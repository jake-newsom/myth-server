import { Response, NextFunction } from "express";
import PowerUpService from "../../services/powerUp.service";
import { AuthenticatedRequest, ApplyPowerUpRequest } from "../../types";

const PowerUpController = {
  /**
   * Apply a level up boost to a user card
   * @route POST /api/power-ups/apply
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async applyPowerUp(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { message: "User not authenticated." },
        });
        return;
      }

      const { user_card_instance_id, power_up_data } =
        req.body as ApplyPowerUpRequest;

      // Validate required fields
      if (!user_card_instance_id) {
        res.status(400).json({
          success: false,
          error: { message: "user_card_instance_id is required" },
        });
        return;
      }

      if (!power_up_data) {
        res.status(400).json({
          success: false,
          error: { message: "power_up_data is required" },
        });
        return;
      }

      // Validate power_up_data structure
      const { top, bottom, left, right } = power_up_data;
      if (
        typeof top !== "number" ||
        typeof bottom !== "number" ||
        typeof left !== "number" ||
        typeof right !== "number"
      ) {
        res.status(400).json({
          success: false,
          error: {
            message:
              "power_up_data must contain numeric values for top, bottom, left, and right",
          },
        });
        return;
      }

      // Apply the power up
      const result = await PowerUpService.applyPowerUp(req.user.user_id, {
        user_card_instance_id,
        power_up_data,
      });

      if (result.success) {
        res.status(200).json({
          success: true,
          message: result.message,
          data: {
            user_card_instance_id,
            power_up_count: result.power_up_count,
            power_up_data: result.power_up_data,
          },
        });
      } else {
        // Determine appropriate status code based on error type
        let statusCode = 400;
        if (
          result.error?.includes("not found") ||
          result.error?.includes("not owned")
        ) {
          statusCode = 404;
        } else if (result.error?.includes("maximum power ups")) {
          statusCode = 409; // Conflict
        } else if (result.error?.includes("non-negative")) {
          statusCode = 400; // Bad Request for negative values
        }

        res.status(statusCode).json({
          success: false,
          error: { message: result.message },
          details: result.error,
        });
      }
    } catch (error) {
      console.error("Error in applyPowerUp controller:", error);
      next(error);
    }
  },

  /**
   * Get power up information for a specific user card
   * @route GET /api/power-ups/:userCardInstanceId
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getPowerUp(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { message: "User not authenticated." },
        });
        return;
      }

      const { userCardInstanceId } = req.params;

      if (!userCardInstanceId) {
        res.status(400).json({
          success: false,
          error: { message: "userCardInstanceId parameter is required" },
        });
        return;
      }

      // First validate that the user owns this card
      const validation = await PowerUpService.validatePowerUpApplication(
        req.user.user_id,
        userCardInstanceId
      );

      if (!validation.isValid && validation.error?.includes("not found")) {
        res.status(404).json({
          success: false,
          error: { message: "Card not found or not owned by user" },
        });
        return;
      }

      // Get power up data
      const powerUp = await PowerUpService.getPowerUpByCardInstance(
        userCardInstanceId
      );

      if (!powerUp) {
        res.status(200).json({
          success: true,
          message: "No power ups applied to this card",
          data: {
            user_card_instance_id: userCardInstanceId,
            power_up_count: 0,
            power_up_data: { top: 0, bottom: 0, left: 0, right: 0 },
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          user_card_instance_id: powerUp.user_card_instance_id,
          power_up_count: powerUp.power_up_count,
          power_up_data: powerUp.power_up_data,
          created_at: powerUp.created_at,
          updated_at: powerUp.updated_at,
        },
      });
    } catch (error) {
      console.error("Error in getPowerUp controller:", error);
      next(error);
    }
  },

  /**
   * Validate if a power up can be applied to a user card
   * @route GET /api/power-ups/:userCardInstanceId/validate
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async validatePowerUp(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { message: "User not authenticated." },
        });
        return;
      }

      const { userCardInstanceId } = req.params;

      if (!userCardInstanceId) {
        res.status(400).json({
          success: false,
          error: { message: "userCardInstanceId parameter is required" },
        });
        return;
      }

      const validation = await PowerUpService.validatePowerUpApplication(
        req.user.user_id,
        userCardInstanceId
      );

      res.status(200).json({
        success: true,
        data: {
          can_apply_power_up: validation.isValid,
          current_level: validation.current_level,
          current_power_up_count: validation.current_power_up_count,
          error: validation.error,
        },
      });
    } catch (error) {
      console.error("Error in validatePowerUp controller:", error);
      next(error);
    }
  },
};

export default PowerUpController;
