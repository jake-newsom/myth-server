import db from "../config/db.config";
import { InGameCard, PowerValues, TriggerMoment } from "../types/card.types";
import { RANKED_DRAFT_CONFIG } from "../config/constants";

/**
 * Turning drafted CATALOG cards into cards the engine can play.
 *
 * The engine addresses every card by `user_card_instance_id`, and
 * GameLogic.hydrateCardInstances resolves those through a join on
 * `user_owned_cards` with an ownership filter. Drafted cards are catalog rows
 * that nobody owns, so they have no such id.
 *
 * Sagas already solved exactly this (see sagaBattle.hydration.ts): mint a
 * synthetic instance id that can never collide with a real one, and hand the
 * engine a fully-built InGameCard up front. The engine treats instance ids as
 * opaque keys into `hydrated_card_data_cache` and only touches the database on
 * a cache MISS, so a fully pre-seeded cache never reaches the DB at all.
 *
 * The alternative — inserting real "ephemeral" user_owned_cards rows — was
 * rejected deliberately: that table is read in ~74 places (packs, sacrifice,
 * fate picks, daily tasks, achievements, XP, the deck editor), and a single
 * missed exclusion would leak draft cards into a player's permanent
 * collection. This approach writes nothing.
 *
 * ============================ READ THIS ============================
 * Seeding the cache for the ENTIRE deck is load-bearing, not an optimisation.
 * The three lazy re-hydration sites — namespace.game.ts (hand top-up on join),
 * game.utils.ts (board/hand repair) and game.logic.ts (drawCard) — are each
 * guarded by `if (!cache[id])` and each SWALLOW failures. Worse, a `draft-*`
 * id does not throw there: it simply matches zero rows. So a partially seeded
 * deck would not crash; it would surface as a card silently going blank the
 * moment it is drawn, far from the real cause.
 *
 * assertDraftCacheComplete() below exists to turn that class of bug into a
 * loud failure at draft-completion time instead.
 * ==================================================================
 */

/** Marks a synthetic draft instance id. Never collides with a real uuid. */
const DRAFT_INSTANCE_PREFIX = "draft-";

/**
 * Synthetic instance id for one copy of a drafted card.
 *
 * A draft pick becomes COPIES_PER_PICK distinct cards in the deck, so the copy
 * index is part of the id — two copies of Amaterasu must be two separately
 * addressable cards on the board.
 */
export function draftInstanceId(
  cardVariantId: string,
  copyIndex: number
): string {
  return `${DRAFT_INSTANCE_PREFIX}${cardVariantId}-${copyIndex}`;
}

/** True if an instance id belongs to a ranked draft (i.e. has no DB row). */
export function isDraftInstanceId(instanceId: string): boolean {
  return instanceId.startsWith(DRAFT_INSTANCE_PREFIX);
}

/** Recovers the card_variant_id a synthetic draft instance id was minted from. */
export function cardVariantIdFromDraftInstanceId(
  instanceId: string
): string | null {
  if (!isDraftInstanceId(instanceId)) return null;
  const body = instanceId.slice(DRAFT_INSTANCE_PREFIX.length);
  // The trailing "-<copyIndex>" is ours; everything before it is the uuid.
  const lastDash = body.lastIndexOf("-");
  return lastDash === -1 ? body : body.slice(0, lastDash);
}

/** One row of the catalog query below. */
interface DraftCatalogRow {
  card_variant_id: string;
  character_id: string;
  name: string;
  rarity: string;
  image_url: string;
  base_power_top: string;
  base_power_right: string;
  base_power_bottom: string;
  base_power_left: string;
  tags: string[];
  set_id: string;
  special_ability_id: string | null;
  attack_animation: string | null;
  is_exclusive: boolean | null;
  sound_effect: string | null;
  ability_key: string | null;
  ability_name: string | null;
  ability_description: string | null;
  ability_triggers: TriggerMoment[] | null;
  ability_parameters: unknown;
  ability_sound_effect: string | null;
}

/**
 * Reads drafted variants straight from the catalog.
 *
 * Deliberately does NOT join user_owned_cards, user_card_power_ups or
 * card_borders: a drafted card is defined to be level 1 with no power-ups and
 * no border, so there is nothing per-player to look up. This is what makes the
 * format collection-independent.
 */
export async function fetchDraftCatalogRows(
  cardVariantIds: string[]
): Promise<Map<string, DraftCatalogRow>> {
  const byId = new Map<string, DraftCatalogRow>();
  if (cardVariantIds.length === 0) return byId;

  const { rows } = await db.query(
    `
      SELECT
        cv.card_variant_id, ch.character_id, ch.name, cv.rarity, cv.image_url,
        ch.base_power->>'top' as base_power_top,
        ch.base_power->>'right' as base_power_right,
        ch.base_power->>'bottom' as base_power_bottom,
        ch.base_power->>'left' as base_power_left,
        ch.tags, ch.set_id, ch.special_ability_id,
        cv.attack_animation, cv.is_exclusive,
        COALESCE(cv.sound_effect, ch.sound_effect) as sound_effect,
        sa.id as ability_key, sa.name as ability_name,
        sa.description as ability_description,
        sa.trigger_moments as ability_triggers,
        sa.parameters as ability_parameters,
        sa.sound_effect as ability_sound_effect
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
      WHERE cv.card_variant_id = ANY($1::uuid[]);
    `,
    [cardVariantIds]
  );

  for (const row of rows as DraftCatalogRow[]) {
    byId.set(row.card_variant_id, row);
  }
  return byId;
}

/**
 * Builds one playable card from a catalog row.
 *
 * Level 1, xp 0, no power enhancements and no border, so `current_power` is
 * exactly the character's base power — the whole point of the draft format.
 */
