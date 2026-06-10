import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as validators from "../../src/game-engine/game.validators";
import {
  destroyRandomEmptyTile,
  applyWorldsEndAfterFlips,
} from "../../src/game-engine/sagaBattle.mechanics";
import { createBoardCell } from "../../src/game-engine/game.utils";
import { GAME_CONFIG } from "../../src/config/constants";
import { GameState, TileStatus } from "../../src/types/game.types";
import { GameStatus } from "../../src/types/game-engine.types";

function emptyBoard(): GameState["board"] {
  return Array(GAME_CONFIG.BOARD_SIZE)
    .fill(null)
    .map(() =>
      Array(GAME_CONFIG.BOARD_SIZE)
        .fill(null)
        .map(() => createBoardCell(null, "normal").boardCell)
    );
}

function baseState(board: GameState["board"]): GameState {
  return {
    board,
    player1: {
      user_id: "p1",
      hand: ["h1"],
      deck: [],
      discard_pile: [],
      score: 2,
    },
    player2: {
      user_id: "p2",
      hand: ["h2"],
      deck: [],
      discard_pile: [],
      score: 1,
    },
    current_player_id: "p1",
    turn_number: 1,
    status: GameStatus.ACTIVE,
    max_cards_in_hand: 10,
    initial_cards_to_draw: 5,
    winner: null,
    saga_context: {
      run_id: "run-1",
      node_id: "node-1",
      season_id: "season-1",
      floor: 1,
      floor_difficulty: "normal",
      battle_difficulty: "easy",
      enemy_stat_bonus: 0,
      ai_profile: "basic",
      worlds_end: { defeats_per_destroy: 1, defeats_since_destroy: 0 },
      slayer_applied: {},
    },
  };
}

describe("hasPlayableEmptyTiles", () => {
  it("returns true when an open tile remains", () => {
    const board = emptyBoard();
    assert.equal(validators.hasPlayableEmptyTiles(board), true);
  });

  it("returns false when every empty tile is blocked", () => {
    const board = emptyBoard();
    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) {
        board[y][x].tile_enabled = false;
        board[y][x].tile_effect = {
          status: TileStatus.Blocked,
          turns_left: 9999,
        };
      }
    }
    assert.equal(validators.hasPlayableEmptyTiles(board), false);
    assert.equal(validators.isBoardFull(board), false);
  });
});

describe("worlds end tile destruction", () => {
  it("can remove the last playable tile", () => {
    const board = emptyBoard();
    // Fill all but one tile with cards
    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) {
        if (x === 0 && y === 0) continue;
        board[y][x].card = {
          user_card_instance_id: `c-${x}-${y}`,
          base_card_id: "base",
          owner: "p1",
          current_power: { top: 1, right: 1, bottom: 1, left: 1 },
          level: 1,
          card_state: "normal",
        } as any;
      }
    }

    assert.equal(validators.hasPlayableEmptyTiles(board), true);

    const state = baseState(board);
    const { state: afterDestroy } = destroyRandomEmptyTile(state, "worlds_end");

    assert.equal(validators.hasPlayableEmptyTiles(afterDestroy.board), false);
  });

  it("applyWorldsEndAfterFlips destroys tiles when threshold reached", () => {
    const state = baseState(emptyBoard());
    const { state: after, events } = applyWorldsEndAfterFlips(state, 1);

    assert.ok(events.length > 0);
    assert.ok(after.board.some((row) => row.some((cell) => !cell.tile_enabled)));
  });
});
