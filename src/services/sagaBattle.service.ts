import _ from "lodash";
import db from "../config/db.config";
import { AI_PLAYER_ID } from "../api/controllers/game.controller";
import { GameLogic, GameStatus } from "../game-engine/game.logic";
import {
  applyPlayerMulligan,
  bootstrapSoloMulliganForClient,
  chooseAIMulligan,
} from "../game-engine/game.mulligan";
import { hydrateGameStateCards } from "../game-engine/game.utils";
import {
  buildInitialSagaBoard,
  getBossBattleExtras,
  parseWorldsEndThreshold,
} from "../game-engine/sagaBattle.mechanics";
import {
  hydrateEnemyDeckForSaga,
  hydrateSagaDeckForBattle,
  sagaInstanceId,
} from "../game-engine/sagaBattle.hydration";
import SagaDeckModel from "../models/sagaDeck.model";
import SagaSeasonModel from "../models/sagaSeason.model";
import SagaRunModel from "../models/sagaRun.model";
import SagaCardModel from "../models/sagaCard.model";
import SagaMapService from "./sagaMap.service";
import { isSagaNodeMapData } from "./sagaMapGeneration.service";
import DeckService from "./deck.service";
import { clientSupportsMulligan } from "../utils/clientVersion";
import { GameState, Player } from "../types/game.types";
import {
  SAGA_FLOOR_BATTLE_CONFIG,
  SagaBattleCompletionResult,
  SagaBattleContext,
  SagaBattleStartResponse,
} from "../types/sagaBattle.types";
import { SAGA_FLOOR_DEFINITIONS } from "../types/sagaMap.types";
import type { SagaMapNode } from "../types/sagaMap.types";
import SagaService from "./saga.service";
import SagaCurrencyService, {
  SAGA_CURRENCY_REWARDS,
} from "./sagaCurrency.service";
import SagaRewardService from "./sagaReward.service";
import SagaDefeatService from "./sagaDefeat.service";
import SagaRandomBattleService from "./sagaRandomBattle.service";

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function shuffle<T>(items: T[]): T[] {
  return _.shuffle([...items]);
}

function findNodeInMap(
  nodeMap: Record<string, unknown>,
  nodeId: string
): SagaMapNode | null {
  if (!isSagaNodeMapData(nodeMap)) return null;
  for (const floor of nodeMap.floors) {
    for (const row of floor.rows) {
      const node = row.nodes.find((n) => n.id === nodeId);
      if (node) return node;
    }
  }
  return null;
}

function battleCurrencyReward(
  node: SagaMapNode,
  won: boolean
): number {
  if (!won) return SAGA_CURRENCY_REWARDS.loss;
  if (node.type === "boss") return SAGA_CURRENCY_REWARDS.boss_win;
  if (node.battle_difficulty === "hard") return SAGA_CURRENCY_REWARDS.hard_win;
  return SAGA_CURRENCY_REWARDS.easy_win;
}

function findBossOpeningCardInstanceId(
  aiCache: Map<string, import("../types/card.types").InGameCard>
): string | null {
  for (const [instanceId, card] of aiCache) {
    const tags = card.base_card_data.tags ?? [];
    if (tags.some((tag) => String(tag).toLowerCase() === "boss")) {
      return instanceId;
    }
  }
  return null;
}

