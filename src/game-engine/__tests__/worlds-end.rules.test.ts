import test from "node:test";
import assert from "node:assert/strict";
import { GameLogic } from "../game.logic";
import { simulationContext } from "../simulation.context";
import * as validators from "../game.validators";
import { destroyRandomEmptyTile } from "../battleMechanic.tiles";
import {
  getEmptyAdjacentTiles,
  getRandomEmptyTile,
  pullCardsIn,
  pushCardAway,
  setTileStatus,
} from "../ability.utils";
import { TileStatus, TileTerrain } from "../../types/game.types";
import { EVENT_TYPES } from "../../types/game-engine.types";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

/**
 * World's End (Ragnarök saga): a destroyed tile is blocked for BOTH players,
 * for placement and every kind of movement, for the rest of the game.
 */

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

/** Destroy exactly (x, y): every other empty tile is temporarily occupied. */
function destroyAt(state: ReturnType<typeof createTestGameState>, x: number, y: number) {
  const filler = createTestCard({ id: "filler", owner: "p1" });
  const filled: { x: number; y: number }[] = [];
  state.board.forEach((row, yy) =>
    row.forEach((cell, xx) => {
      if (!cell.card && !(xx === x && yy === y)) {
        cell.card = filler;
        filled.push({ x: xx, y: yy });
      }
    }),
  );
  const { events } = destroyRandomEmptyTile(state);
  for (const p of filled) state.board[p.y][p.x].card = null;
  return events;
}

test(
  "destroyed tile is blocked for placement for both players",
  inSimulation(() => {
    const state = createTestGameState({ board: createEmptyBoard(), player1Id: "p1", player2Id: "p2" });
    destroyAt(state, 1, 1);
    assert.equal(state.board[1][1].tile_enabled, false);
    assert.equal(state.board[1][1].tile_effect?.animation_label, "worlds_end");
    for (const player of ["p1", "p2"]) {
      state.current_player_id = player;
      assert.equal(validators.canPlaceOnTile(state, { x: 1, y: 1 }).canPlace, false);
    }
  }),
);

test(
  "push and pull into a destroyed tile bounce (CARD_MOVE_BLOCKED, no move)",
  inSimulation(() => {
    const state = createTestGameState({ board: createEmptyBoard(), player1Id: "p1", player2Id: "p2" });
    destroyAt(state, 1, 1);
    const board = state.board;

    const pushed = createTestCard({ id: "pushed", owner: "p2" });
    placeCardOnBoard(board, { x: 2, y: 1 }, pushed);
    const push = pushCardAway(pushed, { x: 3, y: 1 }, board);
    assert.equal(push.length, 1);
    assert.equal(push[0].type, EVENT_TYPES.CARD_MOVE_BLOCKED);
    assert.equal(board[1][2].card?.user_card_instance_id, "pushed");

    const far = createTestCard({ id: "far", owner: "p2" });
    placeCardOnBoard(board, { x: 1, y: 0 }, far);
    const pull = pullCardsIn({ x: 1, y: 2 }, board, "p1");
    const blocked = pull.filter((e) => e.type === EVENT_TYPES.CARD_MOVE_BLOCKED);
    assert.equal(blocked.length, 1);
    assert.equal(board[0][1].card?.user_card_instance_id, "far");
    assert.equal(board[1][1].card, null);
  }),
);

test(
  "self-moves, random-tile spawns and terrain never touch a destroyed tile",
  inSimulation(() => {
    const board = createEmptyBoard(2);
    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });
    destroyAt(state, 1, 0);
    placeCardOnBoard(board, { x: 0, y: 0 }, createTestCard({ id: "nm", owner: "p1" }));
    assert.deepEqual(
      getEmptyAdjacentTiles({ x: 0, y: 0 }, board).map((t) => t.position),
      [{ x: 0, y: 1 }],
    );
    for (let i = 0; i < 20; i++) {
      const pick = getRandomEmptyTile(board);
      assert.notDeepEqual(pick?.position, { x: 1, y: 0 });
    }
    setTileStatus(board[0][1], { x: 1, y: 0 }, {
      status: TileStatus.Normal,
      terrain: TileTerrain.Ocean,
      turns_left: 1000,
      animation_label: "water",
    });
    assert.equal(board[0][1].tile_effect?.animation_label, "worlds_end");
  }),
);

test(
  "destroying a tile clears the ward / terrain on it",
  inSimulation(() => {
    const state = createTestGameState({ board: createEmptyBoard(), player1Id: "p1", player2Id: "p2" });
    state.board[2][2].tile_effect = {
      status: TileStatus.Blocked,
      turns_left: 2,
      animation_label: "heimdall_gate",
      underlying_effect: { status: TileStatus.Normal, terrain: TileTerrain.Ocean, turns_left: 1000, animation_label: "water" },
    };
    destroyAt(state, 2, 2);
    assert.equal(state.board[2][2].tile_effect?.animation_label, "worlds_end");
    assert.equal(state.board[2][2].tile_effect?.underlying_effect, undefined);
  }),
);

test(
  "destroyed tiles persist through many turns and end the game once nothing is playable",
  inSimulation(async () => {
    const board = createEmptyBoard(2);
    let state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });
    destroyAt(state, 0, 0);
    destroyAt(state, 1, 0);
    placeCardOnBoard(state.board, { x: 0, y: 1 }, createTestCard({ id: "p1c", owner: "p1" }));

    // Still one open tile: the game continues across turns, tiles stay gone.
    for (let i = 0; i < 6; i++) {
      const player = state.current_player_id;
      state = (await GameLogic.endTurn(state, player)).state;
      assert.notEqual(state.status, "completed");
      assert.equal(state.board[0][0].tile_enabled, false);
      assert.equal(state.board[0][1].tile_enabled, false);
    }

    // Fill the last open tile: no playable tile left -> game over, scored on
    // cards only (destroyed tiles count for nobody).
    placeCardOnBoard(state.board, { x: 1, y: 1 }, createTestCard({ id: "p2c", owner: "p2" }));
    state = (await GameLogic.endTurn(state, state.current_player_id)).state;
    assert.equal(state.status, "completed");
    assert.equal(state.player1.score, 1);
    assert.equal(state.player2.score, 1);
  }),
);
