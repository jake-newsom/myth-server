import { Router } from "express";
import FeatureFlagController from "../controllers/featureFlag.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/adminAuth.middleware";

const router = Router();

// ---- Player endpoints -------------------------------------------------------
// The flags that are ON for the calling user.
router.get("/me", authenticateJWT, FeatureFlagController.getMyFlags);

// ---- Admin endpoints --------------------------------------------------------
router.get("/admin", authenticateJWT, requireAdmin, FeatureFlagController.listFlags);
router.post("/admin", authenticateJWT, requireAdmin, FeatureFlagController.createFlag);

// Registered BEFORE /admin/:featureFlagId — Express matches in order, and the
// literal "users" segment would otherwise be swallowed by the :featureFlagId
// param route and 404 as a missing flag.
router.get(
  "/admin/users/:userId/overrides",
  authenticateJWT,
  requireAdmin,
  FeatureFlagController.listUserOverrides
);
router.get(
  "/admin/users/:userId/evaluate",
  authenticateJWT,
  requireAdmin,
  FeatureFlagController.evaluateForUser
);

router.get(
  "/admin/:featureFlagId",
  authenticateJWT,
  requireAdmin,
  FeatureFlagController.getFlag
);
router.patch(
  "/admin/:featureFlagId",
  authenticateJWT,
  requireAdmin,
  FeatureFlagController.updateFlag
);
router.delete(
  "/admin/:featureFlagId",
  authenticateJWT,
  requireAdmin,
  FeatureFlagController.deleteFlag
);

// ---- Admin: per-user overrides ----------------------------------------------
router.put(
  "/admin/:featureFlagId/users/:userId",
  authenticateJWT,
  requireAdmin,
  FeatureFlagController.setUserOverride
);
router.delete(
  "/admin/:featureFlagId/users/:userId",
  authenticateJWT,
  requireAdmin,
  FeatureFlagController.removeUserOverride
);
export default router;
