import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../types/middleware.types";
import SagaService from "../../services/saga.service";
import SagaDraftService from "../../services/sagaDraft.service";
import SagaMapService from "../../services/sagaMap.service";
import SagaBattleService from "../../services/sagaBattle.service";
import SagaShopService from "../../services/sagaShop.service";
import SagaRewardService from "../../services/sagaReward.service";
import SagaCurrencyService from "../../services/sagaCurrency.service";
import SagaDeckManageService from "../../services/sagaDeckManage.service";
import SagaRandomBattleService from "../../services/sagaRandomBattle.service";
import type {
  SagaBattleRewardClaimInput,
  SagaCardRewardClaimInput,
} from "../../types/sagaReward.types";
import { getClientVersionFromHeader } from "../../utils/clientVersion";
import {
  CreateSagaCardInput,
  CreateSagaRunInput,
  CreateSagaSeasonInput,
  SagaRun,
  UpdateSagaCardInput,
  UpdateSagaRunInput,
  UpdateSagaSeasonInput,
} from "../../types/saga.types";

function handleError(
  error: unknown,
  res: Response,
  next: NextFunction,
  fallback: string
): void {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof (error as { statusCode: number }).statusCode === "number"
  ) {
    const err = error as { statusCode: number; message: string };
    res.status(err.statusCode).json({ status: "error", message: err.message });
    return;
  }
  next(error instanceof Error ? error : new Error(fallback));
}

