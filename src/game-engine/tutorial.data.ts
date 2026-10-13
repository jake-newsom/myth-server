import db from "../config/db.config";
import { InGameCard, PowerValues, Rarity, TriggerMoment } from "../types/card.types";
import { SpecialAbility } from "../types/database.types";
import { BoardCell, BoardPosition, GameState } from "../types/game.types";
import { GameStatus } from "../types";
import { GAME_CONFIG } from "../config/constants";
import { isPlayableEmptyCell } from "./game.validators";

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

/**
 * v2 tutorial (4x4 board, draws from a deck, teaches water / curse / lava via
 * Njord, Jorōgumo and Surtr, then hands the player a free-play finish).
 *
 * Only clients that POST { version: 2 } get this. Older builds hardcode the v1
 * 3x3 step script above, so v1 must keep working unchanged until they age out.
 *
 * Card counts: Surtr destroys one card, so the 16-tile board takes 17
 * placements. With the player moving first that is 9 player / 8 AI cards, and
 * the player's last placement fills the board and ends the game.
 *
 * Hand order matters only for the guided cards; deck order is the draw order
 * (drawCard shifts from the front after every placement while hand < 5).
 */
const V2_HAND_SIZE = 5;

const V2_PLAYER_CARD_SPECS: Omit<TutorialCardSpec, "side">[] = [
  // Starting hand — the five guided placements
  { tutorialId: "tut2-p1", characterName: "Shieldmaiden", power: { top: 5, right: 4, bottom: 4, left: 4 } },
  { tutorialId: "tut2-p2", characterName: "Oni", power: { top: 3, right: 6, bottom: 4, left: 4 } },
  { tutorialId: "tut2-p3", characterName: "Njord", power: { top: 4, right: 4, bottom: 4, left: 4 } },
  { tutorialId: "tut2-p4", characterName: "Surtr", power: { top: 5, right: 4, bottom: 5, left: 4 } },
  { tutorialId: "tut2-p5", characterName: "Koa Warrior", power: { top: 3, right: 5, bottom: 5, left: 4 } },
  // Deck — drawn during the guided turns, played in free play
  { tutorialId: "tut2-p6", characterName: "Kitsune", power: { top: 5, right: 5, bottom: 4, left: 5 } },
  { tutorialId: "tut2-p7", characterName: "Berserker", power: { top: 5, right: 6, bottom: 4, left: 5 } },
  { tutorialId: "tut2-p8", characterName: "Drengr", power: { top: 4, right: 5, bottom: 5, left: 5 } },
  { tutorialId: "tut2-p9", characterName: "Tengu", power: { top: 5, right: 5, bottom: 5, left: 4 } },
];

const V2_AI_CARD_SPECS: Omit<TutorialCardSpec, "side">[] = [
  // Starting hand
  { tutorialId: "tut2-a1", characterName: "Kappa", power: { top: 3, right: 2, bottom: 3, left: 4 } },
  { tutorialId: "tut2-a2", characterName: "Mokumokuren", power: { top: 3, right: 3, bottom: 3, left: 3 } },
  // Top must stay <= Kappa's bottom (3) so Jorōgumo doesn't flip it back
  { tutorialId: "tut2-a3", characterName: "Jorōgumo", power: { top: 2, right: 3, bottom: 3, left: 3 } },
  // Bottom 4 drops to 3 in Surtr's lava; Koa's top 3 rises to 4 on water
  { tutorialId: "tut2-a4", characterName: "Hitotsume-kozō", power: { top: 2, right: 3, bottom: 4, left: 3 } },
  { tutorialId: "tut2-a5", characterName: "Runestone Keeper", power: { top: 3, right: 2, bottom: 2, left: 3 } },
  // Deck — weak free-play filler
  { tutorialId: "tut2-a6", characterName: "Young Jarl", power: { top: 2, right: 3, bottom: 2, left: 2 } },
  { tutorialId: "tut2-a7", characterName: "Thrall", power: { top: 2, right: 2, bottom: 3, left: 2 } },
  { tutorialId: "tut2-a8", characterName: "Tanuki", power: { top: 3, right: 2, bottom: 2, left: 2 } },
];

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
}

async function fetchCardsByName(names: string[]): Promise<Map<string, DbCardRow>> {
  const placeholders = names.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await db.query(
    `SELECT
       cv.card_variant_id, ch.name, cv.rarity, cv.image_url,
       ch.set_id, ch.tags, ch.special_ability_id, cv.attack_animation, cv.is_exclusive,
       COALESCE(cv.sound_effect, ch.sound_effect) as sound_effect,
       sa.id as ability_key, sa.name as ability_name, sa.description as ability_description,
       sa.trigger_moments as ability_triggers, sa.parameters as ability_parameters,
       sa.sound_effect as ability_sound_effect
     FROM "card_variants" cv
     JOIN "characters" ch ON cv.character_id = ch.character_id
     LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
     WHERE ch.name IN (${placeholders})
       AND cv.rarity::text NOT LIKE '%+%'
       AND cv.released_at <= NOW()
       AND ch.released_at <= NOW()`,
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
      id: dbRow.ability_key ?? dbRow.special_ability_id!,
      name: dbRow.ability_name,
      description: dbRow.ability_description ?? "",
      triggerMoments: dbRow.ability_triggers ?? [],
      parameters: dbRow.ability_parameters ?? {},
      sound_effect: dbRow.ability_sound_effect ?? null,
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
      is_exclusive: dbRow.is_exclusive ?? false,
      special_ability: ability,
      ...(dbRow.attack_animation && { attack_animation: dbRow.attack_animation }),
      ...(dbRow.sound_effect && { sound_effect: dbRow.sound_effect }),
    },
    level: 1,
    xp: 0,
    is_locked: false,
    power_enhancements: { top: 0, right: 0, bottom: 0, left: 0 },
    card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
    card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
    temporary_effects: [],
    current_power: { ...spec.power },
    owner,
    original_owner: owner,
    lockedTurns: 0,
    lockedBy: null,
    defeats: [],
  };
}

