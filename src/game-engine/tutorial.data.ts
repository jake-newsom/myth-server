import db from "../config/db.config";
import { InGameCard, PowerValues, Rarity, TriggerMoment } from "../types/card.types";
import { SpecialAbility } from "../types/database.types";
import { BoardCell, BoardPosition, GameState } from "../types/game.types";
import { GameStatus } from "../types";

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

const TUTORIAL_BOARD_SIZE = 3;

interface TutorialCardSpec {
  tutorialId: string;
  characterName: string;
  power: PowerValues;
  side: "player" | "ai";
}

const PLAYER_CARD_SPECS: Omit<TutorialCardSpec, "side">[] = [
  { tutorialId: "tut-p1", characterName: "Shieldmaiden", power: { top: 5, right: 3, bottom: 4, left: 3 } },
  { tutorialId: "tut-p2", characterName: "Oni", power: { top: 3, right: 6, bottom: 3, left: 4 } },
  { tutorialId: "tut-p3", characterName: "Odin", power: { top: 4, right: 4, bottom: 5, left: 4 } },
  { tutorialId: "tut-p4", characterName: "Koa Warrior", power: { top: 3, right: 5, bottom: 6, left: 3 } },
  { tutorialId: "tut-p5", characterName: "Kitsune", power: { top: 5, right: 4, bottom: 3, left: 5 } },
];

const AI_CARD_SPECS: Omit<TutorialCardSpec, "side">[] = [
  { tutorialId: "tut-a1", characterName: "Kappa", power: { top: 3, right: 2, bottom: 3, left: 4 } },
  { tutorialId: "tut-a2", characterName: "Mokumokuren", power: { top: 4, right: 3, bottom: 3, left: 3 } },
  { tutorialId: "tut-a3", characterName: "Hitotsume-kozō", power: { top: 5, right: 3, bottom: 2, left: 3 } },
  { tutorialId: "tut-a4", characterName: "Runestone Keeper", power: { top: 3, right: 4, bottom: 3, left: 4 } },
  { tutorialId: "tut-a5", characterName: "Young Jarl", power: { top: 3, right: 3, bottom: 3, left: 3 } },
];

interface DbCardRow {
  card_variant_id: string;
  name: string;
  rarity: string;
  image_url: string;
  set_id: string;
  tags: string[];
  special_ability_id: string | null;
  ability_name: string | null;
  ability_description: string | null;
  ability_triggers: TriggerMoment[] | null;
  ability_parameters: Record<string, unknown> | null;
  attack_animation: string | null;
}

async function fetchCardsByName(names: string[]): Promise<Map<string, DbCardRow>> {
  const placeholders = names.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await db.query(
    `SELECT
       cv.card_variant_id, ch.name, cv.rarity, cv.image_url,
       ch.set_id, ch.tags, ch.special_ability_id, cv.attack_animation,
       sa.name as ability_name, sa.description as ability_description,
       sa.trigger_moments as ability_triggers, sa.parameters as ability_parameters
     FROM "card_variants" cv
     JOIN "characters" ch ON cv.character_id = ch.character_id
     LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
     WHERE ch.name IN (${placeholders})
       AND cv.rarity::text NOT LIKE '%+%'`,
    names
  );

  const map = new Map<string, DbCardRow>();
  for (const row of rows as DbCardRow[]) {
    map.set(row.name, row);
  }
  return map;
}