export async function initializeSagaGameState(
  playerId: string,
  playerInstanceIds: string[],
  aiInstanceIds: string[],
  playerCache: Map<string, import("../types/card.types").InGameCard>,
  aiCache: Map<string, import("../types/card.types").InGameCard>,
  preDestroyedTiles: number,
  options: { forcedAiOpeningCardInstanceId?: string } = {}
): Promise<GameState> {
  const initialHandSize = 5;
  const p1Deck = shuffle(playerInstanceIds);
  const p2Deck = shuffle(aiInstanceIds);
  const forcedAiOpeningCardInstanceId = options.forcedAiOpeningCardInstanceId;
  if (forcedAiOpeningCardInstanceId) {
    const forcedIdx = p2Deck.indexOf(forcedAiOpeningCardInstanceId);
    if (forcedIdx >= initialHandSize) {
      const swapIdx = initialHandSize - 1;
      [p2Deck[swapIdx], p2Deck[forcedIdx]] = [p2Deck[forcedIdx], p2Deck[swapIdx]];
    }
  }

  const board = buildInitialSagaBoard(preDestroyedTiles);

  const hydrated_card_data_cache: Record<string, import("../types/card.types").InGameCard> = {};
  for (const [id, card] of playerCache) hydrated_card_data_cache[id] = card;
  for (const [id, card] of aiCache) hydrated_card_data_cache[id] = card;

  const player1: Player = {
    user_id: playerId,
    hand: p1Deck.slice(0, initialHandSize),
    deck: p1Deck.slice(initialHandSize),
    discard_pile: [],
    score: 0,
  };

  const player2: Player = {
    user_id: AI_PLAYER_ID,
    hand: p2Deck.slice(0, initialHandSize),
    deck: p2Deck.slice(initialHandSize),
    discard_pile: [],
    score: 0,
  };

  return {
    board,
    player1,
    player2,
    current_player_id: playerId,
    turn_number: 1,
    status: GameStatus.MULLIGAN,
    max_cards_in_hand: 10,
    initial_cards_to_draw: initialHandSize,
    hydrated_card_data_cache,
    winner: null,
    mulligan_state: {
      player1: { committed: false, replaced_count: 0 },
      player2: { committed: false, replaced_count: 0 },
    },
  };
}

