import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestCard, createTestGameState } from "../../src/game-engine/__tests__/ai.test-utils";
import { GameLogic } from "../../src/game-engine/game.logic";
import { moveCardToPosition } from "../../src/game-engine/ability.utils";
import { EVENT_TYPES } from "../../src/types/game-engine.types";
import { TileStatus, TileTerrain } from "../../src/types/game.types";

// LAVA created by p1: applies_to_user is the creator's OPPONENT (p2).
const lavaBy = (victim: string) => ({
  status: TileStatus.Cursed,
  turns_left: 1000,
  terrain: TileTerrain.Lava,
  animation_label: "lava",
  effect_duration: 1000,
  applies_to_user: victim,
  power: { top: -1, bottom: -1, left: -1, right: -1 },
});

const waterFor = (owner: string) => ({
  status: TileStatus.Normal,
  turns_left: 1000,
  terrain: TileTerrain.Ocean,
  animation_label: "water",
  effect_duration: 1000,
  applies_to_user: owner,
  power: { top: 1, bottom: 1, left: 1, right: 1 },
});

const tilePowerEvents = (events: any[], cardId: string) =>
  events.filter(
    (e) => e.type === EVENT_TYPES.CARD_POWER_CHANGED && e.cardId === cardId,
  );

describe("terrain tile power on placement", () => {
  it("lava never debuffs the creator's own card", async () => {
    const card = createTestCard({ id: "mine", owner: "p1" });
    const state = createTestGameState({ player1Hand: ["mine"], hydrated: { mine: card } });
    state.board[0][0].tile_effect = lavaBy("p2") as any;

    const result = await GameLogic.placeCard(state, "p1", "mine", { x: 0, y: 0 });

    assert.equal(tilePowerEvents(result.events, "mine").length, 0);
    assert.equal(result.state.board[0][0].card?.current_power.top, 4);
    assert.equal(result.state.board[0][0].tile_effect?.terrain, TileTerrain.Lava, "lava persists");
  });

  it("lava debuffs the victim's card -1 per side, ticked AFTER the card lands", async () => {
    const card = createTestCard({ id: "theirs", owner: "p2" });
    const state = createTestGameState({ player2Hand: ["theirs"], hydrated: { theirs: card } });
    state.current_player_id = "p2";
    state.board[0][0].tile_effect = lavaBy("p2") as any;

    const result = await GameLogic.placeCard(state, "p2", "theirs", { x: 0, y: 0 });

    const placedIdx = result.events.findIndex((e: any) => e.type === EVENT_TYPES.CARD_PLACED);
    const placed: any = result.events[placedIdx];
    const [tileEvt]: any[] = tilePowerEvents(result.events, "theirs");

    assert.equal(placed.powerOnPlace.top, 4, "slams in at pre-lava power");
    assert.ok(tileEvt, "tile power event emitted");
    assert.ok(result.events.indexOf(tileEvt) > placedIdx, "emitted after CARD_PLACED");
    assert.equal(tileEvt.powerDelta, -1, "per-side scalar, not the -4 sum");
    assert.deepEqual(tileEvt.powerBySide, { top: -1, right: -1, bottom: -1, left: -1 });
    assert.equal(tileEvt.isNegativeEffect, true);
    assert.equal(result.state.board[0][0].card?.current_power.top, 3);
  });

  it("water reads +1 (not +4) for its owner", async () => {
    const card = createTestCard({ id: "mine", owner: "p1" });
    const state = createTestGameState({ player1Hand: ["mine"], hydrated: { mine: card } });
    state.board[0][0].tile_effect = waterFor("p1") as any;

    const result = await GameLogic.placeCard(state, "p1", "mine", { x: 0, y: 0 });
    const [tileEvt]: any[] = tilePowerEvents(result.events, "mine");

    assert.equal(tileEvt.powerDelta, 1);
    assert.equal(result.state.board[0][0].card?.current_power.top, 5);
  });
});

// Curse created by p1 (Kapo / Nightmarchers shape): applies_to_user = victim.
const curseOn = (victim: string, value: number) => ({
  status: TileStatus.Cursed,
  turns_left: 3,
  animation_label: "cursed",
  effect_duration: 1000,
  applies_to_user: victim,
  power: { top: -value, bottom: -value, left: -value, right: -value },
});

const clearEvents = (events: any[]) =>
  events.filter(
    (e) => e.type === EVENT_TYPES.TILE_STATE_CHANGED && e.tile?.tile_effect === undefined,
  );