export type TutorialCardRowMap = Map<string, DbCardRow>;
export type { DbCardRow as TutorialCardRow };

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

/** Fetches the v2 cards and builds the starting state. */
export async function buildTutorialGameStateV2(userId: string): Promise<GameState> {
  const allNames = [
    ...V2_PLAYER_CARD_SPECS.map((s) => s.characterName),
    ...V2_AI_CARD_SPECS.map((s) => s.characterName),
  ];
  const cardMap = await fetchCardsByName([...new Set(allNames)]);
  return buildTutorialGameStateV2FromRows(userId, cardMap);
}

/** Pure half of buildTutorialGameStateV2, split out so tests can skip the DB. */
export function buildTutorialGameStateV2FromRows(
  userId: string,
  cardMap: TutorialCardRowMap
): GameState {
  const missing = [...V2_PLAYER_CARD_SPECS, ...V2_AI_CARD_SPECS]
    .map((s) => s.characterName)
    .filter((n) => !cardMap.has(n));
  if (missing.length > 0) {
    throw new Error(`Tutorial cards not found in database: ${missing.join(", ")}`);
  }

  const playerCards = V2_PLAYER_CARD_SPECS.map((spec) =>
    buildInGameCard(spec, cardMap.get(spec.characterName)!, userId)
  );
  const aiCards = V2_AI_CARD_SPECS.map((spec) =>
    buildInGameCard(spec, cardMap.get(spec.characterName)!, AI_PLAYER_ID)
  );

  const board: BoardCell[][] = Array.from({ length: GAME_CONFIG.BOARD_SIZE }, () =>
    Array.from({ length: GAME_CONFIG.BOARD_SIZE }, () => ({
      card: null,
      tile_enabled: true,
    }))
  );

  const hydrated_card_data_cache: Record<string, InGameCard> = {};
  for (const card of [...playerCards, ...aiCards]) {
    hydrated_card_data_cache[card.user_card_instance_id] = card;
  }

  const ids = (cards: InGameCard[]) => cards.map((c) => c.user_card_instance_id);

  return {
    board,
    player1: {
      user_id: userId,
      hand: ids(playerCards.slice(0, V2_HAND_SIZE)),
      deck: ids(playerCards.slice(V2_HAND_SIZE)),
      discard_pile: [],
      score: 0,
    },
    player2: {
      user_id: AI_PLAYER_ID,
      hand: ids(aiCards.slice(0, V2_HAND_SIZE)),
      deck: ids(aiCards.slice(V2_HAND_SIZE)),
      discard_pile: [],
      score: 0,
    },
    current_player_id: userId,
    turn_number: 1,
    status: GameStatus.ACTIVE,
    max_cards_in_hand: V2_HAND_SIZE,
    initial_cards_to_draw: V2_HAND_SIZE,
    winner: null,
    hydrated_card_data_cache,
    tutorial_version: 2,
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

/**
 * v2 scripted AI moves (player turns are odd, AI turns even). Each one sets up
 * the lesson for the player's next guided placement:
 *   2: Kappa      → flipped by Oni (turn 3)
 *   4: Mokumokuren → destroyed by Surtr (turn 7)
 *   6: Jorōgumo  → curses (1,2) and (2,3); kept clear of Njord's water row
 *   8: Hitotsume-kozō lands in Surtr's lava → flipped by Koa on water (turn 9)
 * After that the AI plays free-play filler via v2FallbackMove.
 */
const TUTORIAL_V2_AI_MOVES: Record<number, { cardId: string; position: BoardPosition }> = {
  2: { cardId: "tut2-a1", position: { x: 3, y: 0 } },
  4: { cardId: "tut2-a2", position: { x: 0, y: 0 } },
  6: { cardId: "tut2-a3", position: { x: 3, y: 1 } },
  8: { cardId: "tut2-a4", position: { x: 0, y: 2 } },
};

/**
 * Free-play AI: first card in hand onto the first open tile, scanning
 * row-major. Deliberately naive — the AI's remaining cards are weak filler so
 * the player is strongly favoured to win their first match.
 */
function v2FallbackMove(
  state: GameState
): { cardId: string; position: BoardPosition } | null {
  const ai = state.player1.user_id === AI_PLAYER_ID ? state.player1 : state.player2;
  const cardId = ai.hand[0];
  if (!cardId) return null;

  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board[y].length; x++) {
      if (isPlayableEmptyCell(state.board[y][x])) {
        return { cardId, position: { x, y } };
      }
    }
  }
  return null;
}

export function getTutorialAIMove(
  state: GameState
): { cardId: string; position: BoardPosition } | null {
  if ((state.tutorial_version ?? 1) >= 2) {
    return TUTORIAL_V2_AI_MOVES[state.turn_number] ?? v2FallbackMove(state);
  }
  return TUTORIAL_AI_MOVES[state.turn_number] ?? null;
}
