import { Request, Response, NextFunction } from "express";
import SessionService from "../../services/session.service";

// Extend Request type to include session property
declare module "express-serve-static-core" {
  interface Request {
    session?: any;
  }
}

/**
 * Middleware to validate refresh tokens for the /auth/refresh endpoint
 */
const validateRefreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({
        error: {
          message: "Refresh token is required.",
          statusCode: 400,
        },
      });
      return;
    }

    // Validate refresh token
    const session = await SessionService.validateRefreshToken(refreshToken);

    if (!session) {
      res.status(401).json({
        error: {
          message: "Invalid or expired refresh token.",
          statusCode: 401,
        },
      });
      return;
    }

    // Attach session to request for use in the refresh endpoint
    req.session = session;
    next();
  } catch (error) {
    console.log(`[REFRESH AUTH DEBUG] Unexpected error: ${error}`);
    next(error);
  }
};

export default validateRefreshToken;
export { validateRefreshToken };
