import db from "../config/db.config";
import {
  PowerValues,
  UserCardPowerUp,
  ApplyPowerUpRequest,
  ApplyPowerUpResult,
  PowerUpValidationResult,
} from "../types";
import logger from "../utils/logger";
import { cacheInvalidation } from "./cache.invalidation.service";

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

      // Validate that all values are integers
      if (
        !Number.isInteger(top) ||
        !Number.isInteger(bottom) ||
        !Number.isInteger(left) ||
        !Number.isInteger(right)
      ) {
        return {
          success: false,
          message: "Invalid power up values",
          error: "All power up values must be whole numbers.",
        };
      }

      // Each power-up application must distribute exactly 1 point total
      const totalPoints = top + bottom + left + right;
      if (totalPoints !== 1) {
        return {
          success: false,
          message: "Invalid power up distribution",
          error: `Each power up must add exactly 1 point total across all sides. Received ${totalPoints}.`,
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

      // Invalidate user's card cache since power enhancements changed
      await cacheInvalidation.invalidateAfterPowerEnhancement(userId);

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
   * Gets aggregated power-up distribution statistics for a character across all
   * of its card variant rarities (common, rare, epic, legendary, +, ++, +++).
   *
   * Accepts a card_variant_id (what the API calls base_card_id / card_id) and
   * resolves it to the underlying character_id so stats cover every rarity variant
   * of that character.
   *
   * Returns two complementary views:
   *  - aggregate_distribution: share of every point ever spent, weighted by total investment per card
   *  - average_distribution:   each card instance's own split averaged equally (what a "typical" card looks like)
   */
  async getCardPowerUpStats(cardVariantId: string): Promise<{
    character_id: string;
    sample_size: number;
    totals: PowerValues;
    aggregate_distribution: PowerValues;
    average_distribution: PowerValues;
  }> {
    const query = `
      WITH instances AS (
        SELECT
          (ucp.power_up_data->>'top')::int    AS t,
          (ucp.power_up_data->>'bottom')::int AS b,
          (ucp.power_up_data->>'left')::int   AS l,
          (ucp.power_up_data->>'right')::int  AS r
        FROM user_card_power_ups ucp
        JOIN user_owned_cards uoc ON ucp.user_card_instance_id = uoc.user_card_instance_id
        JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
        WHERE cv.character_id = (
          SELECT character_id FROM card_variants WHERE card_variant_id = $1
        )
          AND uoc.user_id != '00000000-0000-0000-0000-000000000000'
          AND (
            (ucp.power_up_data->>'top')::int
            + (ucp.power_up_data->>'bottom')::int
            + (ucp.power_up_data->>'left')::int
            + (ucp.power_up_data->>'right')::int
          ) > 0
      ),
      totals AS (
        SELECT
          COALESCE(SUM(t), 0) AS total_top,
          COALESCE(SUM(b), 0) AS total_bottom,
          COALESCE(SUM(l), 0) AS total_left,
          COALESCE(SUM(r), 0) AS total_right,
          COUNT(*)            AS sample_size
        FROM instances
      ),
      per_instance_pct AS (
        SELECT
          t::float / NULLIF(t + b + l + r, 0) AS pct_top,
          b::float / NULLIF(t + b + l + r, 0) AS pct_bottom,
          l::float / NULLIF(t + b + l + r, 0) AS pct_left,
          r::float / NULLIF(t + b + l + r, 0) AS pct_right
        FROM instances
      ),
      averages AS (
        SELECT
          COALESCE(AVG(pct_top),    0) AS avg_top,
          COALESCE(AVG(pct_bottom), 0) AS avg_bottom,
          COALESCE(AVG(pct_left),   0) AS avg_left,
          COALESCE(AVG(pct_right),  0) AS avg_right
        FROM per_instance_pct
      )
      SELECT
        t.total_top, t.total_bottom, t.total_left, t.total_right, t.sample_size,
        a.avg_top, a.avg_bottom, a.avg_left, a.avg_right,
        (SELECT character_id FROM card_variants WHERE card_variant_id = $1) AS character_id
      FROM totals t, averages a
    `;

    const result = await db.query(query, [cardVariantId]);
    const row = result.rows[0];

    const resolvedCharacterId: string = row.character_id ?? cardVariantId;
    const sampleSize = parseInt(row.sample_size, 10);
    const zero: PowerValues = { top: 0, bottom: 0, left: 0, right: 0 };

    if (sampleSize === 0) {
      return {
        character_id: resolvedCharacterId,
        sample_size: 0,
        totals: zero,
        aggregate_distribution: zero,
        average_distribution: zero,
      };
    }

    const totals: PowerValues = {
      top: parseInt(row.total_top, 10),
      bottom: parseInt(row.total_bottom, 10),
      left: parseInt(row.total_left, 10),
      right: parseInt(row.total_right, 10),
    };

    const grand = totals.top + totals.bottom + totals.left + totals.right;
    const round4 = (n: number) => Math.round(n * 10000) / 10000;

    const aggregate_distribution: PowerValues =
      grand > 0
        ? {
            top: round4(totals.top / grand),
            bottom: round4(totals.bottom / grand),
            left: round4(totals.left / grand),
            right: round4(totals.right / grand),
          }
        : zero;

    const average_distribution: PowerValues = {
      top: round4(parseFloat(row.avg_top)),
      bottom: round4(parseFloat(row.avg_bottom)),
      left: round4(parseFloat(row.avg_left)),
      right: round4(parseFloat(row.avg_right)),
    };

    return {
      character_id: resolvedCharacterId,
      sample_size: sampleSize,
      totals,
      aggregate_distribution,
      average_distribution,
    };
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
