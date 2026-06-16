import test from "node:test";
import assert from "node:assert/strict";
import { EffectType } from "../../types/card.types";
import type { SagaBattleContext } from "../../types/sagaBattle.types";
import { applyFirstProtectionOnPlace } from "../sagaBattle.mechanics";
import {
  createTestCard,
  createEmptyBoard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

function sagaContext(): SagaBattleContext {
  return {
    run_id: "run-1",
    node_id: "node-1",
    season_id: "season-1",
    floor: 1,
    floor_difficulty: "normal",
    battle_difficulty: "easy",
    enemy_stat_bonus: 0,
    ai_profile: "basic",
    worlds_end: { defeats_per_destroy: 2, defeats_since_destroy: 0 },
    player_cards_played: {},
    player_card_instance_ids_played: {},
  };
}

test("First Blessing protects on first entry even when it is not the player's first card played", () => {
  const board = createEmptyBoard();
  const firstBlessed = createTestCard({ id: "saga-first", owner: "p1" });
  firstBlessed.saga_rune_type = "first";

  placeCardOnBoard(board, { x: 1, y: 1 }, firstBlessed);

  const state = createTestGameState({
    board,
    player1Id: "p1",
    hydrated: { [firstBlessed.user_card_instance_id]: firstBlessed },
  });
  state.saga_context = {
    ...sagaContext(),
    player_cards_played: { p1: 1 },
    player_card_instance_ids_played: { p1: ["saga-other"] },
  };

  const { events } = applyFirstProtectionOnPlace(state, { x: 1, y: 1 }, "p1");

  assert.equal(events.length, 1);
  assert.equal(firstBlessed.temporary_effects.length, 1);
  assert.equal(firstBlessed.temporary_effects[0].type, EffectType.BlockDefeat);
  assert.equal(firstBlessed.temporary_effects[0].duration, 4);
});

test("First Blessing does not re-apply when the same card enters play again in one battle", () => {
  const board = createEmptyBoard();
  const firstBlessed = createTestCard({ id: "saga-first", owner: "p1" });
  firstBlessed.saga_rune_type = "first";

  placeCardOnBoard(board, { x: 1, y: 1 }, firstBlessed);

  const state = createTestGameState({
    board,
    player1Id: "p1",
    hydrated: { [firstBlessed.user_card_instance_id]: firstBlessed },
  });
  state.saga_context = {
    ...sagaContext(),
    player_cards_played: { p1: 2 },
    player_card_instance_ids_played: { p1: ["saga-first"] },
  };

  const { events } = applyFirstProtectionOnPlace(state, { x: 1, y: 1 }, "p1");

  assert.equal(events.length, 0);
  assert.equal(firstBlessed.temporary_effects.length, 0);
});
