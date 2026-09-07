import test from "node:test";
import assert from "node:assert/strict";
import {
  claimMechanicTileEffect,
  isClaimedMechanicEffect,
  refreshMechanicTilePower,
} from "../battleMechanic.power";
import { updateCurrentPower } from "../ability.utils";
import { MechanicTileEffect } from "../../types/battleMechanic.types";
import { createTestCard } from "./ai.test-utils";

const HAUNTED: MechanicTileEffect = {
  id: "haunted",
  tag: "underworld",
  matching_bonus: 4,
  other_bonus: -2,
};

function boardWith(card: any, effect?: MechanicTileEffect) {
  return [[{ card, tile_enabled: true, mechanic_effect: effect }]] as any;
}

test("haunted tile buffs a matching card and the bonus survives being claimed", () => {
  const card = createTestCard({ id: "shade", owner: "p1", tags: ["underworld"] });
  const board = boardWith(card, HAUNTED);

  card.current_power = updateCurrentPower(card, board);
  assert.equal(card.current_power.top, 8, "4 base + 4 matching bonus");

  // Placement claims the bonus and clears the tile.
  assert.equal(claimMechanicTileEffect(card), true);
  board[0][0].mechanic_effect = undefined;

  // The bonus must survive recomputation now that the tile is gone.
  card.current_power = updateCurrentPower(card, board);
  assert.equal(card.current_power.top, 8, "claimed bonus persists after tile cleared");

  for (let i = 0; i < 5; i++) {
    card.current_power = updateCurrentPower(card, board);
  }
  assert.equal(card.current_power.top, 8, "stable across repeated recomputes");
  assert.equal(card.temporary_effects.filter(isClaimedMechanicEffect).length, 1);
});

test("haunted tile debuffs a non-matching card and that also persists", () => {
  const card = createTestCard({ id: "sun", owner: "p1", tags: ["god"] });
  const board = boardWith(card, HAUNTED);

  card.current_power = updateCurrentPower(card, board);
  assert.equal(card.current_power.top, 2, "4 base - 2 other_bonus");

  claimMechanicTileEffect(card);
  board[0][0].mechanic_effect = undefined;

  card.current_power = updateCurrentPower(card, board);
  assert.equal(card.current_power.top, 2, "claimed debuff is not refunded");
});

test("a spent haunted tile gives nothing to the next occupant", () => {
  const first = createTestCard({ id: "first", owner: "p1", tags: ["underworld"] });
  const board = boardWith(first, HAUNTED);

  first.current_power = updateCurrentPower(first, board);
  claimMechanicTileEffect(first);
  board[0][0].mechanic_effect = undefined;
  assert.equal(first.current_power.top, 8);

  // The first card leaves; a second card lands on the now-spent tile.
  const second = createTestCard({ id: "second", owner: "p1", tags: ["underworld"] });
  board[0][0].card = second;
  second.current_power = updateCurrentPower(second, board);

  assert.equal(second.current_power.top, 4, "no bonus from an already-spent tile");
  assert.equal(
    second.temporary_effects.some((e: any) => e.data?.battleMechanic === "haunted"),
    false,
  );
});

test("an unclaimed bonus is still re-derived from the tile", () => {
  const card = createTestCard({ id: "drifter", owner: "p1", tags: ["underworld"] });
  const board = boardWith(card, HAUNTED);

  card.current_power = updateCurrentPower(card, board);
  assert.equal(card.current_power.top, 8);

  // Without a claim, removing the tile removes the bonus — this is what keeps
  // the effect correct for any path that has not consumed the tile yet.
  board[0][0].mechanic_effect = undefined;
  card.current_power = updateCurrentPower(card, board);
  assert.equal(card.current_power.top, 4, "unclaimed bonus is tile-derived");
});

test("an iron-rune card takes no debuff but still spends the tile", () => {
  const card = createTestCard({ id: "iron", owner: "p1", tags: ["god"] });
  card.saga_rune_type = "iron";
  const board = boardWith(card, HAUNTED);

  card.current_power = updateCurrentPower(card, board);
  assert.equal(card.current_power.top, 4, "immune to the haunted debuff");

  // Nothing to claim, but the caller still clears the tile.
  assert.equal(claimMechanicTileEffect(card), false);
  board[0][0].mechanic_effect = undefined;
  assert.equal(board[0][0].mechanic_effect, undefined);
});

test("refreshMechanicTilePower never stacks a second bonus on a claimed card", () => {
  const card = createTestCard({ id: "greedy", owner: "p1", tags: ["underworld"] });
  const board = boardWith(card, HAUNTED);

  card.current_power = updateCurrentPower(card, board);
  claimMechanicTileEffect(card);

  // Simulate the card sitting on another haunted tile: the claimed bonus wins
  // and no second entry is added.
  refreshMechanicTilePower(card, HAUNTED);
  const hauntedEntries = card.temporary_effects.filter(
    (e: any) => e.data?.battleMechanic === "haunted",
  );
  assert.equal(hauntedEntries.length, 1, "exactly one haunted effect");
  card.current_power = updateCurrentPower(card, board);
  assert.equal(card.current_power.top, 8, "bonus does not double up");
});
