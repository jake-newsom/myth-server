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
 * OnTurnEnd means "at the end of YOUR turn": triggerIndirectAbilities only
 * fires board cards owned by the player ending the turn. It runs before the
 * turn switch, so current_player_id is still that player.
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

async function endTurnSightings(endingPlayer: "p1" | "p2") {
  const sightings: Sighting[] = [];
  await withProbeAbility(sightings, async () => {
    const board = createEmptyBoard();
    placeCardOnBoard(board, { x: 0, y: 0 }, probeCard("p1-probe", "p1"));
    placeCardOnBoard(board, { x: 1, y: 0 }, probeCard("p2-probe", "p2"));

    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
    });
    state.current_player_id = endingPlayer;

    await GameLogic.endTurn(state, endingPlayer);
  });
  return sightings;
}

for (const ender of ["p1", "p2"] as const) {
  test(`only ${ender}'s cards fire on ${ender}'s turn end`, async () => {
    simulationContext.enterSimulation();
    try {
      const sightings = await endTurnSightings(ender);
      assert.deepEqual(sightings, [{ owner: ender, currentPlayer: ender }]);
    } finally {
      simulationContext.exitSimulation();
    }
  });
}
