import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import requireAdmin from "../middlewares/adminAuth.middleware";
import chatController from "../controllers/chat.controller";

const router = Router();

// Every chat route requires an authenticated user.
router.use(protect);

// --- Player-facing --------------------------------------------------------
router.get("/settings", chatController.getSettings.bind(chatController));
router.patch("/settings", chatController.updateSettings.bind(chatController));

// Public chat profile for the tap-a-user modal.
router.get(
  "/showcase/:userId",
  chatController.getShowcase.bind(chatController)
);

router.post("/report", chatController.reportMessage.bind(chatController));

// --- Moderation -----------------------------------------------------------
// Gated on the existing user_role admin middleware, not a new auth scheme.
router.get(
  "/messages",
  requireAdmin,
  chatController.getHistory.bind(chatController)
);
router.get(
  "/reports",
  requireAdmin,
  chatController.listReports.bind(chatController)
);
router.delete(
  "/messages/:messageId",
  requireAdmin,
  chatController.deleteMessage.bind(chatController)
);
router.post("/mute", requireAdmin, chatController.muteUser.bind(chatController));

export default router;
