import test from "node:test";
import assert from "node:assert/strict";
import { TriggerMoment } from "../../types/card.types";
import { BoardPosition, GameState, TileStatus, TileTerrain } from "../../types/game.types";
import { GameStatus } from "../../types";
import { GameLogic } from "../game.logic";
import { simulationContext } from "../simulation.context";
import * as validators from "../game.validators";
import {
  buildTutorialGameStateV2FromRows,
  getTutorialAIMove,
  TutorialCardRow,
  TutorialCardRowMap,
} from "../tutorial.data";

const USER = "tutorial-user";
const AI = "00000000-0000-0000-0000-000000000000";

const ABILITIES: Record<string, string> = {
  Njord: "njord_sea",
  Surtr: "surtr_flames",
  "Jorōgumo": "jorogumo_web_curse",
};

const NAMES = [
  "Shieldmaiden", "Oni", "Njord", "Surtr", "Koa Warrior", "Kitsune", "Berserker",
  "Drengr", "Tengu", "Kappa", "Mokumokuren", "Jorōgumo", "Hitotsume-kozō",
  "Runestone Keeper", "Young Jarl", "Thrall", "Tanuki",
];

/** In-memory stand-in for the DB rows fetchCardsByName returns. */
function fakeRows(): TutorialCardRowMap {
  const map: TutorialCardRowMap = new Map();
  for (const name of NAMES) {
    const abilityId = ABILITIES[name] ?? null;
    const row: TutorialCardRow = {
      card_variant_id: `variant-${name}`,
      name,
      rarity: "common",
      image_url: "",
      set_id: "set",
      tags: name === "Njord" ? ["god", "sea"] : name === "Kappa" ? ["spirit", "sea"] : [],
      special_ability_id: abilityId,
      ability_key: abilityId,
      ability_name: abilityId,
      ability_description: "",
      ability_triggers: abilityId ? [TriggerMoment.OnPlace] : null,
      ability_parameters: {},
      ability_sound_effect: null,
      attack_animation: null,
      sound_effect: null,
      is_exclusive: false,
    };
    map.set(name, row);
  }
  return map;
}

const at = (state: GameState, row: number, col: number) => state.board[row][col];

async function playerMove(state: GameState, cardId: string, row: number, col: number) {
  return (await GameLogic.placeCard(state, USER, cardId, { x: col, y: row })).state;
}

async function aiMove(state: GameState): Promise<GameState> {
  assert.equal(state.current_player_id, AI);
  const move = getTutorialAIMove(state);
  if (!move) {
    return (await GameLogic.forcePass(state, AI)).state;
  }
  return (await GameLogic.placeCard(state, AI, move.cardId, move.position)).state;
}

function openTiles(state: GameState): BoardPosition[] {
  const tiles: BoardPosition[] = [];
  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board[y].length; x++) {
      if (validators.isPlayableEmptyCell(state.board[y][x])) tiles.push({ x, y });
    }
  }
  return tiles;
}

