// myth-server/src/services/promoCode.service.ts

import db, { PoolClient, QueryExecutor } from "../config/db.config";
import PromoCodeModel from "../models/promoCode.model";
import RewardService from "./reward.service";
import logger from "../utils/logger";
import { RewardItem } from "../types/service.types";
import {
  CreatePromoCodeInput,
  PROMO_CARD_RARITIES,
  PromoCardRarity,
  PromoCode,
  PromoRedemptionFailureReason,
  PromoRedemptionResult,
  PromoRewardSpec,
  UpdatePromoCodeInput,
} from "../types/promo.types";

const FAILURE_MESSAGES: Record<PromoRedemptionFailureReason, string> = {
  not_found: "That promo code doesn't exist.",
  inactive: "That promo code is no longer available.",
  not_started: "That promo code isn't active yet.",
  expired: "That promo code has expired.",
  claim_limit_reached: "That promo code has been fully claimed.",
  already_redeemed: "You've already redeemed that promo code.",
  no_rewards_available:
    "That promo code couldn't be redeemed right now. Please try again later.",
};

function failure(reason: PromoRedemptionFailureReason) {
  return { success: false as const, reason, message: FAILURE_MESSAGES[reason] };
}

/**
 * Classify why an otherwise-existing code couldn't be claimed. Only called on
 * the failure path, after `reserveClaim` declined, so it can afford a re-read.
 */
function explainIneligibility(
  promo: PromoCode
): PromoRedemptionFailureReason | null {
  const now = Date.now();
  if (!promo.is_active) return "inactive";
  if (promo.starts_at && new Date(promo.starts_at).getTime() > now)
    return "not_started";
  if (promo.expires_at && new Date(promo.expires_at).getTime() <= now)
    return "expired";
  if (promo.max_claims !== null && promo.claim_count >= promo.max_claims)
    return "claim_limit_reached";
  return null;
}

