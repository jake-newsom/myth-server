import db from "../config/db.config";
import { Pack, PackWithCardCount } from "../types/database.types";

interface PackCreateInput {
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  is_released?: boolean;
  released_at?: Date | null;
  sort_order?: number;
}

const PACK_COLUMNS = `
  pack_id, name, slug, description, image_url,
  is_released, released_at, sort_order, created_at, updated_at
`;

const PackModel = {
  async create({
    name,
    slug,
    description,
    image_url,
    is_released = false,
    released_at = null,
    sort_order = 0,
  }: PackCreateInput): Promise<Pack> {
    const query = `
      INSERT INTO "packs"
        (name, slug, description, image_url, is_released, released_at, sort_order, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING ${PACK_COLUMNS};
    `;
    const { rows } = await db.query(query, [
      name,
      slug,
      description,
      image_url,
      is_released,
      released_at,
      sort_order,
    ]);
    return rows[0];
  },

  async findAll(): Promise<Pack[]> {
    const query = `
      SELECT ${PACK_COLUMNS} FROM "packs"
      ORDER BY sort_order, name;
    `;
    const { rows } = await db.query(query);
    return rows;
  },

  /**
   * Packs the shop may show: flagged released AND past their release date.
   * A NULL released_at means "no schedule", i.e. available as soon as the
   * flag is on.
   */
  async findAvailable(): Promise<PackWithCardCount[]> {
    const query = `
      SELECT ${PACK_COLUMNS.split(",")
        .map((c) => `p.${c.trim()}`)
        .join(", ")},
        -- Counts ch, not cv: a variant whose character is still unreleased
        -- leaves ch NULL and must not be counted.
        COUNT(ch.character_id)::int AS card_count
      FROM "packs" p
      LEFT JOIN "pack_card_variants" pcv ON pcv.pack_id = p.pack_id
      -- Release gating lives in the join condition so a pack with only
      -- unreleased cards still returns a row, with card_count = 0.
      LEFT JOIN "card_variants" cv
        ON cv.card_variant_id = pcv.card_variant_id
        AND cv.released_at <= NOW()
      LEFT JOIN "characters" ch
        ON ch.character_id = cv.character_id
        AND ch.released_at <= NOW()
      WHERE p.is_released = true
        AND (p.released_at IS NULL OR p.released_at <= NOW())
      GROUP BY p.pack_id
      ORDER BY p.sort_order, p.name;
    `;
    const { rows } = await db.query(query);
    return rows;
  },

  async findById(packId: string): Promise<Pack | null> {
    const query = `SELECT ${PACK_COLUMNS} FROM "packs" WHERE pack_id = $1;`;
    const { rows } = await db.query(query, [packId]);
    return rows[0] || null;
  },

  async findBySlug(slug: string): Promise<Pack | null> {
    const query = `SELECT ${PACK_COLUMNS} FROM "packs" WHERE slug = $1;`;
    const { rows } = await db.query(query, [slug]);
    return rows[0] || null;
  },

  async update(
    packId: string,
    updates: Partial<PackCreateInput>,
  ): Promise<Pack | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    const assignable: (keyof PackCreateInput)[] = [
      "name",
      "slug",
      "description",
      "image_url",
      "is_released",
      "released_at",
      "sort_order",
    ];

    for (const key of assignable) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${paramCount++}`);
        values.push(updates[key]);
      }
    }

    if (fields.length === 0) {
      return this.findById(packId);
    }

    fields.push("updated_at = NOW()");
    values.push(packId);

    const query = `
      UPDATE "packs" SET ${fields.join(", ")}
      WHERE pack_id = $${paramCount}
      RETURNING ${PACK_COLUMNS};
    `;
    const { rows } = await db.query(query, values);
    return rows[0] || null;
  },

  async delete(packId: string): Promise<boolean> {
    const result = await db.query(`DELETE FROM "packs" WHERE pack_id = $1;`, [
      packId,
    ]);
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Replace a pack's contents wholesale. Admin edits the full list, so a
   * delete-then-insert in one transaction is simpler and less error-prone
   * than diffing, and pack sizes are small enough that it is cheap.
   */
  async setCardVariants(
    packId: string,
    cardVariantIds: string[],
  ): Promise<number> {
    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM "pack_card_variants" WHERE pack_id = $1;`,
        [packId],
      );

      if (cardVariantIds.length > 0) {
        await client.query(
          `INSERT INTO "pack_card_variants" (pack_id, card_variant_id)
           SELECT $1, unnest($2::uuid[])
           ON CONFLICT DO NOTHING;`,
          [packId, cardVariantIds],
        );
      }

      await client.query("COMMIT");
      return cardVariantIds.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Count of variants in a pack that are actually openable right now
   * (both the variant and its character past their release date).
   */
  async getCardCount(packId: string): Promise<number> {
    const query = `
      SELECT COUNT(*)::int AS count
      FROM "pack_card_variants" pcv
      JOIN "card_variants" cv ON cv.card_variant_id = pcv.card_variant_id
      JOIN "characters" ch ON ch.character_id = cv.character_id
      WHERE pcv.pack_id = $1
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW();
    `;
    const { rows } = await db.query(query, [packId]);
    return rows[0]?.count ?? 0;
  },
};

export default PackModel;
