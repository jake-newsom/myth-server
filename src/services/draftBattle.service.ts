import _ from "lodash";
import { GameStatus } from "../game-engine/game.logic";
import * as gameUtils from "../game-engine/game.utils";
import { GameState, Player } from "../types/game.types";
import { InGameCard } from "../types/card.types";
import {
  assertDraftCacheComplete,
  hydrateDraftPicks,
} from "../game-engine/draftBattle.hydration";
import {
  GAME_CONFIG,
  DECK_CONFIG,
  RANKED_DRAFT_CARDS_AFTER_BLOCK,
  RANKED_DRAFT_DECK_SIZE,
} from "../config/constants";

/**
 * Builds the GameState for a completed ranked draft.
 *
 * This is a sibling of GameLogic.initializeGame, in the same way
 * sagaBattle.service.initializeSagaGameState is: it produces the identical
 * GameState shape, but seeds `hydrated_card_data_cache` itself from the catalog
 * instead of resolving user_card_instance_ids out of user_owned_cards.
 *
 * The engine is untouched by this. Once the cache is populated for every card
 * in both decks, every downstream code path — placement, abilities, mulligan,
 * draw — works exactly as it does for an unranked game, because they all read
 * the cache and only fall back to the DB on a miss.
 */

const INITIAL_HAND_SIZE = 5;

export interface DraftGameStateResult {
  gameState: GameState;
  /** Deck instance ids per player, for assertions/telemetry. */
  player1InstanceIds: string[];
  player2InstanceIds: string[];
}

/**
 * @param player1Picks card_variant_ids drafted by player 1 (PICKS long)
 * @param player2Picks card_variant_ids drafted by player 2 (PICKS long)
 */
export async function buildDraftGameState(
  player1Id: string,
  player1Picks: string[],
  player2Id: string,
  player2Picks: string[]
): Promise<DraftGameStateResult> {
  // Guard the format itself. A draft that produced the wrong number of picks is
  // a logic bug upstream, and must not become a malformed game.
  //
  // Checked against the POST-BLOCK count, not PICKS: callers pass the decks that
  // survived the block phase, so an 11-pick draft legitimately arrives here as
  // 10 cards.
  for (const [label, picks] of [
    ["player1", player1Picks],
    ["player2", player2Picks],
  ] as const) {
    if (picks.length !== RANKED_DRAFT_CARDS_AFTER_BLOCK) {
      throw new Error(
        `[draftBattle] ${label} has ${picks.length} picks, expected ${RANKED_DRAFT_CARDS_AFTER_BLOCK}`
      );
    }
    if (new Set(picks).size !== picks.length) {
      throw new Error(`[draftBattle] ${label} has duplicate picks`);
    }
  }

  // A card drafted by one player cannot be drafted by the other.
  const overlap = player1Picks.filter((id) => player2Picks.includes(id));
  if (overlap.length > 0) {
    throw new Error(
      `[draftBattle] both players drafted the same card(s): ${overlap.join(", ")}`
    );
  }

  const [p1, p2] = await Promise.all([
    hydrateDraftPicks(player1Picks, player1Id),
    hydrateDraftPicks(player2Picks, player2Id),
  ]);

  // The resulting deck must be the size the rest of the stack assumes.
  if (p1.instanceIds.length !== DECK_CONFIG.DECK_SIZE) {
    throw new Error(
      `[draftBattle] drafted deck is ${p1.instanceIds.length} cards, expected ${DECK_CONFIG.DECK_SIZE} ` +
        `(RANKED_DRAFT_DECK_SIZE=${RANKED_DRAFT_DECK_SIZE})`
    );
  }

  const p1Deck = _.shuffle(p1.instanceIds);
  const p2Deck = _.shuffle(p2.instanceIds);

  const board = Array(GAME_CONFIG.BOARD_SIZE)
    .fill(null)
    .map(() =>
      Array(GAME_CONFIG.BOARD_SIZE).fill(
        gameUtils.createBoardCell(null, "normal").boardCell
      )
    );

  // Seed the cache for EVERY card in both decks up front. See the long note in
  // draftBattle.hydration.ts: this is load-bearing, not an optimisation. The
  // engine's lazy re-hydration paths cannot resolve a synthetic id and fail
  // silently, so anything not seeded here would surface as a blank card
  // mid-match rather than an error.
  const hydrated_card_data_cache: Record<string, InGameCard> = {};
  for (const [id, card] of p1.cache) hydrated_card_data_cache[id] = card;
  for (const [id, card] of p2.cache) hydrated_card_data_cache[id] = card;

  assertDraftCacheComplete(
    [...p1.instanceIds, ...p2.instanceIds],
    hydrated_card_data_cache
  );

  const player1: Player = {
    user_id: player1Id,
    hand: p1Deck.slice(0, INITIAL_HAND_SIZE),
    deck: p1Deck.slice(INITIAL_HAND_SIZE),
    discard_pile: [],
    score: 0,
    equipped_card_back: null,
  };

  const player2: Player = {
    user_id: player2Id,
    hand: p2Deck.slice(0, INITIAL_HAND_SIZE),
    deck: p2Deck.slice(INITIAL_HAND_SIZE),
    discard_pile: [],
    score: 0,
    equipped_card_back: null,
  };

  const gameState: GameState = {
    board,
    player1,
    player2,
    current_player_id: player1Id,
    turn_number: 1,
    status: GameStatus.MULLIGAN,
    max_cards_in_hand: 10,
    initial_cards_to_draw: INITIAL_HAND_SIZE,
    hydrated_card_data_cache,
    winner: null,
    mulligan_state: {
      player1: { committed: false, replaced_count: 0 },
      player2: { committed: false, replaced_count: 0 },
    },
  };

  return {
    gameState,
    player1InstanceIds: p1.instanceIds,
    player2InstanceIds: p2.instanceIds,
  };
}

export default { buildDraftGameState };
