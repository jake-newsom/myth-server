import db from "../config/db.config";
import { CardResponse } from "../types/api.types";
import {
  UserCardInstance,
  Card as BaseCard,
  SpecialAbility,
} from "../types/database.types";
import { TriggerMoment } from "../types/card.types";
import PowerUpService from "../services/powerUp.service";

// Helper to format the card instance response
function formatUserCardInstanceResponse(
  baseCard: BaseCard,
  instance: UserCardInstance,
  ability: SpecialAbility | null
): CardResponse {
  return {
    user_card_instance_id: instance.user_card_instance_id,
    base_card_id: baseCard.card_id,
    name: baseCard.name,
    description: baseCard.description ?? null, // Include description from character
    rarity: baseCard.rarity,
    image_url: baseCard.image_url,
    base_power: baseCard.base_power,
    level: instance.level,
    xp: instance.xp,
    power_enhancements: instance.power_enhancements,
    tags: baseCard.tags,
    set_id: baseCard.set_id || null,
    special_ability: ability
      ? {
          ability_id: ability.ability_id,
          name: ability.name,
          description: ability.description,
          triggerMoments: ability.triggerMoments,
          parameters: ability.parameters,
        }
      : null,
    ...(baseCard.attack_animation && {
      attack_animation: baseCard.attack_animation,
    }),
  };
}

// Helper to format static card response
function formatStaticCardResponse(
  baseCard: BaseCard & {
    special_ability?: {
      ability_id: string;
      name: string;
      description: string;
      triggerMoments: string[];
      parameters: any;
    } | null;
  }
): Omit<
  CardResponse,
  "user_card_instance_id" | "level" | "xp" | "power_enhancements"
> {
  const {
    special_ability_id,
    card_id,
    attack_animation,
    description,
    ...rest
  } = baseCard;
  return {
    ...rest,
    base_card_id: card_id,
    set_id: baseCard.set_id || null,
    description: description ?? null, // Always include description field (null if not set)
    special_ability: baseCard.special_ability
      ? {
          ...baseCard.special_ability,
          triggerMoments: baseCard.special_ability
            .triggerMoments as TriggerMoment[],
        }
      : null,
    ...(attack_animation && { attack_animation: attack_animation }),
  };
}

