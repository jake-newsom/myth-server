import { Request, Response, NextFunction } from "express";
import SessionService from "../../services/session.service";
import UserModel from "../../models/user.model";

/**
 * If a valid Bearer token is present, attaches req.user (same as protect).
 * Does not fail when the token is missing — for public routes that behave
 * differently for admins (e.g. catalog includes unreleased content).
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      next();
      return;
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      next();
      return;
    }

    const session = await SessionService.validateAccessToken(token);
    if (!session) {
      next();
      return;
    }

    const user = await UserModel.findById(session.user_id);
    if (!user) {
      next();
      return;
    }

    await SessionService.updateLastUsed(session.session_id);
    req.user = user;
    req.sessionId = session.session_id;
    next();
  } catch (error) {
    next(error);
  }
};

export default optionalAuth;
