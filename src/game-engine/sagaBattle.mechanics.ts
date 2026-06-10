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
import { updateCurrentPower } from "./ability.utils";

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

/** Slayer: +2 all sides when placed adjacent to a higher-power enemy card */
export function applySlayerOnPlace(
  state: GameState,
  position: { x: number; y: number },
  playerId: string
): { state: GameState; events: BaseGameEvent[] } {
  const ctx = state.saga_context;
  if (!ctx) return { state, events: [] };

  const cell = state.board[position.y]?.[position.x];
  const placed = cell?.card;
  if (!placed) return { state, events: [] };

  const sagaCardId = (placed as InGameCard & { saga_card_id?: string }).saga_card_id;
  if (!sagaCardId || placed.owner !== playerId) return { state, events: [] };

  const cacheEntry = state.hydrated_card_data_cache?.[placed.user_card_instance_id];
  const cached = cacheEntry ?? placed;
  const runeType = (cached as InGameCard & { saga_rune_type?: string }).saga_rune_type;
  if (runeType !== "slayer") return { state, events: [] };

  if (ctx.slayer_applied?.[sagaCardId]) return { state, events: [] };

  const dirs = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];

  const placedTotal = totalPower(placed.current_power);
  let triggered = false;

  for (const { dx, dy } of dirs) {
    const nx = position.x + dx;
    const ny = position.y + dy;
    const adj = state.board[ny]?.[nx];
    if (!adj?.card || adj.card.owner === playerId) continue;
    if (totalPower(adj.card.current_power) > placedTotal) {
      triggered = true;
      break;
    }
  }

  if (!triggered) return { state, events: [] };

  const bonus = 2;
  placed.current_power = {
    top: placed.current_power.top + bonus,
    right: placed.current_power.right + bonus,
    bottom: placed.current_power.bottom + bonus,
    left: placed.current_power.left + bonus,
  };

  if (state.hydrated_card_data_cache?.[placed.user_card_instance_id]) {
    state.hydrated_card_data_cache[placed.user_card_instance_id].current_power = {
      ...placed.current_power,
    };
  }

  ctx.slayer_applied = { ...ctx.slayer_applied, [sagaCardId]: true };

  return {
    state,
    events: [
      {
        type: EVENT_TYPES.CARD_POWER_CHANGED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: placed.user_card_instance_id,
        position,
        powerDelta: bonus,
        effectName: "Slayer Blessing",
        sourcePlayerId: playerId,
      } as CardPowerChangedEvent,
    ],
  };
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
const BLESSING_UNDERDOG_EFFECT = "Underdog Blessing";
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

function setBlessingEffect(
  card: InGameCard,
  effectName: string,
  amount: number
): { changed: boolean; previousAmount: number } {
  const existing = card.temporary_effects.find((e) => e.name === effectName);
  const previousAmount = existing?.power?.top ?? 0;
  const normalized = Math.max(0, amount);
  if (previousAmount === normalized) return { changed: false, previousAmount };

  card.temporary_effects = card.temporary_effects.filter((e) => e.name !== effectName);
  if (normalized > 0) {
    card.temporary_effects.push({
      type: EffectType.Buff,
      duration: 1000,
      name: effectName,
      power: { top: normalized, right: normalized, bottom: normalized, left: normalized },
    });
  }
  return { changed: true, previousAmount };
}

function countAdjacentAllies(
  state: GameState,
  position: { x: number; y: number },
  owner: string
): number {
  const dirs = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];
  let allies = 0;
  for (const { dx, dy } of dirs) {
    const nx = position.x + dx;
    const ny = position.y + dy;
    const adjacent = state.board[ny]?.[nx]?.card;
    if (adjacent && adjacent.owner === owner) allies += 1;
  }
  return allies;
}

function controlledTileCounts(state: GameState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of state.board) {
    for (const cell of row) {
      const owner = cell.card?.owner;
      if (!owner) continue;
      counts[owner] = (counts[owner] ?? 0) + 1;
    }
  }
  return counts;
}

