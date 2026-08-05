// myth-server/src/api/controllers/featureFlag.controller.ts

import { Response } from "express";
import { AuthenticatedRequest } from "../../types";
import FeatureFlagService from "../../services/featureFlag.service";
import logger from "../../utils/logger";

/** Postgres unique_violation — a flag with this key already exists. */
const UNIQUE_VIOLATION = "23505";
/** Postgres foreign_key_violation — the referenced user doesn't exist. */
const FK_VIOLATION = "23503";

const FeatureFlagController = {
  // ---- Player endpoints ----------------------------------------------------

  /**
   * The flags that are ON for the calling user. The client branches on this.
   * Returns a bare list of keys rather than the flag rows: descriptions and
   * global state are admin concerns and shouldn't leak to every player.
   */
  async getMyFlags(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const flags = await FeatureFlagService.getEnabledKeysList(userId);
      return res.status(200).json({ data: { flags } });
    } catch (error) {
      logger.error(
        "Error fetching feature flags for user",
        { userId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      // Read failures degrade to "no flags on" rather than erroring the client
      // into a broken state — same fail-safe posture as the service.
      return res.status(200).json({ data: { flags: [] } });
    }
  },

  // ---- Admin endpoints -----------------------------------------------------

  async listFlags(_req: AuthenticatedRequest, res: Response) {
    try {
      const flags = await FeatureFlagService.listFlags();
      return res.status(200).json({ data: flags });
    } catch (error) {
      logger.error(
        "Error listing feature flags",
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to list feature flags" });
    }
  },

  async createFlag(req: AuthenticatedRequest, res: Response) {
    try {
      const { key, description, enabled_globally } = req.body ?? {};

      const keyErrors = FeatureFlagService.validateKey(key);
      if (keyErrors.length > 0) {
        return res.status(400).json({ message: keyErrors[0], errors: keyErrors });
      }
      if (
        enabled_globally !== undefined &&
        typeof enabled_globally !== "boolean"
      ) {
        return res
          .status(400)
          .json({ message: "`enabled_globally` must be a boolean." });
      }

      const flag = await FeatureFlagService.createFlag({
        key,
        description: description ?? null,
        enabled_globally: enabled_globally ?? false,
      });
      return res.status(201).json({ data: flag });
    } catch (error: any) {
      if (error?.code === UNIQUE_VIOLATION) {
        return res
          .status(409)
          .json({ message: "A feature flag with that key already exists." });
      }
      logger.error(
        "Error creating feature flag",
        { key: req.body?.key },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to create feature flag" });
    }
  },

  async getFlag(req: AuthenticatedRequest, res: Response) {
    try {
      const flag = await FeatureFlagService.getFlagById(
        req.params.featureFlagId
      );
      if (!flag) {
        return res.status(404).json({ message: "Feature flag not found." });
      }

      const users = await FeatureFlagService.listUsersForFlag(
        flag.feature_flag_id
      );
      return res.status(200).json({ data: { ...flag, users } });
    } catch (error) {
      logger.error(
        "Error fetching feature flag",
        { featureFlagId: req.params.featureFlagId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to fetch feature flag" });
    }
  },

  /** The "turn it on for everyone" / "turn it back off" switch. */
  async updateFlag(req: AuthenticatedRequest, res: Response) {
    try {
      const { description, enabled_globally } = req.body ?? {};

      if (
        enabled_globally !== undefined &&
        typeof enabled_globally !== "boolean"
      ) {
        return res
          .status(400)
          .json({ message: "`enabled_globally` must be a boolean." });
      }

      const flag = await FeatureFlagService.updateFlag(
        req.params.featureFlagId,
        { description, enabled_globally }
      );
      if (!flag) {
        return res.status(404).json({ message: "Feature flag not found." });
      }
      return res.status(200).json({ data: flag });
    } catch (error) {
      logger.error(
        "Error updating feature flag",
        { featureFlagId: req.params.featureFlagId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to update feature flag" });
    }
  },

  async deleteFlag(req: AuthenticatedRequest, res: Response) {
    try {
      const removed = await FeatureFlagService.deleteFlag(
        req.params.featureFlagId
      );
      if (!removed) {
        return res.status(404).json({ message: "Feature flag not found." });
      }
      return res.status(204).send();
    } catch (error) {
      logger.error(
        "Error deleting feature flag",
        { featureFlagId: req.params.featureFlagId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to delete feature flag" });
    }
  },

  // ---- Admin: per-user overrides -------------------------------------------

  /**
   * Grant (or explicitly deny) a flag to one user — the core of "test the new
   * version on my test account while everyone else keeps the old one".
   */
  async setUserOverride(req: AuthenticatedRequest, res: Response) {
    try {
      const { featureFlagId, userId } = req.params;
      const { enabled, note } = req.body ?? {};

      if (typeof enabled !== "boolean") {
        return res
          .status(400)
          .json({ message: "`enabled` must be a boolean." });
      }

      const flag = await FeatureFlagService.getFlagById(featureFlagId);
      if (!flag) {
        return res.status(404).json({ message: "Feature flag not found." });
      }

      const override = await FeatureFlagService.setUserOverride(
        featureFlagId,
        userId,
        enabled,
        note ?? null
      );
      return res.status(200).json({ data: override });
    } catch (error: any) {
      if (error?.code === FK_VIOLATION) {
        return res.status(404).json({ message: "User not found." });
      }
      logger.error(
        "Error setting feature flag override",
        {
          featureFlagId: req.params.featureFlagId,
          targetUserId: req.params.userId,
        },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to set override" });
    }
  },

  /** Drop the override so the user falls back to the flag's global state. */
  async removeUserOverride(req: AuthenticatedRequest, res: Response) {
    try {
      const { featureFlagId, userId } = req.params;
      const removed = await FeatureFlagService.removeUserOverride(
        featureFlagId,
        userId
      );
      if (!removed) {
        return res.status(404).json({ message: "Override not found." });
      }
      return res.status(204).send();
    } catch (error) {
      logger.error(
        "Error removing feature flag override",
        {
          featureFlagId: req.params.featureFlagId,
          targetUserId: req.params.userId,
        },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to remove override" });
    }
  },

  async listUserOverrides(req: AuthenticatedRequest, res: Response) {
    try {
      const overrides = await FeatureFlagService.listOverridesForUser(
        req.params.userId
      );
      return res.status(200).json({ data: overrides });
    } catch (error) {
      logger.error(
        "Error listing overrides for user",
        { targetUserId: req.params.userId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to list overrides" });
    }
  },

  /** "Is <key> on for <user>, and why?" — for debugging a rollout. */
  async evaluateForUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;
      const key = req.query.key;
      if (typeof key !== "string" || !key.trim()) {
        return res
          .status(400)
          .json({ message: "A `key` query parameter is required." });
      }

      const evaluation = await FeatureFlagService.evaluate(userId, key);
      return res.status(200).json({ data: evaluation });
    } catch (error) {
      logger.error(
        "Error evaluating feature flag for user",
        { targetUserId: req.params.userId, key: req.query?.key },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to evaluate flag" });
    }
  },
};

export default FeatureFlagController;
