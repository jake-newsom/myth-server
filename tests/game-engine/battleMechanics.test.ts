import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initializeBattleMechanics, applyBattleMechanicsAfterDefeats } from "../../src/game-engine/battleMechanics";
import { resolveSagaMechanics } from "../../src/game-engine/sagaBattle.configuration";
import { updateCurrentPower, moveCardToPosition } from "../../src/game-engine/ability.utils";
import { updateAllBoardCards, updateAllHandCards } from "../../src/game-engine/game.utils";
import { createTestCard, createTestGameState } from "../../src/game-engine/__tests__/ai.test-utils";
import { GameLogic } from "../../src/game-engine/game.logic";
import { EVENT_TYPES } from "../../src/types/game-engine.types";

const blocked = (state: ReturnType<typeof createTestGameState>) => state.board.flat().filter(cell => !cell.tile_enabled).length;

describe("battle mechanic lifecycle", () => {
  it("runs World’s End without saga, preserves remainder across serialization, and supports multiple destructions", () => {
    let state = createTestGameState({});
    initializeBattleMechanics(state, [{ id: "worlds_end", defeats_per_destroy: 3, pre_destroyed_tiles: 1 }]);
    assert.equal(blocked(state), 1);
    applyBattleMechanicsAfterDefeats(state, 2);
    state = JSON.parse(JSON.stringify(state));
    const result = applyBattleMechanicsAfterDefeats(state, 5);
    assert.equal(result.events.length, 2);
    assert.equal(blocked(state), 3);
    assert.equal(state.mechanics?.[0].defeats_since_destroy, 1);
  });
  it("upgrades legacy progress once and respects explicit opt-out", () => {
    const state = createTestGameState({});
    state.saga_context = { worlds_end: { defeats_per_destroy: 3, defeats_since_destroy: 2 } } as any;
    assert.equal(applyBattleMechanicsAfterDefeats(state, 1).events.length, 1);
    assert.equal(state.saga_context?.worlds_end?.defeats_since_destroy, 0);
    assert.equal(applyBattleMechanicsAfterDefeats(state, 1).events.length, 0);
    state.mechanics = [];
    assert.equal(applyBattleMechanicsAfterDefeats(state, 100).events.length, 0);
  });
  it("rejects invalid config before modifying the board", () => {
    for (const config of [
      { id: "worlds_end", defeats_per_destroy: 0 },
      { id: "worlds_end", defeats_per_destroy: Infinity },
      { id: "haunted", tile_count: -1 },
      { id: "haunted", tile_count: 1.5 },
      { id: "unknown" },
      { id: "toString" },
    ]) {
      const state = createTestGameState({});
      assert.throws(() => initializeBattleMechanics(state, [config as any]));
      assert.equal(state.mechanics, undefined);
    }
  });
  it("caps starting tiles to available cells and rejects reinitialization", () => {
    const state = createTestGameState({});
    initializeBattleMechanics(state, [
      { id: "worlds_end", defeats_per_destroy: 2, pre_destroyed_tiles: 3 },
      { id: "haunted", tile_count: 999 },
    ]);
    assert.equal(state.board.flat().filter(cell => cell.mechanic_effect).length, 13);
    assert.throws(() => initializeBattleMechanics(state, []));
  });
  it("keeps legacy saga defaults but lets new seasons replace or disable them", () => {
    const legacy = { defeats_per_destroy: 1, pre_destroyed_tiles: 5 };
    assert.deepEqual(resolveSagaMechanics({}, legacy), [{ id: "worlds_end", ...legacy }]);
    assert.deepEqual(resolveSagaMechanics({ id: "haunted", tile_count: 4 }, legacy), [{ id: "haunted", tile_count: 4 }]);
    assert.deepEqual(resolveSagaMechanics({ mechanics: [] }, legacy), []);
    assert.throws(() => resolveSagaMechanics({ id: "typo" }, legacy));
  });
});

describe("haunted tile power", () => {
  it("uses tags for either player, clamps at zero, and never stacks on refresh", () => {
    for (const owner of ["p1", "p2"]) {
      for (const tags of [[], ["underworld"]]) {
        const state = createTestGameState({});
        initializeBattleMechanics(state, [{ id: "haunted", tile_count: 16 }]);
        const card = createTestCard({ id: "card", owner, tags, power: { top: 1, right: 3, bottom: 4, left: 5 } });
        state.board[0][0].card = card;
        updateAllBoardCards(state);
        updateAllBoardCards(state);
        assert.deepEqual(card.current_power, tags.length
          ? { top: 5, right: 7, bottom: 8, left: 9 }
          : { top: 0, right: 1, bottom: 2, left: 3 });
        assert.equal(card.temporary_effects.length, 1);
      }
    }
  });
  it("removes the effect when moving away or returning to hand", () => {
    const card = createTestCard({ id: "card", owner: "p1", tags: ["underworld"] });
    const state = createTestGameState({ hydrated: { card } });
    initializeBattleMechanics(state, [{ id: "haunted", tile_count: 16 }]);
    delete state.board[0][1].mechanic_effect;
    state.board[0][0].card = card;
    updateAllBoardCards(state);
    assert.equal(card.current_power.top, 8);
    moveCardToPosition(card, { x: 1, y: 0 }, { x: 0, y: 0 }, state.board);
    assert.equal(card.current_power.top, 4);
    moveCardToPosition(card, { x: 0, y: 0 }, { x: 1, y: 0 }, state.board);
    assert.equal(card.current_power.top, 8);
    state.board[0][0].card = null;
    state.player1.hand = ["card"];
    updateAllHandCards(state);
    assert.equal(card.current_power.top, 4);
  });
  it("respects Iron debuff immunity", () => {
    const state = createTestGameState({});
    initializeBattleMechanics(state, [{ id: "haunted", tile_count: 16 }]);
    const card = createTestCard({ id: "iron", owner: "p1" });
    card.saga_rune_type = "iron";
    state.board[0][0].card = card;
    assert.equal(updateCurrentPower(card, state.board).top, 4);
  });
  it("applies before combat in ordinary games and persists the tile after placement", async () => {
    const card = createTestCard({ id: "card", owner: "p1", tags: ["underworld"] });
    const enemy = createTestCard({ id: "enemy", owner: "p2", tags: ["underworld"], power: { top: 6, right: 6, bottom: 6, left: 6 } });
    const state = createTestGameState({ player1Hand: ["card"], player2Hand: ["other"], hydrated: { card, enemy } });
    initializeBattleMechanics(state, [{ id: "haunted", tile_count: 16 }]);
    delete state.board[0][1].mechanic_effect;
    state.board[0][1].card = enemy;
    const result = await GameLogic.placeCard(state, "p1", "card", { x: 0, y: 0 });
    assert.ok(result.events.some(event => event.type === EVENT_TYPES.CARD_FLIPPED));
    assert.equal(result.state.board[0][0].mechanic_effect?.id, "haunted");
    assert.equal(state.board[0][0].card, null, "simulation must not mutate input");
  });
});
