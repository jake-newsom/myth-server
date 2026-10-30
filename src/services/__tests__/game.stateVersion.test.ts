import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.config";
import GameService from "../game.service";
import { HttpError } from "../../api/errors/httpError";
import { GameStatus } from "../../game-engine/game.logic";
import { GameState } from "../../types/game.types";

const state = { status: GameStatus.ACTIVE } as unknown as GameState;

test("a stale expected version throws GAME_STATE_CONFLICT", async (t) => {
  const query = t.mock.method(db, "query", async () => ({ rows: [] }));

  await assert.rejects(
    GameService.updateGameAfterAction("g1", state, GameStatus.ACTIVE, null, 3),
    (err: unknown) =>
      err instanceof HttpError &&
      err.status === 409 &&
      err.code === "GAME_STATE_CONFLICT"
  );
  assert.equal((query.mock.calls[0].arguments as any[])[1][4], 3);
});

test("writers without an expected version skip the check but keep the old error", async (t) => {
  const query = t.mock.method(db, "query", async () => ({ rows: [] }));

  await assert.rejects(
    GameService.updateGameAfterAction("g1", state, GameStatus.ACTIVE, null),
    (err: unknown) =>
      !(err instanceof HttpError) &&
      (err as Error).message === "Failed to update game."
  );
  assert.equal((query.mock.calls[0].arguments as any[])[1][4], null);
});

test("a successful write returns the new version", async (t) => {
  t.mock.method(db, "query", async () => ({
    rows: [
      {
        game_id: "g1",
        game_status: GameStatus.ACTIVE,
        winner_id: null,
        state_version: 4,
      },
    ],
  }));

  const result = await GameService.updateGameAfterAction(
    "g1",
    state,
    GameStatus.ACTIVE,
    null,
    3
  );
  assert.equal(result.state_version, 4);
});
