import db, { QueryExecutor } from "../config/db.config";
import {
  CardBorder,
  EquippedBorder,
} from "../types/database.types";

/**
 * Border Model
 *
 * Data access for the card-border catalog and per-user ownership / equip state.
 *
 * Performance notes:
 * - All multi-row writes (grant, equip-all, unequip-all) are single round-trip,
 *   set-based statements.
 * - Equip operations validate ownership and restriction in the same statement
 *   via a self-join, so we never run separate SELECTs before the UPDATE.
 * - Restriction filters use partial indexes on card_borders (active + character_id
 *   / set_id) and the partial indexes on user_owned_cards keyed by
 *   equipped_border_id IS NULL / NOT NULL (added in the migration).
 */

export interface CardBorderInput {
  name: string;
  description?: string | null;
  image_url: string;
  animation_key?: string | null;
  character_id?: string | null;
  set_id?: string | null;
  min_app_version?: string | null;
  max_equipped?: number | null;
}

export interface CardBorderUpdate {
  name?: string;
  description?: string | null;
  image_url?: string;
  animation_key?: string | null;
  character_id?: string | null;
  set_id?: string | null;
  is_active?: boolean;
  min_app_version?: string | null;
  max_equipped?: number | null;
}

export interface OwnedBorderRow extends CardBorder {
  acquired_at: Date;
}

export interface CharacterBorderAvailabilityRow extends CardBorder {
  is_owned: boolean;
  is_locked: boolean;
  /** How many of the user's cards currently have this border equipped. */
  used_count: number;
}