const SagaBattleService = {
  async startBattle(
    runId: string,
    playerId: string,
    nodeId: string,
    clientVersion?: string
  ): Promise<SagaBattleStartResponse> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    if (run.current_node !== nodeId) {
      throw httpError(400, "Select this node on the map before starting a battle");
    }

    const node = findNodeInMap(run.node_map, nodeId);
    if (!node) throw httpError(404, "Map node not found");
    if (node.type === "card_reward") {
      throw httpError(400, "This node is a card reward, not a battle");
    }
    if (node.type !== "battle" && node.type !== "boss") {
      throw httpError(400, "This node cannot be battled");
    }

    const season = await SagaSeasonModel.findById(run.season_id);
    if (!season) throw httpError(404, "Season not found");

    const floorConfig = SAGA_FLOOR_BATTLE_CONFIG[run.current_floor];
    if (!floorConfig) throw httpError(400, "Invalid floor");

    const floorDef = SAGA_FLOOR_DEFINITIONS[run.current_floor - 1];
    const bossExtras = getBossBattleExtras(
      season.boss_configs as Record<string, unknown>,
      run.current_floor,
      node.type
    );

    const preDestroyed =
      floorConfig.pre_destroyed_tiles + bossExtras.pre_destroyed_tiles;

    const enemyDeckId = node.enemy_deck_id;
    if (!enemyDeckId) {
      throw httpError(500, "Battle node has no enemy deck assigned");
    }

    await DeckService.validateAIDeck(enemyDeckId);
    let aiInstanceIds = await DeckService.getDeckCardInstances(enemyDeckId);
    if (aiInstanceIds.length === 0) {
      throw httpError(500, "Enemy deck is empty");
    }

    const sagaDeck = await SagaDeckModel.findWithActiveCardsByRunId(runId);
    if (!sagaDeck || sagaDeck.cards.length !== 20) {
      throw httpError(400, "Saga deck must have exactly 20 cards");
    }

    const playerCache = await hydrateSagaDeckForBattle(
      sagaDeck.cards,
      playerId
    );
    const playerInstanceIds = sagaDeck.cards.map((c) =>
      sagaInstanceId(c.saga_card_id)
    );

    if (playerInstanceIds.length !== 20) {
      throw httpError(500, "Failed to hydrate saga deck");
    }

    const aiCache = await hydrateEnemyDeckForSaga(
      enemyDeckId,
      AI_PLAYER_ID,
      floorConfig.enemy_stat_bonus
    );
    aiInstanceIds = [...aiCache.keys()];
    const shouldForceBossOpeningPlay = node.type === "boss" && run.current_floor === 3;
    const forcedAiOpeningCardInstanceId = shouldForceBossOpeningPlay
      ? findBossOpeningCardInstanceId(aiCache)
      : null;

    let gameState = await initializeSagaGameState(
      playerId,
      playerInstanceIds,
      aiInstanceIds,
      playerCache,
      aiCache,
      preDestroyed,
      { forcedAiOpeningCardInstanceId: forcedAiOpeningCardInstanceId ?? undefined }
    );

    const worldsEndThreshold =
      bossExtras.worlds_end_threshold ??
      parseWorldsEndThreshold(
        season.seasonal_mechanic as Record<string, unknown>,
        node.type === "boss" && run.current_floor === 3
      );

    const sagaContext: SagaBattleContext = {
      run_id: runId,
      node_id: nodeId,
      season_id: run.season_id,
      floor: run.current_floor,
      floor_difficulty: floorDef.difficulty,
      battle_difficulty:
        node.battle_difficulty ?? (node.type === "boss" ? "hard" : "easy"),
      enemy_stat_bonus: floorConfig.enemy_stat_bonus,
      ai_profile: floorConfig.ai_profile,
      worlds_end: {
        defeats_per_destroy: worldsEndThreshold,
        defeats_since_destroy: 0,
      },
      slayer_applied: {},
      player_cards_played: {},
      forced_ai_opening_card_instance_id: forcedAiOpeningCardInstanceId ?? undefined,
      ai_opening_play_pending: !!forcedAiOpeningCardInstanceId,
    };

    gameState.saga_context = sagaContext;

    const startingPlayerId =
      Math.random() < 0.5 ? playerId : AI_PLAYER_ID;
    gameState.current_player_id = startingPlayerId;

    const aiReplacedIds = chooseAIMulligan(gameState, AI_PLAYER_ID).filter(
      (instanceId) => instanceId !== forcedAiOpeningCardInstanceId
    );
    const aiMulliganResult = applyPlayerMulligan(
      gameState,
      AI_PLAYER_ID,
      aiReplacedIds
    );
    let finalState = aiMulliganResult.state;

    const supportsMulliganUi = clientSupportsMulligan(clientVersion);
    const legacyBootstrap = bootstrapSoloMulliganForClient(
      finalState,
      playerId,
      supportsMulliganUi
    );
    finalState = legacyBootstrap.state;
    await hydrateGameStateCards(finalState);

    const { rows } = await db.query(
      `INSERT INTO games (
        player1_id, player2_id, player1_deck_id, player2_deck_id,
        game_mode, game_status, board_layout, game_state,
        saga_run_id, saga_node_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING game_id`,
      [
        playerId,
        AI_PLAYER_ID,
        // Saga decks live in `saga_decks`, not `decks`, so we cannot reference
        // the saga deck id here (FK -> decks). Cards are already in game_state
        // and saga rewards are handled by SagaBattleService, so leave this null.
        null,
        enemyDeckId,
        "solo",
        finalState.status,
        "4x4",
        JSON.stringify(finalState),
        runId,
        nodeId,
      ]
    );

    const deckNameResult = await db.query(
      "SELECT name FROM decks WHERE deck_id = $1",
      [enemyDeckId]
    );

    return {
      game_id: rows[0].game_id,
      run_id: runId,
      node_id: nodeId,
      floor: run.current_floor,
      node_type: node.type,
      battle_difficulty: sagaContext.battle_difficulty,
      opponent_deck_name: deckNameResult.rows[0]?.name,
    };
  },

  async processBattleCompletion(
    userId: string,
    gameId: string,
    won: boolean
  ): Promise<SagaBattleCompletionResult | null> {
    const gameResult = await db.query(
      `SELECT game_id, saga_run_id, saga_node_id, player1_id, game_state
       FROM games WHERE game_id = $1`,
      [gameId]
    );
    if (gameResult.rows.length === 0) return null;
    const game = gameResult.rows[0];
    if (!game.saga_run_id || game.player1_id !== userId) return null;

    if (game.saga_node_id === "random") {
      return SagaRandomBattleService.processRandomBattleCompletion(
        userId,
        gameId,
        won
      );
    }

    const run = await SagaRunModel.findById(game.saga_run_id);
    if (!run) return null;

    const node = findNodeInMap(run.node_map, game.saga_node_id);
    if (!node) return null;

    const currencyDelta = battleCurrencyReward(node, won);
    let balance = await SagaCurrencyService.getBalance(
      userId,
      run.season_id
    );
    if (currencyDelta > 0) {
      balance = await SagaCurrencyService.award(
        userId,
        run.season_id,
        currencyDelta,
        run.run_id
      );
    } else {
      await SagaCurrencyService.syncRunDisplayCurrency(
        run.run_id,
        userId,
        run.season_id
      );
    }

    let pendingReward = undefined;

    if (won) {
      const gameState =
        typeof game.game_state === "string"
          ? JSON.parse(game.game_state)
          : game.game_state;
      await this.applyFuryRuneProgress(run.run_id, userId, gameState as GameState);
      pendingReward = await SagaRewardService.startBattleRewardNode(
        run.run_id,
        userId,
        game.saga_node_id
      );
    } else if (run.status === "active") {
      const defeat = await SagaDefeatService.processDefeat(
        run.run_id,
        userId,
        game.saga_node_id
      );
      return {
        won: false,
        run_id: run.run_id,
        node_id: game.saga_node_id,
        currency_earned: defeat.currency_earned,
        run_currency_delta: currencyDelta,
        map_view: defeat.map_view,
        defeat_result: defeat,
      };
    }

    const mapView = await SagaMapService.getMapView(run.run_id, userId);

    return {
      won,
      run_id: run.run_id,
      node_id: game.saga_node_id,
      currency_earned: balance,
      run_currency_delta: currencyDelta,
      map_view: mapView,
      pending_reward: pendingReward,
    };
  },

  async applyFuryRuneProgress(
    runId: string,
    playerId: string,
    gameState: GameState
  ): Promise<void> {
    await SagaService.assertRunOwnership(runId, playerId);

    const playedSagaCardIds = new Set<string>();

    const trackedPlayed =
      gameState.saga_context?.player_card_instance_ids_played?.[playerId] ?? [];
    for (const instanceId of trackedPlayed) {
      if (instanceId.startsWith("saga-")) {
        playedSagaCardIds.add(instanceId.slice(5));
      }
    }

    // Fallback for older in-flight game states without explicit played-card tracking:
    // infer from cards that were on board at end or ended in discard pile.
    if (!playedSagaCardIds.size) {
      const player =
        gameState.player1.user_id === playerId
          ? gameState.player1
          : gameState.player2;
      for (const instanceId of player.discard_pile) {
        if (instanceId.startsWith("saga-")) {
          playedSagaCardIds.add(instanceId.slice(5));
        }
      }
      for (const row of gameState.board) {
        for (const cell of row) {
          if (
            cell.card?.owner === playerId &&
            cell.card.user_card_instance_id.startsWith("saga-")
          ) {
            playedSagaCardIds.add(cell.card.user_card_instance_id.slice(5));
          }
        }
      }
    }

    const cards = await SagaCardModel.findActiveByRunId(runId);
    for (const card of cards) {
      if (card.rune_type !== "fury") continue;
      if (!playedSagaCardIds.has(card.saga_card_id)) continue;
      await SagaCardModel.update(card.saga_card_id, {
        rune_stacks: card.rune_stacks + 1,
      });
    }
  },

  async getSagaGameMeta(
    gameId: string
  ): Promise<{ saga_run_id: string; saga_node_id: string } | null> {
    const { rows } = await db.query(
      `SELECT saga_run_id, saga_node_id FROM games WHERE game_id = $1`,
      [gameId]
    );
    if (!rows[0]?.saga_run_id) return null;
    return {
      saga_run_id: rows[0].saga_run_id,
      saga_node_id: rows[0].saga_node_id,
    };
  },
};

export default SagaBattleService;
