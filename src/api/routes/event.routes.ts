import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import * as eventController from "../controllers/event.controller";

const router = Router();

/** GET /api/events — events visible to the caller (may be empty). */
router.get("/", authMiddleware.protect, eventController.getEvents);

/** GET /api/events/:eventId */
router.get("/:eventId", authMiddleware.protect, eventController.getEvent);

/** GET /api/events/:eventId/shop */
router.get("/:eventId/shop", authMiddleware.protect, eventController.getEventShop);

/** POST /api/events/:eventId/shop/:offeringId/purchase */
router.post(
  "/:eventId/shop/:offeringId/purchase",
  authMiddleware.protect,
  eventController.purchaseEventShopItem
);

/** GET /api/events/:eventId/login-sequence — also credits today's login. */
router.get(
  "/:eventId/login-sequence",
  authMiddleware.protect,
  eventController.getEventLoginSequence
);

/** POST /api/events/:eventId/login-sequence/claim */
router.post(
  "/:eventId/login-sequence/claim",
  authMiddleware.protect,
  eventController.claimEventLoginSequence
);

/** GET /api/events/:eventId/milestones */
router.get(
  "/:eventId/milestones",
  authMiddleware.protect,
  eventController.getEventMilestones
);

/** POST /api/events/:eventId/milestones/claim */
router.post(
  "/:eventId/milestones/claim",
  authMiddleware.protect,
  eventController.claimEventMilestones
);

export default router;
