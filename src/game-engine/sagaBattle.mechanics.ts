import { v4 as uuidv4 } from "uuid";
import { GAME_CONFIG } from "../config/constants";
import {
  BaseGameEvent,
  CardPowerChangedEvent,
  EVENT_TYPES,
  TileEvent,
} from "../types/game-engine.types";
import { GameState, TileStatus } from "../types/game.types";
import { EffectType, InGameCard, PowerValues } from "../types/card.types";
import type { SagaBattleContext } from "../types/sagaBattle.types";
import { createBoardCell } from "./game.utils";
import {
  destroyCardAtPosition,
  getCardHighestPower,
  getCardLowestPower,
  protectFromDefeat,
  updateCurrentPower,
} from "./ability.utils";

function totalPower(power: PowerValues): number {
  return power.top + power.right + power.bottom + power.left;
}

function randomEmptyTile(
  board: GameState["board"]
): { x: number; y: number } | null {
  const empty: { x: number; y: number }[] = [];
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      const cell = board[y][x];
      if (cell.tile_enabled && !cell.card) {
        empty.push({ x, y });
      }
    }
  }
  if (empty.length === 0) return null;
  return empty[Math.floor(Math.random() * empty.length)];
}

export function destroyRandomEmptyTile(
  state: GameState,
  animationLabel = "worlds_end"
): { state: GameState; events: BaseGameEvent[] } {
  const pos = randomEmptyTile(state.board);
  if (!pos) return { state, events: [] };

  const cell = state.board[pos.y][pos.x];
  cell.tile_enabled = false;
  cell.tile_effect = {
    status: TileStatus.Blocked,
    turns_left: 9999,
    animation_label: animationLabel,
  };
  cell.card = null;

  const event: TileEvent = {
    type: EVENT_TYPES.TILE_STATE_CHANGED,
    eventId: uuidv4(),
    timestamp: Date.now(),
    position: pos,
    tile: {
      tile_enabled: false,
      tile_effect: cell.tile_effect,
    },
    animation: animationLabel,
  };

  return { state, events: [event] };
}

