import test from "node:test";
import assert from "node:assert/strict";
import { GameLogic } from "../game.logic";
import { norseAbilities } from "../abilities/norse.abilities";
import { simulationContext } from "../simulation.context";
import * as validators from "../game.validators";
import {
  getEmptyAdjacentTiles,
  pullCardsIn,
  pushCardAway,
} from "../ability.utils";
import { TriggerMoment } from "../../types/card.types";
import { TileStatus, TileTerrain } from "../../types/game.types";
import { EVENT_TYPES } from "../../types/game-engine.types";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

/**
 * Watchman's Gate: blocks the empty tiles next to Heimdall for BOTH players,
 * against placement and every kind of movement, until the start of Heimdall's
 * owner's next turn.
 */

const HEIMDALL_POS = { x: 1, y: 1 };

function setupWard() {
  const board = createEmptyBoard();
  // Water under (1,0) before the ward goes up: it must survive the ward.
  board[0][1].tile_effect = {
    status: TileStatus.Normal,
    terrain: TileTerrain.Ocean,
    turns_left: 1000,
    animation_label: "water",
  };
  const heimdall = createTestCard({ id: "heimdall", owner: "p1", abilityId: "heimdall_block" });
  placeCardOnBoard(board, HEIMDALL_POS, heimdall);
  const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });
  const events = norseAbilities.heimdall_block({
    state,
    triggerCard: heimdall,
    triggerMoment: TriggerMoment.OnPlace,
    position: HEIMDALL_POS,
  });
  return { board, state, events, heimdall };
}

function inSimulation(fn: () => void | Promise<void>) {
  return async () => {
    simulationContext.enterSimulation();
    try {
      await fn();
    } finally {
      simulationContext.exitSimulation();
    }
  };
}

const NEIGHBOURS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 2, y: 1 },
  { x: 1, y: 2 },
];

test(
  "ward blocks every empty neighbour, stamps its source, keeps buried terrain",
  inSimulation(() => {
    const { board, events } = setupWard();
    assert.equal(events.length, 4);
    for (const p of NEIGHBOURS) {
      const effect = board[p.y][p.x].tile_effect!;
      assert.equal(effect.status, TileStatus.Blocked);
      assert.equal(effect.animation_label, "heimdall_gate");
      assert.equal(effect.source_card_id, "heimdall");
      assert.equal(effect.source_player_id, "p1");
    }
    assert.equal(board[0][1].tile_effect!.underlying_effect?.terrain, TileTerrain.Ocean);
    assert.equal(board[1][0].tile_effect!.underlying_effect, undefined);
  }),
);

test(
  "ward blocks placement for both players",
  inSimulation(() => {
    const { state } = setupWard();
    for (const player of ["p1", "p2"]) {
      state.current_player_id = player;
      for (const p of NEIGHBOURS) {
        assert.equal(validators.canPlaceOnTile(state, p).canPlace, false);
      }
    }
  }),
);

test(
  "ward expires at the start of the owner's next turn and restores terrain",
  inSimulation(async () => {
    const { state } = setupWard();

    // Owner (p1) ends the turn Heimdall was played: still warded on p2's turn.
    state.current_player_id = "p1";
    const afterP1 = await GameLogic.endTurn(state, "p1");
    for (const p of NEIGHBOURS) {
      assert.equal(afterP1.state.board[p.y][p.x].tile_effect?.status, TileStatus.Blocked);
    }

    // Opponent ends theirs: the ward drops as p1's turn begins.
    const afterP2 = await GameLogic.endTurn(afterP1.state, "p2");
    const board = afterP2.state.board;
    assert.equal(board[0][1].tile_effect?.terrain, TileTerrain.Ocean, "water restored");
    assert.equal(board[0][1].tile_effect?.status, TileStatus.Normal);
    assert.equal(board[1][0].tile_effect, undefined);
    assert.equal(board[1][2].tile_effect, undefined);
    assert.equal(board[2][1].tile_effect, undefined);
  }),
);

test(
  "push into a ward bounces: no move, CARD_MOVE_BLOCKED emitted",
  inSimulation(() => {
    const { board } = setupWard();
    // Pushed from (3,2), the card at (2,2) heads for (1,2): a warded tile.
    const enemy = createTestCard({ id: "enemy", owner: "p2" });
    placeCardOnBoard(board, { x: 2, y: 2 }, enemy);
    const events = pushCardAway(enemy, { x: 3, y: 2 }, board);
    assert.equal(events.length, 1);
    const e = events[0] as any;
    assert.equal(e.type, EVENT_TYPES.CARD_MOVE_BLOCKED);
    assert.equal(e.cardId, "enemy");
    assert.deepEqual(e.fromPosition, { x: 2, y: 2 });
    assert.deepEqual(e.blockedPosition, { x: 1, y: 2 });
    assert.equal(e.animation, "push");
    assert.equal(board[2][2].card?.user_card_instance_id, "enemy");
    assert.equal(board[2][1].card, null);
  }),
);

test(
  "pull into a ward bounces: no move, CARD_MOVE_BLOCKED emitted",
  inSimulation(() => {
    const { board } = setupWard();
    // A p2 puller at (3,1) reaches Heimdall at (1,1) through warded (2,1).
    const events = pullCardsIn({ x: 3, y: 1 }, board, "p2");
    const blocked = events.filter((e) => e.type === EVENT_TYPES.CARD_MOVE_BLOCKED) as any[];
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].cardId, "heimdall");
    assert.deepEqual(blocked[0].blockedPosition, { x: 2, y: 1 });
    assert.equal(blocked[0].animation, "pull");
    assert.equal(board[1][1].card?.user_card_instance_id, "heimdall");
    assert.equal(board[1][2].card, null);
  }),
);

test(
  "self-moves (Nightmarchers) never pick a warded tile",
  inSimulation(() => {
    const { board } = setupWard();
    const open = getEmptyAdjacentTiles({ x: 1, y: 1 }, board);
    assert.equal(open.length, 0);
  }),
);
