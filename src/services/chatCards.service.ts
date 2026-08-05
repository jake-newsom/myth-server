import db from "../config/db.config";
import { CHAT_CONFIG } from "../config/constants";
import {
  CardSharePayload,
  ChatCardPresentation,
  ChatError,
} from "../types/chat.types";
import { Rarity } from "../types/card.types";

/**
 * Card lookups used by chat: the share-a-card snapshot and the public
 * showcase ("3 strongest cards") shown in a player's chat profile.
 *
 * Power model note: a card's current power is `base_power + power_up_data`.
 * Level carries no power bonus (see `levelBonus = 0` in game.logic.ts), so it
 * is used only as a tie-break, not as a term in the total.
 */

/** Ranks rarity tiers for tie-breaking. "+" upgrades are cosmetic. */
const RARITY_RANK_SQL = `
  CASE
    WHEN cv.rarity LIKE 'legendary%' THEN 5
    WHEN cv.rarity LIKE 'epic%'      THEN 4
    WHEN cv.rarity LIKE 'rare%'      THEN 3
    WHEN cv.rarity LIKE 'uncommon%'  THEN 2
    ELSE 1
  END
`;

/** Sum of the four directional powers, including any applied power-ups. */
const TOTAL_POWER_SQL = `
  (
    (ch.base_power->>'top')::int +
    (ch.base_power->>'right')::int +
    (ch.base_power->>'bottom')::int +
    (ch.base_power->>'left')::int
  )
  + COALESCE(
      (pu.power_up_data->>'top')::int +
      (pu.power_up_data->>'right')::int +
      (pu.power_up_data->>'bottom')::int +
      (pu.power_up_data->>'left')::int,
      0
    )
`;

export interface ShowcaseCard extends ChatCardPresentation {
  characterName: string;
  rarity: Rarity;
  imageUrl: string | null;
  level: number;
  power: { top: number; right: number; bottom: number; left: number };
  totalPower: number;
}

export interface ShowcaseResult {
  userId: string;
  username: string;
  cards: ShowcaseCard[];
}

/**
 * Extract the presentation fields the client's GameCard needs (set, tags,
 * ability, exclusivity, border) from a joined card row.
 *
 * Snapshotted rather than resolved client-side so a shared card keeps
 * rendering as it was even after the owner re-equips a border or the card is
 * traded away.
 */
function rowToPresentation(row: Record<string, unknown>): ChatCardPresentation {
  return {
    setId: (row.set_id as string) ?? null,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    isExclusive: Boolean(row.is_exclusive),
    specialAbility: row.ability_id
      ? {
          abilityId: String(row.ability_id),
          name: String(row.ability_name ?? ""),
          description: String(row.ability_description ?? ""),
        }
      : null,
    equippedBorder: row.cb_border_id
      ? {
          borderId: String(row.cb_border_id),
          name: String(row.cb_name ?? ""),
          imageUrl: String(row.cb_image_url ?? ""),
          animationKey: (row.cb_animation_key as string) ?? null,
        }
      : null,
  };
}

function rowToPower(row: {
  top: string | number;
  right: string | number;
  bottom: string | number;
  left: string | number;
}): { top: number; right: number; bottom: number; left: number } {
  return {
    top: Number(row.top),
    right: Number(row.right),
    bottom: Number(row.bottom),
    left: Number(row.left),
  };
}

/**
 * Build the snapshot payload for a card share, proving ownership server-side.
 *
 * The client supplies only a `userCardInstanceId`; every stat in the payload
 * is read here, so a client cannot share a card it doesn't own nor inflate the
 * stats of one it does. The payload is a snapshot on purpose — the banner must
 * still render if the card is later levelled, traded or consumed.
 */
