import SagaRunModel from "../models/sagaRun.model";
import SagaSeasonModel from "../models/sagaSeason.model";
import SagaService from "./saga.service";
import SagaCurrencyService from "./sagaCurrency.service";
import SagaRewardService from "./sagaReward.service";
import {
  generateSagaNodeMap,
  isSagaNodeMapData,
  reconcileMapConnections,
  reconcileBossDeckIds,
  reconcileBattleRowDifficulties,
  bossDeckAssignmentsChanged,
} from "./sagaMapGeneration.service";
import { enrichMapWithEnemyPreviews } from "./sagaEnemyPreview.service";
import {
  SagaFloorMap,
  SagaMapNode,
  SagaMapProgress,
  SagaMapView,
  SagaNodeMapData,
  SagaNodeStatus,
} from "../types/sagaMap.types";

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function getFloorMap(map: SagaNodeMapData, floor: number): SagaFloorMap | null {
  return map.floors.find((f) => f.floor === floor) ?? null;
}

function allNodesOnFloor(floorMap: SagaFloorMap): SagaMapNode[] {
  return floorMap.rows.flatMap((r) => r.nodes);
}

function findNode(map: SagaNodeMapData, nodeId: string): SagaMapNode | null {
  for (const floor of map.floors) {
    const node = allNodesOnFloor(floor).find((n) => n.id === nodeId);
    if (node) return node;
  }
  return null;
}

function parentNodeIds(map: SagaNodeMapData, nodeId: string): string[] {
  const parents: string[] = [];
  for (const floor of map.floors) {
    for (const node of allNodesOnFloor(floor)) {
      if (node.next_node_ids.includes(nodeId)) {
        parents.push(node.id);
      }
    }
  }
  return parents;
}

export function computeAvailableNodeIds(
  map: SagaNodeMapData,
  currentFloor: number,
  currentNode: string | null
): string[] {
  const floorMap = getFloorMap(map, currentFloor);
  if (!floorMap) return [];

  const { completed_node_ids } = map.progress;
  const completed = new Set(completed_node_ids);

  if (currentNode && !completed.has(currentNode)) {
    return [];
  }

  const floorNodes = allNodesOnFloor(floorMap);
  const floorCompleted = floorNodes
    .filter((n) => completed.has(n.id))
    .map((n) => n.id);

  if (floorCompleted.length === 0 && !currentNode) {
    return floorNodes.filter((n) => n.row === 0).map((n) => n.id);
  }

  const lastCompleted = currentNode && completed.has(currentNode)
    ? currentNode
    : floorCompleted[floorCompleted.length - 1];

  if (!lastCompleted) return [];

  const lastNode = findNode(map, lastCompleted);
  if (!lastNode) return [];

  return lastNode.next_node_ids.filter((id) => {
    const child = findNode(map, id);
    return child && child.id.startsWith(`f${currentFloor}_`) && !completed.has(id);
  });
}

function prepareStoredMap(
  nodeMap: Record<string, unknown>,
  enemyDecks: Record<string, unknown>
): SagaNodeMapData {
  if (!isSagaNodeMapData(nodeMap)) {
    throw httpError(500, "Run has no valid saga map");
  }
  const connected = reconcileMapConnections(nodeMap);
  const withBossDecks = reconcileBossDeckIds(connected, enemyDecks);
  return reconcileBattleRowDifficulties(withBossDecks);
}

async function loadPreparedMap(
  runId: string,
  nodeMap: Record<string, unknown>,
  seasonId: string
): Promise<SagaNodeMapData> {
  const season = await SagaSeasonModel.findById(seasonId);
  const enemyDecks =
    (season?.enemy_decks as Record<string, unknown> | undefined) ?? {};
  const before = isSagaNodeMapData(nodeMap)
    ? nodeMap
    : null;
  const map = prepareStoredMap(nodeMap, enemyDecks);
  if (before && bossDeckAssignmentsChanged(before, map)) {
    await SagaRunModel.update(runId, {
      node_map: map as unknown as Record<string, unknown>,
    });
  }
  return map;
}

export function applyNodeStatuses(
  map: SagaNodeMapData,
  currentFloor: number,
  currentNode: string | null,
  availableIds: string[]
): SagaNodeMapData {
  const available = new Set(availableIds);
  const completed = new Set(map.progress.completed_node_ids);

  const floors = map.floors.map((floor) => ({
    ...floor,
    rows: floor.rows.map((row) => ({
      ...row,
      nodes: row.nodes.map((node): SagaMapNode => {
        let status: SagaNodeStatus = "locked";
        if (completed.has(node.id)) {
          status = "completed";
        } else if (currentNode === node.id) {
          status = "current";
        } else if (available.has(node.id)) {
          status = "available";
        } else if (floor.floor < currentFloor) {
          status = "completed";
        }
        return { ...node, status };
      }),
    })),
  }));

  return { ...map, floors };
}

