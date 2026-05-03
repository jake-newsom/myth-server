import { Router } from "express";
import BorderController from "../controllers/border.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

/**
 * Border catalog and ownership routes (user-facing).
 *
 * Equip / unequip operations live under `/api/user-cards/...` since they
 * mutate the card instance, not the border itself. Admin-only mutations
 * (catalog CRUD, grant/revoke) live under `/api/admin/borders/...`.
 */

router.get("/", authenticateJWT, BorderController.listActiveBorders);
router.get("/owned", authenticateJWT, BorderController.listOwnedBorders);

export default router;