export function buildDraftCard(
  row: DraftCatalogRow,
  ownerUserId: string,
  instanceId: string
): InGameCard {
  const basePower: PowerValues = {
    top: parseInt(row.base_power_top, 10),
    right: parseInt(row.base_power_right, 10),
    bottom: parseInt(row.base_power_bottom, 10),
    left: parseInt(row.base_power_left, 10),
  };
  const zero: PowerValues = { top: 0, right: 0, bottom: 0, left: 0 };

  return {
    user_card_instance_id: instanceId,
    base_card_id: row.card_variant_id,
    base_card_data: {
      card_id: row.card_variant_id,
      character_id: row.character_id,
      name: row.name,
      rarity: row.rarity as InGameCard["base_card_data"]["rarity"],
      image_url: row.image_url,
      base_power: basePower,
      set_id: row.set_id,
      tags: row.tags ?? [],
      is_exclusive: row.is_exclusive ?? false,
      special_ability: row.ability_name
        ? {
            ability_id: row.special_ability_id as string,
            id: row.ability_key ?? (row.special_ability_id as string),
            name: row.ability_name,
            description: row.ability_description as string,
            triggerMoments: (row.ability_triggers as TriggerMoment[]) || [],
            parameters: row.ability_parameters,
            sound_effect: row.ability_sound_effect ?? null,
          }
        : null,
      ...(row.attack_animation && { attack_animation: row.attack_animation }),
      ...(row.sound_effect && { sound_effect: row.sound_effect }),
      // Drafted cards are cosmetically bare by design.
      equipped_border: null,
    },
    level: 1,
    xp: 0,
    is_locked: false,
    power_enhancements: { ...zero },
    current_power: { ...basePower },
    owner: ownerUserId,
    original_owner: ownerUserId,
    card_modifiers_positive: { ...zero },
    card_modifiers_negative: { ...zero },
    temporary_effects: [],
    lockedTurns: 0,
    lockedBy: null,
    defeats: [],
  } as InGameCard;
}

/**
 * Expands a player's picks into their full deck of synthetic instances.
 *
 * Returns the instance ids (deck order, pre-shuffle) alongside the cache
 * entries the game state must carry for them.
 */
export async function hydrateDraftPicks(
  cardVariantIds: string[],
  ownerUserId: string
): Promise<{ instanceIds: string[]; cache: Map<string, InGameCard> }> {
  const catalog = await fetchDraftCatalogRows(cardVariantIds);

  const missing = cardVariantIds.filter((id) => !catalog.has(id));
  if (missing.length > 0) {
    // Loud on purpose: a pick that cannot be hydrated must never reach a game.
    throw new Error(
      `[draftBattle] Cannot hydrate drafted card_variant_ids (not found in catalog): ${missing.join(", ")}`
    );
  }

  const instanceIds: string[] = [];
  const cache = new Map<string, InGameCard>();

  for (const variantId of cardVariantIds) {
    const row = catalog.get(variantId)!;
    for (let copy = 0; copy < RANKED_DRAFT_CONFIG.COPIES_PER_PICK; copy++) {
      const instanceId = draftInstanceId(variantId, copy);
      instanceIds.push(instanceId);
      cache.set(instanceId, buildDraftCard(row, ownerUserId, instanceId));
    }
  }

  return { instanceIds, cache };
}

/**
 * Fails loudly if any card in either deck is missing from the cache.
 *
 * Called before the `games` row is written. See the header note: an incomplete
 * cache is invisible at runtime and only shows up as a blank card mid-match, so
 * this converts it into an error at the point the mistake was actually made.
 */
export function assertDraftCacheComplete(
  deckInstanceIds: string[],
  cache: Record<string, InGameCard>
): void {
  const missing = deckInstanceIds.filter((id) => !cache[id]);
  if (missing.length > 0) {
    throw new Error(
      `[draftBattle] Refusing to create a draft game with an incomplete card cache. ` +
        `${missing.length} of ${deckInstanceIds.length} instance(s) unhydrated: ${missing.join(", ")}`
    );
  }
}

/**
 * Maps drafted CHARACTERS back to the real owned instances that should receive
 * post-match XP.
 *
 * Synthetic ids exist only inside the game state, and XpService.awardDirectCardXp
 * filters on `user_owned_cards.user_card_instance_id = ANY($1) AND user_id = $2`
 * — a draft id matches zero rows and throws nothing, so XP would silently
 * vanish. This resolves each drafted variant to the player's own best copy of
 * that character (highest level, then xp).
 *
 * Players routinely draft characters they do not own — that is the point of a
 * catalog draft — so unowned picks are simply skipped rather than treated as an
 * error. Deduped by character so drafting two variants of one character does
 * not double-award.
 */
export async function resolveDraftXpTargets(
  userId: string,
  cardVariantIds: string[]
): Promise<{ card_id: string; card_name: string }[]> {
  if (cardVariantIds.length === 0) return [];

  const { rows } = await db.query(
    `
      SELECT DISTINCT ON (ch.character_id)
        uoc.user_card_instance_id, ch.name
      FROM "card_variants" target_cv
      JOIN "characters" ch ON target_cv.character_id = ch.character_id
      JOIN "card_variants" owned_cv ON owned_cv.character_id = ch.character_id
      JOIN "user_owned_cards" uoc
        ON uoc.card_variant_id = owned_cv.card_variant_id
       AND uoc.user_id = $2
      WHERE target_cv.card_variant_id = ANY($1::uuid[])
      ORDER BY ch.character_id, uoc.level DESC, uoc.xp DESC;
    `,
    [cardVariantIds, userId]
  );

  return rows.map((r: { user_card_instance_id: string; name: string }) => ({
    card_id: r.user_card_instance_id,
    card_name: r.name,
  }));
}
