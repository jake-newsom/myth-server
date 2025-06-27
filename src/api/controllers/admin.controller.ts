import { Request, Response } from "express";
import SetModel from "../../models/set.model";
import UserModel from "../../models/user.model";
import { AuthenticatedRequest } from "../../types";

const AdminController = {
  async givePacksToUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, quantity } = req.body;

      if (!userId || !quantity) {
        return res.status(400).json({
          status: "error",
          message: "userId and quantity are required",
        });
      }

      if (quantity <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Quantity must be greater than 0",
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      // Add packs to user's inventory
      const updatedUser = await UserModel.addPacks(userId, quantity);

      return res.status(200).json({
        status: "success",
        message: `Successfully gave ${quantity} pack(s) to ${user.username}`,
        data: {
          user_id: updatedUser?.user_id,
          username: updatedUser?.username,
          pack_count: updatedUser?.pack_count,
        },
      });
    } catch (error) {
      console.error("Error giving packs to user:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async setUserPackQuantity(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, quantity } = req.body;

      if (!userId || typeof quantity !== "number") {
        return res.status(400).json({
          status: "error",
          message: "userId and quantity are required",
        });
      }

      if (quantity < 0) {
        return res.status(400).json({
          status: "error",
          message: "Quantity cannot be negative",
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      // Set pack quantity for user
      const updatedUser = await UserModel.setPackCount(userId, quantity);

      return res.status(200).json({
        status: "success",
        message: `Successfully set ${user.username}'s pack quantity to ${quantity}`,
        data: {
          user_id: updatedUser?.user_id,
          username: updatedUser?.username,
          pack_count: updatedUser?.pack_count,
        },
      });
    } catch (error) {
      console.error("Error setting user pack quantity:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async getUserPackCount(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          status: "error",
          message: "User ID is required",
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      const packCount = await UserModel.getPackCount(userId);

      return res.status(200).json({
        status: "success",
        message: `Retrieved pack count for ${user.username}`,
        data: {
          user_id: user.user_id,
          username: user.username,
          pack_count: packCount,
        },
      });
    } catch (error) {
      console.error("Error getting user pack count:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },
};

export default AdminController;
