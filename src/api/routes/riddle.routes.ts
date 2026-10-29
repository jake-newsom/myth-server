import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/adminAuth.middleware";
import { asyncHandler } from "../middlewares/express-ts-helper";
import { gameActionRateLimit } from "../middlewares/rateLimit.middleware";
import RiddleController from "../controllers/riddle.controller";

const router = Router();

router.use(protect);

router.get("/current", asyncHandler(RiddleController.getCurrent));
router.get("/leaderboard", asyncHandler(RiddleController.getLeaderboard));
router.post("/attempts", gameActionRateLimit, asyncHandler(RiddleController.startAttempt));
router.post("/attempts/:attemptId/finish", gameActionRateLimit, asyncHandler(RiddleController.finishAttempt));

// Admin: candidate pool + manual rotation (dev).
router.get("/admin/puzzles", requireAdmin, asyncHandler(RiddleController.adminList));
router.post("/admin/puzzles/import", requireAdmin, asyncHandler(RiddleController.adminImport));
router.post("/admin/puzzles/:id/status", requireAdmin, asyncHandler(RiddleController.adminSetStatus));
router.post("/admin/rotate", requireAdmin, asyncHandler(RiddleController.adminRotate));

export default router;