const CardModel = {
  /**
   * Find all card instances owned by a user
   * Joins card_variants -> characters -> special_abilities
   */
  async findInstancesByUserId(userId: string): Promise<CardResponse[]> {
    const query = `
      SELECT 
        uoc.user_card_instance_id, uoc.user_id, uoc.card_variant_id, uoc.level, uoc.xp,
        ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top,
        ch.base_power->>'right' as base_power_right, 
        ch.base_power->>'bottom' as base_power_bottom, 
        ch.base_power->>'left' as base_power_left,
        ch.special_ability_id, ch.set_id, ch.tags,
        cv.rarity, cv.image_url, cv.attack_animation,
        sa.name as ability_name, sa.description as ability_description, 
        sa.trigger_moments as ability_trigger_moments, sa.parameters as ability_parameters,
        sa.id as ability_id_string
      FROM "user_owned_cards" uoc
      JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN "characters" ch ON cv.character_id = ch.character_id
      LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
      WHERE uoc.user_id = $1
      ORDER BY ch.name;
    `;

    const { rows } = await db.query(query, [userId]);

    // Get power ups for all card instances
    const instanceIds = rows.map((row) => row.user_card_instance_id);
    const powerUpsMap = await PowerUpService.getPowerUpsByCardInstances(
      instanceIds
    );

    return rows.map((row) => {
      const baseCard: BaseCard = {
        card_id: row.card_variant_id, // Use variant ID as card_id for compatibility
        name: row.name,
        description: row.description,
        rarity: row.rarity,
        image_url: row.image_url,
        base_power: {
          top: parseInt(row.base_power_top, 10),
          right: parseInt(row.base_power_right, 10),
          bottom: parseInt(row.base_power_bottom, 10),
          left: parseInt(row.base_power_left, 10),
        },
        special_ability_id: row.special_ability_id,
        set_id: row.set_id,
        tags: row.tags,
        ...(row.attack_animation && { attack_animation: row.attack_animation }),
      };

      // Get power up data for this instance
      const powerUp = powerUpsMap.get(row.user_card_instance_id);
      const powerEnhancements = powerUp
        ? powerUp.power_up_data
        : {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          };

      const instance: UserCardInstance = {
        user_card_instance_id: row.user_card_instance_id,
        user_id: row.user_id,
        card_variant_id: row.card_variant_id,
        level: row.level,
        xp: row.xp,
        power_enhancements: powerEnhancements,
      };

      const ability: SpecialAbility | null = row.special_ability_id
        ? {
            ability_id: row.special_ability_id,
            id: row.ability_id_string || "",
            name: row.ability_name,
            description: row.ability_description,
            triggerMoments: row.ability_trigger_moments || [],
            parameters: row.ability_parameters,
          }
        : null;

      return formatUserCardInstanceResponse(baseCard, instance, ability);
    });
  },

  /**
   * Find a card variant by ID (returns flattened card data)
   */
  async findById(cardVariantId: string): Promise<BaseCard | null> {
    const query = `
      SELECT
        cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
        ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top, 
        ch.base_power->>'right' as base_power_right,
        ch.base_power->>'bottom' as base_power_bottom, 
        ch.base_power->>'left' as base_power_left,
        ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE cv.card_variant_id = $1;
    `;
    const { rows } = await db.query(query, [cardVariantId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      card_id: row.card_variant_id,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      ...(row.attack_animation && { attack_animation: row.attack_animation }),
    };
  },

  /**
   * Find a base card by ID (alias for findById for backward compatibility)
   */
  async findBaseCardById(cardVariantId: string): Promise<BaseCard | null> {
    return this.findById(cardVariantId);
  },

  /**
   * Find a specific user card instance by ID
   */
  async findInstanceById(
    instanceId: string,
    userId: string
  ): Promise<CardResponse | null> {
    const query = `
      SELECT 
        uoc.user_card_instance_id, uoc.user_id, uoc.card_variant_id, uoc.level, uoc.xp,
        ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top,
        ch.base_power->>'right' as base_power_right, 
        ch.base_power->>'bottom' as base_power_bottom, 
        ch.base_power->>'left' as base_power_left, 
        ch.special_ability_id, ch.set_id, ch.tags,
        cv.rarity, cv.image_url, cv.attack_animation,
        sa.name as ability_name, sa.description as ability_description, 
        sa.trigger_moments as ability_trigger_moments, sa.parameters as ability_parameters,
        sa.id as ability_id_string
      FROM "user_owned_cards" uoc
      JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN "characters" ch ON cv.character_id = ch.character_id
      LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
      WHERE uoc.user_card_instance_id = $1 AND uoc.user_id = $2;
    `;
    const { rows } = await db.query(query, [instanceId, userId]);
    if (rows.length === 0) return null;

    const row = rows[0];

    // Get power up data for this instance
    const powerUp = await PowerUpService.getPowerUpByCardInstance(instanceId);
    const powerEnhancements = powerUp
      ? powerUp.power_up_data
      : {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        };

    const instance: UserCardInstance = {
      user_card_instance_id: row.user_card_instance_id,
      user_id: row.user_id,
      card_variant_id: row.card_variant_id,
      level: row.level,
      xp: row.xp,
      power_enhancements: powerEnhancements,
    };

    const baseCard: BaseCard = {
      card_id: row.card_variant_id,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      ...(row.attack_animation && { attack_animation: row.attack_animation }),
    };

    const ability: SpecialAbility | null = row.special_ability_id
      ? {
          ability_id: row.special_ability_id,
          id: row.ability_id_string || "",
          name: row.ability_name,
          description: row.ability_description,
          triggerMoments: row.ability_trigger_moments || [],
          parameters: row.ability_parameters,
        }
      : null;

    return formatUserCardInstanceResponse(baseCard, instance, ability);
  },

  /**
   * Find all static card variants with optional filtering
   */
  async findAllStatic(
    filters: {
      rarity?: string;
      name?: string;
      tag?: string;
      ids?: string;
    } = {},
    page = 1,
    limit = 20
  ): Promise<{
    data: Omit<
      CardResponse,
      "user_card_instance_id" | "level" | "xp" | "power_enhancements"
    >[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const { rarity, name, tag, ids } = filters;

      const offset = (page - 1) * limit;

      // Build the query with placeholders
      let whereClauses: string[] = [];
      let queryParams: any[] = [];

      // Start the parameter index at 1
      let paramIndex = 1;

      if (rarity) {
        whereClauses.push(`cv.rarity = $${paramIndex}`);
        queryParams.push(rarity);
        paramIndex++;
      }

      if (name) {
        whereClauses.push(`ch.name ILIKE $${paramIndex}`);
        queryParams.push(`%${name}%`);
        paramIndex++;
      }

      if (tag) {
        whereClauses.push(`$${paramIndex} = ANY(ch.tags)`);
        queryParams.push(tag);
        paramIndex++;
      }

      if (ids) {
        // Split by comma and clean up each ID
        const idArray = ids
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0);

        if (idArray.length > 0) {
          // Use a proper IN clause with UUID casting for both sides
          whereClauses.push(
            `cv.card_variant_id IN (SELECT CAST(unnest($${paramIndex}::text[]) AS uuid))`
          );
          queryParams.push(idArray);
          paramIndex++;
        }
      }

      // Construct the full WHERE clause
      const whereClause =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      // Handle pagination - if limit is 0, return all results
      let limitClause = "";
      if (limit > 0) {
        queryParams.push(limit);
        queryParams.push(offset);
        limitClause = `LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      }

      const dataQuery = `
        SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
              ch.name, ch.description, ch.type,
              ch.base_power->>'top' as base_power_top, 
              ch.base_power->>'right' as base_power_right, 
              ch.base_power->>'bottom' as base_power_bottom, 
              ch.base_power->>'left' as base_power_left, 
              ch.special_ability_id, ch.set_id, ch.tags,
              sa.ability_id as sa_ability_id, sa.name as sa_name, 
              sa.description as sa_description,
              sa.trigger_moments as sa_trigger_moments, 
              sa.parameters as sa_parameters
        FROM "card_variants" cv
        JOIN "characters" ch ON cv.character_id = ch.character_id
        LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
        ${whereClause}
        ORDER BY ch.name
        ${limitClause};
      `;

      const { rows: dataRows } = await db.query(dataQuery, queryParams);

      // If the main query returned no results but we have IDs, try a fallback approach
      if (dataRows.length === 0 && ids) {
        // Split the IDs and try a direct text-based comparison approach
        const idArray = ids
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0);

        if (idArray.length > 0) {
          // Handle no-limit case in fallback query too
          let fallbackLimitClause = "";
          let fallbackParams: any[] = [idArray];
          if (limit > 0) {
            fallbackLimitClause = "LIMIT $2 OFFSET $3";
            fallbackParams.push(limit, offset);
          }

          const fallbackQuery = `
            SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
                  ch.name, ch.description, ch.type,
                  ch.base_power->>'top' as base_power_top, 
                  ch.base_power->>'right' as base_power_right, 
                  ch.base_power->>'bottom' as base_power_bottom, 
                  ch.base_power->>'left' as base_power_left, 
                  ch.special_ability_id, ch.set_id, ch.tags,
                  sa.ability_id as sa_ability_id, sa.name as sa_name, 
                  sa.description as sa_description,
                  sa.trigger_moments as sa_trigger_moments, 
                  sa.parameters as sa_parameters
            FROM "card_variants" cv
            JOIN "characters" ch ON cv.character_id = ch.character_id
            LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
            WHERE cv.card_variant_id::text = ANY($1::text[])
            ORDER BY ch.name
            ${fallbackLimitClause};
          `;

          const { rows: fallbackRows } = await db.query(
            fallbackQuery,
            fallbackParams
          );

          if (fallbackRows.length > 0) {
            // Use results from fallback query instead

            // Get count of total matching IDs for pagination
            const fallbackCountQuery = `SELECT COUNT(*) FROM "card_variants" WHERE card_variant_id::text = ANY($1::text[])`;
            const { rows: fallbackCountRows } = await db.query(
              fallbackCountQuery,
              [idArray]
            );

            const data = fallbackRows.map((row) => {
              const cardWithAbility = {
                card_id: row.card_variant_id,
                name: row.name,
                description: row.description,
                rarity: row.rarity,
                image_url: row.image_url,
                base_power: {
                  top: parseInt(row.base_power_top, 10),
                  right: parseInt(row.base_power_right, 10),
                  bottom: parseInt(row.base_power_bottom, 10),
                  left: parseInt(row.base_power_left, 10),
                },
                special_ability_id: row.special_ability_id,
                set_id: row.set_id,
                tags: row.tags,
                ...(row.attack_animation && {
                  attack_animation: row.attack_animation,
                }),
                special_ability: row.sa_ability_id
                  ? {
                      ability_id: row.sa_ability_id,
                      name: row.sa_name,
                      description: row.sa_description,
                      triggerMoments: row.sa_trigger_moments || [],
                      parameters: row.sa_parameters,
                    }
                  : null,
              };
              return formatStaticCardResponse(cardWithAbility);
            });

            return {
              data,
              total: parseInt(fallbackCountRows[0].count, 10),
              page,
              limit,
            };
          }
        }
      }

      // Count query - use the same where clause but without limit/offset
      const countQuery = `SELECT COUNT(*) FROM "card_variants" cv JOIN "characters" ch ON cv.character_id = ch.character_id ${whereClause}`;
      const countParams = queryParams.slice(0, -2); // Remove limit and offset

      const { rows: countRows } = await db.query(countQuery, countParams);

      const data = dataRows.map((row) => {
        const cardWithAbility = {
          card_id: row.card_variant_id,
          name: row.name,
          description: row.description,
          rarity: row.rarity,
          image_url: row.image_url,
          ...(row.attack_animation && {
            attack_animation: row.attack_animation,
          }),
          base_power: {
            top: parseInt(row.base_power_top, 10),
            right: parseInt(row.base_power_right, 10),
            bottom: parseInt(row.base_power_bottom, 10),
            left: parseInt(row.base_power_left, 10),
          },
          special_ability_id: row.special_ability_id,
          set_id: row.set_id,
          tags: row.tags,
          special_ability: row.sa_ability_id
            ? {
                ability_id: row.sa_ability_id,
                name: row.sa_name,
                description: row.sa_description,
                triggerMoments: row.sa_trigger_moments || [],
                parameters: row.sa_parameters,
              }
            : null,
        };
        return formatStaticCardResponse(cardWithAbility);
      });

      return {
        data,
        total: parseInt(countRows[0].count, 10),
        page,
        limit,
      };
    } catch (error) {
      console.error("Error in findAllStatic:", error);
      throw error;
    }
  },

  /**
   * Find a static card variant by ID with ability info
   */
  async findStaticByIdWithAbility(
    cardVariantId: string
  ): Promise<Omit<
    CardResponse,
    "user_card_instance_id" | "level" | "xp" | "power_enhancements"
  > | null> {
    const query = `
      SELECT
        cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
        ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top, 
        ch.base_power->>'right' as base_power_right,
        ch.base_power->>'bottom' as base_power_bottom, 
        ch.base_power->>'left' as base_power_left,
        ch.special_ability_id, ch.set_id, ch.tags,
        sa.ability_id as sa_ability_id, sa.name as sa_name, sa.description as sa_description,
        sa.trigger_moments as sa_trigger_moments, sa.parameters as sa_parameters
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
      WHERE cv.card_variant_id = $1;
    `;
    const { rows } = await db.query(query, [cardVariantId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    const card: BaseCard & {
      special_ability?: {
        ability_id: string;
        name: string;
        description: string;
        triggerMoments: string[];
        parameters: any;
      } | null;
    } = {
      card_id: row.card_variant_id,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      ...(row.attack_animation && { attack_animation: row.attack_animation }),
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      special_ability: row.sa_ability_id
        ? {
            ability_id: row.sa_ability_id,
            name: row.sa_name,
            description: row.sa_description,
            triggerMoments: row.sa_trigger_moments || [],
            parameters: row.sa_parameters,
          }
        : null,
    };
    return formatStaticCardResponse(card);
  },

  /**
   * Find multiple card instances by their IDs
   */
  async findInstancesByIds(instanceIds: string[]): Promise<CardResponse[]> {
    if (instanceIds.length === 0) return [];

    const query = `
      SELECT 
        uoc.user_card_instance_id, uoc.user_id, uoc.card_variant_id, uoc.level, uoc.xp,
        ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top,
        ch.base_power->>'right' as base_power_right, 
        ch.base_power->>'bottom' as base_power_bottom, 
        ch.base_power->>'left' as base_power_left,
        ch.special_ability_id, ch.set_id, ch.tags,
        cv.rarity, cv.image_url, cv.attack_animation,
        sa.name as ability_name, sa.description as ability_description, 
        sa.trigger_moments as ability_trigger_moments, sa.parameters as ability_parameters,
        sa.id as ability_id_string
      FROM "user_owned_cards" uoc
      JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN "characters" ch ON cv.character_id = ch.character_id
      LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
      WHERE uoc.user_card_instance_id = ANY($1)
      ORDER BY ch.name;
    `;

    const { rows } = await db.query(query, [instanceIds]);

    // Get power ups for all card instances
    const powerUpsMap = await PowerUpService.getPowerUpsByCardInstances(
      instanceIds
    );

    return rows.map((row) => {
      const baseCard: BaseCard = {
        card_id: row.card_variant_id,
        name: row.name,
        description: row.description,
        rarity: row.rarity,
        image_url: row.image_url,
        base_power: {
          top: parseInt(row.base_power_top, 10),
          right: parseInt(row.base_power_right, 10),
          bottom: parseInt(row.base_power_bottom, 10),
          left: parseInt(row.base_power_left, 10),
        },
        special_ability_id: row.special_ability_id,
        set_id: row.set_id,
        tags: row.tags,
        ...(row.attack_animation && { attack_animation: row.attack_animation }),
      };

      // Get power up data for this instance
      const powerUp = powerUpsMap.get(row.user_card_instance_id);
      const powerEnhancements = powerUp
        ? powerUp.power_up_data
        : {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          };

      const instance: UserCardInstance = {
        user_card_instance_id: row.user_card_instance_id,
        user_id: row.user_id,
        card_variant_id: row.card_variant_id,
        level: row.level,
        xp: row.xp,
        power_enhancements: powerEnhancements,
      };

      const ability: SpecialAbility | null = row.special_ability_id
        ? {
            ability_id: row.special_ability_id,
            id: row.ability_id_string || "",
            name: row.ability_name,
            description: row.ability_description,
            triggerMoments: row.ability_trigger_moments || [],
            parameters: row.ability_parameters,
          }
        : null;

      return formatUserCardInstanceResponse(baseCard, instance, ability);
    });
  },

  /**
   * Find a card variant by character name (returns first match)
   */
  async findByName(name: string): Promise<BaseCard | null> {
    const query = `
      SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
             ch.name, ch.description,
             ch.base_power->>'top' as base_power_top, 
             ch.base_power->>'right' as base_power_right, 
             ch.base_power->>'bottom' as base_power_bottom, 
             ch.base_power->>'left' as base_power_left, 
             ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE ch.name = $1
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [name]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      card_id: row.card_variant_id,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      ...(row.attack_animation && { attack_animation: row.attack_animation }),
    };
  },

  /**
   * Find card variants by character names (returns one variant per name)
   */
  async findByNames(names: string[]): Promise<BaseCard[]> {
    if (names.length === 0) {
      return [];
    }
    const query = `
      SELECT DISTINCT ON (ch.name) 
             cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
             ch.name, ch.description,
             ch.base_power->>'top' as base_power_top, 
             ch.base_power->>'right' as base_power_right, 
             ch.base_power->>'bottom' as base_power_bottom, 
             ch.base_power->>'left' as base_power_left, 
             ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE ch.name = ANY($1::text[])
      ORDER BY ch.name, cv.rarity;
    `;
    const { rows } = await db.query(query, [names]);
    return rows.map((row) => ({
      card_id: row.card_variant_id,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      ...(row.attack_animation && { attack_animation: row.attack_animation }),
    }));
  },

  /**
   * Find all user card instances with filtering and pagination
   */
  async findAllUserCardInstances(
    userId: string,
    filters: {
      rarity?: string;
      name?: string;
      tag?: string;
    } = {},
    page = 1,
    limit = 20
  ): Promise<{
    data: CardResponse[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const { rarity, name, tag } = filters;
      const offset = (page - 1) * limit;

      let whereClauses: string[] = ["uoc.user_id = $1"];
      let queryParams: any[] = [userId];
      let paramIndex = 2; // Start after userId

      if (rarity) {
        whereClauses.push(`cv.rarity = $${paramIndex}`);
        queryParams.push(rarity);
        paramIndex++;
      }

      if (name) {
        whereClauses.push(`ch.name ILIKE $${paramIndex}`);
        queryParams.push(`%${name}%`);
        paramIndex++;
      }

      if (tag) {
        whereClauses.push(`$${paramIndex} = ANY(ch.tags)`);
        queryParams.push(tag);
        paramIndex++;
      }

      const whereClause =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      queryParams.push(limit);
      queryParams.push(offset);

      const dataQuery = `
        SELECT 
          uoc.user_card_instance_id, uoc.user_id, uoc.card_variant_id, uoc.level, uoc.xp,
          ch.name, ch.description, ch.type,
          ch.base_power->>'top' as base_power_top,
          ch.base_power->>'right' as base_power_right, 
          ch.base_power->>'bottom' as base_power_bottom, 
          ch.base_power->>'left' as base_power_left,
          ch.special_ability_id, ch.set_id, ch.tags,
          cv.rarity, cv.image_url, cv.attack_animation,
          sa.name as ability_name, sa.description as ability_description, 
          sa.trigger_moments as ability_trigger_moments, sa.parameters as ability_parameters,
          sa.id as ability_id_string 
        FROM "user_owned_cards" uoc
        JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
        JOIN "characters" ch ON cv.character_id = ch.character_id
        LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
        ${whereClause}
        ORDER BY ch.name
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
      `;

      const { rows: dataRows } = await db.query(dataQuery, queryParams);

      const countQuery = `
        SELECT COUNT(*) 
        FROM "user_owned_cards" uoc
        JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
        JOIN "characters" ch ON cv.character_id = ch.character_id
        ${whereClause};
      `;
      // Remove limit and offset for count query
      const countParams = queryParams.slice(0, -2);
      const { rows: countRows } = await db.query(countQuery, countParams);

      // Get power ups for all card instances
      const instanceIds = dataRows.map((row) => row.user_card_instance_id);
      const powerUpsMap = await PowerUpService.getPowerUpsByCardInstances(
        instanceIds
      );

      const data = dataRows.map((row) => {
        const baseCard: BaseCard = {
          card_id: row.card_variant_id,
          name: row.name,
          description: row.description,
          rarity: row.rarity,
          image_url: row.image_url,
          base_power: {
            top: parseInt(row.base_power_top, 10),
            right: parseInt(row.base_power_right, 10),
            bottom: parseInt(row.base_power_bottom, 10),
            left: parseInt(row.base_power_left, 10),
          },
          special_ability_id: row.special_ability_id,
          set_id: row.set_id,
          tags: row.tags,
        };

        // Get power up data for this instance
        const powerUp = powerUpsMap.get(row.user_card_instance_id);
        const powerEnhancements = powerUp
          ? powerUp.power_up_data
          : {
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
            };

        const instance: UserCardInstance = {
          user_card_instance_id: row.user_card_instance_id,
          user_id: row.user_id,
          card_variant_id: row.card_variant_id,
          level: row.level,
          xp: row.xp,
          power_enhancements: powerEnhancements,
        };

        const ability: SpecialAbility | null = row.special_ability_id
          ? {
              ability_id: row.special_ability_id,
              id: row.ability_id_string || "",
              name: row.ability_name,
              description: row.ability_description,
              triggerMoments: row.ability_trigger_moments || [],
              parameters: row.ability_parameters,
            }
          : null;

        return formatUserCardInstanceResponse(baseCard, instance, ability);
      });

      return {
        data,
        total: parseInt(countRows[0].count, 10),
        page,
        limit,
      };
    } catch (error) {
      console.error("Error in findAllUserCardInstances:", error);
      throw error;
    }
  },

  /**
   * Add a card variant to user's collection
   */
  async addCardToUser(
    userId: string,
    cardVariantId: string
  ): Promise<UserCardInstance> {
    const query = `
      INSERT INTO "user_owned_cards" (user_id, card_variant_id, level, xp)
      VALUES ($1, $2, 1, 0)
      RETURNING user_card_instance_id, user_id, card_variant_id, level, xp, created_at;
    `;

    const { rows } = await db.query(query, [userId, cardVariantId]);
    return rows[0];
  },

  /**
   * Get count of unique card variants owned by user
   */
  async getUserUniqueCardCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(DISTINCT card_variant_id) as count
      FROM "user_owned_cards"
      WHERE user_id = $1;
    `;
    const { rows } = await db.query(query, [userId]);
    return parseInt(rows[0].count, 10);
  },

  /**
   * Get count of unique mythic cards owned by user
   * Mythic cards are those with +, ++, or +++ variants
   */
  async getUserMythicCardCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(DISTINCT cv.card_variant_id) as count
      FROM "user_owned_cards" uoc
      JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
      WHERE uoc.user_id = $1
        AND POSITION('+' IN cv.rarity::text) > 0;
    `;
    const { rows } = await db.query(query, [userId]);
    return parseInt(rows[0].count, 10);
  },

  /**
   * Get count of cards at specific level by rarity for a user
   */
  async getUserCardsAtLevelByRarity(
    userId: string
  ): Promise<Record<string, Record<number, number>>> {
    const query = `
      SELECT 
        cv.rarity,
        uoc.level,
        COUNT(*) as count
      FROM "user_owned_cards" uoc
      JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
      WHERE uoc.user_id = $1
        AND uoc.level >= 2
        AND cv.rarity IN ('rare', 'epic', 'legendary')
      GROUP BY cv.rarity, uoc.level;
    `;
    const { rows } = await db.query(query, [userId]);

    const result: Record<string, Record<number, number>> = {
      rare: {},
      epic: {},
      legendary: {},
    };

    for (const row of rows) {
      const rarity = row.rarity.toLowerCase();
      const level = parseInt(row.level, 10);
      const count = parseInt(row.count, 10);

      if (result[rarity]) {
        result[rarity][level] = count;
      }
    }

    return result;
  },

  /**
   * Get total count of all card instances owned by user (not unique cards)
   */
  async getUserTotalCardCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM "user_owned_cards"
      WHERE user_id = $1;
    `;
    const { rows } = await db.query(query, [userId]);
    return parseInt(rows[0].count, 10);
  },

  /**
   * Get count of unique cards owned by user for each base rarity
   * Returns counts for common, rare, epic, legendary (base rarities only)
   */
  async getUserUniqueCardCountByRarity(
    userId: string
  ): Promise<Record<string, number>> {
    const query = `
      SELECT 
        CASE 
          WHEN POSITION('+' IN cv.rarity::text) > 0 
            THEN SPLIT_PART(cv.rarity::text, '+', 1)
          ELSE cv.rarity::text
        END as base_rarity,
        COUNT(DISTINCT cv.card_variant_id) as count
      FROM "user_owned_cards" uoc
      JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
      WHERE uoc.user_id = $1
      GROUP BY base_rarity;
    `;
    const { rows } = await db.query(query, [userId]);

    const result: Record<string, number> = {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };

    for (const row of rows) {
      const rarity = row.base_rarity.toLowerCase();
      const count = parseInt(row.count, 10);
      if (result[rarity] !== undefined) {
        result[rarity] = count;
      }
    }

    return result;
  },

  /**
   * Find all variants for a specific character
   */
  async findVariantsByCharacterId(characterId: string): Promise<BaseCard[]> {
    const query = `
      SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
             ch.name, ch.description,
             ch.base_power->>'top' as base_power_top, 
             ch.base_power->>'right' as base_power_right, 
             ch.base_power->>'bottom' as base_power_bottom, 
             ch.base_power->>'left' as base_power_left, 
             ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE cv.character_id = $1
      ORDER BY cv.rarity;
    `;
    const { rows } = await db.query(query, [characterId]);
    return rows.map((row) => ({
      card_id: row.card_variant_id,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      ...(row.attack_animation && { attack_animation: row.attack_animation }),
    }));
  },

  /**
   * Find all variants for a character by name
   */
  async findVariantsByCharacterName(
    characterName: string
  ): Promise<BaseCard[]> {
    const query = `
      SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
             ch.name, ch.description,
             ch.base_power->>'top' as base_power_top, 
             ch.base_power->>'right' as base_power_right, 
             ch.base_power->>'bottom' as base_power_bottom, 
             ch.base_power->>'left' as base_power_left, 
             ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE ch.name = $1
      ORDER BY cv.rarity;
    `;
    const { rows } = await db.query(query, [characterName]);
    return rows.map((row) => ({
      card_id: row.card_variant_id,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      ...(row.attack_animation && { attack_animation: row.attack_animation }),
    }));
  },
};

export default CardModel;
