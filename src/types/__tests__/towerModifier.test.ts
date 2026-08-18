import { test, describe } from "node:test";
import assert from "node:assert";

import {
  validateDeckAgainstModifiers,
  normalizeModifiers,
  ModifierDeckCard,
  TowerModifier,
  MAX_MODIFIERS_PER_FLOOR,
} from "../towerModifier.types";
import { Rarity } from "../card.types";

function card(
  name: string,
  rarity: string,
  tags: string[] = [],
  setName: string | null = "Norse"
): ModifierDeckCard {
  return { name, rarity: rarity as Rarity, tags, set_name: setName };
}

/** 20 legal Norse commons — the baseline "clean" deck. */
function cleanDeck(): ModifierDeckCard[] {
  return Array.from({ length: 20 }, (_, i) =>
    card(`Norse Common ${i}`, "common", ["war"], "Norse")
  );
}

const modifier = (
  type: TowerModifier["type"],
  value?: number | string
): TowerModifier => ({
  type,
  value,
  label: "Test Modifier",
  description: "test",
});

describe("validateDeckAgainstModifiers", () => {
  test("returns no violations for an unrestricted floor", () => {
    assert.deepEqual(validateDeckAgainstModifiers(cleanDeck(), []), []);
  });

  test("no_legendary passes a deck with no legendary cards", () => {
    const result = validateDeckAgainstModifiers(cleanDeck(), [
      modifier("no_legendary"),
    ]);
    assert.deepEqual(result, []);
  });

  test("no_legendary flags legendary cards, including '+' variants", () => {
    const deck = cleanDeck();
    deck[0] = card("Odin", "legendary", ["god"]);
    deck[1] = card("Thor", "legendary+++", ["god"]);

    const result = validateDeckAgainstModifiers(deck, [
      modifier("no_legendary"),
    ]);

    assert.equal(result.length, 1);
    assert.match(result[0], /Legendary cards may not enter/);
    assert.match(result[0], /Odin/);
    assert.match(result[0], /Thor/);
  });

  test("single_set flags cards from other sets and is case-insensitive", () => {
    const deck = cleanDeck();
    deck[0] = card("Amaterasu", "epic", ["god"], "Japanese");

    const result = validateDeckAgainstModifiers(deck, [
      modifier("single_set", "norse"),
    ]);

    assert.equal(result.length, 1);
    assert.match(result[0], /only Norse cards/);
    assert.match(result[0], /Amaterasu/);
  });

  test("single_set treats a null set as a violation rather than a pass", () => {
    const deck = cleanDeck();
    deck[0] = card("Setless", "rare", [], null);

    const result = validateDeckAgainstModifiers(deck, [
      modifier("single_set", "norse"),
    ]);

    assert.equal(result.length, 1);
    assert.match(result[0], /Setless/);
  });

  test("no_tag flags cards carrying the banned tag", () => {
    const deck = cleanDeck();
    deck[0] = card("Surtr", "epic", ["fire", "giant"]);

    const result = validateDeckAgainstModifiers(deck, [
      modifier("no_tag", "fire"),
    ]);

    assert.equal(result.length, 1);
    assert.match(result[0], /Fire cards may not enter/);
    assert.match(result[0], /Surtr/);
  });

  test("no_tag ignores cards without the banned tag", () => {
    const result = validateDeckAgainstModifiers(cleanDeck(), [
      modifier("no_tag", "ice"),
    ]);
    assert.deepEqual(result, []);
  });

  test("max_budget uses base rarity cost and ignores '+' upgrades", () => {
    const deck = cleanDeck();
    // legendary costs 9; two of them = 18, over a cap of 10.
    deck[0] = card("Odin", "legendary", ["god"]);
    deck[1] = card("Thor", "legendary++", ["god"]);

    const result = validateDeckAgainstModifiers(deck, [
      modifier("max_budget", 10),
    ]);

    assert.equal(result.length, 1);
    assert.match(result[0], /caps the deck power budget at 10/);
    assert.match(result[0], /spends 18/);
  });

  test("max_budget passes a deck exactly at the cap", () => {
    const deck = cleanDeck();
    deck[0] = card("Odin", "legendary", ["god"]); // 9

    const result = validateDeckAgainstModifiers(deck, [
      modifier("max_budget", 9),
    ]);

    assert.deepEqual(result, []);
  });

  test("reports one violation per violated modifier", () => {
    const deck = cleanDeck();
    deck[0] = card("Odin", "legendary", ["god"], "Norse");
    deck[1] = card("Amaterasu", "epic", ["god"], "Japanese");

    const result = validateDeckAgainstModifiers(deck, [
      modifier("no_legendary"),
      modifier("single_set", "norse"),
    ]);

    assert.equal(result.length, 2);
  });

  test("poison is a battle status, not a deck restriction", () => {
    const deck = cleanDeck();
    deck[0] = card("Odin", "legendary", ["god"]);

    const result = validateDeckAgainstModifiers(deck, [modifier("poison", 1)]);

    assert.deepEqual(result, []);
  });

  test("repeated offenders are annotated so the count matches the list", () => {
    const deck = cleanDeck();
    deck[0] = card("Kāne", "legendary", ["god"]);
    deck[1] = card("Kāne", "legendary", ["god"]);

    const result = validateDeckAgainstModifiers(deck, [
      modifier("no_legendary"),
    ]);

    // 2 offending cards, but only one distinct name — must not read as
    // "2 cards must be swapped: Kāne".
    assert.match(result[0], /2 cards must be swapped: Kāne ×2\./);
  });

  test("offender lists are deduped and capped at five names", () => {
    const deck = Array.from({ length: 20 }, (_, i) =>
      card(`Legend ${i}`, "legendary", ["god"])
    );

    const result = validateDeckAgainstModifiers(deck, [
      modifier("no_legendary"),
    ]);

    assert.match(result[0], /\+15 more/);
  });

  test("a malformed value is skipped rather than throwing", () => {
    const result = validateDeckAgainstModifiers(cleanDeck(), [
      modifier("max_budget", "not-a-number"),
      modifier("single_set", ""),
      modifier("no_tag", ""),
    ]);
    assert.deepEqual(result, []);
  });
});

describe("normalizeModifiers", () => {
  test("returns [] for null, undefined and non-arrays", () => {
    assert.deepEqual(normalizeModifiers(null), []);
    assert.deepEqual(normalizeModifiers(undefined), []);
    assert.deepEqual(normalizeModifiers({ type: "poison" }), []);
  });

  test("drops entries with an unknown type", () => {
    const result = normalizeModifiers([
      { type: "mind_control", label: "x", description: "y" },
      { type: "poison", label: "Poison", description: "desc" },
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].type, "poison");
  });

  test("drops entries missing display copy", () => {
    const result = normalizeModifiers([
      { type: "poison" },
      { type: "no_legendary", label: "No Legends", description: "desc" },
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].type, "no_legendary");
  });

  test("caps the list at MAX_MODIFIERS_PER_FLOOR", () => {
    const raw = Array.from({ length: 5 }, () => ({
      type: "poison",
      label: "Poison",
      description: "desc",
    }));

    assert.equal(normalizeModifiers(raw).length, MAX_MODIFIERS_PER_FLOOR);
  });
});
