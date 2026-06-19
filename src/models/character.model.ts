import db from "../config/db.config";
import { Character } from "../types/database.types";
import { PowerValues } from "../types/card.types";
import {
  andCharacterReleased,
  andCatalogReleased,
  CatalogQueryOptions,
} from "../utils/catalogRelease";

export interface CharacterVariantSummary {
  card_variant_id: string;
  rarity: string;
  image_url: string;
  description: string | null;
  attack_animation: string | null;
  sound_effect: string | null;
  is_exclusive: boolean;
  released_at: Date | null;
  created_at: Date | null;
}

export interface CharacterWithVariants extends Character {
  variants: CharacterVariantSummary[];
}

function mapCharacterRow(row: Record<string, unknown>): Character {
  return {
    character_id: row.character_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? undefined,
    type: row.type as string,
    base_power: {
      top: parseInt(String(row.base_power_top), 10),
      right: parseInt(String(row.base_power_right), 10),
      bottom: parseInt(String(row.base_power_bottom), 10),
      left: parseInt(String(row.base_power_left), 10),
    },
    special_ability_id: row.special_ability_id as string | null,
    set_id: row.set_id as string | null,
    tags: (row.tags as string[]) || [],
    sound_effect:
      (row.character_sound_effect as string | null | undefined) ??
      (row.sound_effect as string | null | undefined) ??
      null,
    released_at: row.released_at as Date,
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
  };
}

const CHARACTER_SELECT = `
  character_id, name, description, type,
  base_power->>'top' as base_power_top,
  base_power->>'right' as base_power_right,
  base_power->>'bottom' as base_power_bottom,
  base_power->>'left' as base_power_left,
  special_ability_id, set_id, tags, sound_effect,
  released_at, created_at, updated_at
`;

/**
 * CharacterModel handles database operations for the characters table
 * Characters store shared data (name, description, power, ability, tags)
 * that can be referenced by multiple card variants
 */
const CharacterModel = {
  /**
   * Find a character by ID
   */
  async findById(
    characterId: string,
    options: CatalogQueryOptions = {}
  ): Promise<Character | null> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT ${CHARACTER_SELECT}
      FROM characters
      WHERE character_id = $1${andCharacterReleased("characters", includeUnreleased)};
    `;
    const { rows } = await db.query(query, [characterId]);
    if (rows.length === 0) return null;
    return mapCharacterRow(rows[0]);
  },

  /**
   * Find a character by name
   */
  async findByName(
    name: string,
    options: CatalogQueryOptions = {}
  ): Promise<Character | null> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT ${CHARACTER_SELECT}
      FROM characters
      WHERE name = $1${andCharacterReleased("characters", includeUnreleased)};
    `;
    const { rows } = await db.query(query, [name]);
    if (rows.length === 0) return null;
    return mapCharacterRow(rows[0]);
  },

  /**
   * Find all characters
   */
  async findAll(options: CatalogQueryOptions = {}): Promise<Character[]> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT ${CHARACTER_SELECT}
      FROM characters
      WHERE TRUE${andCharacterReleased("characters", includeUnreleased)}
      ORDER BY name;
    `;
    const { rows } = await db.query(query);
    return rows.map(mapCharacterRow);
  },

  /**
   * Find all characters with their nested card variants.
   */
  async findAllWithVariants(
    options: CatalogQueryOptions = {}
  ): Promise<CharacterWithVariants[]> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT
        ch.character_id, ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top,
        ch.base_power->>'right' as base_power_right,
        ch.base_power->>'bottom' as base_power_bottom,
        ch.base_power->>'left' as base_power_left,
        ch.special_ability_id, ch.set_id, ch.tags,
        ch.sound_effect as character_sound_effect,
        ch.released_at, ch.created_at, ch.updated_at,
        cv.card_variant_id, cv.rarity, cv.image_url,
        cv.description as variant_description,
        cv.attack_animation, cv.sound_effect as variant_sound_effect, cv.is_exclusive,
        cv.released_at as variant_released_at,
        cv.created_at as variant_created_at
      FROM characters ch
      LEFT JOIN card_variants cv ON cv.character_id = ch.character_id
        AND ${includeUnreleased ? "TRUE" : "cv.released_at <= NOW()"}
      WHERE TRUE${andCharacterReleased("ch", includeUnreleased)}
      ORDER BY ch.name ASC, cv.rarity ASC, cv.created_at ASC;
    `;

    const { rows } = await db.query(query);
    const characterMap = new Map<string, CharacterWithVariants>();

    for (const row of rows) {
      let character = characterMap.get(row.character_id);

      if (!character) {
        character = {
          ...mapCharacterRow(row),
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
          sound_effect: row.variant_sound_effect ?? null,
          is_exclusive: row.is_exclusive ?? false,
          released_at: row.variant_released_at,
          created_at: row.variant_created_at,
        });
      }
    }

    return Array.from(characterMap.values());
  },

  /**
   * Find characters by set ID
   */
  async findBySetId(
    setId: string,
    options: CatalogQueryOptions = {}
  ): Promise<Character[]> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT ${CHARACTER_SELECT}
      FROM characters
      WHERE set_id = $1${andCharacterReleased("characters", includeUnreleased)}
      ORDER BY name;
    `;
    const { rows } = await db.query(query, [setId]);
    return rows.map(mapCharacterRow);
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
        released_at, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [characterId, description]);
    if (rows.length === 0) return null;
    return mapCharacterRow(rows[0]);
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
    released_at?: Date;
  }): Promise<Character> {
    const query = `
      INSERT INTO characters (name, description, type, base_power, special_ability_id, set_id, tags, released_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
      RETURNING
        character_id, name, description, type,
        base_power->>'top' as base_power_top,
        base_power->>'right' as base_power_right,
        base_power->>'bottom' as base_power_bottom,
        base_power->>'left' as base_power_left,
        special_ability_id, set_id, tags,
        released_at, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [
      data.name,
      data.description || null,
      data.type,
      JSON.stringify(data.base_power),
      data.special_ability_id || null,
      data.set_id || null,
      data.tags,
      data.released_at ?? null,
    ]);
    return mapCharacterRow(rows[0]);
  },

  /**
   * Get character count (released only unless includeUnreleased)
   */
  async getCount(options: CatalogQueryOptions = {}): Promise<number> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT COUNT(*) as count FROM characters
      WHERE TRUE${andCharacterReleased("characters", includeUnreleased)};
    `;
    const { rows } = await db.query(query);
    return parseInt(rows[0].count, 10);
  },
};

export default CharacterModel;
