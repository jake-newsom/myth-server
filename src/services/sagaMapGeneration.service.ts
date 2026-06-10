import {
  SAGA_FLOOR_DEFINITIONS,
  SAGA_ROW_LAYOUT,
  SagaBattleDifficulty,
  SagaFloorMap,
  SagaMapNode,
  SagaMapProgress,
  SagaMapRow,
  SagaNodeMapData,
  SagaNodeType,
} from "../types/sagaMap.types";

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function nodeId(floor: number, row: number, col: number): string {
  return `f${floor}_r${row}_c${col}`;
}

/** Build forward connections per GDD §12.1 (diamond widen/narrow). */
export function buildNextNodeIds(
  floor: number,
  row: number,
  col: number
): string[] {
  const nextRow = row + 1;
  if (nextRow >= SAGA_ROW_LAYOUT.length) return [];

  const nextCols = SAGA_ROW_LAYOUT[nextRow];

  // 3-wide row -> 2-wide row: center can reach both left and right child nodes.
  if (row === 3) {
    const next: string[] = [];
    if (col === 0) next.push(nodeId(floor, nextRow, 0));
    else if (col === 1) {
      next.push(nodeId(floor, nextRow, 0));
      next.push(nodeId(floor, nextRow, 1));
    } else if (col === 2) next.push(nodeId(floor, nextRow, 1));
    return next;
  }

  if (row === 4) {
    const next: string[] = [];
    if (col <= 1) next.push(nodeId(floor, nextRow, 0));
    if (col >= 1) next.push(nodeId(floor, nextRow, 1));
    return [...new Set(next)];
  }

  if (row === 5) {
    return [nodeId(floor, 6, 0)];
  }

  const rowCols = SAGA_ROW_LAYOUT[row];

  // 3-wide -> 3-wide: center branches to both flanks, edges stay diagonal inward.
  if (rowCols === 3 && nextCols === 3) {
    if (col === 0) return [nodeId(floor, nextRow, 0), nodeId(floor, nextRow, 1)];
    if (col === 1) return [nodeId(floor, nextRow, 0), nodeId(floor, nextRow, 2)];
    return [nodeId(floor, nextRow, 1), nodeId(floor, nextRow, 2)];
  }

  // Standard widen: (r,c) -> (r+1,c) and (r+1,c+1), clamped to next row width.
  const next: string[] = [];
  const primaryCol = Math.min(col, nextCols - 1);
  next.push(nodeId(floor, nextRow, primaryCol));
  if (col + 1 < nextCols) {
    next.push(nodeId(floor, nextRow, col + 1));
  }
  return [...new Set(next)];
}

/** Recompute next_node_ids from layout (fixes persisted maps with stale edges). */
export function reconcileMapConnections(map: SagaNodeMapData): SagaNodeMapData {
  const floors = map.floors.map((floor) => ({
    ...floor,
    rows: floor.rows.map((row) => ({
      ...row,
      nodes: row.nodes.map((node) => ({
        ...node,
        next_node_ids: buildNextNodeIds(floor.floor, node.row, node.col),
      })),
    })),
  }));
  return { ...map, floors };
}

/** Floor boss nodes always use the last deck in the season pool (not a battle assignment). */
export function reconcileBossDeckIds(
  map: SagaNodeMapData,
  enemyDecks: Record<string, unknown>
): SagaNodeMapData {
  const floors = map.floors.map((floor) => {
    const pool = parseEnemyDeckPool(enemyDecks, floor.floor);
    const bossDeckId =
      pool.length > 1 ? pool[pool.length - 1] : pool[0] ?? null;
    if (!bossDeckId) return floor;

    const rows = floor.rows.map((row) => ({
      ...row,
      nodes: row.nodes.map((node) =>
        node.type === "boss"
          ? { ...node, enemy_deck_id: bossDeckId }
          : node
      ),
    }));
    return { ...floor, rows };
  });
  return { ...map, floors };
}

export function bossDeckAssignmentsChanged(
  before: SagaNodeMapData,
  after: SagaNodeMapData
): boolean {
  for (const floor of before.floors) {
    const floorAfter = after.floors.find((f) => f.floor === floor.floor);
    if (!floorAfter) continue;
    for (const row of floor.rows) {
      const rowAfter = floorAfter.rows.find((r) => r.row === row.row);
      if (!rowAfter) continue;
      for (const node of row.nodes) {
        if (node.type !== "boss") continue;
        const fixed = rowAfter.nodes.find((n) => n.id === node.id);
        if (fixed?.enemy_deck_id !== node.enemy_deck_id) return true;
      }
    }
  }
  return false;
}

function pickRewardNodeIds(floor: number): Set<string> {
  const earlyPool: string[] = [];
  const latePool: string[] = [];

  for (let row = 0; row <= 2; row++) {
    for (let col = 0; col < SAGA_ROW_LAYOUT[row]; col++) {
      earlyPool.push(nodeId(floor, row, col));
    }
  }
  for (let row = 3; row <= 5; row++) {
    for (let col = 0; col < SAGA_ROW_LAYOUT[row]; col++) {
      latePool.push(nodeId(floor, row, col));
    }
  }

  const early = shuffle(earlyPool)[0];
  let late = shuffle(latePool)[0];
  if (late === early) {
    late =
      latePool.find((id) => id !== early) ??
      latePool[0];
  }

  return new Set([early, late]);
}

function rollBattleDifficulty(easyRatio: number): SagaBattleDifficulty {
  return Math.random() < easyRatio ? "easy" : "hard";
}

