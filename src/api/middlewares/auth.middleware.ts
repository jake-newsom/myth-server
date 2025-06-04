// myth-server/src/api/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import config from "../../config";
import UserModel from "../../models/user.model";

// Extend Request type to include user property
declare module "express-serve-static-core" {
  interface Request {
    user?: any;
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

    // Verify token
    jwt.verify(token, config.jwtSecret as string, async (err, decoded: any) => {
      if (err) {
        console.log(`[AUTH DEBUG] JWT verification failed: ${err.message}`);
        res.status(401).json({
          error: {
            message: "Authentication failed. Invalid token.",
            statusCode: 401,
          },
        });
        return;
      }

      try {
        // Fetch user from database to ensure they still exist and are valid
        const user = await UserModel.findById(decoded.userId);

        if (!user) {
          res.status(401).json({
            error: {
              message: "Authentication failed. User not found.",
              statusCode: 401,
            },
          });
          return;
        }

        // Add user to request object for use in protected routes
        req.user = user;
        next();
      } catch (error) {
        console.log(`[AUTH DEBUG] Error during user lookup: ${error}`);
        next(error);
      }
    });
  } catch (error) {
    console.log(`[AUTH DEBUG] Unexpected error: ${error}`);
    next(error);
  }
};

// Backwards compatibility
const authenticateJWT = protect;

export { protect, authenticateJWT };
export default { protect, authenticateJWT };
