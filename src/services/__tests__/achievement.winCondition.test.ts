import { test, describe } from "node:test";
import assert from "node:assert";

import GameRewardsService from "../gameRewards.service";
import { winConditionMatches } from "../achievement.service";
import type { GameState } from "../../types/game.types";

/**
 * "Win with X" frame achievements: what a win was won with
 * (getVictoryContext) and whether it satisfies an achievements.win_condition
 * (winConditionMatches). Both are pure.
 *
 * Run with `npm run test:frames` (needs dotenv + transpile-only, see
 * gameRewards.currency.test.ts for why).
 */

const ME = "user-1";
const THEM = "user-2";
const NJORD = "char-njord";
const ONI = "char-oni";
const USHI_ONI = "char-ushi-oni";

function card(characterId: string, owner: string, originalOwner = owner) {
  return {
    card: {
      owner,
      original_owner: originalOwner,
      base_card_data: { character_id: characterId },
    },
  };
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    board: [
      [card(NJORD, ME), null, null],
      // Played by me, flipped to the opponent: still counts as played by me.
      [null, card(USHI_ONI, THEM, ME), null],
      // The opponent's own card never counts for me.
      [null, null, card(ONI, THEM)],
    ],
    player1: { user_id: ME, deck_effect: "norse", discard_pile: ["inst-1"] },
    player2: { user_id: THEM, deck_effect: "japanese", discard_pile: [] },
    hydrated_card_data_cache: {
      "inst-1": { base_card_data: { character_id: "char-from-discard" } },
    },
    ...overrides,
  } as unknown as GameState;
}

describe("getVictoryContext", () => {
  test("collects played characters from board (by original owner) and discard", () => {
    const ctx = GameRewardsService.getVictoryContext(state(), ME);
    assert.deepStrictEqual(
      [...ctx.playedCharacterIds].sort(),
      [NJORD, USHI_ONI, "char-from-discard"].sort()
    );
    assert.strictEqual(ctx.deckEffect, "norse");
    assert.deepStrictEqual(ctx.mechanicIds, []);
  });

  test("reads mechanics and the legacy saga World's End flag", () => {
    const modern = GameRewardsService.getVictoryContext(
      state({ mechanics: [{ config: { id: "worlds_end", defeats_per_destroy: 3 } }] }),
      ME
    );
    assert.deepStrictEqual(modern.mechanicIds, ["worlds_end"]);

    const legacy = GameRewardsService.getVictoryContext(
      state({ saga_context: { worlds_end: { defeats_per_destroy: 3, defeats_since_destroy: 0 } } } as any),
      ME
    );
    assert.deepStrictEqual(legacy.mechanicIds, ["worlds_end"]);
  });
});

describe("winConditionMatches", () => {
  const ctx = GameRewardsService.getVictoryContext(state(), ME);
  const event = { gameMode: "pvp", ...ctx };

  test("played_character requires the card to have been played", () => {
    assert.strictEqual(winConditionMatches({ played_character: NJORD }, event), true);
    // Oni sat on the board but was the opponent's; Ushi-oni is not Oni.
    assert.strictEqual(winConditionMatches({ played_character: ONI }, event), false);
  });

  test("deck_effect matches the winner's passive only", () => {
    assert.strictEqual(winConditionMatches({ deck_effect: "norse" }, event), true);
    assert.strictEqual(winConditionMatches({ deck_effect: "japanese" }, event), false);
  });

  test("game_mode and mechanic are ANDed", () => {
    const sagaWin = { ...event, gameMode: "saga", mechanicIds: ["worlds_end"] };
    const condition = { game_mode: "saga", mechanic: "worlds_end" };
    assert.strictEqual(winConditionMatches(condition, sagaWin), true);
    assert.strictEqual(winConditionMatches(condition, { ...sagaWin, mechanicIds: [] }), false);
    assert.strictEqual(winConditionMatches(condition, { ...sagaWin, gameMode: "solo" }), false);
  });

  test("empty or missing condition never matches", () => {
    assert.strictEqual(winConditionMatches(null, event), false);
    assert.strictEqual(winConditionMatches({}, event), false);
  });
});
