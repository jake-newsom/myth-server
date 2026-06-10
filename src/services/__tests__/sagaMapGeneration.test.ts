import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SagaMapNode } from "../../types/sagaMap.types";
import {
  buildNextNodeIds,
  generateFloorMap,
  generateSagaNodeMap,
  reconcileBossDeckIds,
  balanceBattleRowDifficulties,
} from "../sagaMapGeneration.service";

describe("sagaMapGeneration", () => {
  it("builds diamond connections for row 1", () => {
    assert.deepEqual(buildNextNodeIds(1, 0, 0), ["f1_r1_c0", "f1_r1_c1"]);
    assert.deepEqual(buildNextNodeIds(1, 0, 1), ["f1_r1_c1", "f1_r1_c2"]);
  });

  it("connects center of 3-wide rows to left and right below", () => {
    assert.deepEqual(buildNextNodeIds(1, 1, 0), ["f1_r2_c0", "f1_r2_c1"]);
    assert.deepEqual(buildNextNodeIds(1, 1, 1), ["f1_r2_c0", "f1_r2_c2"]);
    assert.deepEqual(buildNextNodeIds(1, 1, 2), ["f1_r2_c1", "f1_r2_c2"]);
    assert.deepEqual(buildNextNodeIds(1, 2, 1), ["f1_r3_c0", "f1_r3_c2"]);
  });

  it("narrows row 4 from row 3 (3 cols -> 2 cols)", () => {
    assert.deepEqual(buildNextNodeIds(1, 3, 0), ["f1_r4_c0"]);
    assert.deepEqual(buildNextNodeIds(1, 3, 1), ["f1_r4_c0", "f1_r4_c1"]);
    assert.deepEqual(buildNextNodeIds(1, 3, 2), ["f1_r4_c1"]);
  });

  it("narrows row 5 from row 4", () => {
    assert.deepEqual(buildNextNodeIds(1, 4, 0), ["f1_r5_c0"]);
    assert.deepEqual(buildNextNodeIds(1, 4, 1), ["f1_r5_c0", "f1_r5_c1"]);
    assert.deepEqual(buildNextNodeIds(1, 4, 2), ["f1_r5_c1"]);
  });

  it("connects row 6 to boss", () => {
    assert.deepEqual(buildNextNodeIds(1, 5, 0), ["f1_r6_c0"]);
    assert.deepEqual(buildNextNodeIds(1, 5, 1), ["f1_r6_c0"]);
  });

  it("assigns exactly 2 card rewards and 1 boss per floor", () => {
    const floor = generateFloorMap(1, {
      floor_1: ["deck_a", "deck_b", "deck_c", "deck_boss"],
    });
    const nodes = floor.rows.flatMap((r) => r.nodes);
    const rewards = nodes.filter((n) => n.type === "card_reward");
    const bosses = nodes.filter((n) => n.type === "boss");
    assert.equal(rewards.length, 2);
    assert.equal(bosses.length, 1);
    assert.equal(nodes.length, 16);
    assert.equal(bosses[0].enemy_deck_id, "deck_boss");
    assert.equal(bosses[0].boss_name, "Fenrir Unchained");
  });

  it("generates three floors", () => {
    const map = generateSagaNodeMap({});
    assert.equal(map.floors.length, 3);
    assert.equal(map.version, 1);
  });

  it("ensures each battle row has at least one standard battle", () => {
    const floor = generateFloorMap(1, {
      floor_1: ["deck_a", "deck_b", "deck_c", "deck_boss"],
    });
    for (let row = 0; row < 6; row++) {
      const battles = floor.rows
        .flatMap((r) => r.nodes)
        .filter((n) => n.row === row && n.type === "battle");
      if (battles.length === 0) continue;
      assert.ok(
        battles.some((n) => n.battle_difficulty === "easy"),
        `row ${row} should have at least one easy battle`
      );
    }
  });

  it("balanceBattleRowDifficulties fixes all-hard rows", () => {
    const nodes: SagaMapNode[] = [
      {
        id: "f1_r1_c0",
        row: 1,
        col: 0,
        type: "battle",
        battle_difficulty: "hard",
        enemy_deck_id: null,
        next_node_ids: [],
        status: "locked",
      },
      {
        id: "f1_r1_c1",
        row: 1,
        col: 1,
        type: "battle",
        battle_difficulty: "hard",
        enemy_deck_id: null,
        next_node_ids: [],
        status: "locked",
      },
    ];
    balanceBattleRowDifficulties(nodes);
    assert.equal(
      nodes.filter((n) => n.battle_difficulty === "easy").length,
      1
    );
  });

  it("boss uses last pool deck even if map had battle deck on boss node", () => {
    const floor = generateFloorMap(1, {
      floor_1: ["deck_a", "deck_b", "deck_c", "deck_boss"],
    });
    const boss = floor.rows.flatMap((r) => r.nodes).find((n) => n.type === "boss")!;
    boss.enemy_deck_id = "deck_c";

    const map = reconcileBossDeckIds(
      { version: 1, floors: [floor], progress: { completed_node_ids: [], cleared_checkpoint_floors: [] } },
      { floor_1: ["deck_a", "deck_b", "deck_c", "deck_boss"] }
    );
    const fixed = map.floors[0].rows.flatMap((r) => r.nodes).find((n) => n.type === "boss")!;
    assert.equal(fixed.enemy_deck_id, "deck_boss");
  });
});
