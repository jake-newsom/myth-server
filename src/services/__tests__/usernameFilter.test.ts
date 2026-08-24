import { test, describe } from "node:test";
import assert from "node:assert";
import { checkUsername, isUsernameAllowed } from "../usernameFilter.service";

describe("usernameFilter — sensitive terms", () => {
  // Names taken from the August 2026 bulk-signup batch. The chat matcher is
  // word-boundary only and would have caught just the bare "suicide".
  test("rejects the real abuse-batch names", () => {
    for (const name of [
      "suicide",
      "suicide17",
      "suicidefull",
      "suicidefullx4657980098721",
      "suicide1856142",
    ]) {
      assert.equal(isUsernameAllowed(name), false, name);
    }
  });

  test("rejects concatenation evasion", () => {
    assert.equal(isUsernameAllowed("xxsuicidexx"), false);
  });

  test("rejects leetspeak, separator and repeat evasion", () => {
    assert.equal(isUsernameAllowed("su1c1de"), false);
    assert.equal(isUsernameAllowed("s u i c i d e"), false);
    assert.equal(isUsernameAllowed("s-u-i-c-i-d-e"), false);
    assert.equal(isUsernameAllowed("suuuuicide"), false);
  });

  test("is case insensitive", () => {
    assert.equal(isUsernameAllowed("SuIcIdE99"), false);
  });

  test("reports the sensitive reason", () => {
    assert.equal(checkUsername("suicide17").reason, "sensitive");
  });
});

describe("usernameFilter — slurs and profanity", () => {
  test("rejects substring slurs", () => {
    assert.equal(checkUsername("xxfaggotxx").reason, "slur");
    assert.equal(checkUsername("f4ggot").reason, "slur");
  });

  test("rejects substring profanity", () => {
    assert.equal(checkUsername("fuckerxx").reason, "profanity");
  });
});

describe("usernameFilter — false positives", () => {
  // Substring matching reintroduces Scunthorpe-class hits that the chat
  // matcher avoids via word boundaries. These must stay allowed.
  test("allows innocuous names containing listed substrings", () => {
    for (const name of [
      "suspicious_sam",
      "Pakistan_Ali",
      "skyler",
      "chinkara_fan",
      "bassmaster",
      "classicgamer",
      "Thorfinn",
      "Analysis",
    ]) {
      assert.equal(isUsernameAllowed(name), true, name);
    }
  });

  test("allowlisted place names are exact-match only", () => {
    assert.equal(isUsernameAllowed("Scunthorpe"), true);
    assert.equal(isUsernameAllowed("scunthorpe_fc"), false);
  });

  test("allows the legitimate run* names", () => {
    for (const name of ["runstrikegod", "runstrikegod123", "run2297"]) {
      assert.equal(isUsernameAllowed(name), true, name);
    }
  });
});

describe("usernameFilter — robustness", () => {
  test("empty and symbol-only input is allowed (length/format is the caller's job)", () => {
    assert.equal(isUsernameAllowed(""), true);
    assert.equal(isUsernameAllowed("___"), true);
  });

  test("does not throw on unusual input", () => {
    assert.doesNotThrow(() => isUsernameAllowed("🎮🎮🎮"));
    assert.doesNotThrow(() => isUsernameAllowed("café"));
  });
});
