import db from "../config/db.config";
import { Card } from "../types/database.types";

const CardModel = {
  async findById(cardId: string): Promise<Card | null> {
    const query = `SELECT * FROM "Cards" WHERE card_id = $1;`;
    const { rows } = await db.query(query, [cardId]);
    return rows[0] || null;
  },

  async findByName(name: string): Promise<Card | null> {
    const query = `SELECT * FROM "Cards" WHERE name = $1;`;
    const { rows } = await db.query(query, [name]);
    return rows[0] || null;
  },

  async findByNames(names: string[]): Promise<Card[]> {
    if (names.length === 0) return [];

    const placeholders = names.map((_, i) => `$${i + 1}`).join(",");
    const query = `SELECT * FROM "Cards" WHERE name IN (${placeholders});`;
    const { rows } = await db.query(query, names);
    return rows;
  },
};

export default CardModel;
