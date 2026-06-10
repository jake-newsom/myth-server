import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeAvailableNodeIds,
  applyNodeStatuses,
} from "../sagaMap.service";
import {
  generateSagaNodeMap,
  reconcileMapConnections,
} from "../sagaMapGeneration.service";

describe("sagaMap.service", () => {
  it("computeAvailableNodeIds matches after reconcile (stale persisted edges)", () => {
    const map = generateSagaNodeMap({});
    const floor = map.floors[0];
    const centerR3 = floor.rows
      .find((r) => r.row === 3)!
      .nodes.find((n) => n.col === 1)!;

    const staleMap = {
      ...map,
      progress: {
        ...map.progress,
        completed_node_ids: [centerR3.id],
      },
      floors: map.floors.map((f) => ({
        ...f,
        rows: f.rows.map((row) => ({
          ...row,
          nodes: row.nodes.map((node) =>
            node.id === centerR3.id
              ? { ...node, next_node_ids: ["f1_r4_c0"] }
              : node
          ),
        })),
      })),
    };

    const reconciled = reconcileMapConnections(staleMap);
    const currentFloor = 1;
    const currentNode = null;

    const staleAvailable = computeAvailableNodeIds(
      staleMap,
      currentFloor,
      currentNode
    );
    const fixedAvailable = computeAvailableNodeIds(
      reconciled,
      currentFloor,
      currentNode
    );

    assert.deepEqual(staleAvailable, ["f1_r4_c0"]);
    assert.deepEqual(fixedAvailable.sort(), ["f1_r4_c0", "f1_r4_c1"].sort());

    const view = applyNodeStatuses(
      reconciled,
      currentFloor,
      currentNode,
      fixedAvailable
    );
    const rightR4 = view.floors[0].rows
      .find((r) => r.row === 4)!
      .nodes.find((n) => n.col === 1)!;
    assert.equal(rightR4.status, "available");
  });
});
