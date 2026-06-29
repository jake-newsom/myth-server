import BorderModel, {
  CardBorderInput,
  CardBorderUpdate,
  CharacterBorderAvailabilityRow,
  OwnedBorderRow,
} from "../models/border.model";
import { CardBorder } from "../types/database.types";
import { redisCache } from "./redis.cache.service";
import { cacheInvalidation } from "./cache.invalidation.service";
import logger from "../utils/logger";
import { QueryExecutor } from "../config/db.config";
import CharacterModel from "../models/character.model";
import {
  meetsMinAppVersion,
  VersionGateOptions,
} from "../utils/catalogVersion";

/**
 * Border Service
 *
 * Encapsulates business rules around the border catalog and player ownership /
 * equip operations. The service is the single layer that:
 *   - applies redis caching on the global active-border catalog
 *   - invalidates user card caches whenever an equipped border changes (so
 *     CardResponse payloads stay fresh)
 *   - enforces silent-ignore semantics on duplicate border grants
 *
 * Restriction validation is enforced inside the model SQL itself (see
 * BorderModel.equipBorderOnInstance / equipBorderOnAllEmpty); the service only
 * needs to interpret zero-row results into a meaningful error to the caller.
 */

const ACTIVE_CATALOG_CACHE_KEY = "borders:active";
const CATALOG_CACHE_TTL_SECONDS = 60 * 30; // 30 minutes

export interface EquipResult {
  success: boolean;
  error?: string;
  user_card_instance_id?: string;
  equipped_border_id?: string | null;
}

export interface BulkEquipResult {
  success: boolean;
  affected_count: number;
  error?: string;
}

