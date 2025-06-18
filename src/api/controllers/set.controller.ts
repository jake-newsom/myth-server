import { Request, Response } from "express";
import SetModel from "../../models/set.model";

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    username: string;
    email: string;
  };
}

const SetController = {
  async getAllSets(req: Request, res: Response) {
    try {
      const sets = await SetModel.findAll();

      return res.status(200).json({
        status: "success",
        message: "Sets retrieved successfully",
        data: sets,
      });
    } catch (error) {
      console.error("Error getting sets:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async getReleasedSets(req: Request, res: Response) {
    try {
      const sets = await SetModel.findReleased();

      return res.status(200).json({
        status: "success",
        message: "Released sets retrieved successfully",
        data: sets,
      });
    } catch (error) {
      console.error("Error getting released sets:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async getSetById(req: Request, res: Response) {
    try {
      const { setId } = req.params;

      if (!setId) {
        return res.status(400).json({
          status: "error",
          message: "Set ID is required",
        });
      }

      const set = await SetModel.findById(setId);

      if (!set) {
        return res.status(404).json({
          status: "error",
          message: "Set not found",
        });
      }

      // Get card count for this set
      const cardCount = await SetModel.getCardCount(setId);

      return res.status(200).json({
        status: "success",
        message: "Set retrieved successfully",
        data: {
          ...set,
          cardCount,
        },
      });
    } catch (error) {
      console.error("Error getting set:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async createSet(req: AuthenticatedRequest, res: Response) {
    try {
      const { name, description, is_released } = req.body;

      if (!name) {
        return res.status(400).json({
          status: "error",
          message: "Set name is required",
        });
      }

      // Check if set with this name already exists
      const existingSet = await SetModel.findByName(name);
      if (existingSet) {
        return res.status(400).json({
          status: "error",
          message: "A set with this name already exists",
        });
      }

      const newSet = await SetModel.create({
        name,
        description,
        is_released: is_released || false,
      });

      return res.status(201).json({
        status: "success",
        message: "Set created successfully",
        data: newSet,
      });
    } catch (error) {
      console.error("Error creating set:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async updateSet(req: AuthenticatedRequest, res: Response) {
    try {
      const { setId } = req.params;
      const updates = req.body;

      if (!setId) {
        return res.status(400).json({
          status: "error",
          message: "Set ID is required",
        });
      }

      const updatedSet = await SetModel.update(setId, updates);

      if (!updatedSet) {
        return res.status(404).json({
          status: "error",
          message: "Set not found",
        });
      }

      return res.status(200).json({
        status: "success",
        message: "Set updated successfully",
        data: updatedSet,
      });
    } catch (error) {
      console.error("Error updating set:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async updateReleaseStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const { setId } = req.params;
      const { is_released } = req.body;

      if (!setId) {
        return res.status(400).json({
          status: "error",
          message: "Set ID is required",
        });
      }

      if (typeof is_released !== "boolean") {
        return res.status(400).json({
          status: "error",
          message: "is_released must be a boolean value",
        });
      }

      const updatedSet = await SetModel.updateReleaseStatus(setId, is_released);

      if (!updatedSet) {
        return res.status(404).json({
          status: "error",
          message: "Set not found",
        });
      }

      return res.status(200).json({
        status: "success",
        message: `Set ${is_released ? "released" : "unreleased"} successfully`,
        data: updatedSet,
      });
    } catch (error) {
      console.error("Error updating set release status:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async deleteSet(req: AuthenticatedRequest, res: Response) {
    try {
      const { setId } = req.params;

      if (!setId) {
        return res.status(400).json({
          status: "error",
          message: "Set ID is required",
        });
      }

      const deleted = await SetModel.delete(setId);

      if (!deleted) {
        return res.status(404).json({
          status: "error",
          message: "Set not found",
        });
      }

      return res.status(200).json({
        status: "success",
        message: "Set deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting set:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },
};

export default SetController;
