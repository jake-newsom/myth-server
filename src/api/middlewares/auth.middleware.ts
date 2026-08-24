// myth-server/src/api/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import SessionService from "../../services/session.service";
import UserModel from "../../models/user.model";
import OnboardingService from "../../services/onboarding.service";

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

      // Banned accounts are cut off here, on every authenticated request.
      // The check is free: findById already returns banned_at, so this adds no
      // query. Sessions are invalidated at ban time too, but this is the
      // backstop that also covers a ban applied directly in the database.
      if (user.banned_at) {
        res.status(403).json({
          error: {
            // `code` lets the client show a real "account suspended" screen
            // instead of bouncing the user through a login loop.
            code: "ACCOUNT_BANNED",
            message:
              user.banned_reason ||
              "This account has been suspended.",
            statusCode: 403,
          },
        });
        return;
      }

      // Update last used timestamp for the session
      await SessionService.updateLastUsed(session.session_id);

      // Add user and session info to request object for use in protected routes
      req.user = user;
      req.sessionId = session.session_id;

      // Advance the onboarding day counter. Deliberately NOT awaited: this
      // must never add latency to a response or turn a working request into a
      // 500. The eligibility check is in-process (created_at is already on the
      // user row), so ineligible users cost nothing here.
      if (user.created_at && OnboardingService.isEligible(user.created_at)) {
        void OnboardingService.tick({
          user_id: user.user_id,
          created_at: user.created_at,
        });
      }

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
