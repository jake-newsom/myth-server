import db from "../config/db.config";
import { InGameCard, PowerValues, Rarity, TriggerMoment } from "../types/card.types";
import { SpecialAbility } from "../types/database.types";
import type { SagaCard } from "../types/saga.types";

export function sagaInstanceId(sagaCardId: string): string {
  return `saga-${sagaCardId}`;
}

function applyPowerBonus(
  power: PowerValues,
  bonus: { top: number; right: number; bottom: number; left: number }
): PowerValues {
  return {
    top: power.top + bonus.top,
    right: power.right + bonus.right,
    bottom: power.bottom + bonus.bottom,
    left: power.left + bonus.left,
  };
}

function furyBonus(stacks: number): PowerValues {
  return { top: stacks, right: stacks, bottom: stacks, left: stacks };
}

export function computeSagaCardPower(
  base: PowerValues,
  card: SagaCard
): PowerValues {
  let power: PowerValues = {
    top: base.top + card.top_buff,
    right: base.right + card.right_buff,
    bottom: base.bottom + card.bottom_buff,
    left: base.left + card.left_buff,
  };

  if (card.rune_type === "fury" && card.rune_stacks > 0) {
    power = applyPowerBonus(power, furyBonus(card.rune_stacks));
  }

  return power;
}

interface DbCardRow {
  card_variant_id: string;
  name: string;
  rarity: string;
  image_url: string;
  set_id: string;
  tags: string[];
  special_ability_id: string | null;
  ability_key: string | null;
  ability_name: string | null;
  ability_description: string | null;
  ability_triggers: TriggerMoment[] | null;
  ability_parameters: Record<string, unknown> | null;
  ability_sound_effect: string | null;
  attack_animation: string | null;
  sound_effect: string | null;
  is_exclusive: boolean;
  base_power_top: string;
  base_power_right: string;
  base_power_bottom: string;
  base_power_left: string;
}

export async function fetchCardRowsByVariantIds(
  variantIds: string[]
): Promise<Map<string, DbCardRow>> {
  if (variantIds.length === 0) return new Map();

  const placeholders = variantIds.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await db.query(
    `SELECT
      cv.card_variant_id, ch.name, cv.rarity, cv.image_url,
      ch.set_id, ch.tags, ch.special_ability_id, cv.attack_animation, cv.is_exclusive,
      COALESCE(cv.sound_effect, ch.sound_effect) as sound_effect,
      ch.base_power->>'top' as base_power_top,
      ch.base_power->>'right' as base_power_right,
      ch.base_power->>'bottom' as base_power_bottom,
      ch.base_power->>'left' as base_power_left,
      sa.id as ability_key, sa.name as ability_name, sa.description as ability_description,
      sa.trigger_moments as ability_triggers, sa.parameters as ability_parameters,
      sa.sound_effect as ability_sound_effect
    FROM card_variants cv
    JOIN characters ch ON cv.character_id = ch.character_id
    LEFT JOIN special_abilities sa ON ch.special_ability_id = sa.ability_id
    WHERE cv.card_variant_id IN (${placeholders})`,
    variantIds
  );

  const map = new Map<string, DbCardRow>();
  for (const row of rows as DbCardRow[]) {
    map.set(row.card_variant_id, row);
  }
  return map;
}

export function buildSagaInGameCard(
  sagaCard: SagaCard,
  dbRow: DbCardRow,
  ownerUserId: string
): InGameCard {
  const basePower: PowerValues = {
    top: parseInt(dbRow.base_power_top, 10),
    right: parseInt(dbRow.base_power_right, 10),
    bottom: parseInt(dbRow.base_power_bottom, 10),
    left: parseInt(dbRow.base_power_left, 10),
  };

  const currentPower = computeSagaCardPower(basePower, sagaCard);
  const enhancements: PowerValues = {
    top: currentPower.top - basePower.top,
    right: currentPower.right - basePower.right,
    bottom: currentPower.bottom - basePower.bottom,
    left: currentPower.left - basePower.left,
  };

  const ability: SpecialAbility | null = dbRow.ability_name
    ? {
        ability_id: dbRow.special_ability_id!,
        id: dbRow.ability_key ?? dbRow.special_ability_id!,
        name: dbRow.ability_name,
        description: dbRow.ability_description ?? "",
        triggerMoments: dbRow.ability_triggers ?? [],
        parameters: dbRow.ability_parameters ?? {},
        sound_effect: dbRow.ability_sound_effect ?? null,
      }
    : null;

  const instanceId = sagaInstanceId(sagaCard.saga_card_id);

  return {
    user_card_instance_id: instanceId,
    base_card_id: dbRow.card_variant_id,
    base_card_data: {
      card_id: dbRow.card_variant_id,
      name: dbRow.name,
      tags: [...dbRow.tags, "saga"],
      rarity: dbRow.rarity as Rarity,
      image_url: dbRow.image_url,
      base_power: { ...basePower },
      set_id: dbRow.set_id,
      is_exclusive: dbRow.is_exclusive ?? false,
      special_ability: ability,
      ...(dbRow.attack_animation && { attack_animation: dbRow.attack_animation }),
      ...(dbRow.sound_effect && { sound_effect: dbRow.sound_effect }),
    },
    level: 1,
    xp: 0,
    is_locked: false,
    power_enhancements: enhancements,
    card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
    card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
    temporary_effects: [],
    current_power: { ...currentPower },
    owner: ownerUserId,
    original_owner: ownerUserId,
    lockedTurns: 0,
    lockedBy: null,
    defeats: [],
    saga_rune_type: sagaCard.rune_type ?? undefined,
    saga_card_id: sagaCard.saga_card_id,
  };
}

export async function hydrateSagaDeckForBattle(
  sagaCards: SagaCard[],
  ownerUserId: string,
  enemyStatBonus = 0
): Promise<Map<string, InGameCard>> {
  const variantIds = [...new Set(sagaCards.map((c) => c.base_card_id))];
  const rows = await fetchCardRowsByVariantIds(variantIds);
  const result = new Map<string, InGameCard>();

  for (const sagaCard of sagaCards) {
    const row = rows.get(sagaCard.base_card_id);
    if (!row) continue;
    const card = buildSagaInGameCard(sagaCard, row, ownerUserId);
    result.set(card.user_card_instance_id, card);
  }

  return result;
}

export async function hydrateEnemyDeckForSaga(
  aiDeckId: string,
  aiUserId: string,
  enemyStatBonus: number
): Promise<Map<string, InGameCard>> {
  const { rows } = await db.query(
    `SELECT dc.user_card_instance_id
     FROM deck_cards dc
     WHERE dc.deck_id = $1`,
    [aiDeckId]
  );

  const instanceIds = rows.map(
    (r: { user_card_instance_id: string }) => r.user_card_instance_id
  );

  const { GameLogic } = await import("./game.logic");
  const hydrated = await GameLogic.hydrateCardInstances(instanceIds);

  if (enemyStatBonus > 0) {
    for (const card of hydrated.values()) {
      const bonus = {
        top: enemyStatBonus,
        right: enemyStatBonus,
        bottom: enemyStatBonus,
        left: enemyStatBonus,
      };
      card.current_power = applyPowerBonus(card.current_power, bonus);
      card.base_card_data.base_power = applyPowerBonus(
        card.base_card_data.base_power,
        bonus
      );
    }
  }

  for (const card of hydrated.values()) {
    card.owner = aiUserId;
  }

  return hydrated;
}
