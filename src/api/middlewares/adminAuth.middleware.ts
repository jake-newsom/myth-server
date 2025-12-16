import { Request, Response, NextFunction } from "express";
import logger from "../../utils/logger";

/**
 * Middleware to check if the authenticated user has admin role.
 * Must be used AFTER authenticateJWT middleware.
 */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      logger.warn("Admin access attempted without authentication");
      res.status(401).json({
        error: {
          message: "Authentication required.",
          statusCode: 401,
        },
      });
      return;
    }

    // Check if user has admin role
    if (req.user.role !== "admin") {
      logger.warn("Admin access denied", {
        userId: req.user.user_id,
        username: req.user.username,
        attemptedRoute: req.path,
      });
      res.status(403).json({
        error: {
          message: "Admin access required.",
          statusCode: 403,
        },
      });
      return;
    }

    // Log admin action for audit trail
    logger.info("Admin access granted", {
      userId: req.user.user_id,
      username: req.user.username,
      route: req.path,
      method: req.method,
    });

    next();
  } catch (error) {
    logger.error(
      "Error in admin authorization middleware",
      { route: req.path },
      error instanceof Error ? error : new Error(String(error))
    );
    next(error);
  }
};

export default requireAdmin;