function rowToCardBorder(row: any): CardBorder {
  return {
    border_id: row.border_id,
    name: row.name,
    description: row.description ?? null,
    image_url: row.image_url,
    animation_key: row.animation_key ?? null,
    character_id: row.character_id ?? null,
    set_id: row.set_id ?? null,
    is_active: row.is_active,
    min_app_version: row.min_app_version ?? null,
    max_equipped: row.max_equipped ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const BorderModel = {
  // ============================================================================
  // CATALOG
  // ============================================================================

  /**
   * List all active borders. Used for the user-facing catalog.
   */
  async listActive(): Promise<CardBorder[]> {
    const query = `
      SELECT border_id, name, description, image_url, animation_key,
             character_id, set_id, is_active, min_app_version, max_equipped,
             created_at, updated_at
      FROM "card_borders"
      WHERE is_active = true
      ORDER BY name ASC;
    `;
    const { rows } = await db.query(query);
    return rows.map(rowToCardBorder);
  },

  /**
   * List every border in the catalog including inactive ones (admin tooling).
   */
  async listAll(): Promise<CardBorder[]> {
    const query = `
      SELECT border_id, name, description, image_url, animation_key,
             character_id, set_id, is_active, min_app_version, max_equipped,
             created_at, updated_at
      FROM "card_borders"
      ORDER BY is_active DESC, name ASC;
    `;
    const { rows } = await db.query(query);
    return rows.map(rowToCardBorder);
  },

  async findById(borderId: string): Promise<CardBorder | null> {
    const query = `
      SELECT border_id, name, description, image_url, animation_key,
             character_id, set_id, is_active, min_app_version, max_equipped,
             created_at, updated_at
      FROM "card_borders"
      WHERE border_id = $1;
    `;
    const { rows } = await db.query(query, [borderId]);
    return rows.length > 0 ? rowToCardBorder(rows[0]) : null;
  },

  async create(input: CardBorderInput): Promise<CardBorder> {
    const query = `
      INSERT INTO "card_borders"
        (name, description, image_url, animation_key, character_id, set_id, is_active, min_app_version, max_equipped)
      VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
      RETURNING border_id, name, description, image_url, animation_key,
                character_id, set_id, is_active, min_app_version, max_equipped,
                created_at, updated_at;
    `;
    const { rows } = await db.query(query, [
      input.name,
      input.description ?? null,
      input.image_url,
      input.animation_key ?? null,
      input.character_id ?? null,
      input.set_id ?? null,
      input.min_app_version ?? null,
      input.max_equipped ?? null,
    ]);
    return rowToCardBorder(rows[0]);
  },

  async update(
    borderId: string,
    updates: CardBorderUpdate
  ): Promise<CardBorder | null> {
    const setClauses: string[] = [];
    const values: any[] = [borderId];
    let idx = 2;

    const assign = (column: string, value: any) => {
      setClauses.push(`${column} = $${idx}`);
      values.push(value);
      idx++;
    };

    if (updates.name !== undefined) assign("name", updates.name);
    if (updates.description !== undefined)
      assign("description", updates.description);
    if (updates.image_url !== undefined) assign("image_url", updates.image_url);
    if (updates.animation_key !== undefined)
      assign("animation_key", updates.animation_key);
    if (updates.character_id !== undefined)
      assign("character_id", updates.character_id);
    if (updates.set_id !== undefined) assign("set_id", updates.set_id);
    if (updates.is_active !== undefined) assign("is_active", updates.is_active);
    if (updates.min_app_version !== undefined)
      assign("min_app_version", updates.min_app_version);
    if (updates.max_equipped !== undefined)
      assign("max_equipped", updates.max_equipped);

    if (setClauses.length === 0) {
      return this.findById(borderId);
    }

    setClauses.push(`updated_at = NOW()`);

    const query = `
      UPDATE "card_borders"
      SET ${setClauses.join(", ")}
      WHERE border_id = $1
      RETURNING border_id, name, description, image_url, animation_key,
                character_id, set_id, is_active, min_app_version, max_equipped,
                created_at, updated_at;
    `;
    const { rows } = await db.query(query, values);
    return rows.length > 0 ? rowToCardBorder(rows[0]) : null;
  },

  /**
   * Soft-delete a border by deactivating it. Existing equipped/owned references
   * are preserved (they simply won't render in catalogs / can't be re-granted).
   * Returns the updated row, or null if no border exists with the given id.
   */
  async softDelete(borderId: string): Promise<CardBorder | null> {
    return this.update(borderId, { is_active: false });
  },

  // ============================================================================
  // OWNERSHIP
  // ============================================================================

  /**
   * Grant a single border to a user, optionally scoped to a character.
   * Idempotent - returns true only if the row was newly inserted.
   *
   * When characterId is null the grant is global (usable on any applicable
   * card). When set, the grant is scoped to that character only.
   */
  async grantToUser(
    userId: string,
    borderId: string,
    characterId?: string | null,
    client?: QueryExecutor
  ): Promise<boolean> {
    const exec = client ?? db;
    const query = `
      INSERT INTO "user_owned_borders" (user_id, border_id, character_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, border_id, COALESCE(character_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO NOTHING
      RETURNING border_id;
    `;
    const { rows } = await exec.query(query, [
      userId,
      borderId,
      characterId ?? null,
    ]);
    return rows.length > 0;
  },

  /**
   * Bulk grant. Single round-trip. Returns the set of border_ids that were
   * newly granted to the user (already-owned ids are silently ignored).
   *
   * Each grant may optionally carry a character_id to scope ownership.
   */
  async grantBulkToUser(
    userId: string,
    grants: Array<{ border_id: string; character_id?: string | null }>,
    client?: QueryExecutor
  ): Promise<string[]> {
    if (grants.length === 0) return [];
    const exec = client ?? db;
    const query = `
      INSERT INTO "user_owned_borders" (user_id, border_id, character_id)
      SELECT $1, (g->>'border_id')::uuid, (g->>'character_id')::uuid
      FROM json_array_elements($2::json) AS g
      ON CONFLICT (user_id, border_id, COALESCE(character_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO NOTHING
      RETURNING border_id;
    `;
    const { rows } = await exec.query(query, [
      userId,
      JSON.stringify(
        grants.map((g) => ({
          border_id: g.border_id,
          character_id: g.character_id ?? null,
        }))
      ),
    ]);
    return rows.map((r) => r.border_id);
  },

  async revokeFromUser(userId: string, borderId: string): Promise<boolean> {
    // Detach any equipped instances first so the FK delete doesn't surprise us.
    // Single round-trip CTE.
    const query = `
      WITH unequip AS (
        UPDATE "user_owned_cards"
        SET equipped_border_id = NULL
        WHERE user_id = $1 AND equipped_border_id = $2
      )
      DELETE FROM "user_owned_borders"
      WHERE user_id = $1 AND border_id = $2
      RETURNING border_id;
    `;
    const { rows } = await db.query(query, [userId, borderId]);
    return rows.length > 0;
  },

  /**
   * Returns the distinct border_ids the user currently owns (any scope).
   */
  async listOwnedBorderIds(userId: string): Promise<string[]> {
    const query = `
      SELECT DISTINCT border_id FROM "user_owned_borders" WHERE user_id = $1;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows.map((r) => r.border_id);
  },

  /**
   * Returns the user's owned borders joined with catalog metadata. Active
   * filter is applied so soft-deleted borders are hidden from inventories.
   * Uses DISTINCT ON to collapse per-character rows into one per border.
   */
  async listOwnedWithDetails(userId: string): Promise<OwnedBorderRow[]> {
    const query = `
      SELECT DISTINCT ON (b.border_id)
             b.border_id, b.name, b.description, b.image_url, b.animation_key,
             b.character_id, b.set_id, b.is_active, b.min_app_version,
             b.max_equipped, b.created_at, b.updated_at,
             uob.acquired_at
      FROM "user_owned_borders" uob
      JOIN "card_borders" b ON uob.border_id = b.border_id
      WHERE uob.user_id = $1 AND b.is_active = true
      ORDER BY b.border_id, uob.acquired_at ASC;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows.map((row) => ({
      ...rowToCardBorder(row),
      acquired_at: row.acquired_at,
    }));
  },

  /**
   * Returns all active borders applicable to a specific character and marks
   * whether the authenticated user owns each one.
   *
   * Applicability rules:
   * - unrestricted borders (character_id/set_id both null)
   * - borders restricted to this character_id
   * - borders restricted to this character's set_id, BUT if any active
   *   achievement gates the border (i.e. is its `reward_border_id`), the
   *   character must have an applicable achievement for that border —
   *   either a set-wide one (achievements.character_id IS NULL) or one
   *   scoped to this character. This prevents set-tier achievement rewards
   *   from advertising themselves on characters that have no path to earn
   *   them.
   * - borders restricted to both character and set must match both
   *
   * Ownership is satisfied by either a global grant (character_id IS NULL in
   * user_owned_borders) or a character-scoped grant matching this character.
   */
  async listApplicableForCharacter(
    userId: string,
    characterId: string
  ): Promise<CharacterBorderAvailabilityRow[]> {
    const query = `
      SELECT b.border_id, b.name, b.description, b.image_url, b.animation_key,
             b.character_id, b.set_id, b.is_active, b.min_app_version,
             b.max_equipped, b.created_at, b.updated_at,
             EXISTS(
               SELECT 1 FROM "user_owned_borders" uob
               WHERE uob.user_id = $1
                 AND uob.border_id = b.border_id
                 AND (uob.character_id IS NULL OR uob.character_id = ch.character_id)
             ) AS is_owned,
             (
               SELECT COUNT(*)::int FROM "user_owned_cards" uoc
               WHERE uoc.user_id = $1
                 AND uoc.equipped_border_id = b.border_id
             ) AS used_count
      FROM "characters" ch
      JOIN "card_borders" b ON b.is_active = true
        AND (b.character_id IS NULL OR b.character_id = ch.character_id)
        AND (b.set_id IS NULL OR b.set_id = ch.set_id)
        AND (
          -- Borders that aren't gated by any active achievement are visible
          -- to every character that passes the character/set restrictions.
          NOT EXISTS (
            SELECT 1 FROM "achievements" a
            WHERE a.reward_border_id = b.border_id
              AND a.is_active = true
          )
          -- Otherwise, the character must have an active achievement that
          -- rewards this border — either a set-wide one or one scoped to
          -- this specific character.
          OR EXISTS (
            SELECT 1 FROM "achievements" a
            WHERE a.reward_border_id = b.border_id
              AND a.is_active = true
              AND (a.character_id IS NULL OR a.character_id = ch.character_id)
          )
        )
      WHERE ch.character_id = $2
      ORDER BY b.name ASC;
    `;
    const { rows } = await db.query(query, [userId, characterId]);
    return rows.map((row) => {
      const isOwned = row.is_owned === true;
      const usedCount = row.used_count ?? 0;
      const maxEquipped = row.max_equipped ?? null;
      // Locked if the user doesn't own it, or if it owns it but has already hit
      // the equip cap. The cap check is "in use" — unequipping a card frees a
      // slot. The single-card panel still allows re-selecting a border already
      // on the viewed card (that path is a no-op, gated client-side).
      const capReached =
        maxEquipped !== null && usedCount >= maxEquipped;
      return {
        ...rowToCardBorder(row),
        is_owned: isOwned,
        is_locked: !isOwned || capReached,
        used_count: usedCount,
      };
    });
  },

  /**
   * Count how many of the user's card instances currently have this border
   * equipped. Used to surface a precise "cap reached" error on the equip
   * failure path.
   */
  async countEquippedForBorder(
    userId: string,
    borderId: string
  ): Promise<number> {
    const query = `
      SELECT COUNT(*)::int AS cnt FROM "user_owned_cards"
      WHERE user_id = $1 AND equipped_border_id = $2;
    `;
    const { rows } = await db.query(query, [userId, borderId]);
    return rows[0]?.cnt ?? 0;
  },

  async userOwnsBorder(userId: string, borderId: string): Promise<boolean> {
    const query = `
      SELECT 1 FROM "user_owned_borders"
      WHERE user_id = $1 AND border_id = $2 LIMIT 1;
    `;
    const { rows } = await db.query(query, [userId, borderId]);
    return rows.length > 0;
  },

  // ============================================================================
  // EQUIP / UNEQUIP
  // ============================================================================

  /**
   * Equip a border on a single card instance. The UPDATE itself enforces:
   *   - the card belongs to the user
   *   - the user owns the border (globally or for the card's character)
   *   - the border is active
   *   - the border's restrictions (character_id / set_id) match the card variant
   * If any check fails, zero rows are updated and we return null.
   */
  async equipBorderOnInstance(
    userId: string,
    instanceId: string,
    borderId: string
  ): Promise<{ user_card_instance_id: string; equipped_border_id: string } | null> {
    const query = `
      UPDATE "user_owned_cards" uoc
      SET equipped_border_id = $3
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      JOIN "card_borders" b ON b.border_id = $3
      WHERE uoc.user_card_instance_id = $1
        AND uoc.user_id = $2
        AND uoc.card_variant_id = cv.card_variant_id
        AND b.is_active = true
        AND (b.character_id IS NULL OR cv.character_id = b.character_id)
        AND (b.set_id IS NULL OR ch.set_id = b.set_id)
        AND EXISTS (
          SELECT 1 FROM "user_owned_borders" uob
          WHERE uob.user_id = $2
            AND uob.border_id = $3
            AND (uob.character_id IS NULL OR uob.character_id = cv.character_id)
        )
        AND (
          b.max_equipped IS NULL
          OR (
            -- Count this border's equips excluding the card being updated, so
            -- re-equipping a border already on this card is always allowed.
            SELECT COUNT(*) FROM "user_owned_cards" used
            WHERE used.user_id = $2
              AND used.equipped_border_id = $3
              AND used.user_card_instance_id <> $1
          ) < b.max_equipped
        )
      RETURNING uoc.user_card_instance_id, uoc.equipped_border_id;
    `;
    const { rows } = await db.query(query, [instanceId, userId, borderId]);
    return rows.length > 0
      ? {
          user_card_instance_id: rows[0].user_card_instance_id,
          equipped_border_id: rows[0].equipped_border_id,
        }
      : null;
  },

  /**
   * Unequip whatever border is on a single card instance. Returns the
   * affected row, or null if the card doesn't belong to the user.
   */
  async unequipBorderOnInstance(
    userId: string,
    instanceId: string
  ): Promise<{ user_card_instance_id: string } | null> {
    const query = `
      UPDATE "user_owned_cards"
      SET equipped_border_id = NULL
      WHERE user_card_instance_id = $1 AND user_id = $2
      RETURNING user_card_instance_id;
    `;
    const { rows } = await db.query(query, [instanceId, userId]);
    return rows.length > 0
      ? { user_card_instance_id: rows[0].user_card_instance_id }
      : null;
  },

  /**
   * Equip a border on every empty-border card instance the user owns that
   * passes the border's restriction filter AND for which the user has
   * ownership (global or character-scoped). Single round-trip UPDATE.
   * Returns the count of rows changed.
   *
   * When the border defines max_equipped, only the remaining capacity worth of
   * empty cards is filled (cards already wearing the border still count toward
   * the cap). If the cap is already met, zero cards are changed.
   */
  async equipBorderOnAllEmpty(
    userId: string,
    borderId: string
  ): Promise<number> {
    const query = `
      WITH border AS (
        SELECT b.max_equipped
        FROM "card_borders" b
        WHERE b.border_id = $2 AND b.is_active = true
      ),
      already AS (
        SELECT COUNT(*)::int AS cnt
        FROM "user_owned_cards" uoc
        WHERE uoc.user_id = $1 AND uoc.equipped_border_id = $2
      ),
      eligible AS (
        SELECT uoc.user_card_instance_id
        FROM "user_owned_cards" uoc
        JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
        JOIN "characters" ch ON cv.character_id = ch.character_id
        JOIN "card_borders" b ON b.border_id = $2
        WHERE uoc.user_id = $1
          AND uoc.equipped_border_id IS NULL
          AND b.is_active = true
          AND (b.character_id IS NULL OR cv.character_id = b.character_id)
          AND (b.set_id IS NULL OR ch.set_id = b.set_id)
          AND EXISTS (
            SELECT 1 FROM "user_owned_borders" uob
            WHERE uob.user_id = $1
              AND uob.border_id = $2
              AND (uob.character_id IS NULL OR uob.character_id = cv.character_id)
          )
        -- Cap the fill to the remaining capacity when max_equipped is set.
        LIMIT (
          SELECT CASE
            WHEN border.max_equipped IS NULL THEN NULL
            ELSE GREATEST(border.max_equipped - already.cnt, 0)
          END
          FROM border, already
        )
      )
      UPDATE "user_owned_cards" uoc
      SET equipped_border_id = $2
      FROM eligible
      WHERE uoc.user_card_instance_id = eligible.user_card_instance_id;
    `;
    const result = await db.query(query, [userId, borderId]);
    return result.rowCount ?? 0;
  },

  /**
   * Clear equipped_border_id on every card instance the user owns. Single
   * round-trip UPDATE; uses the partial index keyed on
   * `equipped_border_id IS NOT NULL`.
   */
  async unequipAllForUser(userId: string): Promise<number> {
    const query = `
      UPDATE "user_owned_cards"
      SET equipped_border_id = NULL
      WHERE user_id = $1 AND equipped_border_id IS NOT NULL;
    `;
    const result = await db.query(query, [userId]);
    return result.rowCount ?? 0;
  },

  /**
   * Lightweight helper that returns the equipped border (if any) for a single
   * card instance, projected to the EquippedBorder shape. Used by callers that
   * need to confirm or display equip state outside of the standard card
   * response paths.
   */
  async findEquippedBorderForInstance(
    userId: string,
    instanceId: string
  ): Promise<EquippedBorder | null> {
    const query = `
      SELECT b.border_id, b.name, b.image_url, b.animation_key
      FROM "user_owned_cards" uoc
      JOIN "card_borders" b ON uoc.equipped_border_id = b.border_id
      WHERE uoc.user_card_instance_id = $1 AND uoc.user_id = $2
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [instanceId, userId]);
    if (rows.length === 0) return null;
    return {
      border_id: rows[0].border_id,
      name: rows[0].name,
      image_url: rows[0].image_url,
      animation_key: rows[0].animation_key ?? null,
    };
  },
};

export default BorderModel;