// Two naive free-play policies scanning the board from opposite ends, so the
// win doesn't hinge on the player happening to fill tiles in the AI's order.
for (const policy of ["first", "last"] as const) {
  test(`v2 tutorial: guided script teaches flip, water, curse, lava; free play (${policy} open tile) ends in a player win`, async () => {
    simulationContext.enterSimulation();
    try {
      let state = buildTutorialGameStateV2FromRows(USER, fakeRows());
      assert.equal(state.board.length, 4);
      assert.equal(state.tutorial_version, 2);
      assert.equal(state.player1.hand.length, 5);
      assert.equal(state.player1.deck.length, 4);
      assert.equal(state.player2.hand.length + state.player2.deck.length, 8);

      // Turn 1: Shieldmaiden to (1,1)
      state = await playerMove(state, "tut2-p1", 1, 1);
      assert.equal(state.player1.hand.length, 5, "player draws back to 5");

      // Turn 2: Kappa to (0,3)
      state = await aiMove(state);
      assert.equal(at(state, 0, 3).card?.user_card_instance_id, "tut2-a1");

      // Turn 3: Oni to (0,2) flips Kappa
      state = await playerMove(state, "tut2-p2", 0, 2);
      assert.equal(at(state, 0, 3).card?.owner, USER, "Oni flips Kappa");

      // Turn 4: Mokumokuren to (0,0)
      state = await aiMove(state);
      assert.equal(at(state, 0, 0).card?.user_card_instance_id, "tut2-a2");

      // Turn 5: Njord to (3,3) floods row 3
      state = await playerMove(state, "tut2-p3", 3, 3);
      for (let col = 0; col < 4; col++) {
        assert.equal(at(state, 3, col).tile_effect?.terrain, TileTerrain.Ocean, `water at (3,${col})`);
      }

      // Turn 6: Jorōgumo to (1,3) curses (1,2) and (2,3), flips nothing
      state = await aiMove(state);
      assert.equal(at(state, 1, 3).card?.owner, AI);
      assert.equal(at(state, 0, 3).card?.owner, USER, "Kappa stays the player's");
      for (const [r, c] of [[1, 2], [2, 3]]) {
        const effect = at(state, r, c).tile_effect;
        assert.equal(effect?.status, TileStatus.Cursed, `curse at (${r},${c})`);
        assert.equal(effect?.terrain, undefined, `curse at (${r},${c}) is not terrain`);
        assert.equal(effect?.applies_to_user, USER);
      }
      assert.equal(at(state, 3, 3).tile_effect?.terrain, TileTerrain.Ocean, "water row untouched");

      // Turn 7: Surtr to (1,0) destroys Mokumokuren, leaves lava at (0,0) and (2,0)
      state = await playerMove(state, "tut2-p4", 1, 0);
      assert.equal(at(state, 0, 0).card, null, "Mokumokuren destroyed");
      for (const [r, c] of [[0, 0], [2, 0]]) {
        assert.equal(at(state, r, c).tile_effect?.terrain, TileTerrain.Lava, `lava at (${r},${c})`);
        assert.equal(at(state, r, c).tile_effect?.applies_to_user, AI);
      }

      // Turn 8: Hitotsume-kozō lands in lava at (2,0) and loses 1
      state = await aiMove(state);
      const hitotsume = at(state, 2, 0).card;
      assert.equal(hitotsume?.user_card_instance_id, "tut2-a4");
      assert.equal(hitotsume?.owner, AI);
      assert.equal(hitotsume?.current_power.bottom, 3, "lava drops bottom 4 -> 3");
      assert.equal(at(state, 1, 0).card?.owner, USER, "Surtr survives");

      // Turn 9: Koa Warrior on water at (3,0): top 3 -> 4 beats 3, flips Hitotsume
      state = await playerMove(state, "tut2-p5", 3, 0);
      assert.equal(at(state, 3, 0).card?.current_power.top, 4, "water buffs Koa");
      assert.equal(at(state, 2, 0).card?.owner, USER, "Koa flips Hitotsume");

      // Free play: naive player (first card, first open tile) vs the fallback AI
      for (let guard = 0; guard < 40 && state.status === GameStatus.ACTIVE; guard++) {
        if (state.current_player_id === AI) {
          state = await aiMove(state);
          continue;
        }
        const cardId = state.player1.hand[0];
        const tiles = openTiles(state);
        const pos = policy === "first" ? tiles[0] : tiles[tiles.length - 1];
        if (!cardId || !pos) {
          state = (await GameLogic.forcePass(state, USER)).state;
          continue;
        }
        state = await playerMove(state, cardId, pos.y, pos.x);
      }

      assert.equal(state.status, GameStatus.COMPLETED);
      assert.equal(validators.hasPlayableEmptyTiles(state.board), false, "board filled");
      assert.equal(state.player1.hand.length, 0, "player played every card");
      assert.equal(state.winner, USER, `player wins (${state.player1.score}-${state.player2.score})`);
    } finally {
      simulationContext.exitSimulation();
    }
  });
}

test("v1 tutorial AI script is unchanged when tutorial_version is absent", () => {
  const v1State = { turn_number: 2, board: [] } as unknown as GameState;
  assert.deepEqual(getTutorialAIMove(v1State), {
    cardId: "tut-a1",
    position: { x: 2, y: 0 },
  });
  assert.equal(getTutorialAIMove({ ...v1State, turn_number: 10 }), null);
});
