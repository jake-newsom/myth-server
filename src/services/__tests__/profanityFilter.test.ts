import { test, describe } from "node:test";
import assert from "node:assert";
import {
  containsHardBlocked,
  maskProfanity,
} from "../profanityFilter.service";

describe("profanityFilter — hard-blocked tier", () => {
  test("detects a plain slur", () => {
    assert.equal(containsHardBlocked("you are a faggot"), true);
  });

  test("detects leetspeak evasion", () => {
    assert.equal(containsHardBlocked("f4gg0t"), true);
  });

  test("detects separator evasion", () => {
    assert.equal(containsHardBlocked("f a g g o t"), true);
    assert.equal(containsHardBlocked("f.a.g.g.o.t"), true);
  });

  test("detects repeated-character evasion", () => {
    assert.equal(containsHardBlocked("faaaggggot"), true);
  });

  test("clean text is not blocked", () => {
    assert.equal(containsHardBlocked("good game, well played"), false);
    assert.equal(containsHardBlocked("nice legendary pull!"), false);
  });
});

describe("profanityFilter — maskable tier", () => {
  test("masks a word preserving the first character and length", () => {
    assert.equal(maskProfanity("what the fuck"), "what the f***");
  });

  test("preserves casing of the kept character", () => {
    assert.equal(maskProfanity("Shit happens"), "S*** happens");
  });

  test("masks multiple occurrences", () => {
    assert.equal(maskProfanity("shit shit"), "s*** s***");
  });

  test("returns the input unchanged when nothing matches", () => {
    const clean = "great match, close one";
    assert.equal(maskProfanity(clean), clean);
  });

  test("clean message is returned identical (fast-path contract)", () => {
    // chat.service relies on masked === raw to emit one frame instead of
    // splitting per socket.
    const raw = "anyone want to trade a legendary?";
    assert.strictEqual(maskProfanity(raw) === raw, true);
  });

  test("masks a word spelled across separators", () => {
    // The separators themselves stay visible; only the letters are masked.
    assert.equal(maskProfanity("s h i t"), "s * * *");
  });

  test("a run of unrelated single letters is not masked", () => {
    const initialism = "g g w p";
    assert.equal(maskProfanity(initialism), initialism);
  });

  test("masks leetspeak while preserving original characters' positions", () => {
    const result = maskProfanity("sh1t");
    assert.equal(result.length, 4);
    assert.equal(result[0], "s");
  });
});

describe("profanityFilter — Scunthorpe / false-positive set", () => {
  const innocent = [
    "Scunthorpe",
    "cocktail",
    "assassin",
    "class",
    "analysis",
    "bass",
    "grass",
    "pass the turn",
    "assistant",
    "Cockburn",
    "Penistone",
    "mishit",
    "massachusetts",
    "classic",
  ];

  for (const phrase of innocent) {
    test(`"${phrase}" is not masked`, () => {
      assert.equal(maskProfanity(phrase), phrase);
    });

    test(`"${phrase}" is not hard-blocked`, () => {
      assert.equal(containsHardBlocked(phrase), false);
    });
  }
});

describe("profanityFilter — diacritics", () => {
  test("folds diacritics for matching", () => {
    assert.equal(containsHardBlocked("fággot"), true);
  });

  test("non-profane accented text is untouched", () => {
    const text = "café au lait";
    assert.equal(maskProfanity(text), text);
  });
});

describe("profanityFilter — robustness", () => {
  test("empty and whitespace input", () => {
    assert.equal(maskProfanity(""), "");
    assert.equal(containsHardBlocked(""), false);
    assert.equal(maskProfanity("   "), "   ");
  });

  test("emoji do not shift mask positions", () => {
    const result = maskProfanity("🎉 shit 🎉");
    assert.equal(result, "🎉 s*** 🎉");
  });

  test("does not throw on unusual input", () => {
    assert.doesNotThrow(() => maskProfanity("!@#$%^&*()"));
    assert.doesNotThrow(() => containsHardBlocked("𝓯𝓾𝓬𝓴"));
  });
});
