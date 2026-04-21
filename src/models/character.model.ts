import db from "../config/db.config";
import { Character } from "../types/database.types";
import { PowerValues } from "../types/card.types";

export interface CharacterVariantSummary {
  card_variant_id: string;
  rarity: string;
  image_url: string;
  description: string | null;
  attack_animation: string | null;
  is_exclusive: boolean;
  created_at: Date | null;
}

export interface CharacterWithVariants extends Character {
  variants: CharacterVariantSummary[];
}

/**
 * CharacterModel handles database operations for the characters table
 * Characters store shared data (name, description, power, ability, tags)
 * that can be referenced by multiple card variants
 */
const CharacterModel = {
  /**
   * Find a character by ID
   */
  async findById(characterId: string): Promise<Character | null> {
    const query = `
      SELECT 
        character_id, name, description, type,
        base_power->>'top' as base_power_top,
        base_power->>'right' as base_power_right,
        base_power->>'bottom' as base_power_bottom,
        base_power->>'left' as base_power_left,
        special_ability_id, set_id, tags,
        created_at, updated_at
      FROM characters
      WHERE character_id = $1;
    `;
    const { rows } = await db.query(query, [characterId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      character_id: row.character_id,
      name: row.name,
      description: row.description,
      type: row.type,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },

  /**
   * Find a character by name
   */
  async findByName(name: string): Promise<Character | null> {
    const query = `
      SELECT 
        character_id, name, description, type,
        base_power->>'top' as base_power_top,
        base_power->>'right' as base_power_right,
        base_power->>'bottom' as base_power_bottom,
        base_power->>'left' as base_power_left,
        special_ability_id, set_id, tags,
        created_at, updated_at
      FROM characters
      WHERE name = $1;
    `;
    const { rows } = await db.query(query, [name]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      character_id: row.character_id,
      name: row.name,
      description: row.description,
      type: row.type,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },

  /**
   * Find all characters
   */
  async findAll(): Promise<Character[]> {
    const query = `
      SELECT 
        character_id, name, description, type,
        base_power->>'top' as base_power_top,
        base_power->>'right' as base_power_right,
        base_power->>'bottom' as base_power_bottom,
        base_power->>'left' as base_power_left,
        special_ability_id, set_id, tags,
        created_at, updated_at
      FROM characters
      ORDER BY name;
    `;
    const { rows } = await db.query(query);

    return rows.map((row) => ({
      character_id: row.character_id,
      name: row.name,
      description: row.description,
      type: row.type,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  },

  /**
   * Find all characters with their nested card variants.
   */
  async findAllWithVariants(): Promise<CharacterWithVariants[]> {
    const query = `
      SELECT
        ch.character_id, ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top,
        ch.base_power->>'right' as base_power_right,
        ch.base_power->>'bottom' as base_power_bottom,
        ch.base_power->>'left' as base_power_left,
        ch.special_ability_id, ch.set_id, ch.tags,
        ch.created_at, ch.updated_at,
        cv.card_variant_id, cv.rarity, cv.image_url,
        cv.description as variant_description,
        cv.attack_animation, cv.is_exclusive, cv.created_at as variant_created_at
      FROM characters ch
      LEFT JOIN card_variants cv ON ch.character_id = cv.character_id
      ORDER BY ch.name ASC, cv.rarity ASC, cv.created_at ASC;
    `;

    const { rows } = await db.query(query);

    const characterMap = new Map<string, CharacterWithVariants>();

    for (const row of rows) {
      let character = characterMap.get(row.character_id);

      if (!character) {
        character = {
          character_id: row.character_id,
          name: row.name,
          description: row.description,
          type: row.type,
          base_power: {
            top: parseInt(row.base_power_top, 10),
            right: parseInt(row.base_power_right, 10),
            bottom: parseInt(row.base_power_bottom, 10),
            left: parseInt(row.base_power_left, 10),
          },
          special_ability_id: row.special_ability_id,
          set_id: row.set_id,
          tags: row.tags,
          created_at: row.created_at,
          updated_at: row.updated_at,
          variants: [],
        };
        characterMap.set(row.character_id, character);
      }

      if (row.card_variant_id) {
        character.variants.push({
          card_variant_id: row.card_variant_id,
          rarity: row.rarity,
          image_url: row.image_url,
          description: row.variant_description,
          attack_animation: row.attack_animation,
          is_exclusive: row.is_exclusive ?? false,
          created_at: row.variant_created_at,
        });
      }
    }

    return Array.from(characterMap.values());
  },

  /**
   * Find characters by set ID
   */
  async findBySetId(setId: string): Promise<Character[]> {
    const query = `
      SELECT 
        character_id, name, description, type,
        base_power->>'top' as base_power_top,
        base_power->>'right' as base_power_right,
        base_power->>'bottom' as base_power_bottom,
        base_power->>'left' as base_power_left,
        special_ability_id, set_id, tags,
        created_at, updated_at
      FROM characters
      WHERE set_id = $1
      ORDER BY name;
    `;
    const { rows } = await db.query(query, [setId]);

    return rows.map((row) => ({
      character_id: row.character_id,
      name: row.name,
      description: row.description,
      type: row.type,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  },

  /**
   * Update a character's description
   */
  async updateDescription(
    characterId: string,
    description: string
  ): Promise<Character | null> {
    const query = `
      UPDATE characters
      SET description = $2, updated_at = NOW()
      WHERE character_id = $1
      RETURNING 
        character_id, name, description, type,
        base_power->>'top' as base_power_top,
        base_power->>'right' as base_power_right,
        base_power->>'bottom' as base_power_bottom,
        base_power->>'left' as base_power_left,
        special_ability_id, set_id, tags,
        created_at, updated_at;
    `;
    const { rows } = await db.query(query, [characterId, description]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      character_id: row.character_id,
      name: row.name,
      description: row.description,
      type: row.type,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },

  /**
   * Create a new character
   */
  async create(data: {
    name: string;
    description?: string;
    type: string;
    base_power: PowerValues;
    special_ability_id?: string | null;
    set_id?: string | null;
    tags: string[];
  }): Promise<Character> {
    const query = `
      INSERT INTO characters (name, description, type, base_power, special_ability_id, set_id, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING 
        character_id, name, description, type,
        base_power->>'top' as base_power_top,
        base_power->>'right' as base_power_right,
        base_power->>'bottom' as base_power_bottom,
        base_power->>'left' as base_power_left,
        special_ability_id, set_id, tags,
        created_at, updated_at;
    `;
    const { rows } = await db.query(query, [
      data.name,
      data.description || null,
      data.type,
      JSON.stringify(data.base_power),
      data.special_ability_id || null,
      data.set_id || null,
      data.tags,
    ]);

    const row = rows[0];
    return {
      character_id: row.character_id,
      name: row.name,
      description: row.description,
      type: row.type,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },

  /**
   * Get character count
   */
  async getCount(): Promise<number> {
    const query = `SELECT COUNT(*) as count FROM characters;`;
    const { rows } = await db.query(query);
    return parseInt(rows[0].count, 10);
  },
};

export default CharacterModel;

