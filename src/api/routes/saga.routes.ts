/**
 * Sagas roguelike mode API — Phase 1 data model & CRUD
 */

import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/adminAuth.middleware";
import { moderateRateLimit } from "../middlewares/rateLimit.middleware";
import { SagaController } from "../controllers/saga.controller";

const router = Router();

// --- Seasons (read: authenticated; write: admin) ---
router.get(
  "/overview",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getSeasonOverview
);

router.get(
  "/seasons/active",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getActiveSeason
);

router.get(
  "/seasons",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.listSeasons
);

router.get(
  "/seasons/:seasonId",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getSeason
);

router.post(
  "/seasons",
  authMiddleware.protect,
  requireAdmin,
  moderateRateLimit,
  SagaController.createSeason
);

router.put(
  "/seasons/:seasonId",
  authMiddleware.protect,
  requireAdmin,
  moderateRateLimit,
  SagaController.updateSeason
);

router.delete(
  "/seasons/:seasonId",
  authMiddleware.protect,
  requireAdmin,
  moderateRateLimit,
  SagaController.deleteSeason
);

// --- Runs ---
router.get(
  "/runs/current",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getCurrentRun
);

router.get(
  "/runs",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.listRuns
);

router.get(
  "/runs/:runId/map",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getMap
);

router.post(
  "/runs/:runId/map/select",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.selectMapNode
);

router.post(
  "/runs/:runId/map/complete",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.completeMapNode
);

router.post(
  "/runs/:runId/battle/start",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.startBattle
);

router.get(
  "/shop",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getShop
);

router.post(
  "/shop/purchase",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.purchaseShopItem
);

router.get(
  "/currency",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getSeasonCurrency
);

router.get(
  "/runs/:runId/rewards",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getRewardStatus
);

router.post(
  "/runs/:runId/rewards/card",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.claimCardReward
);

router.post(
  "/runs/:runId/rewards/battle",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.claimBattleReward
);

router.post(
  "/runs/:runId/restart",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.restartRun
);

router.get(
  "/runs/:runId/roster",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getRoster
);

router.post(
  "/runs/:runId/deck/swap",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.swapDeckCards
);

router.post(
  "/random-battle/start",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.startRandomBattle
);

router.get(
  "/runs/:runId",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getRun
);

router.post(
  "/runs",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.createRun
);

router.put(
  "/runs/:runId",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.updateRun
);

router.post(
  "/runs/:runId/abandon",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.abandonRun
);

router.delete(
  "/runs/:runId",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.deleteRun
);

// --- Deck & collection (nested under run) ---
router.get(
  "/runs/:runId/deck",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getDeck
);

router.get(
  "/runs/:runId/collection",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getCollection
);

// --- Cards ---
router.get(
  "/runs/:runId/cards",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.listCards
);

router.post(
  "/runs/:runId/cards",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.createCard
);

router.put(
  "/cards/:sagaCardId",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.updateCard
);

router.delete(
  "/cards/:sagaCardId",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.deleteCard
);

// --- Draft (GDD Section 2) ---
router.post(
  "/draft/start",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.startDraft
);

router.get(
  "/draft/:runId/status",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getDraftStatus
);

router.post(
  "/draft/:runId/legendary",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.selectLegendary
);

router.get(
  "/draft/:runId/pick-options",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.getPickOptions
);

router.post(
  "/draft/:runId/pick",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.selectPick
);

router.post(
  "/draft/:runId/finalize",
  authMiddleware.protect,
  moderateRateLimit,
  SagaController.finalizeDraft
);

export default router;