export const SagaController = {
  // Seasons
  async getSeasonOverview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const seasonId = req.query.season_id as string | undefined;
      const overview = await SagaService.getSeasonOverview(userId, seasonId);
      res.status(200).json({ status: "success", data: overview });
    } catch (error) {
      handleError(error, res, next, "Failed to get saga overview");
    }
  },

  async getRoster(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const roster = await SagaDeckManageService.getRoster(
        req.params.runId,
        userId
      );
      res.status(200).json({ status: "success", data: roster });
    } catch (error) {
      handleError(error, res, next, "Failed to get saga roster");
    }
  },

  async swapDeckCards(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const { bench_saga_card_id, deck_saga_card_id } = req.body as {
        bench_saga_card_id: string;
        deck_saga_card_id: string;
      };
      if (!bench_saga_card_id || !deck_saga_card_id) {
        res.status(400).json({
          status: "error",
          message: "bench_saga_card_id and deck_saga_card_id are required",
        });
        return;
      }
      const roster = await SagaDeckManageService.swapCards(
        req.params.runId,
        userId,
        bench_saga_card_id,
        deck_saga_card_id
      );
      res.status(200).json({ status: "success", data: roster });
    } catch (error) {
      handleError(error, res, next, "Failed to swap saga cards");
    }
  },

  async startRandomBattle(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const { season_id } = req.body as { season_id: string };
      if (!season_id) {
        res.status(400).json({ status: "error", message: "season_id is required" });
        return;
      }
      const result = await SagaRandomBattleService.startRandomBattle(
        userId,
        season_id,
        getClientVersionFromHeader(req.headers)
      );
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to start random saga battle");
    }
  },

  async getActiveSeason(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const season = await SagaService.getActiveSeason();
      res.status(200).json({ status: "success", data: season });
    } catch (error) {
      handleError(error, res, next, "Failed to get active saga season");
    }
  },

  async listSeasons(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const seasons = await SagaService.listSeasons(limit);
      res.status(200).json({ status: "success", data: seasons });
    } catch (error) {
      handleError(error, res, next, "Failed to list saga seasons");
    }
  },

  async getSeason(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const season = await SagaService.getSeason(req.params.seasonId);
      res.status(200).json({ status: "success", data: season });
    } catch (error) {
      handleError(error, res, next, "Failed to get saga season");
    }
  },

  async createSeason(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as CreateSagaSeasonInput;
      const season = await SagaService.createSeason({
        ...body,
        start_date: new Date(body.start_date),
        end_date: new Date(body.end_date),
      });
      res.status(201).json({ status: "success", data: season });
    } catch (error) {
      handleError(error, res, next, "Failed to create saga season");
    }
  },

  async updateSeason(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpdateSagaSeasonInput;
      const input: UpdateSagaSeasonInput = { ...body };
      if (body.start_date) input.start_date = new Date(body.start_date);
      if (body.end_date) input.end_date = new Date(body.end_date);
      const season = await SagaService.updateSeason(req.params.seasonId, input);
      res.status(200).json({ status: "success", data: season });
    } catch (error) {
      handleError(error, res, next, "Failed to update saga season");
    }
  },

  async deleteSeason(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await SagaService.deleteSeason(req.params.seasonId);
      res.status(200).json({ status: "success", message: "Saga season deleted" });
    } catch (error) {
      handleError(error, res, next, "Failed to delete saga season");
    }
  },

  // Runs
  async getCurrentRun(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const seasonId = req.query.season_id as string | undefined;
      const run = await SagaService.getCurrentRun(userId, seasonId);
      res.status(200).json({ status: "success", data: run });
    } catch (error) {
      handleError(error, res, next, "Failed to get current saga run");
    }
  },

  async listRuns(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const runs = await SagaService.listRuns(userId, {
        seasonId: req.query.season_id as string | undefined,
        status: req.query.status as SagaRun["status"] | undefined,
      });
      res.status(200).json({ status: "success", data: runs });
    } catch (error) {
      handleError(error, res, next, "Failed to list saga runs");
    }
  },

  async getRun(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const run = await SagaService.getRunDetail(req.params.runId, userId);
      res.status(200).json({ status: "success", data: run });
    } catch (error) {
      handleError(error, res, next, "Failed to get saga run");
    }
  },

  async createRun(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const body = req.body as CreateSagaRunInput;
      const run = await SagaService.createRun(userId, body);
      res.status(201).json({ status: "success", data: run });
    } catch (error) {
      handleError(error, res, next, "Failed to create saga run");
    }
  },

  async updateRun(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const run = await SagaService.updateRun(
        req.params.runId,
        userId,
        req.body as UpdateSagaRunInput
      );
      res.status(200).json({ status: "success", data: run });
    } catch (error) {
      handleError(error, res, next, "Failed to update saga run");
    }
  },

  async abandonRun(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const run = await SagaService.abandonRun(req.params.runId, userId);
      res.status(200).json({ status: "success", data: run });
    } catch (error) {
      handleError(error, res, next, "Failed to abandon saga run");
    }
  },

  async deleteRun(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      await SagaService.deleteRun(req.params.runId, userId);
      res.status(200).json({ status: "success", message: "Saga run deleted" });
    } catch (error) {
      handleError(error, res, next, "Failed to delete saga run");
    }
  },

  // Deck & collection
  async getDeck(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const deck = await SagaService.getDeck(req.params.runId, userId);
      res.status(200).json({ status: "success", data: deck });
    } catch (error) {
      handleError(error, res, next, "Failed to get saga deck");
    }
  },

  async getCollection(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const collection = await SagaService.getCollection(
        req.params.runId,
        userId
      );
      res.status(200).json({ status: "success", data: collection });
    } catch (error) {
      handleError(error, res, next, "Failed to get saga collection");
    }
  },

  // Cards
  async listCards(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const cards = await SagaService.listCards(req.params.runId, userId);
      res.status(200).json({ status: "success", data: cards });
    } catch (error) {
      handleError(error, res, next, "Failed to list saga cards");
    }
  },

  async createCard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const card = await SagaService.createCard(
        req.params.runId,
        userId,
        req.body as CreateSagaCardInput
      );
      res.status(201).json({ status: "success", data: card });
    } catch (error) {
      handleError(error, res, next, "Failed to create saga card");
    }
  },

  async updateCard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const card = await SagaService.updateCard(
        req.params.sagaCardId,
        userId,
        req.body as UpdateSagaCardInput
      );
      res.status(200).json({ status: "success", data: card });
    } catch (error) {
      handleError(error, res, next, "Failed to update saga card");
    }
  },

  async deleteCard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      await SagaService.deleteCard(req.params.sagaCardId, userId);
      res.status(200).json({ status: "success", message: "Saga card deleted" });
    } catch (error) {
      handleError(error, res, next, "Failed to delete saga card");
    }
  },

  // Draft
  async startDraft(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const { season_id } = req.body as { season_id: string };
      if (!season_id) {
        res.status(400).json({ status: "error", message: "season_id is required" });
        return;
      }
      const result = await SagaDraftService.startDraft(userId, season_id);
      res.status(201).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to start saga draft");
    }
  },

  async getDraftStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const result = await SagaDraftService.getDraftStatus(
        req.params.runId,
        userId
      );
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to get saga draft status");
    }
  },

  async selectLegendary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const { base_card_id } = req.body as { base_card_id: string };
      if (!base_card_id) {
        res.status(400).json({ status: "error", message: "base_card_id is required" });
        return;
      }
      const result = await SagaDraftService.selectLegendary(
        req.params.runId,
        userId,
        base_card_id
      );
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to select legendary anchor");
    }
  },

  async getPickOptions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const result = await SagaDraftService.getCurrentPickOptions(
        req.params.runId,
        userId
      );
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to get draft pick options");
    }
  },

  async selectPick(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const { base_card_id } = req.body as { base_card_id: string };
      if (!base_card_id) {
        res.status(400).json({ status: "error", message: "base_card_id is required" });
        return;
      }
      const result = await SagaDraftService.selectPick(
        req.params.runId,
        userId,
        base_card_id
      );
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to select draft card");
    }
  },

  async finalizeDraft(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const run = await SagaDraftService.finalizeDraft(req.params.runId, userId);
      res.status(200).json({ status: "success", data: run });
    } catch (error) {
      handleError(error, res, next, "Failed to finalize saga draft");
    }
  },

  // Node map (GDD Sections 3 & 12)
  async getMap(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const view = await SagaMapService.getMapView(req.params.runId, userId);
      res.status(200).json({ status: "success", data: view });
    } catch (error) {
      handleError(error, res, next, "Failed to get saga map");
    }
  },

  async selectMapNode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const { node_id } = req.body as { node_id: string };
      if (!node_id) {
        res.status(400).json({ status: "error", message: "node_id is required" });
        return;
      }
      const view = await SagaMapService.selectNode(
        req.params.runId,
        userId,
        node_id
      );
      res.status(200).json({ status: "success", data: view });
    } catch (error) {
      handleError(error, res, next, "Failed to select map node");
    }
  },

  async startBattle(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const { node_id } = req.body as { node_id: string };
      if (!node_id) {
        res.status(400).json({ status: "error", message: "node_id is required" });
        return;
      }
      const result = await SagaBattleService.startBattle(
        req.params.runId,
        userId,
        node_id,
        getClientVersionFromHeader(req.headers)
      );
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to start saga battle");
    }
  },

  async getShop(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const seasonId = req.query.season_id as string | undefined;
      const view = await SagaShopService.getShopView(userId, seasonId);
      res.status(200).json({ status: "success", data: view });
    } catch (error) {
      handleError(error, res, next, "Failed to load saga shop");
    }
  },

  async purchaseShopItem(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const { season_id, item_id } = req.body as {
        season_id: string;
        item_id: string;
      };
      if (!season_id || !item_id) {
        res.status(400).json({
          status: "error",
          message: "season_id and item_id are required",
        });
        return;
      }
      const result = await SagaShopService.purchase(userId, season_id, item_id);
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to purchase shop item");
    }
  },

  async getSeasonCurrency(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const seasonId = req.query.season_id as string;
      if (!seasonId) {
        res.status(400).json({ status: "error", message: "season_id is required" });
        return;
      }
      const balance = await SagaCurrencyService.getBalance(userId, seasonId);
      res.status(200).json({ status: "success", data: { currency_balance: balance } });
    } catch (error) {
      handleError(error, res, next, "Failed to get saga currency");
    }
  },

  async getRewardStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const status = await SagaRewardService.getRewardStatus(
        req.params.runId,
        userId
      );
      res.status(200).json({ status: "success", data: status });
    } catch (error) {
      handleError(error, res, next, "Failed to get reward status");
    }
  },

  async claimCardReward(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const result = await SagaRewardService.claimCardReward(
        req.params.runId,
        userId,
        req.body as SagaCardRewardClaimInput
      );
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to claim card reward");
    }
  },

  async claimBattleReward(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const result = await SagaRewardService.claimBattleReward(
        req.params.runId,
        userId,
        req.body as SagaBattleRewardClaimInput
      );
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      handleError(error, res, next, "Failed to claim battle reward");
    }
  },

  async restartRun(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const run = await SagaService.restartRun(req.params.runId, userId);
      res.status(200).json({ status: "success", data: run });
    } catch (error) {
      handleError(error, res, next, "Failed to restart saga run");
    }
  },

  async completeMapNode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        res.status(401).json({ status: "error", message: "Not authenticated" });
        return;
      }
      const { node_id } = req.body as { node_id: string };
      if (!node_id) {
        res.status(400).json({ status: "error", message: "node_id is required" });
        return;
      }
      const view = await SagaMapService.completeNode(
        req.params.runId,
        userId,
        node_id
      );
      res.status(200).json({ status: "success", data: view });
    } catch (error) {
      handleError(error, res, next, "Failed to complete map node");
    }
  },
};
