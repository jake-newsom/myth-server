import { test, describe } from "node:test";
import assert from "node:assert";
import {
  pickerForIndex,
  picksLeftInTurn,
  resolveCurrentPicker,
  isDraftComplete,
  TOTAL_PICKS,
} from "../rankedDraft.service";
import { RANKED_DRAFT_CONFIG } from "../../config/constants";

const P1 = "p1", P2 = "p2";

describe("draft order 1 / 2,2 / 1", () => {
  test("sequence is 1221122112211221122112", () => {
    const seq = Array.from({ length: TOTAL_PICKS }, (_, i) =>
      pickerForIndex(i, P1, P2) === P1 ? "1" : "2"
    ).join("");
    assert.strictEqual(seq, "1221122112211221122112");
  });

  test("both players get exactly PICKS cards", () => {
    let p1 = 0, p2 = 0;
    for (let i = 0; i < TOTAL_PICKS; i++) {
      pickerForIndex(i, P1, P2) === P1 ? p1++ : p2++;
    }
    assert.strictEqual(p1, RANKED_DRAFT_CONFIG.PICKS);
    assert.strictEqual(p2, RANKED_DRAFT_CONFIG.PICKS);
  });

  test("first turn is a single pick, last turn is a single pick", () => {
    assert.strictEqual(picksLeftInTurn(0), 1);
    assert.strictEqual(picksLeftInTurn(TOTAL_PICKS - 1), 1);
  });

  test("picksLeftInTurn never exceeds the picks actually remaining", () => {
    for (let i = 0; i < TOTAL_PICKS; i++) {
      const left = picksLeftInTurn(i);
      assert.ok(left >= 1, `index ${i} owed ${left}`);
      assert.ok(left <= TOTAL_PICKS - i, `index ${i} promised ${left}`);
    }
  });

  test("a turn's owed picks all belong to the same player", () => {
    let i = 0;
    while (i < TOTAL_PICKS) {
      const owed = picksLeftInTurn(i);
      const who = pickerForIndex(i, P1, P2);
      for (let k = 0; k < owed; k++) {
        assert.strictEqual(
          pickerForIndex(i + k, P1, P2), who,
          `index ${i + k} should belong to ${who}`
        );
      }
      i += owed;
    }
    assert.strictEqual(i, TOTAL_PICKS, "turns must tile the draft exactly");
  });

  test("simulating the whole draft via resolveCurrentPicker terminates at 11/11", () => {
    let p1 = 0, p2 = 0, guard = 0;
    while (!isDraftComplete(p1, p2)) {
      if (++guard > 100) assert.fail("did not terminate");
      const who = resolveCurrentPicker(P1, P2, p1, p2);
      assert.ok(who, "picker must exist while incomplete");
      who === P1 ? p1++ : p2++;
    }
    assert.strictEqual(p1, 11);
    assert.strictEqual(p2, 11);
    assert.strictEqual(resolveCurrentPicker(P1, P2, p1, p2), null);
  });
});
