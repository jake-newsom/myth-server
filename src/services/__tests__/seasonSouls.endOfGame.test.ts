import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import SeasonSoulsService from "../seasonSouls.service";
import { GameLogic } from "../../game-engine/game.logic";
import { GameState } from "../../types/game.types";

const owned = (owner: string) => ({ card: { owner } });
const empty = { card: null };

const makeState = (extra: Partial<GameState> = {}) =>
  ({
    player1: { user_id: "p1" },
    player2: { user_id: "p2" },
    board: [
      [owned("p1"), owned("p1")],
      [owned("p2"), empty],
    ],
    ...extra,
  }) as unknown as GameState;

const pending = () => (SeasonSoulsService as any).pendingByUser as Map<string, number>;

beforeEach(() => pending().clear());

test("one soul per card owned on the board, win or lose", () => {
  const state = makeState({ winner: "p2" } as Partial<GameState>);
  SeasonSoulsService.awardEndOfGameSouls("p1", state);
  SeasonSoulsService.awardEndOfGameSouls("p2", state);
  assert.equal(pending().get("p1"), 2);
  assert.equal(pending().get("p2"), 1);
});

test("a surrendering player earns nothing; the opponent still counts", async () => {
  const state = await GameLogic.surrender(makeState(), "p1");
  SeasonSoulsService.awardEndOfGameSouls("p1", state);
  SeasonSoulsService.awardEndOfGameSouls("p2", state);
  assert.equal(pending().has("p1"), false);
  assert.equal(pending().get("p2"), 1);
});

test("an unfunded game earns nothing", () => {
  SeasonSoulsService.awardEndOfGameSouls("p1", makeState({ ember_funded: false }));
  assert.equal(pending().size, 0);
});

test("no cards on the board earns nothing", () => {
  SeasonSoulsService.awardEndOfGameSouls("p9", makeState());
  assert.equal(pending().has("p9"), false);
});