export function applyPreDestroyedTiles(
  state: GameState,
  count: number
): { state: GameState; events: BaseGameEvent[] } {
  const events: BaseGameEvent[] = [];
  let current = state;
  for (let i = 0; i < count; i++) {
    // Use worlds_end so pre-blocked saga tiles render with the same
    // visual pipeline as in-battle World's End tile destruction.
    const result = destroyRandomEmptyTile(current, "worlds_end");
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

export function parseWorldsEndThreshold(
  seasonalMechanic: Record<string, unknown>,
  isFinalBoss: boolean
): number {
  if (isFinalBoss) return 1;
  const mechanicId = String(seasonalMechanic.id ?? seasonalMechanic.type ?? "");
  if (mechanicId === "worlds_end") {
    const val = seasonalMechanic.defeats_per_destroy;
    if (typeof val === "number" && val > 0) return val;
  }
  return 2;
}

export function getBossBattleExtras(
  bossConfigs: Record<string, unknown>,
  floor: number,
  nodeType: string
): { pre_destroyed_tiles: number; worlds_end_threshold?: number } {
  if (nodeType !== "boss") return { pre_destroyed_tiles: 0 };

  const floorKey = `floor_${floor}`;
  const cfg =
    (bossConfigs[floorKey] as Record<string, unknown>) ??
    (bossConfigs[`${floor}`] as Record<string, unknown>) ??
    {};

  return {
    pre_destroyed_tiles:
      typeof cfg.pre_destroyed_tiles === "number"
        ? cfg.pre_destroyed_tiles
        : floor === 3
          ? 3
          : 0,
    worlds_end_threshold:
      typeof cfg.worlds_end_threshold === "number"
        ? cfg.worlds_end_threshold
        : floor === 3
          ? 1
          : undefined,
  };
}

const ADJACENT_DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

/** Underdog: when placed adjacent to a stronger enemy, reduce that enemy's highest side by 2. */
export function applyUnderdogOnPlace(
  state: GameState,
  position: { x: number; y: number },
  playerId: string
): { state: GameState; events: BaseGameEvent[] } {
  const cell = state.board[position.y]?.[position.x];
  const placed = cell?.card;
  if (!placed || placed.owner !== playerId) return { state, events: [] };

  const cacheEntry = state.hydrated_card_data_cache?.[placed.user_card_instance_id];
  const cached = cacheEntry ?? placed;
  const runeType = (cached as InGameCard & { saga_rune_type?: string }).saga_rune_type;
  if (runeType !== "underdog") return { state, events: [] };

  const placedTotal = totalPower(placed.current_power);
  const events: BaseGameEvent[] = [];

  for (const { dx, dy } of ADJACENT_DIRS) {
    const nx = position.x + dx;
    const ny = position.y + dy;
    const adj = state.board[ny]?.[nx];
    const enemy = adj?.card;
    if (!enemy || enemy.owner === playerId) continue;
    if (totalPower(enemy.current_power) <= placedTotal) continue;

    const { key: highestKey, value: highestValue } = getCardHighestPower(enemy);
    const reduction = Math.min(2, highestValue);
    if (reduction <= 0) continue;

    enemy.temporary_effects.push({
      type: EffectType.Debuff,
      duration: 1000,
      name: "Underdog Blessing",
      power: { [highestKey]: -reduction },
    });
    enemy.current_power = updateCurrentPower(enemy);
    syncCurrentPowerToCache(state, enemy);

    events.push({
      type: EVENT_TYPES.CARD_POWER_CHANGED,
      eventId: uuidv4(),
      timestamp: Date.now(),
      cardId: enemy.user_card_instance_id,
      position: { x: nx, y: ny },
      powerDelta: -reduction,
      effectName: "Underdog Blessing",
      sourcePlayerId: playerId,
    } as CardPowerChangedEvent);
  }

  return { state, events };
}

/** Sight Blessing: draw an additional card after this card is placed. */
export function hasSightBlessingOnPlacedCard(
  state: GameState,
  position: { x: number; y: number },
  playerId: string
): boolean {
  const cell = state.board[position.y]?.[position.x];
  const placed = cell?.card;
  if (!placed || placed.owner !== playerId) return false;

  const cacheEntry = state.hydrated_card_data_cache?.[placed.user_card_instance_id];
  const cached = cacheEntry ?? placed;
  const runeType = (cached as InGameCard & { saga_rune_type?: string }).saga_rune_type;
  return runeType === "sight";
}

const BLESSING_BONDS_EFFECT = "Bonds Blessing";
const BLESSING_FIRST_EFFECT = "First Blessing";

function syncCurrentPowerToCache(state: GameState, card: InGameCard): void {
  const cached = state.hydrated_card_data_cache?.[card.user_card_instance_id];
  if (cached) {
    cached.current_power = { ...card.current_power };
  }
}

function findBoardCardById(
  state: GameState,
  cardId: string
): { card: InGameCard; x: number; y: number } | null {
  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board[y].length; x++) {
      const card = state.board[y][x]?.card;
      if (card?.user_card_instance_id === cardId) return { card, x, y };
    }
  }
  return null;
}

function countAdjacentAllies(
  state: GameState,
  position: { x: number; y: number },
  owner: string
): number {
  let allies = 0;
  for (const { dx, dy } of ADJACENT_DIRS) {
    const nx = position.x + dx;
    const ny = position.y + dy;
    const adjacent = state.board[ny]?.[nx]?.card;
    if (adjacent && adjacent.owner === owner) allies += 1;
  }
  return allies;
}

/** Bonds: this card cannot be defeated while adjacent to an ally. Refreshed around each placement/combat. */
export function refreshDynamicBlessings(state: GameState): { state: GameState; events: BaseGameEvent[] } {
  const events: BaseGameEvent[] = [];

  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board[y].length; x++) {
      const card = state.board[y][x]?.card;
      if (!card || card.saga_rune_type !== "bonds") continue;

      const hasAlly = countAdjacentAllies(state, { x, y }, card.owner) > 0;
      const hasEffect = card.temporary_effects.some((e) => e.name === BLESSING_BONDS_EFFECT);

      if (hasAlly && !hasEffect) {
        card.temporary_effects.push({
          type: EffectType.BlockDefeat,
          duration: 1000,
          name: BLESSING_BONDS_EFFECT,
          power: { top: 0, right: 0, bottom: 0, left: 0 },
        });
      } else if (!hasAlly && hasEffect) {
        card.temporary_effects = card.temporary_effects.filter(
          (e) => e.name !== BLESSING_BONDS_EFFECT
        );
      }
    }
  }

  return { state, events };
}