/** Each row with battles must include at least one standard (easy) battle. */
export function balanceBattleRowDifficulties(nodes: SagaMapNode[]): void {
  for (let row = 0; row < 6; row++) {
    const battles = nodes.filter((n) => n.row === row && n.type === "battle");
    if (battles.length === 0) continue;

    const hasEasy = battles.some((n) => n.battle_difficulty === "easy");
    if (hasEasy) continue;

    const firstHard = battles.find((n) => n.battle_difficulty === "hard");
    if (firstHard) firstHard.battle_difficulty = "easy";
  }
}

export function reconcileBattleRowDifficulties(
  map: SagaNodeMapData
): SagaNodeMapData {
  for (const floor of map.floors) {
    balanceBattleRowDifficulties(floor.rows.flatMap((r) => r.nodes));
  }
  return map;
}

export function parseEnemyDeckPool(
  enemyDecks: Record<string, unknown>,
  floor: number
): string[] {
  const candidates = [
    enemyDecks[`floor_${floor}`],
    enemyDecks[`${floor}`],
    (enemyDecks.floors as Record<string, unknown> | undefined)?.[`${floor}`],
    (enemyDecks.floors as Record<string, unknown> | undefined)?.[
      `floor_${floor}`
    ],
  ];

  for (const val of candidates) {
    if (Array.isArray(val)) {
      return val.map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const obj = entry as Record<string, unknown>;
          return String(
            obj.deck_id ?? obj.ai_deck_id ?? obj.archetype_id ?? obj.id ?? ""
          );
        }
        return "";
      }).filter(Boolean);
    }
  }

  return [`saga_floor_${floor}_default`];
}

function assignEnemyDecks(
  nodes: SagaMapNode[],
  enemyPool: string[]
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentsOf = new Map<string, string[]>();

  for (const node of nodes) {
    for (const nextId of node.next_node_ids) {
      if (!parentsOf.has(nextId)) parentsOf.set(nextId, []);
      parentsOf.get(nextId)!.push(node.id);
    }
  }

  const sorted = [...nodes].sort((a, b) => a.row - b.row || a.col - b.col);

  for (const node of sorted) {
    if (node.type !== "battle") continue;

    const parentIds = parentsOf.get(node.id) ?? [];
    const parentArchetypes = parentIds
      .map((pid) => byId.get(pid)?.enemy_deck_id)
      .filter((id): id is string => Boolean(id));

    const pool = shuffle(
      enemyPool.filter((id) => !parentArchetypes.includes(id))
    );
    const pick = pool[0] ?? shuffle(enemyPool)[0] ?? enemyPool[0];
    node.enemy_deck_id = pick;
  }
}

export function generateFloorMap(
  floor: number,
  enemyDecks: Record<string, unknown>
): SagaFloorMap {
  const def = SAGA_FLOOR_DEFINITIONS[floor - 1];
  if (!def) {
    throw new Error(`Invalid saga floor: ${floor}`);
  }

  const rewardIds = pickRewardNodeIds(floor);
  const enemyPool = parseEnemyDeckPool(enemyDecks, floor);
  const nodes: SagaMapNode[] = [];

  for (let row = 0; row < SAGA_ROW_LAYOUT.length; row++) {
    const count = SAGA_ROW_LAYOUT[row];
    for (let col = 0; col < count; col++) {
      const id = nodeId(floor, row, col);
      let type: SagaNodeType;
      let battle_difficulty: SagaBattleDifficulty | undefined;
      let boss_name: string | null = null;

      if (row === 6) {
        type = "boss";
        boss_name = def.boss_name;
        battle_difficulty = "hard";
      } else if (rewardIds.has(id)) {
        type = "card_reward";
      } else {
        type = "battle";
        battle_difficulty = rollBattleDifficulty(def.easy_battle_ratio);
      }

      nodes.push({
        id,
        row,
        col,
        type,
        battle_difficulty,
        boss_name,
        enemy_deck_id: null,
        next_node_ids: buildNextNodeIds(floor, row, col),
        status: "locked",
      });
    }
  }

  // Seed order is 3 battle decks then boss deck per floor; keep boss off the battle pool.
  const bossDeckId =
    enemyPool.length > 1 ? enemyPool[enemyPool.length - 1] : enemyPool[0] ?? null;
  const battlePool =
    enemyPool.length > 1 ? enemyPool.slice(0, -1) : enemyPool;

  balanceBattleRowDifficulties(nodes);

  assignEnemyDecks(nodes, battlePool);

  const bossNode = nodes.find((n) => n.type === "boss");
  if (bossNode && bossDeckId) {
    bossNode.enemy_deck_id = bossDeckId;
  }

  const rows: SagaMapRow[] = SAGA_ROW_LAYOUT.map((_, rowIndex) => ({
    row: rowIndex,
    nodes: nodes.filter((n) => n.row === rowIndex),
  }));

  return {
    floor,
    theme: def.theme,
    difficulty: def.difficulty,
    boss_name: def.boss_name,
    rows,
  };
}

export function generateSagaNodeMap(
  enemyDecks: Record<string, unknown> = {}
): SagaNodeMapData {
  return {
    version: 1,
    floors: [1, 2, 3].map((f) => generateFloorMap(f, enemyDecks)),
    progress: {
      completed_node_ids: [],
      cleared_checkpoint_floors: [],
    },
  };
}

export function isSagaNodeMapData(value: unknown): value is SagaNodeMapData {
  if (!value || typeof value !== "object") return false;
  const map = value as SagaNodeMapData;
  return map.version === 1 && Array.isArray(map.floors) && !!map.progress;
}
