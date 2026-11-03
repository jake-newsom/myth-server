import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReplayRecord } from "../gameReplay.service";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const pw = (t: number, r: number, b: number, l: number) => ({ top: t, right: r, bottom: b, left: l });

function state(): any {
  return {
    turn_number: 3,
    player1: { user_id: P1 },
    player2: { user_id: P2 },
    board: [
      [{ card: { user_card_instance_id: "a", owner: P2, current_power: pw(5, 4, 3, 2) } }, { card: null }],
      [null, { card: { user_card_instance_id: "b", owner: P2, current_power: pw(1, 1, 1, 1) } }],
    ],
    hydrated_card_data_cache: {
      a: {
        owner: P2, original_owner: P1, level: 3,
        power_enhancements: pw(1, 0, 0, 0),
        base_card_data: { card_id: "va", character_id: "ca", base_power: pw(4, 4, 3, 2) },
      },
      b: {
        owner: P2, original_owner: P2, level: 1,
        power_enhancements: pw(0, 0, 0, 0),
        base_card_data: { card_id: "vb", character_id: "cb", base_power: pw(1, 1, 1, 1) },
        saga_rune_type: "fury",
      },
    },
    move_log: [
      { t: 1, p: 1, id: "a", x: 0, y: 0 },
      { t: 2, p: 2, id: "b", x: 1, y: 1, tx: 0, ty: 0 },
    ],
    surrendered_by: P1,
  };
}

test("cards keep identity, starting stats and original owner", () => {
  const r = buildReplayRecord(state())!;
  assert.deepEqual(r.cards.a, { ch: "ca", v: "va", o: 1, lv: 3, bp: [4, 4, 3, 2], pe: [1, 0, 0, 0] });
  assert.deepEqual(r.cards.b, { ch: "cb", v: "vb", o: 2, lv: 1, bp: [1, 1, 1, 1], rune: "fury" });
});

test("final board is [id, owner side, power] by [y][x]", () => {
  const r = buildReplayRecord(state())!;
  assert.deepEqual(r.board, [[["a", 2, [5, 4, 3, 2]], null], [null, ["b", 2, [1, 1, 1, 1]]]]);
});

test("moves, surrender side and turns carried over; no move log -> null", () => {
  const r = buildReplayRecord(state())!;
  assert.equal(r.moves!.length, 2);
  assert.equal(r.surrendered_by, 1);
  assert.equal(r.turns, 3);
  const s = state(); delete s.move_log;
  assert.equal(buildReplayRecord(s)!.moves, null);
});

test("blank state gives no record", () => {
  assert.equal(buildReplayRecord({} as any), null);
});