function buildInGameCard(
  spec: Omit<TutorialCardSpec, "side">,
  dbRow: DbCardRow,
  owner: string
): InGameCard {
  const ability: SpecialAbility | null = dbRow.ability_name
    ? {
      ability_id: dbRow.special_ability_id!,
      id: dbRow.special_ability_id!,
      name: dbRow.ability_name,
      description: dbRow.ability_description ?? "",
      triggerMoments: dbRow.ability_triggers ?? [],
      parameters: dbRow.ability_parameters ?? {},
    }
    : null;

  return {
    user_card_instance_id: spec.tutorialId,
    base_card_id: dbRow.card_variant_id,
    base_card_data: {
      card_id: dbRow.card_variant_id,
      name: dbRow.name,
      tags: [...dbRow.tags, "tutorial"],
      rarity: dbRow.rarity as Rarity,
      image_url: dbRow.image_url,
      base_power: { ...spec.power },
      set_id: dbRow.set_id,
      special_ability: ability,
      ...(dbRow.attack_animation && { attack_animation: dbRow.attack_animation }),
    },
    level: 1,
    xp: 0,
    power_enhancements: { top: 0, right: 0, bottom: 0, left: 0 },
    card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
    card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
    temporary_effects: [],
    current_power: { ...spec.power },
    owner,
    original_owner: owner,
    lockedTurns: 0,
    defeats: [],
  };
}

export async function buildTutorialCards(userId: string): Promise<{
  playerCards: InGameCard[];
  aiCards: InGameCard[];
}> {
  const allNames = [
    ...PLAYER_CARD_SPECS.map((s) => s.characterName),
    ...AI_CARD_SPECS.map((s) => s.characterName),
  ];
  const cardMap = await fetchCardsByName(allNames);

  const missing = allNames.filter((n) => !cardMap.has(n));
  if (missing.length > 0) {
    throw new Error(`Tutorial cards not found in database: ${missing.join(", ")}`);
  }

  const playerCards = PLAYER_CARD_SPECS.map((spec) =>
    buildInGameCard(spec, cardMap.get(spec.characterName)!, userId)
  );
  const aiCards = AI_CARD_SPECS.map((spec) =>
    buildInGameCard(spec, cardMap.get(spec.characterName)!, AI_PLAYER_ID)
  );

  return { playerCards, aiCards };
}

export async function buildTutorialGameState(userId: string): Promise<GameState> {
  const { playerCards, aiCards } = await buildTutorialCards(userId);

  const board: BoardCell[][] = Array.from({ length: TUTORIAL_BOARD_SIZE }, () =>
    Array.from({ length: TUTORIAL_BOARD_SIZE }, () => ({
      card: null,
      tile_enabled: true,
    }))
  );

  const hydrated_card_data_cache: Record<string, InGameCard> = {};
  for (const card of [...playerCards, ...aiCards]) {
    hydrated_card_data_cache[card.user_card_instance_id] = card;
  }

  return {
    board,
    player1: {
      user_id: userId,
      hand: playerCards.map((c) => c.user_card_instance_id),
      deck: [],
      discard_pile: [],
      score: 0,
    },
    player2: {
      user_id: AI_PLAYER_ID,
      hand: aiCards.map((c) => c.user_card_instance_id),
      deck: [],
      discard_pile: [],
      score: 0,
    },
    current_player_id: userId,
    turn_number: 1,
    status: GameStatus.ACTIVE,
    max_cards_in_hand: 5,
    initial_cards_to_draw: 5,
    winner: null,
    hydrated_card_data_cache,
  };
}

/**
 * Scripted AI moves for the tutorial, keyed by the game engine's turn_number.
 *
 * Turn flow (player goes first):
 *   turn 1: player → endTurn → turn 2
 *   turn 2: AI move 1 → endTurn → turn 3
 *   turn 3: player → endTurn → turn 4
 *   turn 4: AI move 2 → endTurn → turn 5
 *   ...and so on
 */
const TUTORIAL_AI_MOVES: Record<number, { cardId: string; position: BoardPosition }> = {
  2: { cardId: "tut-a1", position: { x: 2, y: 0 } },
  4: { cardId: "tut-a2", position: { x: 2, y: 2 } },
  6: { cardId: "tut-a3", position: { x: 0, y: 2 } },
  8: { cardId: "tut-a4", position: { x: 1, y: 2 } },
};

export function getTutorialAIMove(
  turnNumber: number
): { cardId: string; position: BoardPosition } | null {
  return TUTORIAL_AI_MOVES[turnNumber] ?? null;
}
