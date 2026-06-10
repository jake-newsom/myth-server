import db, { QueryExecutor } from "../config/db.config";
import { CardBack, EquippedCardBack } from "../types/database.types";

export interface CardBackInput {
  code_key: string;
  name: string;
  description?: string | null;
  image_url: string;
  animation_key?: string | null;
}

export interface CardBackUpdate {
  code_key?: string;
  name?: string;
  description?: string | null;
  image_url?: string;
  animation_key?: string | null;
  is_active?: boolean;
}

export interface OwnedCardBackRow extends CardBack {
  acquired_at: Date;
}

function rowToCardBack(row: any): CardBack {
  return {
    back_id: row.back_id,
    code_key: row.code_key,
    name: row.name,
    description: row.description ?? null,
    image_url: row.image_url,
    animation_key: row.animation_key ?? null,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const CardBackModel = {
  async listActive(): Promise<CardBack[]> {
    const { rows } = await db.query(
      `SELECT back_id, code_key, name, description, image_url, animation_key,
              is_active, created_at, updated_at
       FROM "card_backs"
       WHERE is_active = true
       ORDER BY name ASC;`
    );
    return rows.map(rowToCardBack);
  },

  async listAll(): Promise<CardBack[]> {
    const { rows } = await db.query(
      `SELECT back_id, code_key, name, description, image_url, animation_key,
              is_active, created_at, updated_at
       FROM "card_backs"
       ORDER BY is_active DESC, name ASC;`
    );
    return rows.map(rowToCardBack);
  },

  async findById(backId: string): Promise<CardBack | null> {
    const { rows } = await db.query(
      `SELECT back_id, code_key, name, description, image_url, animation_key,
              is_active, created_at, updated_at
       FROM "card_backs"
       WHERE back_id = $1
       LIMIT 1;`,
      [backId]
    );
    return rows[0] ? rowToCardBack(rows[0]) : null;
  },

  async findByCodeKey(codeKey: string): Promise<CardBack | null> {
    const { rows } = await db.query(
      `SELECT back_id, code_key, name, description, image_url, animation_key,
              is_active, created_at, updated_at
       FROM "card_backs"
       WHERE code_key = $1
       LIMIT 1;`,
      [codeKey]
    );
    return rows[0] ? rowToCardBack(rows[0]) : null;
  },

  async create(input: CardBackInput): Promise<CardBack> {
    const { rows } = await db.query(
      `INSERT INTO "card_backs"
         (code_key, name, description, image_url, animation_key, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING back_id, code_key, name, description, image_url, animation_key,
                 is_active, created_at, updated_at;`,
      [
        input.code_key,
        input.name,
        input.description ?? null,
        input.image_url,
        input.animation_key ?? null,
      ]
    );
    return rowToCardBack(rows[0]);
  },

  async update(
    backId: string,
    updates: CardBackUpdate
  ): Promise<CardBack | null> {
    const sets: string[] = [];
    const values: any[] = [backId];
    let idx = 2;
    const assign = (column: string, value: any) => {
      sets.push(`${column} = $${idx}`);
      values.push(value);
      idx++;
    };

    if (updates.code_key !== undefined) assign("code_key", updates.code_key);
    if (updates.name !== undefined) assign("name", updates.name);
    if (updates.description !== undefined)
      assign("description", updates.description);
    if (updates.image_url !== undefined) assign("image_url", updates.image_url);
    if (updates.animation_key !== undefined)
      assign("animation_key", updates.animation_key);
    if (updates.is_active !== undefined) assign("is_active", updates.is_active);

    if (sets.length === 0) return this.findById(backId);
    sets.push("updated_at = NOW()");

    const { rows } = await db.query(
      `UPDATE "card_backs"
       SET ${sets.join(", ")}
       WHERE back_id = $1
       RETURNING back_id, code_key, name, description, image_url, animation_key,
                 is_active, created_at, updated_at;`,
      values
    );
    return rows[0] ? rowToCardBack(rows[0]) : null;
  },

  async softDelete(backId: string): Promise<CardBack | null> {
    return this.update(backId, { is_active: false });
  },

  async grantToUser(
    userId: string,
    backId: string,
    client?: QueryExecutor
  ): Promise<boolean> {
    const exec = client ?? db;
    const { rows } = await exec.query(
      `INSERT INTO "user_owned_card_backs" (user_id, back_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, back_id) DO NOTHING
       RETURNING back_id;`,
      [userId, backId]
    );
    return rows.length > 0;
  },

  async revokeFromUser(userId: string, backId: string): Promise<boolean> {
    await db.query(
      `UPDATE "decks"
       SET equipped_card_back_id = NULL, last_updated = NOW()
       WHERE user_id = $1 AND equipped_card_back_id = $2;`,
      [userId, backId]
    );

    const { rows } = await db.query(
      `DELETE FROM "user_owned_card_backs"
       WHERE user_id = $1 AND back_id = $2
       RETURNING back_id;`,
      [userId, backId]
    );
    return rows.length > 0;
  },

  async listOwnedWithDetails(userId: string): Promise<OwnedCardBackRow[]> {
    const { rows } = await db.query(
      `SELECT cb.back_id, cb.code_key, cb.name, cb.description, cb.image_url,
              cb.animation_key, cb.is_active, cb.created_at, cb.updated_at,
              uob.acquired_at
       FROM "user_owned_card_backs" uob
       JOIN "card_backs" cb ON uob.back_id = cb.back_id
       WHERE uob.user_id = $1 AND cb.is_active = true
       ORDER BY cb.name ASC;`,
      [userId]
    );
    return rows.map((row) => ({
      ...rowToCardBack(row),
      acquired_at: row.acquired_at,
    }));
  },

  async userOwnsBack(userId: string, backId: string): Promise<boolean> {
    const { rows } = await db.query(
      `SELECT 1 FROM "user_owned_card_backs"
       WHERE user_id = $1 AND back_id = $2
       LIMIT 1;`,
      [userId, backId]
    );
    return rows.length > 0;
  },

  async resolveEquippedBackForDeck(
    deckId: string
  ): Promise<EquippedCardBack | null> {
    const { rows } = await db.query(
      `SELECT cb.back_id, cb.code_key, cb.name, cb.image_url, cb.animation_key
       FROM "decks" d
       LEFT JOIN "card_backs" cb ON d.equipped_card_back_id = cb.back_id
       WHERE d.deck_id = $1
       LIMIT 1;`,
      [deckId]
    );
    if (!rows[0] || !rows[0].back_id) return null;
    return {
      back_id: rows[0].back_id,
      code_key: rows[0].code_key,
      name: rows[0].name,
      image_url: rows[0].image_url,
      animation_key: rows[0].animation_key ?? null,
    };
  },
};

export default CardBackModel;
