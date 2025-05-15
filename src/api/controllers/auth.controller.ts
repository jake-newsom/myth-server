// myth-server/src/api/controllers/auth.controller.ts
import { Request, Response, NextFunction } from "express";

// Placeholder for auth controller methods
// Will be implemented in upcoming sections
const AuthController = {
  register: async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(501).json({ message: "Not implemented yet" });
    } catch (error) {
      next(error);
    }
  },

  login: async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(501).json({ message: "Not implemented yet" });
    } catch (error) {
      next(error);
    }
  },
};

export default AuthController;
