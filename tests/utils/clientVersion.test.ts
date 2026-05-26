import test from "node:test";
import assert from "node:assert/strict";
import {
  clientSupportsMulligan,
  compareSemver,
} from "../../src/utils/clientVersion";

test("compareSemver orders versions", () => {
  assert.equal(compareSemver("1.0.8", "1.0.9"), -1);
  assert.equal(compareSemver("1.0.9", "1.0.9"), 0);
  assert.equal(compareSemver("1.1.0", "1.0.9"), 1);
});

test("clientSupportsMulligan: missing version is legacy", () => {
  assert.equal(clientSupportsMulligan(undefined), false);
  assert.equal(clientSupportsMulligan(""), false);
});

test("clientSupportsMulligan: at or above min supports mulligan", () => {
  assert.equal(clientSupportsMulligan("1.0.9"), true);
  assert.equal(clientSupportsMulligan("1.1.0"), true);
  assert.equal(clientSupportsMulligan("1.0.8"), false);
});