const BorderService = {
  // ============================================================================
  // CATALOG (cached)
  // ============================================================================

  /**
   * Returns the active border catalog, gated by the requesting client's app
   * version. The cache stores the full active list (version-agnostic) so one
   * caller's version never poisons it for others; min_app_version filtering is
   * applied per-request after the cache read.
   */
  async getActiveCatalog(
    versionOptions: VersionGateOptions = {}
  ): Promise<CardBorder[]> {
    let borders = await redisCache.get<CardBorder[]>(ACTIVE_CATALOG_CACHE_KEY);
    if (!borders) {
      borders = await BorderModel.listActive();
      await redisCache.set(
        ACTIVE_CATALOG_CACHE_KEY,
        borders,
        CATALOG_CACHE_TTL_SECONDS
      );
    }
    return borders.filter((b) =>
      meetsMinAppVersion(b.min_app_version, versionOptions)
    );
  },

  async getFullCatalog(): Promise<CardBorder[]> {
    return BorderModel.listAll();
  },

  async getById(borderId: string): Promise<CardBorder | null> {
    return BorderModel.findById(borderId);
  },

  async invalidateCatalogCache(): Promise<void> {
    try {
      await redisCache.delete(ACTIVE_CATALOG_CACHE_KEY);
    } catch (error) {
      logger.error(
        "Failed to invalidate border catalog cache",
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  },

  // ============================================================================
  // ADMIN: catalog mutation
  // ============================================================================

  async createBorder(input: CardBorderInput): Promise<CardBorder> {
    const border = await BorderModel.create(input);
    await this.invalidateCatalogCache();
    return border;
  },

  async updateBorder(
    borderId: string,
    updates: CardBorderUpdate
  ): Promise<CardBorder | null> {
    const border = await BorderModel.update(borderId, updates);
    await this.invalidateCatalogCache();
    return border;
  },

  async deactivateBorder(borderId: string): Promise<CardBorder | null> {
    const border = await BorderModel.softDelete(borderId);
    await this.invalidateCatalogCache();
    return border;
  },

  // ============================================================================
  // OWNERSHIP
  // ============================================================================

  /**
   * Grant a single border to a user, optionally scoped to a character.
   * Returns true if newly granted, false if already owned (silently ignored).
   */
  async grantBorder(
    userId: string,
    borderId: string,
    characterId?: string | null,
    client?: QueryExecutor
  ): Promise<boolean> {
    return BorderModel.grantToUser(userId, borderId, characterId, client);
  },

  /**
   * Bulk grant borders to a user; returns the subset that were newly granted.
   * Each grant may optionally scope ownership to a specific character.
   */
  async grantBordersBulk(
    userId: string,
    grants: Array<{ border_id: string; character_id?: string | null }>,
    client?: QueryExecutor
  ): Promise<string[]> {
    return BorderModel.grantBulkToUser(userId, grants, client);
  },

  async revokeBorder(userId: string, borderId: string): Promise<boolean> {
    const removed = await BorderModel.revokeFromUser(userId, borderId);
    if (removed) {
      // The revoke also unequipped any cards using this border, so refresh
      // user card caches so the next read reflects the cleared border.
      await cacheInvalidation.invalidateUserCards(userId);
    }
    return removed;
  },

  async getUserOwnedBorders(userId: string): Promise<OwnedBorderRow[]> {
    return BorderModel.listOwnedWithDetails(userId);
  },

  async getUserOwnedBorderIds(userId: string): Promise<string[]> {
    return BorderModel.listOwnedBorderIds(userId);
  },

  async getCharacterEligibleBorders(
    userId: string,
    characterId: string
  ): Promise<{
    success: boolean;
    data: CharacterBorderAvailabilityRow[];
    error?: string;
  }> {
    const character = await CharacterModel.findById(characterId);
    if (!character) {
      return { success: false, data: [], error: "Character not found" };
    }

    const data = await BorderModel.listApplicableForCharacter(userId, characterId);
    return { success: true, data };
  },

  // ============================================================================
  // EQUIP / UNEQUIP
  // ============================================================================

  /**
   * Set or clear the equipped border on a single card instance.
   *
   * If borderId is null, unequips. If borderId is provided, validates the
   * card-and-border combination atomically inside the UPDATE and rejects if:
   *   - the card doesn't belong to the user
   *   - the user doesn't own the border
   *   - the border is inactive
   *   - the border's restrictions don't match the card's character/set
   *
   * Failure modes are surfaced via a structured EquipResult; the caller does
   * not need to perform additional lookups.
   */
  async setEquippedBorder(
    userId: string,
    instanceId: string,
    borderId: string | null
  ): Promise<EquipResult> {
    if (borderId === null) {
      const result = await BorderModel.unequipBorderOnInstance(
        userId,
        instanceId
      );
      if (!result) {
        return { success: false, error: "Card not found for user" };
      }
      await cacheInvalidation.invalidateUserCards(userId);
      return {
        success: true,
        user_card_instance_id: result.user_card_instance_id,
        equipped_border_id: null,
      };
    }

    const updated = await BorderModel.equipBorderOnInstance(
      userId,
      instanceId,
      borderId
    );
    if (!updated) {
      // Diagnose why the UPDATE matched zero rows so the client gets a
      // meaningful error. Costs at most three cheap point lookups, only on
      // the failure path.
      return this.diagnoseSingleEquipFailure(userId, instanceId, borderId);
    }
    await cacheInvalidation.invalidateUserCards(userId);
    return {
      success: true,
      user_card_instance_id: updated.user_card_instance_id,
      equipped_border_id: updated.equipped_border_id,
    };
  },

  async equipBorderOnAllEmpty(
    userId: string,
    borderId: string
  ): Promise<BulkEquipResult> {
    const owns = await BorderModel.userOwnsBorder(userId, borderId);
    if (!owns) {
      return {
        success: false,
        affected_count: 0,
        error: "User does not own this border",
      };
    }

    const border = await BorderModel.findById(borderId);
    if (!border || !border.is_active) {
      return {
        success: false,
        affected_count: 0,
        error: "Border is not available",
      };
    }

    const affected = await BorderModel.equipBorderOnAllEmpty(userId, borderId);
    if (affected > 0) {
      await cacheInvalidation.invalidateUserCards(userId);
    }
    return { success: true, affected_count: affected };
  },

  async unequipAll(userId: string): Promise<BulkEquipResult> {
    const affected = await BorderModel.unequipAllForUser(userId);
    if (affected > 0) {
      await cacheInvalidation.invalidateUserCards(userId);
    }
    return { success: true, affected_count: affected };
  },

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  /**
   * Failure diagnostics for the single-equip path. The model UPDATE returns
   * zero rows for any of: missing card, missing ownership, inactive border,
   * restriction mismatch. To give the client a precise error, we only run
   * these point lookups when the UPDATE failed.
   */
  async diagnoseSingleEquipFailure(
    userId: string,
    instanceId: string,
    borderId: string
  ): Promise<EquipResult> {
    const [border, owns] = await Promise.all([
      BorderModel.findById(borderId),
      BorderModel.userOwnsBorder(userId, borderId),
    ]);

    if (!border) {
      return { success: false, error: "Border not found" };
    }
    if (!border.is_active) {
      return { success: false, error: "Border is not available" };
    }
    if (!owns) {
      return { success: false, error: "User does not own this border" };
    }
    // If the border has an application cap, check whether it's already met
    // (excluding the card being targeted, mirroring the equip UPDATE).
    if (border.max_equipped != null) {
      const equippedCount = await BorderModel.countEquippedForBorder(
        userId,
        borderId
      );
      // The targeted card may already wear this border; if so the equip is a
      // no-op rather than cap-blocked, so only report the cap when the count of
      // *other* cards meets it. We don't know here whether this instance is one
      // of them, so conservatively report the cap when the total meets it.
      if (equippedCount >= border.max_equipped) {
        return {
          success: false,
          error: `This border can only be applied to ${border.max_equipped} card${
            border.max_equipped === 1 ? "" : "s"
          } at once.`,
        };
      }
    }
    // At this point, either the card doesn't belong to the user or the
    // restriction failed. Both produce the same generic message; the client
    // can validate locally against the catalog metadata if a richer hint is
    // needed.
    return {
      success: false,
      error: "Border cannot be equipped on this card",
    };
  },
};

export default BorderService;