const PromoCodeService = {
  /**
   * Validate an authored reward payload. Returns a list of human-readable
   * problems; empty means the payload is well-formed. Used by the admin
   * create/update endpoints so bad configs are rejected at authoring time
   * rather than silently granting nothing at redemption time.
   */
  validateRewards(rewards: unknown): string[] {
    const errors: string[] = [];
    if (!Array.isArray(rewards)) {
      return ["`rewards` must be an array."];
    }
    if (rewards.length === 0) {
      return ["`rewards` must contain at least one reward."];
    }

    const amountTypes = new Set([
      "gems",
      "gold",
      "fate_coins",
      "card_fragments",
      "packs",
    ]);

    rewards.forEach((raw, index) => {
      const at = `rewards[${index}]`;
      if (!raw || typeof raw !== "object") {
        errors.push(`${at} must be an object.`);
        return;
      }
      const item = raw as Record<string, unknown>;
      const type = item.type;

      if (typeof type !== "string") {
        errors.push(`${at}.type is required.`);
        return;
      }

      if (amountTypes.has(type)) {
        const amount = item.amount;
        if (typeof amount !== "number" || !Number.isFinite(amount)) {
          errors.push(`${at}.amount must be a number.`);
        } else if (!Number.isInteger(amount) || amount <= 0) {
          errors.push(`${at}.amount must be a positive integer.`);
        }
        return;
      }

      if (type === "card") {
        if (typeof item.card_variant_id !== "string" || !item.card_variant_id) {
          errors.push(`${at}.card_variant_id must be a card variant UUID.`);
        }
        return;
      }

      if (type === "border") {
        if (typeof item.border_id !== "string" || !item.border_id) {
          errors.push(`${at}.border_id must be a border id.`);
        }
        return;
      }

      if (type === "card_back") {
        if (typeof item.back_id !== "string" || !item.back_id) {
          errors.push(`${at}.back_id must be a card back UUID.`);
        }
        return;
      }

      if (type === "random_card") {
        if (
          typeof item.rarity !== "string" ||
          !PROMO_CARD_RARITIES.includes(item.rarity as PromoCardRarity)
        ) {
          errors.push(
            `${at}.rarity must be one of: ${PROMO_CARD_RARITIES.join(", ")}.`
          );
        }
        if (item.count !== undefined) {
          const count = item.count;
          if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) {
            errors.push(`${at}.count must be a positive integer.`);
          }
        }
        if (item.base_only !== undefined && typeof item.base_only !== "boolean") {
          errors.push(`${at}.base_only must be a boolean.`);
        }
        return;
      }

      errors.push(`${at}.type "${type}" is not a supported reward type.`);
    });

    return errors;
  },

  /**
   * Draw `count` random card variants of the given rarity.
   *
   * `card_variants.rarity` stores cosmetic upgrade tiers as suffixes ("rare",
   * "rare+", "rare++", "rare+++"), which all share a base rarity. A promo
   * asking for a "rare" card therefore draws from the whole `rare*` family by
   * stripping the suffix — matching `rarity = 'rare'` exactly would silently
   * exclude most of the pool. Pass `baseOnly` to restrict to the unsuffixed
   * tier when a promo should never hand out upgraded variants.
   *
   * Draws without replacement within a single call, so
   * `{ rarity: "rare", count: 3 }` yields three distinct cards when the pool
   * allows (and fewer if it doesn't).
   */
  async drawRandomVariants(
    rarity: PromoCardRarity,
    count: number,
    executor: QueryExecutor,
    baseOnly = false
  ): Promise<string[]> {
    const result = await executor.query(
      baseOnly
        ? `SELECT card_variant_id FROM card_variants
            WHERE rarity = $1
            ORDER BY random()
            LIMIT $2`
        : `SELECT card_variant_id FROM card_variants
            WHERE replace(rarity, '+', '') = $1
            ORDER BY random()
            LIMIT $2`,
      [rarity, count]
    );
    return result.rows.map((row: any) => row.card_variant_id);
  },

  /**
   * Expand authored reward specs into concrete RewardItems that
   * RewardService.grantRewards understands. `random_card` entries are resolved
   * here; everything else passes through.
   */
  async resolveRewards(
    rewards: PromoRewardSpec[],
    executor: QueryExecutor
  ): Promise<RewardItem[]> {
    const resolved: RewardItem[] = [];

    for (const spec of rewards) {
      if (spec.type === "random_card") {
        const count = spec.count ?? 1;
        const variantIds = await this.drawRandomVariants(
          spec.rarity,
          count,
          executor,
          spec.base_only ?? false
        );
        if (variantIds.length < count) {
          logger.warn(
            "Promo random_card pool smaller than requested count",
            { rarity: spec.rarity, requested: count, drawn: variantIds.length }
          );
        }
        for (const cardVariantId of variantIds) {
          resolved.push({ type: "card", card_variant_id: cardVariantId });
        }
        continue;
      }
      resolved.push(spec as RewardItem);
    }

    return resolved;
  },

  /**
   * Redeem a code for a user.
   *
   * Everything runs in one transaction: reserve the claim (atomic guard against
   * exceeding max_claims), insert the per-user redemption row (unique key gives
   * the one-claim-per-user guarantee), resolve random cards, then grant. Any
   * failure rolls the claim_count increment back, so a failed grant never burns
   * a claim slot.
   */
  async redeem(userId: string, rawCode: string): Promise<PromoRedemptionResult> {
    const code = PromoCodeModel.normalizeCode(rawCode ?? "");
    if (!code) {
      return failure("not_found");
    }

    const client: PoolClient = await db.getClient();
    try {
      await client.query("BEGIN");

      const promo = await PromoCodeModel.findByCode(code, client);
      if (!promo) {
        await client.query("ROLLBACK");
        return failure("not_found");
      }

      // Cheap pre-check so the common rejection paths report a precise reason
      // without relying on the post-hoc explain below.
      const ineligible = explainIneligibility(promo);
      if (ineligible) {
        await client.query("ROLLBACK");
        return failure(ineligible);
      }

      if (await PromoCodeModel.hasRedeemed(promo.promo_code_id, userId, client)) {
        await client.query("ROLLBACK");
        return failure("already_redeemed");
      }

      // Atomic reservation — the row lock here serializes concurrent redeems.
      const reserved = await PromoCodeModel.reserveClaim(
        promo.promo_code_id,
        client
      );
      if (!reserved) {
        await client.query("ROLLBACK");
        // Lost a race against another claimer (or the code changed underneath
        // us); re-read to report the current reason.
        const current = await PromoCodeModel.findById(promo.promo_code_id);
        return failure(
          (current && explainIneligibility(current)) || "claim_limit_reached"
        );
      }

      // Unique (promo_code_id, user_id) — a concurrent double-submit from the
      // same user loses here even though it passed the check above.
      const redemption = await PromoCodeModel.insertRedemption(
        promo.promo_code_id,
        userId,
        [],
        client
      );
      if (!redemption) {
        await client.query("ROLLBACK");
        return failure("already_redeemed");
      }

      const resolved = await this.resolveRewards(promo.rewards, client);
      if (resolved.length === 0) {
        await client.query("ROLLBACK");
        return failure("no_rewards_available");
      }

      const grant = await RewardService.grantRewards(userId, resolved, {
        client,
      });
      if (!grant.success) {
        await client.query("ROLLBACK");
        logger.error("Promo code grant failed", {
          userId,
          code,
          error: grant.error,
        });
        return failure("no_rewards_available");
      }

      // Persist the receipt of what was actually granted.
      await client.query(
        `UPDATE promo_code_redemptions SET granted = $1::jsonb
          WHERE promo_code_id = $2 AND user_id = $3`,
        [JSON.stringify(resolved), promo.promo_code_id, userId]
      );

      await client.query("COMMIT");

      logger.info("Promo code redeemed", {
        userId,
        code,
        promoCodeId: promo.promo_code_id,
        rewardCount: resolved.length,
      });

      return {
        success: true,
        promo_code_id: promo.promo_code_id,
        code: promo.code,
        description: promo.description,
        granted: resolved,
        updated_currencies: grant.updated_currencies,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(
        "Promo code redemption failed",
        { userId, code },
        error instanceof Error ? error : new Error(String(error))
      );
      return failure("no_rewards_available");
    } finally {
      client.release();
    }
  },

  /**
   * Look up a code without claiming it, so the client can show what's on offer
   * (and whether this user can still claim) before committing.
   */
  async preview(userId: string, rawCode: string) {
    const promo = await PromoCodeModel.findByCode(rawCode ?? "");
    if (!promo) {
      return { eligible: false as const, ...failure("not_found") };
    }

    const alreadyRedeemed = await PromoCodeModel.hasRedeemed(
      promo.promo_code_id,
      userId
    );
    const reason = alreadyRedeemed
      ? "already_redeemed"
      : explainIneligibility(promo);

    return {
      eligible: !reason,
      code: promo.code,
      description: promo.description,
      rewards: promo.rewards,
      ...(reason
        ? { success: false as const, reason, message: FAILURE_MESSAGES[reason] }
        : {}),
    };
  },

  // ---- Admin surface -------------------------------------------------------

  async list(filters: {
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
  }) {
    return PromoCodeModel.list(filters);
  },

  async getById(promoCodeId: string) {
    return PromoCodeModel.findById(promoCodeId);
  },

  async create(input: CreatePromoCodeInput): Promise<PromoCode> {
    return PromoCodeModel.create(input);
  },

  async update(
    promoCodeId: string,
    input: UpdatePromoCodeInput
  ): Promise<PromoCode | null> {
    return PromoCodeModel.update(promoCodeId, input);
  },

  async delete(promoCodeId: string): Promise<boolean> {
    return PromoCodeModel.delete(promoCodeId);
  },

  async listRedemptions(
    promoCodeId: string,
    filters: { limit?: number; offset?: number } = {}
  ) {
    return PromoCodeModel.listRedemptions(promoCodeId, filters);
  },
};

export default PromoCodeService;
