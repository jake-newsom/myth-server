import express from "express";
import RankedDraftController from "../controllers/rankedDraft.controller";
import { protect } from "../middlewares/auth.middleware";

const router = express.Router();

// Every route is flag-gated inside the controller and 404s when the flag is off.
router.get("/config", protect, RankedDraftController.getConfig);
router.post("/queue/join", protect, RankedDraftController.joinQueue);
router.post("/queue/leave", protect, RankedDraftController.leaveQueue);
router.get("/queue/status", protect, RankedDraftController.getQueueStatus);
router.get("/session", protect, RankedDraftController.getSession);
router.get("/variants/:cardVariantId", protect, RankedDraftController.getVariants);

export default router;
