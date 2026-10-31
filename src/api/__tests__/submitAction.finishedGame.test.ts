import { test } from "node:test";
import assert from "node:assert/strict";
import gameController from "../controllers/game.controller";
import GameService from "../../services/game.service";
import GameRewardsService from "../../services/gameRewards.service";
import { GameStatus } from "../../game-engine/game.logic";

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  return res;
}

const record = (columnStatus: string, stateStatus: string) => ({
  game_id: "g1",
  game_mode: "solo",
  game_status: columnStatus,
  state_version: 1,
  created_at: new Date(),
  player1_id: "p1",
  player2_id: "ai",
  player1_deck_id: "d1",
  game_state: {
    status: stateStatus,
    winner: "ai",
    current_player_id: "p1",
    player1: { user_id: "p1", score: 0, hand: [], deck: [] },
    player2: { user_id: "ai", score: 0, hand: [], deck: [] },
    board: [],
    hydrated_card_data_cache: {},
  },
});

for (const [column, state] of [
  [GameStatus.COMPLETED, GameStatus.COMPLETED],
  [GameStatus.REWARDED, GameStatus.COMPLETED],
  [GameStatus.ABORTED, GameStatus.ACTIVE],
]) {
  test(`surrender on a finished game (${column}) grants and writes nothing`, async (t) => {
    t.mock.method(GameService, "getRawGameRecord", async () => record(column, state));
    const write = t.mock.method(GameService, "updateGameAfterAction", async () => ({
      game_id: "g1",
      game_state: {},
      game_status: GameStatus.COMPLETED,
      winner_id: "ai",
      state_version: 2,
    }));
    const rewards = t.mock.method(GameRewardsService, "processGameCompletion", async () => null);

    const res = fakeRes();
    await gameController.submitAction(
      {
        user: { user_id: "p1" },
        params: { gameId: "g1" },
        body: { action_type: "surrender" },
        headers: {},
      } as any,
      res
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "Game is not active");
    assert.equal(write.mock.callCount(), 0);
    assert.equal(rewards.mock.callCount(), 0);
  });
}
