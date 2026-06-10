import _ from "lodash";
import db from "../config/db.config";
import { AI_PLAYER_ID } from "../api/controllers/game.controller";
import { GameStatus } from "../game-engine/game.logic";
import {
  applyPlayerMulligan,
  bootstrapSoloMulliganForClient,
  chooseAIMulligan,
} from "../game-engine/game.mulligan";
import { sagaInstanceId } from "../game-engine/sagaBattle.hydration";
import { hydrateGameStateCards } from "../game-engine/game.utils";
import { buildInitialSagaBoard } from "../game-engine/sagaBattle.mechanics";
import {
  hydrateEnemyDeckForSaga,
  hydrateSagaDeckForBattle,
} from "../game-engine/sagaBattle.hydration";
import { SAGA_FLOOR_BATTLE_CONFIG } from "../types/sagaBattle.types";
import SagaRunModel from "../models/sagaRun.model";
import SagaSeasonModel from "../models/sagaSeason.model";
import SagaDeckModel from "../models/sagaDeck.model";
import DeckService from "./deck.service";
import SagaService from "./saga.service";
import SagaCurrencyService, {
  SAGA_CURRENCY_REWARDS,
} from "./sagaCurrency.service";
import { clientSupportsMulligan } from "../utils/clientVersion";
import type { SagaRandomBattleStartResult } from "../types/sagaLifecycle.types";
import type { SagaBattleCompletionResult } from "../types/sagaBattle.types";

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function collectEnemyDeckIds(
  enemyDecks: Record<string, unknown>
): string[] {
  const ids: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") ids.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(enemyDecks);
  return [...new Set(ids)];
}

const SagaRandomBattleService = {
  async findCompletedRun(playerId: string, seasonId: string) {
    return SagaRunModel.findLatestCompletedByPlayerAndSeason(
      playerId,
      seasonId
    );
  },

  async startRandomBattle(
    _playerId: string,
    _seasonId: string,
    _clientVersion?: string
  ): Promise<SagaRandomBattleStartResult> {
    throw httpError(403, "Random saga battles are not available.");
  },

  async processRandomBattleCompletion(
    userId: string,
    gameId: string,
    won: boolean
  ): Promise<SagaBattleCompletionResult | null> {
    const gameResult = await db.query(
      `SELECT game_id, saga_run_id, saga_node_id, player1_id
       FROM games WHERE game_id = $1`,
      [gameId]
    );
    if (gameResult.rows.length === 0) return null;
    const game = gameResult.rows[0];
    if (game.saga_node_id !== "random" || game.player1_id !== userId) {
      return null;
    }

    const run = await SagaRunModel.findById(game.saga_run_id);
    if (!run) return null;

    const currencyDelta = won
      ? SAGA_CURRENCY_REWARDS.random_win
      : SAGA_CURRENCY_REWARDS.loss;

    const balance = await SagaCurrencyService.award(
      userId,
      run.season_id,
      currencyDelta,
      run.run_id
    );

    return {
      won,
      run_id: run.run_id,
      node_id: "random",
      currency_earned: balance,
      run_currency_delta: currencyDelta,
    };
  },
};

export default SagaRandomBattleService;
