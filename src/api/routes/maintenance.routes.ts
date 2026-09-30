import { Router } from "express";
import MaintenanceController from "../controllers/maintenance.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/adminAuth.middleware";

const router = Router();

// ---- Public -----------------------------------------------------------------
// Unauthenticated: a client must be able to ask "is the server down?" while
// every other route is refusing it, including before it has a valid session.
router.get("/status", MaintenanceController.getStatus);

// ---- Admin ------------------------------------------------------------------
router.get("/admin", authenticateJWT, requireAdmin, MaintenanceController.listWindows);
router.post("/admin", authenticateJWT, requireAdmin, MaintenanceController.createWindow);

// Registered BEFORE the :maintenanceWindowId routes so the literal "end"
// segment can't be swallowed as an id, matching the ordering convention used
// by the feature-flag routes.
router.post(
  "/admin/:maintenanceWindowId/end",
  authenticateJWT,
  requireAdmin,
  MaintenanceController.endWindow
);

router.patch(
  "/admin/:maintenanceWindowId",
  authenticateJWT,
  requireAdmin,
  MaintenanceController.updateWindow
);
router.delete(
  "/admin/:maintenanceWindowId",
  authenticateJWT,
  requireAdmin,
  MaintenanceController.deleteWindow
);

export default router;
