import { test } from "node:test";
import assert from "node:assert/strict";
import PackService from "../pack.service";

const card = (id: string, pull_weight?: number) =>
  ({ card_id: id, rarity: "epic++", pull_weight }) as any;

function share(cards: any[], id: string, n = 200_000): number {
  let hits = 0;
  for (let i = 0; i < n; i++) if (PackService.pickWeighted(cards).card_id === id) hits++;
  return hits / n;
}

test("default weights pick uniformly", () => {
  const cards = Array.from({ length: 4 }, (_, i) => card(`c${i}`));
  assert.ok(Math.abs(share(cards, "c0") - 0.25) < 0.01);
});

test("event card at 130 gets a 1.3x relative edge", () => {
  const cards = [...Array.from({ length: 9 }, (_, i) => card(`c${i}`)), card("event", 130)];
  // 130 / (900 + 130) ≈ 0.1262
  assert.ok(Math.abs(share(cards, "event") - 130 / 1030) < 0.006);
});

test("non-positive weight falls back to default", () => {
  const cards = [card("a", 0), card("b")];
  assert.ok(Math.abs(share(cards, "a") - 0.5) < 0.01);
});
