import db from "../config/db.config";
import {
  PowerValues,
  UserCardPowerUp,
  ApplyPowerUpRequest,
  ApplyPowerUpResult,
  PowerUpValidationResult,
} from "../types";
import logger from "../utils/logger";

class PowerUpService {
  /**
   * Validates if a power up can be applied to a user card
   * @param userId - The user ID
   * @param userCardInstanceId - The user card instance ID
   * @returns PowerUpValidationResult
   */
  async validatePowerUpApplication(
    userId: string,
    userCardInstanceId: string
  ): Promise<PowerUpValidationResult> {
    try {
      // First, verify the user owns this card
      const cardOwnershipQuery = `
        SELECT level, user_id
        FROM user_owned_cards
        WHERE user_card_instance_id = $1 AND user_id = $2
      `;
      const cardResult = await db.query(cardOwnershipQuery, [
        userCardInstanceId,
        userId,
      ]);

      if (cardResult.rows.length === 0) {
        return {
          isValid: false,
          error: "Card not found or not owned by user",
        };
      }

      const cardLevel = cardResult.rows[0].level;

      // Check current power up count
      const powerUpQuery = `
        SELECT power_up_count
        FROM user_card_power_ups
        WHERE user_card_instance_id = $1
      `;
      const powerUpResult = await db.query(powerUpQuery, [userCardInstanceId]);

      const currentPowerUpCount =
        powerUpResult.rows.length > 0
          ? powerUpResult.rows[0].power_up_count
          : 0;

      // Cards can only have (level - 1) power ups
      const maxPowerUps = cardLevel - 1;
      if (currentPowerUpCount >= maxPowerUps) {
        return {
          isValid: false,
          error: `Card already has maximum power ups for its level (${cardLevel}). Maximum allowed: ${maxPowerUps}, Current power ups: ${currentPowerUpCount}`,
          current_level: cardLevel,
          current_power_up_count: currentPowerUpCount,
        };
      }

      return {
        isValid: true,
        current_level: cardLevel,
        current_power_up_count: currentPowerUpCount,
      };
    } catch (error) {
      console.error("Error validating power up application:", error);
      return {
        isValid: false,
        error: "Failed to validate power up application",
      };
    }
  }

  /**
   * Applies a power up to a user card
   * @param userId - The user ID
   * @param request - The power up application request
   * @returns ApplyPowerUpResult
   */
  async applyPowerUp(
    userId: string,
    request: ApplyPowerUpRequest
  ): Promise<ApplyPowerUpResult> {
    try {
      // Validate the power up application
      const validation = await this.validatePowerUpApplication(
        userId,
        request.user_card_instance_id
      );

      if (!validation.isValid) {
        return {
          success: false,
          message: validation.error || "Invalid power up application",
          error: validation.error,
        };
      }

      // Validate power up data format
      const { top, bottom, left, right } = request.power_up_data;
      if (
        typeof top !== "number" ||
        typeof bottom !== "number" ||
        typeof left !== "number" ||
        typeof right !== "number"
      ) {
        return {
          success: false,
          message: "Invalid power up data format",
          error:
            "Power up data must contain numeric values for top, bottom, left, and right",
        };
      }

      // Validate that all power up values are non-negative (no reductions allowed)
      if (top < 0 || bottom < 0 || left < 0 || right < 0) {
        return {
          success: false,
          message: "Invalid power up values",
          error:
            "All power up values must be non-negative. Power ups can only add to existing values, not reduce them.",
        };
      }

      // Check if power up record exists
      const existingPowerUpQuery = `
        SELECT id, power_up_count, power_up_data
        FROM user_card_power_ups
        WHERE user_card_instance_id = $1
      `;
      const existingResult = await db.query(existingPowerUpQuery, [
        request.user_card_instance_id,
      ]);

      let newPowerUpCount: number;
      let newPowerUpData: PowerValues;

      if (existingResult.rows.length > 0) {
        // Update existing power up record
        const existing = existingResult.rows[0];
        newPowerUpCount = existing.power_up_count + 1;

        // Merge the new power up data with existing
        const existingData = existing.power_up_data;
        newPowerUpData = {
          top: existingData.top + request.power_up_data.top,
          bottom: existingData.bottom + request.power_up_data.bottom,
          left: existingData.left + request.power_up_data.left,
          right: existingData.right + request.power_up_data.right,
        };

        const updateQuery = `
          UPDATE user_card_power_ups
          SET power_up_count = $1, power_up_data = $2, updated_at = NOW()
          WHERE user_card_instance_id = $3
          RETURNING *
        `;
        await db.query(updateQuery, [
          newPowerUpCount,
          JSON.stringify(newPowerUpData),
          request.user_card_instance_id,
        ]);
      } else {
        // Create new power up record
        newPowerUpCount = 1;
        newPowerUpData = request.power_up_data;

        const insertQuery = `
          INSERT INTO user_card_power_ups (user_card_instance_id, power_up_count, power_up_data)
          VALUES ($1, $2, $3)
          RETURNING *
        `;
        await db.query(insertQuery, [
          request.user_card_instance_id,
          newPowerUpCount,
          JSON.stringify(newPowerUpData),
        ]);
      }

      return {
        success: true,
        message: `Power up applied successfully! Card now has ${newPowerUpCount} power up(s).`,
        power_up_count: newPowerUpCount,
        power_up_data: newPowerUpData,
      };
    } catch (error) {
      console.error("Error applying power up:", error);
      return {
        success: false,
        message: "Failed to apply power up",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Gets power up data for a user card
   * @param userCardInstanceId - The user card instance ID
   * @returns UserCardPowerUp or null
   */
  async getPowerUpByCardInstance(
    userCardInstanceId: string
  ): Promise<UserCardPowerUp | null> {
    try {
      const query = `
        SELECT id, user_card_instance_id, power_up_count, power_up_data, created_at, updated_at
        FROM user_card_power_ups
        WHERE user_card_instance_id = $1
      `;
      const result = await db.query(query, [userCardInstanceId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        user_card_instance_id: row.user_card_instance_id,
        power_up_count: row.power_up_count,
        power_up_data: row.power_up_data,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    } catch (error) {
      console.error("Error fetching power up data:", error);
      return null;
    }
  }

  /**
   * Gets power up data for multiple user cards
   * @param userCardInstanceIds - Array of user card instance IDs
   * @returns Map of userCardInstanceId to UserCardPowerUp
   */
  async getPowerUpsByCardInstances(
    userCardInstanceIds: string[]
  ): Promise<Map<string, UserCardPowerUp>> {
    const powerUpsMap = new Map<string, UserCardPowerUp>();

    if (userCardInstanceIds.length === 0) {
      return powerUpsMap;
    }

    try {
      const placeholders = userCardInstanceIds
        .map((_, index) => `$${index + 1}`)
        .join(", ");

      const query = `
        SELECT id, user_card_instance_id, power_up_count, power_up_data, created_at, updated_at
        FROM user_card_power_ups
        WHERE user_card_instance_id IN (${placeholders})
      `;

      const result = await db.query(query, userCardInstanceIds);

      result.rows.forEach((row) => {
        powerUpsMap.set(row.user_card_instance_id, {
          id: row.id,
          user_card_instance_id: row.user_card_instance_id,
          power_up_count: row.power_up_count,
          power_up_data: row.power_up_data,
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      });

      return powerUpsMap;
    } catch (error) {
      logger.error(
        "Error fetching power ups data",
        {
          instanceCount: userCardInstanceIds.length,
        },
        error instanceof Error ? error : new Error(String(error))
      );
      return powerUpsMap;
    }
  }
}

export default new PowerUpService();
