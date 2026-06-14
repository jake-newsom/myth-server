import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "../../src/types/game-engine.types";
import { resolveCombat } from "../../src/game-engine/game.utils";
import {
  createTestCard,
  createEmptyBoard,
  createTestGameState,
  placeCardOnBoard,
} from "../../src/game-engine/__tests__/ai.test-utils";

function oceansShield(id: string, owner: string, power: number) {
  const card = createTestCard({
    id,
    owner,
    power: { top: power, right: power, bottom: power, left: power },
  });
  card.base_card_data.name = "Kamohoalii";
  card.base_card_data.special_ability = {
    ability_id: "kamohoalii_oceans_shield",
    id: "kamohoalii_oceans_shield",
    name: "Ocean's Shield",
    description: "Cannot be defeated by enemies with lower total power.",
    parameters: {},
    triggerMoments: [],
  };
  return card;
}

describe("kamohoalii_oceans_shield ally protection", () => {
  it("a strong attacker flips through Ocean's Shield even when a weaker allied Ocean's Shield is on board", () => {
    const board = createEmptyBoard();

    // Target Ocean's Shield card (total power 20).
    const target = oceansShield("shield-1", "p2", 5);
    // A weaker allied Ocean's Shield card (total power 16).
    const allyShield = oceansShield("shield-2", "p2", 4);

    // Strong attacker (total power 24 >= target's 20) - shield does not apply.
    const attacker = createTestCard({
      id: "attacker",
      owner: "p1",
      power: { top: 6, right: 6, bottom: 6, left: 6 },
    });

    placeCardOnBoard(board, { x: 0, y: 0 }, target);
    placeCardOnBoard(board, { x: 1, y: 0 }, allyShield);
    placeCardOnBoard(board, { x: 0, y: 1 }, attacker);

    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });

    const { events } = resolveCombat(state, { x: 0, y: 1 }, "p1");

    const flipEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_FLIPPED);
    const defendEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_DEFENDED);

    // Self-defense correctly allows the flip (attacker total 24 >= target
    // total 20). The ally-protection pass then runs with the second Ocean's
    // Shield card as triggerCard. The bug compared the ally's total power
    // (16) against the target's (20) - 16 < 20 - and incorrectly blocked the
    // flip. Using the real attacker's total power (24) via flippedBy fixes
    // this.
    assert.equal(flipEvents.length, 1, "Ocean's Shield should not block a strong attacker");
    assert.equal((flipEvents[0] as any).cardId, "shield-1");
    assert.equal(defendEvents.length, 0);
  });

  it("self-defense baseline: a strong-enough attacker flips through Ocean's Shield with no allies present", () => {
    const board = createEmptyBoard();

    const target = oceansShield("shield-1", "p2", 5);

    const attacker = createTestCard({
      id: "attacker",
      owner: "p1",
      power: { top: 6, right: 6, bottom: 6, left: 6 },
    });

    placeCardOnBoard(board, { x: 0, y: 0 }, target);
    placeCardOnBoard(board, { x: 0, y: 1 }, attacker);

    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });

    const { events } = resolveCombat(state, { x: 0, y: 1 }, "p1");

    const flipEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_FLIPPED);
    const defendEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_DEFENDED);

    // attacker total power (24) >= target total power (20) -> shield does not apply.
    assert.equal(flipEvents.length, 1, "attacker with equal/greater total power flips through");
    assert.equal((flipEvents[0] as any).cardId, "shield-1");
    assert.equal(defendEvents.length, 0);
  });
});