/** First Blessing: the first time this card enters play each battle, it cannot be defeated for 2 rounds. */
export function applyFirstProtectionOnPlace(
  state: GameState,
  position: { x: number; y: number },
  playerId: string
): { state: GameState; events: BaseGameEvent[] } {
  const ctx = state.saga_context;
  const card = state.board[position.y]?.[position.x]?.card;
  if (!ctx || !card || card.owner !== playerId) return { state, events: [] };

  const playedInstanceIds = ctx.player_card_instance_ids_played ?? {};
  const priorIds = playedInstanceIds[playerId] ?? [];
  const isFirstEntryThisBattle = !priorIds.includes(card.user_card_instance_id);

  if (isFirstEntryThisBattle) {
    ctx.player_card_instance_ids_played = {
      ...playedInstanceIds,
      [playerId]: [...priorIds, card.user_card_instance_id],
    };
  }

  const played = ctx.player_cards_played ?? {};
  const previousCount = played[playerId] ?? 0;
  ctx.player_cards_played = { ...played, [playerId]: previousCount + 1 };

  const cacheEntry = state.hydrated_card_data_cache?.[card.user_card_instance_id];
  const cached = cacheEntry ?? card;
  const runeType = (cached as InGameCard & { saga_rune_type?: string }).saga_rune_type;

  if (runeType !== "first" || !isFirstEntryThisBattle) {
    return { state, events: [] };
  }

  // 2 full rounds = 4 turn-ends (both players act each round).
  const event = protectFromDefeat(card, 4, position, {
    name: BLESSING_FIRST_EFFECT,
    sourcePlayerId: playerId,
  });
  return { state, events: [event] };
}

/**
 * Thorns Blessing: when defeated, destroy the card that defeated it. Once per battle.
 * This bypasses defeat-prevention (Bonds/First/lockedTurns) on the attacker.
 */
export function applyThornsOnFlips(
  state: GameState,
  flips: BaseGameEvent[]
): { state: GameState; events: BaseGameEvent[] } {
  const ctx = state.saga_context;
  const events: BaseGameEvent[] = [];
  for (const event of flips) {
    if (event.type !== EVENT_TYPES.CARD_FLIPPED) continue;
    const flipped = event as BaseGameEvent & {
      cardId?: string;
      sourceCardId?: string;
      sourcePlayerId?: string;
      position?: { x: number; y: number };
    };
    const pos = flipped.position;
    if (!pos) continue;

    const defeatedCard = state.board[pos.y]?.[pos.x]?.card;
    if (!defeatedCard || defeatedCard.saga_rune_type !== "thorns") continue;

    const sagaCardId = defeatedCard.saga_card_id;
    if (sagaCardId && ctx?.thorns_used?.[sagaCardId]) continue;

    if (!flipped.sourceCardId) continue;
    const attacker = findBoardCardById(state, flipped.sourceCardId);
    if (!attacker) continue;

    const destroyEvent = destroyCardAtPosition(
      { x: attacker.x, y: attacker.y },
      state.board,
      "thorns",
      flipped.sourcePlayerId,
      defeatedCard
    );
    if (destroyEvent) {
      events.push(destroyEvent);
      if (ctx && sagaCardId) {
        ctx.thorns_used = { ...ctx.thorns_used, [sagaCardId]: true };
      }
    }
  }
  return { state, events };
}

const BLESSING_SLAYER_EFFECT = "Slayer Blessing";

/**
 * Slayer Blessing: when a Slayer-blessed card defeats an enemy, immediately
 * reduce the enemy's highest power side by 1 and add that power to the
 * Slayer card's own currently-lowest side. Both changes are visible
 * immediately (in-battle). The Slayer card's gain is also tracked as a
 * pending steal so it can be made permanent on the saga card at battle end.
 */
