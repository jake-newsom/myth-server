import test from "node:test";
import assert from "node:assert/strict";
import { AILogic } from "../ai.logic";
import { createTestCard, createTestGameState } from "./ai.test-utils";

/**
 * Autoplay reuses the AI engine to play the HUMAN's seat (see `isAutoplayMove`
 * in game.controller.ts). These tests pin the property that makes that safe:
 * `makeAIMove(state, difficulty, forPlayerId)` must pick from the requested
 * player's hand, not from whichever seat looks like the AI.
 *
 * The AI seat here is player1 (the "AI_"-prefixed id the solo-game default
 * detection looks for), so a regression that ignores `forPlayerId` and falls
 * back to that detection would return an AI card and fail these.
 */

const AI_ID = "AI_00000000-0000-0000-0000-000000000000";
const HUMAN_ID = "human-player-1";

function buildState() {
  const aiCard = createTestCard({
    id: "ai-card-1",
    power: { top: 5, right: 5, bottom: 5, left: 5 },
    owner: AI_ID,
  });
  const humanCard = createTestCard({
    id: "human-card-1",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
    owner: HUMAN_ID,
  });

  return createTestGameState({
    player1Id: AI_ID,
    player2Id: HUMAN_ID,
    player1Hand: ["ai-card-1"],
    player2Hand: ["human-card-1"],
    hydrated: { "ai-card-1": aiCard, "human-card-1": humanCard },
  });
}

test("autoplay: makeAIMove plays from the human's hand when forPlayerId is the human", async () => {
  const ai = new AILogic();
  const state = buildState();
  state.current_player_id = HUMAN_ID;

  const move = await ai.makeAIMove(state, "hard", HUMAN_ID);

  assert.ok(move, "Expected a move for the human seat");
  assert.equal(
    move!.user_card_instance_id,
    "human-card-1",
    "Autoplay must place the human's card, not the AI's"
  );
});

test("autoplay: makeAIMove still plays the AI's hand when forPlayerId is the AI", async () => {
  const ai = new AILogic();
  const state = buildState();

  const move = await ai.makeAIMove(state, "hard", AI_ID);

  assert.ok(move, "Expected a move for the AI seat");
  assert.equal(move!.user_card_instance_id, "ai-card-1");
});

test("autoplay: returns null when the requested seat has an empty hand", async () => {
  const ai = new AILogic();
  const state = buildState();
  state.player2.hand = [];
  state.current_player_id = HUMAN_ID;

  const move = await ai.makeAIMove(state, "hard", HUMAN_ID);

  assert.equal(
    move,
    null,
    "An empty hand must yield no move so the caller force-passes"
  );
});
