import db from "../config/db.config";
import { Set } from "../types/database.types";

interface SetCreateInput {
  name: string;
  description?: string;
  image_url?: string;
  is_released?: boolean;
}

const SetModel = {
  async create({
    name,
    description,
    image_url,
    is_released = false,
  }: SetCreateInput): Promise<Set> {
    const query = `
      INSERT INTO "sets" (name, description, image_url, is_released, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING set_id, name, description, image_url, is_released, created_at, updated_at;
    `;
    const values = [name, description, image_url, is_released];
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  async findAll(): Promise<Set[]> {
    const query = `
      SELECT set_id, name, description, image_url, is_released, created_at, updated_at 
      FROM "sets" 
      ORDER BY name;
    `;
    const { rows } = await db.query(query);
    return rows;
  },

  async findReleased(): Promise<Set[]> {
    const query = `
      SELECT set_id, name, description, image_url, is_released, created_at, updated_at 
      FROM "sets" 
      WHERE is_released = true 
      ORDER BY name;
    `;
    const { rows } = await db.query(query);
    return rows;
  },

  async findById(setId: string): Promise<Set | null> {
    const query = `
      SELECT set_id, name, description, image_url, is_released, created_at, updated_at 
      FROM "sets" 
      WHERE set_id = $1;
    `;
    const { rows } = await db.query(query, [setId]);
    return rows[0] || null;
  },

  async findByName(name: string): Promise<Set | null> {
    const query = `
      SELECT set_id, name, description, image_url, is_released, created_at, updated_at 
      FROM "sets" 
      WHERE name = $1;
    `;
    const { rows } = await db.query(query, [name]);
    return rows[0] || null;
  },

  async updateReleaseStatus(
    setId: string,
    isReleased: boolean
  ): Promise<Set | null> {
    const query = `
      UPDATE "sets" 
      SET is_released = $2, updated_at = NOW() 
      WHERE set_id = $1
      RETURNING set_id, name, description, image_url, is_released, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [setId, isReleased]);
    return rows[0] || null;
  },

  async update(
    setId: string,
    updates: Partial<SetCreateInput>
  ): Promise<Set | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramCount++}`);
      values.push(updates.description);
    }
    if (updates.image_url !== undefined) {
      fields.push(`image_url = $${paramCount++}`);
      values.push(updates.image_url);
    }
    if (updates.is_released !== undefined) {
      fields.push(`is_released = $${paramCount++}`);
      values.push(updates.is_released);
    }

    if (fields.length === 0) {
      return this.findById(setId);
    }

    fields.push(`updated_at = NOW()`);
    values.push(setId);

    const query = `
      UPDATE "sets" 
      SET ${fields.join(", ")} 
      WHERE set_id = $${paramCount}
      RETURNING set_id, name, description, image_url, is_released, created_at, updated_at;
    `;

    const { rows } = await db.query(query, values);
    return rows[0] || null;
  },

  async delete(setId: string): Promise<boolean> {
    const query = `DELETE FROM "sets" WHERE set_id = $1;`;
    const result = await db.query(query, [setId]);
    return (result.rowCount ?? 0) > 0;
  },

  async getCardCount(setId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count 
      FROM "card_variants" cv 
      JOIN "characters" ch ON cv.character_id = ch.character_id 
      WHERE ch.set_id = $1;
    `;
    const { rows } = await db.query(query, [setId]);
    return parseInt(rows[0].count, 10);
  },
};

export default SetModel;
