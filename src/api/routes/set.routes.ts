import { Router } from "express";
import SetController from "../controllers/set.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// Public routes (no authentication required)
router.get("/", SetController.getAllSets);
router.get("/released", SetController.getReleasedSets);
router.get("/:setId", SetController.getSetById);

// Admin routes (authentication required)
router.post("/", authenticateJWT, SetController.createSet);
router.put("/:setId", authenticateJWT, SetController.updateSet);
router.patch(
  "/:setId/release",
  authenticateJWT,
  SetController.updateReleaseStatus
);
router.delete("/:setId", authenticateJWT, SetController.deleteSet);

export default router;