export function applySlayerOnDefeat(
  state: GameState,
  flips: BaseGameEvent[],
  playerId: string
): { state: GameState; events: BaseGameEvent[] } {
  const ctx = state.saga_context;
  if (!ctx) return { state, events: [] };

  const events: BaseGameEvent[] = [];

  for (const event of flips) {
    if (event.type !== EVENT_TYPES.CARD_FLIPPED) continue;
    const flipped = event as BaseGameEvent & {
      sourceCardId?: string;
      sourcePlayerId?: string;
      position?: { x: number; y: number };
    };
    if (flipped.sourcePlayerId !== playerId || !flipped.sourceCardId) continue;

    const attacker = findBoardCardById(state, flipped.sourceCardId);
    if (!attacker || attacker.card.saga_rune_type !== "slayer") continue;

    const sagaCardId = attacker.card.saga_card_id;
    if (!sagaCardId) continue;

    const enemyPos = flipped.position;
    const enemy = enemyPos ? state.board[enemyPos.y]?.[enemyPos.x]?.card : null;
    if (!enemy) continue;

    const { key: highestKey, value: highestValue } = getCardHighestPower(enemy);
    if (highestValue > 0) {
      enemy.temporary_effects.push({
        type: EffectType.Debuff,
        duration: 1000,
        name: BLESSING_SLAYER_EFFECT,
        power: { [highestKey]: -1 },
      });
      enemy.current_power = updateCurrentPower(enemy);
      syncCurrentPowerToCache(state, enemy);

      events.push({
        type: EVENT_TYPES.CARD_POWER_CHANGED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: enemy.user_card_instance_id,
        position: enemyPos,
        powerDelta: -1,
        effectName: BLESSING_SLAYER_EFFECT,
        sourcePlayerId: playerId,
      } as CardPowerChangedEvent);
    }

    const slayer = attacker.card;
    const { key: lowestKey } = getCardLowestPower(slayer);
    slayer.temporary_effects.push({
      type: EffectType.Buff,
      duration: 1000,
      name: BLESSING_SLAYER_EFFECT,
      power: { [lowestKey]: 1 },
    });
    slayer.current_power = updateCurrentPower(slayer);
    syncCurrentPowerToCache(state, slayer);

    events.push({
      type: EVENT_TYPES.CARD_POWER_CHANGED,
      eventId: uuidv4(),
      timestamp: Date.now(),
      cardId: slayer.user_card_instance_id,
      position: { x: attacker.x, y: attacker.y },
      powerDelta: 1,
      effectName: BLESSING_SLAYER_EFFECT,
      sourcePlayerId: playerId,
    } as CardPowerChangedEvent);

    const pending = ctx.slayer_pending_steals ?? {};
    ctx.slayer_pending_steals = {
      ...pending,
      [sagaCardId]: (pending[sagaCardId] ?? 0) + 1,
    };
  }

  return { state, events };
}

/** World's End: destroy tiles after N defeats (flips) in a battle */
export function applyWorldsEndAfterFlips(
  state: GameState,
  flipCount: number
): { state: GameState; events: BaseGameEvent[] } {
  const ctx = state.saga_context;
  if (!ctx || flipCount <= 0) return { state, events: [] };

  const events: BaseGameEvent[] = [];
  let current = state;

  ctx.worlds_end.defeats_since_destroy += flipCount;

  while (
    ctx.worlds_end.defeats_since_destroy >= ctx.worlds_end.defeats_per_destroy
  ) {
    ctx.worlds_end.defeats_since_destroy -= ctx.worlds_end.defeats_per_destroy;
    const result = destroyRandomEmptyTile(current, "worlds_end");
    current = result.state;
    events.push(...result.events);
  }

  return { state: current, events };
}

export function countFlipEvents(events: BaseGameEvent[]): number {
  return events.filter((e) => e.type === EVENT_TYPES.CARD_FLIPPED).length;
}

export function buildInitialSagaBoard(
  preDestroyed: number
): GameState["board"] {
  const board = Array(GAME_CONFIG.BOARD_SIZE)
    .fill(null)
    .map(() =>
      Array(GAME_CONFIG.BOARD_SIZE).fill(null).map(() => {
        const { boardCell } = createBoardCell(null, "normal");
        return boardCell;
      })
    );

  if (preDestroyed <= 0) return board;

  const tempState: GameState = {
    board,
    player1: {
      user_id: "",
      hand: [],
      deck: [],
      discard_pile: [],
      score: 0,
    },
    player2: {
      user_id: "",
      hand: [],
      deck: [],
      discard_pile: [],
      score: 0,
    },
    current_player_id: "",
    turn_number: 1,
    status: "active" as GameState["status"],
    max_cards_in_hand: 10,
    initial_cards_to_draw: 5,
    winner: null,
  };

  const { state } = applyPreDestroyedTiles(tempState, preDestroyed);
  return state.board;
}

export function getSagaAiDifficulty(ctx: SagaBattleContext): string {
  switch (ctx.ai_profile) {
    case "basic":
      return "medium";
    case "intermediate":
      return "hard";
    case "advanced":
      return "hard";
    default:
      return "hard";
  }
}

export function listPlayerSagaInstanceIds(state: GameState, playerId: string): string[] {
  const ids: string[] = [];
  const player =
    state.player1.user_id === playerId ? state.player1 : state.player2;
  ids.push(...player.hand, ...player.deck);
  for (const row of state.board) {
    for (const cell of row) {
      if (cell.card?.owner === playerId) {
        ids.push(cell.card.user_card_instance_id);
      }
    }
  }
  return ids;
}

export function parseSagaCardIdFromInstance(instanceId: string): string | null {
  if (!instanceId.startsWith("saga-")) return null;
  return instanceId.slice(5);
}
