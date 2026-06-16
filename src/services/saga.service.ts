import db from "../config/db.config";
import SagaSeasonModel from "../models/sagaSeason.model";
import SagaRunModel from "../models/sagaRun.model";
import SagaDeckModel from "../models/sagaDeck.model";
import SagaCollectionModel from "../models/sagaCollection.model";
import SagaCardModel from "../models/sagaCard.model";
import SagaPlayerSeasonModel from "../models/sagaPlayerSeason.model";
import SagaCurrencyService from "./sagaCurrency.service";
import {
  getCurrentInstancePeriodEnd,
  isRunInCurrentInstancePeriod,
} from "./sagaInstancePeriod.service";
import {
  CreateSagaCardInput,
  CreateSagaRunInput,
  CreateSagaSeasonInput,
  SagaCard,
  SagaCollectionWithCards,
  SagaDeckWithCards,
  SagaRun,
  SagaRunDetail,
  SagaSeason,
  UpdateSagaCardInput,
  UpdateSagaRunInput,
  UpdateSagaSeasonInput,
} from "../types/saga.types";

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

const SagaService = {
  // --- Seasons ---

  async getSeasonOverview(
    playerId: string,
    seasonId?: string
  ): Promise<import("../types/sagaLifecycle.types").SagaSeasonOverview> {
    const season = seasonId
      ? await this.getSeason(seasonId)
      : await SagaSeasonModel.findActive();
    if (!season) throw httpError(404, "No saga season found");

    // expireStaleInstanceRun returns the still-active run (or null if it just
    // expired one), so we reuse it instead of re-querying for the active run.
    const [balance, active, completed] = await Promise.all([
      SagaCurrencyService.getBalance(playerId, season.season_id),
      this.expireStaleInstanceRun(playerId, season.season_id, season),
      SagaRunModel.findLatestCompletedByPlayerAndSeason(
        playerId,
        season.season_id
      ),
    ]);

    const draftComplete = (run: SagaRun) => {
      if (run.draft_state?.phase === "complete") return true;
      const map = run.node_map as { version?: number } | undefined;
      return map?.version === 1;
    };

    return {
      season_id: season.season_id,
      season_name: season.season_name,
      currency_balance: balance,
      instance_period_ends_at: getCurrentInstancePeriodEnd(
        season.start_date
      ).toISOString(),
      active_run: active
        ? {
            run_id: active.run_id,
            current_floor: active.current_floor,
            status: active.status,
            draft_complete: draftComplete(active),
          }
        : null,
      completed_run: completed
        ? {
            run_id: completed.run_id,
            completed_at: completed.completed_at
              ? completed.completed_at.toISOString()
              : null,
          }
        : null,
    };
  },

  async getActiveSeason(): Promise<SagaSeason | null> {
    return SagaSeasonModel.findActive();
  },

  async getSeason(seasonId: string): Promise<SagaSeason> {
    const season = await SagaSeasonModel.findById(seasonId);
    if (!season) throw httpError(404, "Saga season not found");
    return season;
  },

  async listSeasons(limit?: number): Promise<SagaSeason[]> {
    return SagaSeasonModel.findAll(limit);
  },

  async createSeason(input: CreateSagaSeasonInput): Promise<SagaSeason> {
    const existing = await SagaSeasonModel.findById(input.season_id);
    if (existing) {
      throw httpError(409, "Saga season with this ID already exists");
    }
    if (input.end_date <= input.start_date) {
      throw httpError(400, "end_date must be after start_date");
    }
    return SagaSeasonModel.create(input);
  },

  async updateSeason(
    seasonId: string,
    input: UpdateSagaSeasonInput
  ): Promise<SagaSeason> {
    const season = await SagaSeasonModel.update(seasonId, input);
    if (!season) throw httpError(404, "Saga season not found");
    return season;
  },

  async deleteSeason(seasonId: string): Promise<void> {
    const deleted = await SagaSeasonModel.delete(seasonId);
    if (!deleted) throw httpError(404, "Saga season not found");
  },

  // --- Runs ---

  async assertRunOwnership(runId: string, playerId: string): Promise<SagaRun> {
    const run = await SagaRunModel.findById(runId);
    if (!run) throw httpError(404, "Saga run not found");
    if (run.player_id !== playerId) {
      throw httpError(403, "You do not have access to this saga run");
    }
    return run;
  },

  async getRunDetail(runId: string, playerId: string): Promise<SagaRunDetail> {
    const run = await this.assertRunOwnership(runId, playerId);
    const [balance, deck, collection] = await Promise.all([
      SagaCurrencyService.getBalance(playerId, run.season_id),
      SagaDeckModel.findWithActiveCardsByRunId(runId),
      SagaCollectionModel.findWithBenchCardsByRunId(runId),
    ]);
    if (run.currency_earned !== balance) {
      await SagaRunModel.update(runId, { currency_earned: balance });
      run.currency_earned = balance;
    }
    return { ...run, deck, collection };
  },

  async expireStaleInstanceRun(
    playerId: string,
    seasonId: string,
    preloadedSeason?: SagaSeason
  ): Promise<SagaRun | null> {
    const season =
      preloadedSeason && preloadedSeason.season_id === seasonId
        ? preloadedSeason
        : await SagaSeasonModel.findById(seasonId);
    if (!season) return null;

    const run = await SagaRunModel.findActiveByPlayerAndSeason(
      playerId,
      seasonId
    );
    if (!run) return null;

    const createdAt =
      run.created_at instanceof Date
        ? run.created_at
        : new Date(run.created_at);
    if (
      isRunInCurrentInstancePeriod(createdAt, season.start_date)
    ) {
      return run;
    }

    await SagaRunModel.update(run.run_id, { status: "abandoned" });
    return null;
  },

  async getCurrentRun(
    playerId: string,
    seasonId?: string
  ): Promise<SagaRunDetail | null> {
    let resolvedSeasonId = seasonId;
    if (!resolvedSeasonId) {
      const active = await SagaSeasonModel.findActive();
      if (!active) return null;
      resolvedSeasonId = active.season_id;
    }

    const run = await this.expireStaleInstanceRun(
      playerId,
      resolvedSeasonId
    );
    if (!run) return null;

    return this.getRunDetail(run.run_id, playerId);
  },

  async listRuns(
    playerId: string,
    options?: { seasonId?: string; status?: SagaRun["status"] }
  ): Promise<SagaRun[]> {
    return SagaRunModel.findByPlayerId(playerId, options);
  },

  async createRun(
    playerId: string,
    input: CreateSagaRunInput
  ): Promise<SagaRunDetail> {
    const season = await SagaSeasonModel.findById(input.season_id);
    if (!season) throw httpError(404, "Saga season not found");

    const existing = await SagaRunModel.findActiveByPlayerAndSeason(
      playerId,
      input.season_id
    );
    if (existing) {
      throw httpError(
        409,
        "An active saga run already exists for this season."
      );
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      const run = await SagaRunModel.createWithClient(client, playerId, input);
      await SagaDeckModel.createWithClient(client, run.run_id);
      await SagaCollectionModel.createWithClient(client, run.run_id);

      await SagaPlayerSeasonModel.getOrCreate(playerId, input.season_id);
      const balance = await SagaCurrencyService.getBalance(
        playerId,
        input.season_id
      );
      await SagaRunModel.update(run.run_id, {
        currency_earned: balance,
      });

      await client.query("COMMIT");
      return (await this.getRunDetail(run.run_id, playerId)) as SagaRunDetail;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async updateRun(
    runId: string,
    playerId: string,
    input: UpdateSagaRunInput
  ): Promise<SagaRun> {
    await this.assertRunOwnership(runId, playerId);
    const updated = await SagaRunModel.update(runId, input);
    if (!updated) throw httpError(404, "Saga run not found");
    return updated;
  },

  async abandonRun(runId: string, playerId: string): Promise<SagaRun> {
    return this.updateRun(runId, playerId, { status: "abandoned" });
  },

  async restartRun(
    _runId: string,
    _playerId: string
  ): Promise<SagaRunDetail> {
    throw httpError(
      403,
      "Manual instance reset is disabled. Your saga run resets automatically every 2 weeks."
    );
  },

  async deleteRun(runId: string, playerId: string): Promise<void> {
    await this.assertRunOwnership(runId, playerId);
    const deleted = await SagaRunModel.delete(runId);
    if (!deleted) throw httpError(404, "Saga run not found");
  },

  // --- Deck ---

  async getDeck(runId: string, playerId: string): Promise<SagaDeckWithCards> {
    await this.assertRunOwnership(runId, playerId);
    const deck = await SagaDeckModel.findWithActiveCardsByRunId(runId);
    if (!deck) throw httpError(404, "Saga deck not found for this run");
    return deck;
  },

  // --- Collection ---

  async getCollection(
    runId: string,
    playerId: string
  ): Promise<SagaCollectionWithCards> {
    await this.assertRunOwnership(runId, playerId);
    const collection =
      await SagaCollectionModel.findWithBenchCardsByRunId(runId);
    if (!collection) {
      throw httpError(404, "Saga collection not found for this run");
    }
    return collection;
  },

  // --- Cards ---

  async listCards(runId: string, playerId: string): Promise<SagaCard[]> {
    await this.assertRunOwnership(runId, playerId);
    return SagaCardModel.findByRunId(runId);
  },

  async createCard(
    runId: string,
    playerId: string,
    input: CreateSagaCardInput
  ): Promise<SagaCard> {
    const run = await this.assertRunOwnership(runId, playerId);
    const deck = await SagaDeckModel.findByRunId(runId);

    const deckId =
      input.is_active === false ? null : input.deck_id ?? deck?.deck_id ?? null;

    if (input.is_active !== false && !deckId) {
      throw httpError(400, "No saga deck exists for this run");
    }

    return SagaCardModel.create(run.run_id, {
      ...input,
      deck_id: deckId,
    });
  },

  async updateCard(
    sagaCardId: string,
    playerId: string,
    input: UpdateSagaCardInput
  ): Promise<SagaCard> {
    const card = await SagaCardModel.findById(sagaCardId);
    if (!card) throw httpError(404, "Saga card not found");
    await this.assertRunOwnership(card.run_id, playerId);

    const updated = await SagaCardModel.update(sagaCardId, input);
    if (!updated) throw httpError(404, "Saga card not found");
    return updated;
  },

  async deleteCard(sagaCardId: string, playerId: string): Promise<void> {
    const card = await SagaCardModel.findById(sagaCardId);
    if (!card) throw httpError(404, "Saga card not found");
    await this.assertRunOwnership(card.run_id, playerId);
    const deleted = await SagaCardModel.delete(sagaCardId);
    if (!deleted) throw httpError(404, "Saga card not found");
  },
};

export default SagaService;
