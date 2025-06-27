// myth-server/src/api/controllers/auth.controller.ts
import { Request, Response, NextFunction } from "express";
import jwt, { Secret, SignOptions } from "jsonwebtoken";
import bcrypt from "bcrypt";
import config from "../../config";
import UserModel from "../../models/user.model";
import StarterService from "../../services/starter.service";
import db from "../../config/db.config";
import { User } from "../../types/database.types";

// Define a more specific User type that includes password_hash
interface UserWithPassword extends User {
  password_hash: string;
}

// Define a type that matches the StringValue type expected by jsonwebtoken
type JwtExpiresIn = number | string;

// Secret key for JWT - with fallback to prevent undefined
const JWT_SECRET: Secret =
  config.jwtSecret || "fallback_dev_secret_do_not_use_in_production";
// Use a more specific type assertion for the string literal
const JWT_EXPIRES_IN = (config.jwtExpiresIn || "1h") as JwtExpiresIn;

// Type guard to check if user has password_hash
function isUserWithPassword(user: any): user is UserWithPassword {
  return user !== null && typeof user === "object" && "password_hash" in user;
}

const AuthController = {
  register: async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
      const { username, email, password } = req.body;

      // Validate input
      if (!username || !email || !password) {
        return res.status(400).json({
          error: { message: "Username, email, and password are required." },
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          error: { message: "Password must be at least 6 characters long." },
        });
      }

      // Check if user already exists
      const existingUserByEmail = await UserModel.findByEmail(email);
      if (existingUserByEmail) {
        return res.status(409).json({
          error: { message: "Email already in use." },
        });
      }

      const existingUserByUsername = await UserModel.findByUsername(username);
      if (existingUserByUsername) {
        return res.status(409).json({
          error: { message: "Username already taken." },
        });
      }

      await client.query("BEGIN");

      // Create user
      const newUser = await UserModel.create({ username, email, password });

      // Grant starter content (cards and deck)
      await StarterService.grantStarterContent(newUser.user_id);

      await client.query("COMMIT");

      const token = jwt.sign({ userId: newUser.user_id }, JWT_SECRET, {
        expiresIn: "7d",
      });

      res.status(201).json({
        token,
        user: {
          user_id: newUser.user_id,
          username: newUser.username,
          email: newUser.email,
          in_game_currency: newUser.in_game_currency,
          gold: newUser.gold,
          gems: newUser.gems,
          fate_coins: newUser.fate_coins,
          total_xp: newUser.total_xp,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },

  login: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          error: { message: "Email and password are required." },
        });
      }

      // Find user by email
      const user = await UserModel.findByEmail(email);
      if (!user) {
        return res.status(401).json({
          error: { message: "Invalid email or password." },
        });
      }

      // Check if user has password_hash field
      if (!isUserWithPassword(user)) {
        return res.status(500).json({
          error: { message: "User data corrupted. Please contact support." },
        });
      }

      // Check password
      const isPasswordValid = await bcrypt.compare(
        password,
        user.password_hash
      );
      if (!isPasswordValid) {
        return res.status(401).json({
          error: { message: "Invalid email or password." },
        });
      }

      // Update last login
      await UserModel.updateLastLogin(user.user_id);

      // Generate JWT
      const token = jwt.sign({ userId: user.user_id }, JWT_SECRET, {
        expiresIn: "7d",
      });

      res.status(200).json({
        token,
        user: {
          user_id: user.user_id,
          username: user.username,
          email: user.email,
          in_game_currency: user.in_game_currency,
          gold: user.gold,
          gems: user.gems,
          fate_coins: user.fate_coins,
          total_xp: user.total_xp,
        },
      });
    } catch (error) {
      next(error);
    }
  },
};

export default AuthController;
