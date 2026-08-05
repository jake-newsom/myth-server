// myth-server/src/models/featureFlag.model.ts

import db, { QueryExecutor } from "../config/db.config";
import {
  CreateFeatureFlagInput,
  FeatureFlag,
  FeatureFlagWithOverrideCount,
  UpdateFeatureFlagInput,
  UserFeatureFlagOverride,
} from "../types/featureFlag.types";

const FLAG_COLUMNS = `
  feature_flag_id, key, description, enabled_globally, created_at, updated_at
`;

function mapFlag(row: any): FeatureFlag {
  return {
    feature_flag_id: row.feature_flag_id,
    key: row.key,
    description: row.description ?? null,
    enabled_globally: row.enabled_globally,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapOverride(row: any): UserFeatureFlagOverride {
  return {
    feature_flag_id: row.feature_flag_id,
    user_id: row.user_id,
    key: row.key,
    enabled: row.enabled,
    note: row.note ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Keys are matched case-insensitively and ignore surrounding whitespace, so
 * "  New-Tower " and "new-tower" both hit the stored "new-tower".
 */
export function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

const FeatureFlagModel = {
  normalizeKey,

  async findAll(
    executor: QueryExecutor = db
  ): Promise<FeatureFlagWithOverrideCount[]> {
    const result = await executor.query(
      `SELECT f.feature_flag_id, f.key, f.description, f.enabled_globally,
              f.created_at, f.updated_at,
              COUNT(u.user_id) AS override_count
         FROM feature_flags f
         LEFT JOIN user_feature_flags u USING (feature_flag_id)
        GROUP BY f.feature_flag_id
        ORDER BY f.key ASC`
    );
    return result.rows.map((row: any) => ({
      ...mapFlag(row),
      override_count: Number(row.override_count ?? 0),
    }));
  },

  async findByKey(
    key: string,
    executor: QueryExecutor = db
  ): Promise<FeatureFlag | null> {
    const result = await executor.query(
      `SELECT ${FLAG_COLUMNS} FROM feature_flags WHERE key = $1`,
      [normalizeKey(key)]
    );
    return result.rows[0] ? mapFlag(result.rows[0]) : null;
  },

  async findById(
    featureFlagId: string,
    executor: QueryExecutor = db
  ): Promise<FeatureFlag | null> {
    const result = await executor.query(
      `SELECT ${FLAG_COLUMNS} FROM feature_flags WHERE feature_flag_id = $1`,
      [featureFlagId]
    );
    return result.rows[0] ? mapFlag(result.rows[0]) : null;
  },

  async create(
    input: CreateFeatureFlagInput,
    executor: QueryExecutor = db
  ): Promise<FeatureFlag> {
    const result = await executor.query(
      `INSERT INTO feature_flags (key, description, enabled_globally)
       VALUES ($1, $2, $3)
       RETURNING ${FLAG_COLUMNS}`,
      [
        normalizeKey(input.key),
        input.description ?? null,
        input.enabled_globally ?? false,
      ]
    );
    return mapFlag(result.rows[0]);
  },

  /**
   * Partial update: only the fields present in `input` are written, so PATCHing
   * a description can't accidentally reset `enabled_globally` to its default.
   */
  async update(
    featureFlagId: string,
    input: UpdateFeatureFlagInput,
    executor: QueryExecutor = db
  ): Promise<FeatureFlag | null> {
    const sets: string[] = [];
    const values: any[] = [];

    if (input.description !== undefined) {
      values.push(input.description);
      sets.push(`description = $${values.length}`);
    }
    if (input.enabled_globally !== undefined) {
      values.push(input.enabled_globally);
      sets.push(`enabled_globally = $${values.length}`);
    }

    if (sets.length === 0) {
      return this.findById(featureFlagId, executor);
    }

    sets.push(`updated_at = current_timestamp`);
    values.push(featureFlagId);

    const result = await executor.query(
      `UPDATE feature_flags SET ${sets.join(", ")}
        WHERE feature_flag_id = $${values.length}
        RETURNING ${FLAG_COLUMNS}`,
      values
    );
    return result.rows[0] ? mapFlag(result.rows[0]) : null;
  },

  async remove(
    featureFlagId: string,
    executor: QueryExecutor = db
  ): Promise<boolean> {
    // Overrides go with it via ON DELETE CASCADE.
    const result = await executor.query(
      `DELETE FROM feature_flags WHERE feature_flag_id = $1`,
      [featureFlagId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  // ---- Per-user overrides ---------------------------------------------------

  /**
   * All flags that resolve to ON for this user, as a set of keys. One query,
   * used to populate the per-user cache entry and the `GET /me` payload.
   *
   * A user row with enabled = false suppresses a globally-on flag, which is why
   * this is a FULL OUTER-ish join expressed as: take the override when present,
   * else the global value.
   */
  async findEnabledKeysForUser(
    userId: string,
    executor: QueryExecutor = db
  ): Promise<string[]> {
    const result = await executor.query(
      `SELECT f.key
         FROM feature_flags f
         LEFT JOIN user_feature_flags u
                ON u.feature_flag_id = f.feature_flag_id
               AND u.user_id = $1
        WHERE COALESCE(u.enabled, f.enabled_globally) = true
        ORDER BY f.key ASC`,
      [userId]
    );
    return result.rows.map((row: any) => row.key);
  },

  async findOverridesForUser(
    userId: string,
    executor: QueryExecutor = db
  ): Promise<UserFeatureFlagOverride[]> {
    const result = await executor.query(
      `SELECT u.feature_flag_id, u.user_id, f.key, u.enabled, u.note,
              u.created_at, u.updated_at
         FROM user_feature_flags u
         JOIN feature_flags f USING (feature_flag_id)
        WHERE u.user_id = $1
        ORDER BY f.key ASC`,
      [userId]
    );
    return result.rows.map(mapOverride);
  },

  async findUsersForFlag(
    featureFlagId: string,
    executor: QueryExecutor = db
  ): Promise<UserFeatureFlagOverride[]> {
    const result = await executor.query(
      `SELECT u.feature_flag_id, u.user_id, f.key, u.enabled, u.note,
              u.created_at, u.updated_at
         FROM user_feature_flags u
         JOIN feature_flags f USING (feature_flag_id)
        WHERE u.feature_flag_id = $1
        ORDER BY u.created_at ASC`,
      [featureFlagId]
    );
    return result.rows.map(mapOverride);
  },

  async setUserOverride(
    featureFlagId: string,
    userId: string,
    enabled: boolean,
    note: string | null,
    executor: QueryExecutor = db
  ): Promise<UserFeatureFlagOverride> {
    const result = await executor.query(
      `INSERT INTO user_feature_flags (feature_flag_id, user_id, enabled, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (feature_flag_id, user_id) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             note = EXCLUDED.note,
             updated_at = current_timestamp
       RETURNING feature_flag_id, user_id, enabled, note, created_at, updated_at`,
      [featureFlagId, userId, enabled, note]
    );
    const flag = await this.findById(featureFlagId, executor);
    return mapOverride({ ...result.rows[0], key: flag?.key });
  },

  async removeUserOverride(
    featureFlagId: string,
    userId: string,
    executor: QueryExecutor = db
  ): Promise<boolean> {
    const result = await executor.query(
      `DELETE FROM user_feature_flags
        WHERE feature_flag_id = $1 AND user_id = $2`,
      [featureFlagId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },
};

export default FeatureFlagModel;
