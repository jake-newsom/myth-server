import SagaPlayerSeasonModel from "../models/sagaPlayerSeason.model";
import SagaRunModel from "../models/sagaRun.model";
import UserModel from "../models/user.model";

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

/** Tuned so ~4 full saga clears buy card (400) + border (75) + back (100). */
export const SAGA_CURRENCY_REWARDS = {
  easy_win: 3,
  hard_win: 5,
  boss_win: 10,
  loss: 0,
  random_win: 0,
  floor_1_clear: 8,
  floor_2_clear: 12,
  full_run_clear: 35,
} as const;

const SagaCurrencyService = {
  async getBalance(playerId: string, _seasonId?: string): Promise<number> {
    return UserModel.getEchoes(playerId);
  },

  async syncRunDisplayCurrency(
    runId: string,
    playerId: string,
    seasonId: string
  ): Promise<void> {
    const balance = await this.getBalance(playerId, seasonId);
    await SagaRunModel.update(runId, { currency_earned: balance });
  },

  async award(
    playerId: string,
    seasonId: string,
    amount: number,
    runId?: string
  ): Promise<number> {
    if (amount <= 0) {
      return this.getBalance(playerId, seasonId);
    }
    const updatedUser = await UserModel.updateEchoes(playerId, amount);
    if (!updatedUser) {
      throw httpError(404, "Player not found");
    }
    const next = updatedUser.echoes;
    if (runId) {
      const run = await SagaRunModel.findById(runId);
      if (run) {
        await SagaRunModel.update(runId, {
          currency_earned: next,
          run_currency: run.run_currency + amount,
        });
      }
    }
    return next;
  },

  async spend(
    playerId: string,
    seasonId: string,
    amount: number,
    runId?: string
  ): Promise<number> {
    if (amount <= 0) {
      return this.getBalance(playerId, seasonId);
    }

    const updatedUser = await UserModel.updateEchoes(playerId, -amount);
    if (!updatedUser) {
      throw httpError(400, "Not enough echoes");
    }
    const next = updatedUser.echoes;

    if (runId) {
      await SagaRunModel.update(runId, { currency_earned: next });
    }
    return next;
  },

  async tryAwardFloorClearBonus(
    playerId: string,
    seasonId: string,
    floor: number,
    runId?: string
  ): Promise<number> {
    const bonus =
      floor === 1
        ? SAGA_CURRENCY_REWARDS.floor_1_clear
        : floor === 2
          ? SAGA_CURRENCY_REWARDS.floor_2_clear
          : 0;
    if (!bonus) return 0;

    const row = await SagaPlayerSeasonModel.getOrCreate(playerId, seasonId);
    if (row.floor_bonuses_claimed.includes(floor)) return 0;

    await SagaPlayerSeasonModel.update(playerId, seasonId, {
      floor_bonuses_claimed: [...row.floor_bonuses_claimed, floor],
    });
    await this.award(playerId, seasonId, bonus, runId);
    return bonus;
  },

  async tryAwardFullRunBonus(
    playerId: string,
    seasonId: string,
    runId?: string
  ): Promise<number> {
    const row = await SagaPlayerSeasonModel.getOrCreate(playerId, seasonId);
    if (row.full_run_bonus_claimed) return 0;

    await SagaPlayerSeasonModel.update(playerId, seasonId, {
      full_run_bonus_claimed: true,
    });
    await this.award(
      playerId,
      seasonId,
      SAGA_CURRENCY_REWARDS.full_run_clear,
      runId
    );
    return SAGA_CURRENCY_REWARDS.full_run_clear;
  },
};

export default SagaCurrencyService;
