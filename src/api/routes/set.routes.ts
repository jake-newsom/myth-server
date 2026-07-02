import { Router } from "express";
import SetController from "../controllers/set.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import requireAdmin from "../middlewares/adminAuth.middleware";

const router = Router();

// Public routes (no authentication required)
router.get("/", SetController.getAllSets);
router.get("/released", SetController.getReleasedSets);
router.get("/:setId", SetController.getSetById);

// Admin routes
router.post("/", authenticateJWT, requireAdmin, SetController.createSet);
router.put("/:setId", authenticateJWT, requireAdmin, SetController.updateSet);
router.patch(
  "/:setId/release",
  authenticateJWT,
  requireAdmin,
  SetController.updateReleaseStatus
);
router.delete("/:setId", authenticateJWT, requireAdmin, SetController.deleteSet);

export default router;
