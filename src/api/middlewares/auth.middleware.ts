// myth-server/src/api/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import SessionService from "../../services/session.service";
import UserModel from "../../models/user.model";

// Extend Request type to include user and sessionId properties
declare module "express-serve-static-core" {
  interface Request {
    user?: any;
    sessionId?: string;
  }
}

const protect = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: {
          message: "Authentication failed. Token not provided.",
          statusCode: 401,
        },
      });
      return;
    }

    // Get token from "Bearer <token>"
    const token = authHeader.split(" ")[1];

    if (!token) {
      res.status(401).json({
        error: {
          message: "Authentication failed. Token not provided.",
          statusCode: 401,
        },
      });
      return;
    }

    // Validate access token using session service
    const session = await SessionService.validateAccessToken(token);

    if (!session) {
      console.log(`[AUTH DEBUG] Session validation failed for token`);
      res.status(401).json({
        error: {
          message: "Authentication failed. Invalid or expired token.",
          statusCode: 401,
        },
      });
      return;
    }

    try {
      // Fetch user from database to ensure they still exist and are valid
      const user = await UserModel.findById(session.user_id);

      if (!user) {
        res.status(401).json({
          error: {
            message: "Authentication failed. User not found.",
            statusCode: 401,
          },
        });
        return;
      }

      // Update last used timestamp for the session
      await SessionService.updateLastUsed(session.session_id);

      // Add user and session info to request object for use in protected routes
      req.user = user;
      req.sessionId = session.session_id;
      next();
    } catch (error) {
      console.log(`[AUTH DEBUG] Error during user lookup: ${error}`);
      next(error);
    }
  } catch (error) {
    console.log(`[AUTH DEBUG] Unexpected error: ${error}`);
    next(error);
  }
};

// Backwards compatibility
const authenticateJWT = protect;

export { protect, authenticateJWT };
export default { protect, authenticateJWT };