/** Dynamic blessings (Bonds/Underdog) are refreshed around each placement/combat. */
export function refreshDynamicBlessings(state: GameState): { state: GameState; events: BaseGameEvent[] } {
  const events: BaseGameEvent[] = [];
  const tileCounts = controlledTileCounts(state);

  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board[y].length; x++) {
      const card = state.board[y][x]?.card;
      if (!card) continue;

      if (card.saga_rune_type === "bonds") {
        const amount = countAdjacentAllies(state, { x, y }, card.owner);
        const { changed, previousAmount } = setBlessingEffect(
          card,
          BLESSING_BONDS_EFFECT,
          amount
        );
        if (changed) {
          card.current_power = updateCurrentPower(card);
          syncCurrentPowerToCache(state, card);
          events.push({
            type: EVENT_TYPES.CARD_POWER_CHANGED,
            eventId: uuidv4(),
            timestamp: Date.now(),
            cardId: card.user_card_instance_id,
            position: { x, y },
            powerDelta: amount - previousAmount,
            effectName: BLESSING_BONDS_EFFECT,
            sourcePlayerId: card.owner,
          } as CardPowerChangedEvent);
        }
      }

      if (card.saga_rune_type === "underdog") {
        const own = tileCounts[card.owner] ?? 0;
        const opponentsBest = Object.entries(tileCounts)
          .filter(([owner]) => owner !== card.owner)
          .reduce((max, [, count]) => Math.max(max, count), 0);
        const amount = own < opponentsBest ? 3 : 0;
        const { changed, previousAmount } = setBlessingEffect(
          card,
          BLESSING_UNDERDOG_EFFECT,
          amount
        );
        if (changed) {
          card.current_power = updateCurrentPower(card);
          syncCurrentPowerToCache(state, card);
          events.push({
            type: EVENT_TYPES.CARD_POWER_CHANGED,
            eventId: uuidv4(),
            timestamp: Date.now(),
            cardId: card.user_card_instance_id,
            position: { x, y },
            powerDelta: amount - previousAmount,
            effectName: BLESSING_UNDERDOG_EFFECT,
            sourcePlayerId: card.owner,
          } as CardPowerChangedEvent);
        }
      }
    }
  }

  return { state, events };
}

/** First Blessing (+2 all sides) if this is the player's first placement this battle. */
export function applyFirstBlessingOnPlace(
  state: GameState,
  position: { x: number; y: number },
  playerId: string
): { state: GameState; events: BaseGameEvent[] } {
  const ctx = state.saga_context;
  const card = state.board[position.y]?.[position.x]?.card;
  if (!ctx || !card || card.owner !== playerId) return { state, events: [] };

  const played = ctx.player_cards_played ?? {};
  const previousCount = played[playerId] ?? 0;
  ctx.player_cards_played = { ...played, [playerId]: previousCount + 1 };

  const playedInstanceIds = ctx.player_card_instance_ids_played ?? {};
  const priorIds = playedInstanceIds[playerId] ?? [];
  if (!priorIds.includes(card.user_card_instance_id)) {
    ctx.player_card_instance_ids_played = {
      ...playedInstanceIds,
      [playerId]: [...priorIds, card.user_card_instance_id],
    };
  }

  if (card.saga_rune_type !== "first" || previousCount !== 0) {
    return { state, events: [] };
  }

  const { previousAmount } = setBlessingEffect(card, BLESSING_FIRST_EFFECT, 2);
  card.current_power = updateCurrentPower(card);
  syncCurrentPowerToCache(state, card);
  return {
    state,
    events: [
      {
        type: EVENT_TYPES.CARD_POWER_CHANGED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: card.user_card_instance_id,
        position,
        powerDelta: 2 - previousAmount,
        effectName: BLESSING_FIRST_EFFECT,
        sourcePlayerId: playerId,
      } as CardPowerChangedEvent,
    ],
  };
}

/** Thorns Blessing: when defeated, debuff the defeating card by -2 all sides. */
export function applyThornsOnFlips(
  state: GameState,
  flips: BaseGameEvent[]
): { state: GameState; events: BaseGameEvent[] } {
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

    if (!flipped.sourceCardId) continue;
    const attacker = findBoardCardById(state, flipped.sourceCardId);
    if (!attacker) continue;

    attacker.card.temporary_effects.push({
      type: EffectType.Debuff,
      duration: 1000,
      name: "Thorns Blessing",
      power: { top: -2, right: -2, bottom: -2, left: -2 },
    });
    attacker.card.current_power = updateCurrentPower(attacker.card);
    syncCurrentPowerToCache(state, attacker.card);
    events.push({
      type: EVENT_TYPES.CARD_POWER_CHANGED,
      eventId: uuidv4(),
      timestamp: Date.now(),
      cardId: attacker.card.user_card_instance_id,
      position: { x: attacker.x, y: attacker.y },
      powerDelta: -2,
      effectName: "Thorns Blessing",
      sourcePlayerId: flipped.sourcePlayerId,
    } as CardPowerChangedEvent);
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