export async function buildCardSharePayload(
  userId: string,
  userCardInstanceId: string
): Promise<CardSharePayload> {
  if (!userCardInstanceId || typeof userCardInstanceId !== "string") {
    throw new ChatError("No card specified.", 400, "invalid");
  }

  const query = `
    SELECT
      uoc.user_card_instance_id,
      uoc.card_variant_id,
      uoc.level,
      ch.name AS character_name,
      ch.set_id,
      ch.tags,
      cv.rarity,
      cv.image_url,
      cv.is_exclusive,
      sa.ability_id,
      sa.name AS ability_name,
      sa.description AS ability_description,
      cb.border_id AS cb_border_id,
      cb.name AS cb_name,
      cb.image_url AS cb_image_url,
      cb.animation_key AS cb_animation_key,
      (ch.base_power->>'top')::int
        + COALESCE((pu.power_up_data->>'top')::int, 0)    AS top,
      (ch.base_power->>'right')::int
        + COALESCE((pu.power_up_data->>'right')::int, 0)  AS right,
      (ch.base_power->>'bottom')::int
        + COALESCE((pu.power_up_data->>'bottom')::int, 0) AS bottom,
      (ch.base_power->>'left')::int
        + COALESCE((pu.power_up_data->>'left')::int, 0)   AS left
    FROM "user_owned_cards" uoc
    JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
    JOIN "characters" ch ON cv.character_id = ch.character_id
    LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
    LEFT JOIN "card_borders" cb ON uoc.equipped_border_id = cb.border_id
    LEFT JOIN "user_card_power_ups" pu
      ON pu.user_card_instance_id = uoc.user_card_instance_id
    WHERE uoc.user_card_instance_id = $1
      AND uoc.user_id = $2
    LIMIT 1;
  `;

  const { rows } = await db.query(query, [userCardInstanceId, userId]);
  const row = rows[0];

  if (!row) {
    // Same error whether the card is missing or owned by someone else, so
    // this can't be used to probe other players' collections.
    throw new ChatError("Card not found.", 404, "not_found");
  }

  return {
    userCardInstanceId: row.user_card_instance_id,
    cardVariantId: row.card_variant_id,
    characterName: row.character_name,
    rarity: row.rarity as Rarity,
    imageUrl: row.image_url ?? null,
    level: row.level,
    power: rowToPower(row),
    ...rowToPresentation(row),
  };
}

/**
 * A user's strongest cards for the public chat profile.
 *
 * "Strongest" = total power (sum of the four directions, power-ups included),
 * tie-broken by rarity tier then level. Ranked and limited in SQL rather than
 * in JS over the whole collection.
 *
 * Deliberately returns only what a chat profile needs: username and, per card,
 * name / image / rarity / level / power. No instance ids, no collection size,
 * no currency, no email.
 */
export async function getShowcaseForUser(
  userId: string
): Promise<ShowcaseResult> {
  const userResult = await db.query(
    `SELECT user_id, username FROM "users" WHERE user_id = $1`,
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new ChatError("Player not found.", 404, "not_found");
  }

  const query = `
    SELECT
      ch.name AS character_name,
      ch.set_id,
      ch.tags,
      cv.rarity,
      cv.image_url,
      cv.is_exclusive,
      sa.ability_id,
      sa.name AS ability_name,
      sa.description AS ability_description,
      cb.border_id AS cb_border_id,
      cb.name AS cb_name,
      cb.image_url AS cb_image_url,
      cb.animation_key AS cb_animation_key,
      uoc.level,
      (ch.base_power->>'top')::int
        + COALESCE((pu.power_up_data->>'top')::int, 0)    AS top,
      (ch.base_power->>'right')::int
        + COALESCE((pu.power_up_data->>'right')::int, 0)  AS right,
      (ch.base_power->>'bottom')::int
        + COALESCE((pu.power_up_data->>'bottom')::int, 0) AS bottom,
      (ch.base_power->>'left')::int
        + COALESCE((pu.power_up_data->>'left')::int, 0)   AS left,
      ${TOTAL_POWER_SQL} AS total_power
    FROM "user_owned_cards" uoc
    JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
    JOIN "characters" ch ON cv.character_id = ch.character_id
    LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
    LEFT JOIN "card_borders" cb ON uoc.equipped_border_id = cb.border_id
    LEFT JOIN "user_card_power_ups" pu
      ON pu.user_card_instance_id = uoc.user_card_instance_id
    WHERE uoc.user_id = $1
    ORDER BY total_power DESC, ${RARITY_RANK_SQL} DESC, uoc.level DESC
    LIMIT $2;
  `;

  const { rows } = await db.query(query, [
    userId,
    CHAT_CONFIG.SHOWCASE_CARD_COUNT,
  ]);

  return {
    userId: user.user_id,
    username: user.username,
    cards: rows.map((row: Record<string, string | number>) => ({
      characterName: String(row.character_name),
      rarity: row.rarity as Rarity,
      imageUrl: (row.image_url as string) ?? null,
      level: Number(row.level),
      power: rowToPower(
        row as unknown as {
          top: number;
          right: number;
          bottom: number;
          left: number;
        }
      ),
      totalPower: Number(row.total_power),
      ...rowToPresentation(row as unknown as Record<string, unknown>),
    })),
  };
}

export default { buildCardSharePayload, getShowcaseForUser };
