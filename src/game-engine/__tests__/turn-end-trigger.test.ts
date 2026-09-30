import test from "node:test";
import assert from "node:assert/strict";
import { GameLogic } from "../game.logic";
import { abilities } from "../abilities";
import { simulationContext } from "../simulation.context";
import { TriggerMoment } from "../../types/card.types";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

/**
 * OnTurnEnd fires before the turn switch, so an "at the end of YOUR turn"
 * ability can gate on triggerCard.owner === state.current_player_id — the same
 * idiom OnTurnStart abilities (Tyr) already use.
 *
 * Before this ordering fix the trigger ran AFTER current_player_id was swapped,
 * so that gate was inverted: every such ability fired on the opponent's turn
 * end and never on its owner's.
 */

const PROBE_ABILITY_ID = "__turn_end_probe";

/** Records the owner/current-player pair seen each time the trigger fires. */
type Sighting = { owner: string; currentPlayer: string };

function withProbeAbility(sightings: Sighting[], run: () => Promise<void>) {
  const registry = abilities as Record<string, unknown>;
  const previous = registry[PROBE_ABILITY_ID];

  registry[PROBE_ABILITY_ID] = (context: any) => {
    sightings.push({
      owner: context.triggerCard.owner,
      currentPlayer: context.state.current_player_id,
    });
    return [];
  };

  return run().finally(() => {
    if (previous === undefined) delete registry[PROBE_ABILITY_ID];
    else registry[PROBE_ABILITY_ID] = previous;
  });
}

function probeCard(id: string, owner: string) {
  const card = createTestCard({ id, owner, abilityId: PROBE_ABILITY_ID });
  card.base_card_data.special_ability!.triggerMoments = [TriggerMoment.OnTurnEnd];
  return card;
}

test("OnTurnEnd fires while current_player_id is still the player ending the turn", async () => {
  simulationContext.enterSimulation();
  const sightings: Sighting[] = [];
  try {
    await withProbeAbility(sightings, async () => {
      const board = createEmptyBoard();
      placeCardOnBoard(board, { x: 0, y: 0 }, probeCard("p1-probe", "p1"));
      placeCardOnBoard(board, { x: 1, y: 0 }, probeCard("p2-probe", "p2"));

      const state = createTestGameState({
        board,
        player1Id: "p1",
        player2Id: "p2",
      });
      state.current_player_id = "p1";

      await GameLogic.endTurn(state, "p1");
    });

    assert.equal(sightings.length, 2, "both board cards should be triggered");

    // The whole point of the fix: during p1's turn end, current_player_id is
    // still p1, so `owner === currentPlayer` identifies the ending player.
    for (const s of sightings) {
      assert.equal(
        s.currentPlayer,
        "p1",
        "current_player_id must still be the player ending the turn"
      );
    }

    const owners = sightings.map((s) => s.owner).sort();
    assert.deepEqual(owners, ["p1", "p2"]);

    const gated = sightings.filter((s) => s.owner === s.currentPlayer);
    assert.equal(gated.length, 1, "exactly one card passes the owner gate");
    assert.equal(gated[0].owner, "p1", "and it is the turn-ender's card");
  } finally {
    simulationContext.exitSimulation();
  }
});

test("the owner gate selects the other player on the following turn end", async () => {
  simulationContext.enterSimulation();
  const sightings: Sighting[] = [];
  try {
    await withProbeAbility(sightings, async () => {
      const board = createEmptyBoard();
      placeCardOnBoard(board, { x: 0, y: 0 }, probeCard("p1-probe", "p1"));
      placeCardOnBoard(board, { x: 1, y: 0 }, probeCard("p2-probe", "p2"));

      const state = createTestGameState({
        board,
        player1Id: "p1",
        player2Id: "p2",
      });
      state.current_player_id = "p2";

      await GameLogic.endTurn(state, "p2");
    });

    const gated = sightings.filter((s) => s.owner === s.currentPlayer);
    assert.equal(gated.length, 1);
    assert.equal(gated[0].owner, "p2", "p2 ending their turn gates to p2");
  } finally {
    simulationContext.exitSimulation();
  }
});
