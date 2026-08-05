// myth-server/src/models/promoCode.model.ts

import db, { QueryExecutor } from "../config/db.config";
import {
  CreatePromoCodeInput,
  PromoCode,
  PromoCodeRedemption,
  PromoRewardSpec,
  UpdatePromoCodeInput,
} from "../types/promo.types";

const PROMO_COLUMNS = `
  promo_code_id, code, description, rewards, max_claims, claim_count,
  is_active, starts_at, expires_at, created_at, updated_at
`;

function mapRow(row: any): PromoCode {
  return {
    promo_code_id: row.promo_code_id,
    code: row.code,
    description: row.description ?? null,
    // jsonb comes back parsed; guard against a hand-edited scalar.
    rewards: Array.isArray(row.rewards)
      ? (row.rewards as PromoRewardSpec[])
      : [],
    max_claims: row.max_claims ?? null,
    claim_count: Number(row.claim_count ?? 0),
    is_active: row.is_active,
    starts_at: row.starts_at ?? null,
    expires_at: row.expires_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Codes are matched case-insensitively and ignore surrounding whitespace, so
 * "  wintergift " and "WinterGift" both hit the stored "WINTERGIFT".
 */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const PromoCodeModel = {
  normalizeCode,

  async findByCode(
    code: string,
    executor: QueryExecutor = db
  ): Promise<PromoCode | null> {
    const result = await executor.query(
      `SELECT ${PROMO_COLUMNS} FROM promo_codes WHERE upper(code) = $1`,
      [normalizeCode(code)]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async findById(
    promoCodeId: string,
    executor: QueryExecutor = db
  ): Promise<PromoCode | null> {
    const result = await executor.query(
      `SELECT ${PROMO_COLUMNS} FROM promo_codes WHERE promo_code_id = $1`,
      [promoCodeId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async list(
    filters: { includeInactive?: boolean; limit?: number; offset?: number } = {},
    executor: QueryExecutor = db
  ): Promise<PromoCode[]> {
    const { includeInactive = true, limit = 100, offset = 0 } = filters;
    const where = includeInactive ? "" : "WHERE is_active = true";
    const result = await executor.query(
      `SELECT ${PROMO_COLUMNS} FROM promo_codes ${where}
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows.map(mapRow);
  },

  async create(
    input: CreatePromoCodeInput,
    executor: QueryExecutor = db
  ): Promise<PromoCode> {
    const result = await executor.query(
      `INSERT INTO promo_codes
         (code, description, rewards, max_claims, is_active, starts_at, expires_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
       RETURNING ${PROMO_COLUMNS}`,
      [
        normalizeCode(input.code),
        input.description ?? null,
        JSON.stringify(input.rewards ?? []),
        input.max_claims ?? null,
        input.is_active ?? true,
        input.starts_at ?? null,
        input.expires_at ?? null,
      ]
    );
    return mapRow(result.rows[0]);
  },

  async update(
    promoCodeId: string,
    input: UpdatePromoCodeInput,
    executor: QueryExecutor = db
  ): Promise<PromoCode | null> {
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;

    const push = (fragment: string, value: any) => {
      sets.push(`${fragment} = $${i++}`);
      params.push(value);
    };

    if (input.code !== undefined) push("code", normalizeCode(input.code));
    if (input.description !== undefined)
      push("description", input.description ?? null);
    if (input.rewards !== undefined) {
      sets.push(`rewards = $${i++}::jsonb`);
      params.push(JSON.stringify(input.rewards));
    }
    if (input.max_claims !== undefined)
      push("max_claims", input.max_claims ?? null);
    if (input.is_active !== undefined) push("is_active", input.is_active);
    if (input.starts_at !== undefined) push("starts_at", input.starts_at ?? null);
    if (input.expires_at !== undefined)
      push("expires_at", input.expires_at ?? null);

    if (sets.length === 0) {
      return this.findById(promoCodeId, executor);
    }

    sets.push("updated_at = now()");
    params.push(promoCodeId);

    const result = await executor.query(
      `UPDATE promo_codes SET ${sets.join(", ")}
       WHERE promo_code_id = $${i}
       RETURNING ${PROMO_COLUMNS}`,
      params
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async delete(
    promoCodeId: string,
    executor: QueryExecutor = db
  ): Promise<boolean> {
    const result = await executor.query(
      `DELETE FROM promo_codes WHERE promo_code_id = $1`,
      [promoCodeId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Atomically reserve one claim of a code.
   *
   * The WHERE clause re-checks every validity condition (active, in window,
   * under max_claims) as part of the UPDATE, so concurrent redemptions can
   * never push claim_count past max_claims — the row lock serializes them and
   * the loser's WHERE fails. Returns the updated code, or null if the claim
   * could not be reserved (caller then re-reads the row to say *why*).
   *
   * Must run inside the caller's transaction so it rolls back with the grant.
   */
  async reserveClaim(
    promoCodeId: string,
    executor: QueryExecutor
  ): Promise<PromoCode | null> {
    const result = await executor.query(
      `UPDATE promo_codes
          SET claim_count = claim_count + 1,
              updated_at = now()
        WHERE promo_code_id = $1
          AND is_active = true
          AND (starts_at IS NULL OR starts_at <= now())
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_claims IS NULL OR claim_count < max_claims)
        RETURNING ${PROMO_COLUMNS}`,
      [promoCodeId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  /**
   * Record a user's redemption. The composite primary key enforces one claim
   * per user; on conflict we return null so the caller can roll back the
   * reserved claim and report `already_redeemed`.
   */
  async insertRedemption(
    promoCodeId: string,
    userId: string,
    granted: unknown[],
    executor: QueryExecutor
  ): Promise<PromoCodeRedemption | null> {
    const result = await executor.query(
      `INSERT INTO promo_code_redemptions (promo_code_id, user_id, granted)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (promo_code_id, user_id) DO NOTHING
       RETURNING promo_code_id, user_id, granted, redeemed_at`,
      [promoCodeId, userId, JSON.stringify(granted)]
    );
    return result.rows[0] ?? null;
  },

  async hasRedeemed(
    promoCodeId: string,
    userId: string,
    executor: QueryExecutor = db
  ): Promise<boolean> {
    const result = await executor.query(
      `SELECT 1 FROM promo_code_redemptions
        WHERE promo_code_id = $1 AND user_id = $2`,
      [promoCodeId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async listRedemptions(
    promoCodeId: string,
    filters: { limit?: number; offset?: number } = {},
    executor: QueryExecutor = db
  ): Promise<Array<PromoCodeRedemption & { username: string | null }>> {
    const { limit = 100, offset = 0 } = filters;
    const result = await executor.query(
      `SELECT r.promo_code_id, r.user_id, r.granted, r.redeemed_at, u.username
         FROM promo_code_redemptions r
         LEFT JOIN users u ON u.user_id = r.user_id
        WHERE r.promo_code_id = $1
        ORDER BY r.redeemed_at DESC
        LIMIT $2 OFFSET $3`,
      [promoCodeId, limit, offset]
    );
    return result.rows;
  },
};

export default PromoCodeModel;