describe("curse tiles", () => {
  for (const value of [1, 2, 3]) {
    it(`victim placement takes -${value} and consumes the curse (clear before the -X)`, async () => {
      const card = createTestCard({ id: "theirs", owner: "p2" });
      const state = createTestGameState({ player2Hand: ["theirs"], hydrated: { theirs: card } });
      state.current_player_id = "p2";
      state.board[0][0].tile_effect = curseOn("p2", value) as any;

      const result = await GameLogic.placeCard(state, "p2", "theirs", { x: 0, y: 0 });
      const [clear]: any[] = clearEvents(result.events);
      const [tileEvt]: any[] = tilePowerEvents(result.events, "theirs");

      assert.equal(result.state.board[0][0].tile_effect, undefined, "consumed");
      assert.ok(clear, "clear event emitted");
      assert.ok(result.events.indexOf(clear) < result.events.indexOf(tileEvt), "clear before -X");
      assert.equal(tileEvt.powerDelta, -value);
      assert.equal(tileEvt.effectName, "Curse");
      assert.equal(result.state.board[0][0].card?.current_power.top, 4 - value);
    });
  }

  it("creator's own card is untouched and the curse is consumed harmlessly", async () => {
    const card = createTestCard({ id: "mine", owner: "p1" });
    const state = createTestGameState({ player1Hand: ["mine"], hydrated: { mine: card } });
    state.board[0][0].tile_effect = curseOn("p2", 3) as any;

    const result = await GameLogic.placeCard(state, "p1", "mine", { x: 0, y: 0 });
    const [clear]: any[] = clearEvents(result.events);

    assert.equal(tilePowerEvents(result.events, "mine").length, 0);
    assert.equal(result.state.board[0][0].card?.current_power.top, 4);
    assert.equal(result.state.board[0][0].tile_effect, undefined);
    assert.ok(clear, "cleared");
  });

  it("a victim MOVING onto a curse takes -X and consumes it", () => {
    const card = createTestCard({ id: "theirs", owner: "p2" });
    const state = createTestGameState({ hydrated: { theirs: card } });
    state.board[0][1].card = card;
    state.board[0][0].tile_effect = curseOn("p2", 2) as any;

    const events = moveCardToPosition(card, { x: 0, y: 0 }, { x: 1, y: 0 }, state.board);

    assert.equal(state.board[0][0].tile_effect, undefined, "consumed");
    assert.equal(clearEvents(events).length, 1);
    assert.equal(card.current_power.top, 2);
  });

  it("a friendly card moving onto a curse leaves it armed", () => {
    const card = createTestCard({ id: "mine", owner: "p1" });
    const state = createTestGameState({ hydrated: { mine: card } });
    state.board[0][1].card = card;
    state.board[0][0].tile_effect = curseOn("p2", 2) as any;

    const events = moveCardToPosition(card, { x: 0, y: 0 }, { x: 1, y: 0 }, state.board);

    assert.equal(state.board[0][0].tile_effect?.status, TileStatus.Cursed, "still armed");
    assert.equal(clearEvents(events).length, 0);
    assert.equal(card.current_power.top, 4);
  });

  it("haunted: slams in at pre-haunt power, then ticks +4 exactly once", async () => {
    const card = createTestCard({ id: "shade", owner: "p1", tags: ["underworld"] });
    const state = createTestGameState({ player1Hand: ["shade"], hydrated: { shade: card } });
    state.board[0][0].mechanic_effect = { id: "haunted", tag: "underworld", matching_bonus: 4, other_bonus: -2 } as any;

    const result = await GameLogic.placeCard(state, "p1", "shade", { x: 0, y: 0 });
    const placed: any = result.events.find((e: any) => e.type === EVENT_TYPES.CARD_PLACED);
    const [hauntEvt]: any[] = tilePowerEvents(result.events, "shade");

    assert.equal(placed.powerOnPlace.top, 4, "powerOnPlace excludes the haunt bonus");
    assert.equal(hauntEvt.powerDelta, 4);
    assert.equal(result.state.board[0][0].card?.current_power.top, 8);
  });

  it("haunted + water: powerOnPlace excludes both bonuses", async () => {
    const card = createTestCard({ id: "shade", owner: "p1", tags: ["underworld"] });
    const state = createTestGameState({ player1Hand: ["shade"], hydrated: { shade: card } });
    state.board[0][0].tile_effect = waterFor("p1") as any;
    state.board[0][0].mechanic_effect = { id: "haunted", tag: "underworld", matching_bonus: 4, other_bonus: -2 } as any;

    const result = await GameLogic.placeCard(state, "p1", "shade", { x: 0, y: 0 });
    const placed: any = result.events.find((e: any) => e.type === EVENT_TYPES.CARD_PLACED);

    assert.equal(placed.powerOnPlace.top, 4);
    assert.equal(result.state.board[0][0].card?.current_power.top, 9);
  });
});