const SagaMapService = {
  async ensureMapGenerated(runId: string, playerId: string): Promise<SagaNodeMapData> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    const existing = run.node_map;
    if (isSagaNodeMapData(existing)) {
      return existing;
    }

    const season = await SagaSeasonModel.findById(run.season_id);
    const map = generateSagaNodeMap(
      (season?.enemy_decks as Record<string, unknown>) ?? {}
    );

    await SagaRunModel.update(runId, { node_map: map as unknown as Record<string, unknown> });
    return map;
  },

  async getMapView(runId: string, playerId: string): Promise<SagaMapView> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    let map = isSagaNodeMapData(run.node_map)
      ? await loadPreparedMap(runId, run.node_map, run.season_id)
      : await this.ensureMapGenerated(runId, playerId);

    const available = computeAvailableNodeIds(
      map,
      run.current_floor,
      run.current_node
    );
    map = applyNodeStatuses(map, run.current_floor, run.current_node, available);
    map = await enrichMapWithEnemyPreviews(map);

    return {
      run_id: runId,
      current_floor: run.current_floor,
      current_node: run.current_node,
      map,
      available_node_ids: available,
    };
  },

  async selectNode(
    runId: string,
    playerId: string,
    nodeId: string
  ): Promise<SagaMapView> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    const map = isSagaNodeMapData(run.node_map)
      ? await loadPreparedMap(runId, run.node_map, run.season_id)
      : await this.ensureMapGenerated(runId, playerId);

    const node = findNode(map, nodeId);
    if (!node) throw httpError(404, "Node not found");
    if (!nodeId.startsWith(`f${run.current_floor}_`)) {
      throw httpError(400, "Node is not on your current floor");
    }

    const available = computeAvailableNodeIds(
      map,
      run.current_floor,
      run.current_node
    );
    if (!available.includes(nodeId)) {
      throw httpError(400, "Node is not available");
    }

    if (run.current_node && run.current_node !== nodeId) {
      const progress = map.progress;
      if (!progress.completed_node_ids.includes(run.current_node)) {
        throw httpError(400, "Complete your current node before moving on");
      }
    }

    await SagaRunModel.update(runId, { current_node: nodeId });

    if (node.type === "card_reward") {
      await SagaRewardService.startCardRewardNode(runId, playerId, nodeId);
    }

    return this.getMapView(runId, playerId);
  },

  async completeNode(
    runId: string,
    playerId: string,
    nodeId: string
  ): Promise<SagaMapView> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    if (run.current_node !== nodeId) {
      throw httpError(400, "You must be on this node to complete it");
    }

    let map = isSagaNodeMapData(run.node_map)
      ? await loadPreparedMap(runId, run.node_map, run.season_id)
      : await this.ensureMapGenerated(runId, playerId);

    const node = findNode(map, nodeId);
    if (!node) throw httpError(404, "Node not found");

    const progress: SagaMapProgress = {
      ...map.progress,
      completed_node_ids: map.progress.completed_node_ids.includes(nodeId)
        ? map.progress.completed_node_ids
        : [...map.progress.completed_node_ids, nodeId],
    };

    if (node.type === "boss") {
      const floor = run.current_floor;
      if (!progress.cleared_checkpoint_floors.includes(floor)) {
        progress.cleared_checkpoint_floors = [
          ...progress.cleared_checkpoint_floors,
          floor,
        ];
      }
      await SagaCurrencyService.tryAwardFloorClearBonus(
        playerId,
        run.season_id,
        floor,
        runId
      );
    }

    map = { ...map, progress };

    if (node.type === "boss" && run.current_floor >= 3) {
      await SagaCurrencyService.tryAwardFullRunBonus(
        playerId,
        run.season_id,
        runId
      );
      await SagaRunModel.update(runId, {
        node_map: map as unknown as Record<string, unknown>,
        current_node: null,
        status: "completed",
        completed_at: new Date(),
      });
      return this.getMapView(runId, playerId);
    }

    const nextFloor =
      node.type === "boss" ? run.current_floor + 1 : run.current_floor;

    await SagaRunModel.update(runId, {
      node_map: map as unknown as Record<string, unknown>,
      current_node: null,
      current_floor: nextFloor,
    });

    return this.getMapView(runId, playerId);
  },

  async generateAndPersistMap(
    runId: string,
    seasonId: string
  ): Promise<SagaNodeMapData> {
    const season = await SagaSeasonModel.findById(seasonId);
    const map = generateSagaNodeMap(
      (season?.enemy_decks as Record<string, unknown>) ?? {}
    );
    await SagaRunModel.update(runId, {
      node_map: map as unknown as Record<string, unknown>,
      current_floor: 1,
      current_node: null,
    });
    return map;
  },
};

export default SagaMapService;
