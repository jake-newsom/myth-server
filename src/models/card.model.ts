import db from "../config/db.config";
import { CardResponse } from "../types/api.types";
import {
  UserCardInstance,
  Card as BaseCard,
  SpecialAbility,
} from "../types/database.types";
import { PowerValues } from "../types/card.types";

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
    rarity: baseCard.rarity,
    image_url: baseCard.image_url,
    base_power: baseCard.base_power,
    level: instance.level,
    xp: instance.xp,
    power_enhancements: instance.power_enhancements,
    tags: baseCard.tags,
    special_ability: ability
      ? {
          ability_id: ability.ability_id,
          name: ability.name,
          description: ability.description,
          triggerMoment: ability.triggerMoment,
          parameters: ability.parameters,
        }
      : null,
  };
}

// Helper to format static card response
function formatStaticCardResponse(
  baseCard: BaseCard & {
    special_ability?: {
      ability_id: string;
      name: string;
      description: string;
      triggerMoment: string;
      parameters: any;
    } | null;
  }
): Omit<
  CardResponse,
  "user_card_instance_id" | "level" | "xp" | "power_enhancements"
> {
  const { special_ability_id, card_id, ...rest } = baseCard;
  return {
    ...rest,
    base_card_id: card_id,
    special_ability: baseCard.special_ability || null,
  };
}

const CardModel = {
  async findInstancesByUserId(userId: string): Promise<CardResponse[]> {
    const query = `
      SELECT 
        uoc.user_card_instance_id, uoc.user_id, uoc.card_id, uoc.level, uoc.xp,
        c.name, c.rarity, c.image_url, 
        c.power->>'top' as base_power_top,
        c.power->>'right' as base_power_right, 
        c.power->>'bottom' as base_power_bottom, 
        c.power->>'left' as base_power_left,
        c.special_ability_id, c.tags,
        sa.name as ability_name, sa.description as ability_description, 
        sa.trigger_moment as ability_trigger_moment, sa.parameters as ability_parameters,
        sa.id as ability_id_string
      FROM "user_owned_cards" uoc
      JOIN "cards" c ON uoc.card_id = c.card_id
      LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
      WHERE uoc.user_id = $1
      ORDER BY c.name;
    `;

    const { rows } = await db.query(query, [userId]);
    return rows.map((row) => {
      const baseCard: BaseCard = {
        card_id: row.card_id,
        name: row.name,
        rarity: row.rarity,
        image_url: row.image_url,
        base_power: {
          top: parseInt(row.base_power_top, 10),
          right: parseInt(row.base_power_right, 10),
          bottom: parseInt(row.base_power_bottom, 10),
          left: parseInt(row.base_power_left, 10),
        },
        special_ability_id: row.special_ability_id,
        tags: row.tags,
      };

      const instance: UserCardInstance = {
        user_card_instance_id: row.user_card_instance_id,
        user_id: row.user_id,
        card_id: row.card_id,
        level: row.level,
        xp: row.xp,
        power_enhancements: {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        },
      };

      const ability: SpecialAbility | null = row.special_ability_id
        ? {
            ability_id: row.special_ability_id,
            id: row.ability_id_string || "",
            name: row.ability_name,
            description: row.ability_description,
            triggerMoment: row.ability_trigger_moment,
            parameters: row.ability_parameters,
          }
        : null;

      return formatUserCardInstanceResponse(baseCard, instance, ability);
    });
  },

  async findById(cardId: string): Promise<BaseCard | null> {
    const query = `
      SELECT
        card_id, name, rarity, image_url, 
        power->>'top' as base_power_top, 
        power->>'right' as base_power_right,
        power->>'bottom' as base_power_bottom, 
        power->>'left' as base_power_left,
        special_ability_id, tags
      FROM "cards"
      WHERE card_id = $1;
    `;
    const { rows } = await db.query(query, [cardId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      card_id: row.card_id,
      name: row.name,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      tags: row.tags,
    };
  },

  async findBaseCardById(cardId: string): Promise<BaseCard | null> {
    const query = `SELECT card_id, name, rarity, image_url, power->>'top' as base_power_top, power->>'right' as base_power_right, power->>'bottom' as base_power_bottom, power->>'left' as base_power_left, special_ability_id, tags FROM "cards" WHERE card_id = $1;`;
    const { rows } = await db.query(query, [cardId]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      card_id: row.card_id,
      name: row.name,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      tags: row.tags,
    };
  },

  async findInstanceById(
    instanceId: string,
    userId: string
  ): Promise<CardResponse | null> {
    const query = `
      SELECT 
        uoc.user_card_instance_id, uoc.user_id, uoc.card_id, uoc.level, uoc.xp,
        c.name, c.rarity, c.image_url, 
        c.power->>'top' as base_power_top,
        c.power->>'right' as base_power_right, 
        c.power->>'bottom' as base_power_bottom, 
        c.power->>'left' as base_power_left, 
        c.special_ability_id, c.tags,
        sa.name as ability_name, sa.description as ability_description, 
        sa.trigger_moment as ability_trigger_moment, sa.parameters as ability_parameters,
        sa.id as ability_id_string
      FROM "user_owned_cards" uoc
      JOIN "cards" c ON uoc.card_id = c.card_id
      LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
      WHERE uoc.user_card_instance_id = $1 AND uoc.user_id = $2;
    `;
    const { rows } = await db.query(query, [instanceId, userId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    const instance: UserCardInstance = {
      user_card_instance_id: row.user_card_instance_id,
      user_id: row.user_id,
      card_id: row.card_id,
      level: row.level,
      xp: row.xp,
      power_enhancements: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    };

    const baseCard: BaseCard = {
      card_id: row.card_id,
      name: row.name,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      tags: row.tags,
    };

    const ability: SpecialAbility | null = row.special_ability_id
      ? {
          ability_id: row.special_ability_id,
          id: row.ability_id_string || "",
          name: row.ability_name,
          description: row.ability_description,
          triggerMoment: row.ability_trigger_moment,
          parameters: row.ability_parameters,
        }
      : null;

    return formatUserCardInstanceResponse(baseCard, instance, ability);
  },

  // Static card data methods
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
      console.log("ids", ids, "page", page, "limit", limit);

      const offset = (page - 1) * limit;

      // Build the query with placeholders
      let whereClauses: string[] = [];
      let queryParams: any[] = [];

      // Start the parameter index at 1
      let paramIndex = 1;

      if (rarity) {
        whereClauses.push(`c.rarity = $${paramIndex}`);
        queryParams.push(rarity);
        paramIndex++;
      }

      if (name) {
        whereClauses.push(`c.name ILIKE $${paramIndex}`);
        queryParams.push(`%${name}%`);
        paramIndex++;
      }

      if (tag) {
        whereClauses.push(`$${paramIndex} = ANY(c.tags)`);
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
            `c.card_id IN (SELECT CAST(unnest($${paramIndex}::text[]) AS uuid))`
          );
          queryParams.push(idArray);
          paramIndex++;
        }
      }

      // Construct the full WHERE clause
      const whereClause =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      // Add limit and offset at the end of the params array
      queryParams.push(limit);
      queryParams.push(offset);

      const dataQuery = `
        SELECT c.card_id, c.name, c.rarity, c.image_url, 
              c.power->>'top' as base_power_top, 
              c.power->>'right' as base_power_right, 
              c.power->>'bottom' as base_power_bottom, 
              c.power->>'left' as base_power_left, 
              c.special_ability_id, c.tags,
              sa.ability_id as sa_ability_id, sa.name as sa_name, 
              sa.description as sa_description,
              sa.trigger_moment as sa_trigger_moment, 
              sa.parameters as sa_parameters
        FROM "cards" c
        LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
        ${whereClause}
        ORDER BY c.name
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
      `;

      console.log("Full SQL query:", dataQuery);
      console.log("Query parameters:", queryParams);

      const { rows: dataRows } = await db.query(dataQuery, queryParams);
      console.log(`Query returned ${dataRows.length} results`);

      // If the main query returned no results but we have IDs, try a fallback approach
      if (dataRows.length === 0 && ids) {
        console.log(
          "Main query returned no results. Trying fallback approach..."
        );

        // Split the IDs and try a direct text-based comparison approach
        const idArray = ids
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0);

        if (idArray.length > 0) {
          // Use a simpler query with explicit casting
          const fallbackQuery = `
            SELECT c.card_id, c.name, c.rarity, c.image_url, 
                  c.power->>'top' as base_power_top, 
                  c.power->>'right' as base_power_right, 
                  c.power->>'bottom' as base_power_bottom, 
                  c.power->>'left' as base_power_left, 
                  c.special_ability_id, c.tags,
                  sa.ability_id as sa_ability_id, sa.name as sa_name, 
                  sa.description as sa_description,
                  sa.trigger_moment as sa_trigger_moment, 
                  sa.parameters as sa_parameters
            FROM "cards" c
            LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
            WHERE c.card_id::text = ANY($1::text[])
            ORDER BY c.name
            LIMIT $2 OFFSET $3;
          `;

          console.log("Executing fallback query with parameters:", [
            idArray,
            limit,
            offset,
          ]);
          const { rows: fallbackRows } = await db.query(fallbackQuery, [
            idArray,
            limit,
            offset,
          ]);
          console.log(`Fallback query returned ${fallbackRows.length} results`);

          if (fallbackRows.length > 0) {
            // Use results from fallback query instead
            console.log("Using fallback query results");

            // Get count of total matching IDs for pagination
            const fallbackCountQuery = `SELECT COUNT(*) FROM "cards" WHERE card_id::text = ANY($1::text[])`;
            const { rows: fallbackCountRows } = await db.query(
              fallbackCountQuery,
              [idArray]
            );

            const data = fallbackRows.map((row) => {
              const cardWithAbility = {
                card_id: row.card_id,
                name: row.name,
                rarity: row.rarity,
                image_url: row.image_url,
                base_power: {
                  top: parseInt(row.base_power_top, 10),
                  right: parseInt(row.base_power_right, 10),
                  bottom: parseInt(row.base_power_bottom, 10),
                  left: parseInt(row.base_power_left, 10),
                },
                special_ability_id: row.special_ability_id,
                tags: row.tags,
                special_ability: row.sa_ability_id
                  ? {
                      ability_id: row.sa_ability_id,
                      name: row.sa_name,
                      description: row.sa_description,
                      triggerMoment: row.sa_trigger_moment,
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
      const countQuery = `SELECT COUNT(*) FROM "cards" c ${whereClause}`;
      const countParams = queryParams.slice(0, -2); // Remove limit and offset

      console.log("Count query:", countQuery);
      console.log("Count params:", countParams);

      const { rows: countRows } = await db.query(countQuery, countParams);

      const data = dataRows.map((row) => {
        const cardWithAbility = {
          card_id: row.card_id,
          name: row.name,
          rarity: row.rarity,
          image_url: row.image_url,
          base_power: {
            top: parseInt(row.base_power_top, 10),
            right: parseInt(row.base_power_right, 10),
            bottom: parseInt(row.base_power_bottom, 10),
            left: parseInt(row.base_power_left, 10),
          },
          special_ability_id: row.special_ability_id,
          tags: row.tags,
          special_ability: row.sa_ability_id
            ? {
                ability_id: row.sa_ability_id,
                name: row.sa_name,
                description: row.sa_description,
                triggerMoment: row.sa_trigger_moment,
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

  async findStaticByIdWithAbility(
    cardId: string
  ): Promise<Omit<
    CardResponse,
    "user_card_instance_id" | "level" | "xp" | "power_enhancements"
  > | null> {
    const query = `
      SELECT
        c.card_id, c.name, c.rarity, c.image_url,
        c.power->>'top' as base_power_top, 
        c.power->>'right' as base_power_right,
        c.power->>'bottom' as base_power_bottom, 
        c.power->>'left' as base_power_left,
        c.special_ability_id, c.tags,
        sa.ability_id as sa_ability_id, sa.name as sa_name, sa.description as sa_description,
        sa.trigger_moment as sa_trigger_moment, sa.parameters as sa_parameters
      FROM "cards" c
      LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
      WHERE c.card_id = $1;
    `;
    const { rows } = await db.query(query, [cardId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    const card: BaseCard & {
      special_ability?: {
        ability_id: string;
        name: string;
        description: string;
        triggerMoment: string;
        parameters: any;
      } | null;
    } = {
      card_id: row.card_id,
      name: row.name,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      tags: row.tags,
      special_ability: row.sa_ability_id
        ? {
            ability_id: row.sa_ability_id,
            name: row.sa_name,
            description: row.sa_description,
            triggerMoment: row.sa_trigger_moment,
            parameters: row.sa_parameters,
          }
        : null,
    };
    return formatStaticCardResponse(card);
  },

  // Keep existing methods for backward compatibility
  async findByName(name: string): Promise<BaseCard | null> {
    const query = `
      SELECT card_id, name, rarity, image_url, 
             power->>'top' as base_power_top, 
             power->>'right' as base_power_right, 
             power->>'bottom' as base_power_bottom, 
             power->>'left' as base_power_left, 
             special_ability_id, tags
      FROM "cards" 
      WHERE name = $1;
    `;
    const { rows } = await db.query(query, [name]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      card_id: row.card_id,
      name: row.name,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      tags: row.tags,
    };
  },

  async findByNames(names: string[]): Promise<BaseCard[]> {
    if (names.length === 0) {
      return [];
    }
    const query = `
      SELECT card_id, name, rarity, image_url, 
             power->>'top' as base_power_top, 
             power->>'right' as base_power_right, 
             power->>'bottom' as base_power_bottom, 
             power->>'left' as base_power_left, 
             special_ability_id, tags
      FROM "cards"
      WHERE name = ANY($1::text[]);
    `;
    const { rows } = await db.query(query, [names]);
    return rows.map((row) => ({
      card_id: row.card_id,
      name: row.name,
      rarity: row.rarity,
      image_url: row.image_url,
      base_power: {
        top: parseInt(row.base_power_top, 10),
        right: parseInt(row.base_power_right, 10),
        bottom: parseInt(row.base_power_bottom, 10),
        left: parseInt(row.base_power_left, 10),
      },
      special_ability_id: row.special_ability_id,
      tags: row.tags,
    }));
  },

  async findAllUserCardInstances(
    userId: string,
    filters: {
      rarity?: string;
      name?: string;
      tag?: string;
      // Add any other user-specific filters if needed
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
      console.log("LIMIT: ", limit);
      const { rarity, name, tag } = filters;
      const offset = (page - 1) * limit;

      let whereClauses: string[] = ["uoc.user_id = $1"];
      let queryParams: any[] = [userId];
      let paramIndex = 2; // Start after userId

      if (rarity) {
        whereClauses.push(`c.rarity = $${paramIndex}`);
        queryParams.push(rarity);
        paramIndex++;
      }

      if (name) {
        whereClauses.push(`c.name ILIKE $${paramIndex}`);
        queryParams.push(`%${name}%`);
        paramIndex++;
      }

      if (tag) {
        whereClauses.push(`$${paramIndex} = ANY(c.tags)`);
        queryParams.push(tag);
        paramIndex++;
      }

      const whereClause =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      queryParams.push(limit);
      queryParams.push(offset);

      const dataQuery = `
        SELECT 
          uoc.user_card_instance_id, uoc.user_id, uoc.card_id, uoc.level, uoc.xp,
          c.name, c.rarity, c.image_url, 
          c.power->>'top' as base_power_top,
          c.power->>'right' as base_power_right, 
          c.power->>'bottom' as base_power_bottom, 
          c.power->>'left' as base_power_left,
          c.special_ability_id, c.tags,
          sa.name as ability_name, sa.description as ability_description, 
          sa.trigger_moment as ability_trigger_moment, sa.parameters as ability_parameters,
          sa.id as ability_id_string 
        FROM "user_owned_cards" uoc
        JOIN "cards" c ON uoc.card_id = c.card_id
        LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
        ${whereClause}
        ORDER BY c.name
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
      `;

      console.log("[findAllUserCardInstances] Data Query:", dataQuery);
      console.log("[findAllUserCardInstances] Query Parameters:", queryParams);

      const { rows: dataRows } = await db.query(dataQuery, queryParams);

      const countQuery = `
        SELECT COUNT(*) 
        FROM "user_owned_cards" uoc
        JOIN "cards" c ON uoc.card_id = c.card_id
        ${whereClause};
      `;
      // Remove limit and offset for count query
      const countParams = queryParams.slice(0, -2);
      console.log("[findAllUserCardInstances] Count Query:", countQuery);
      console.log("[findAllUserCardInstances] Count Parameters:", countParams);
      const { rows: countRows } = await db.query(countQuery, countParams);

      const data = dataRows.map((row) => {
        const baseCard: BaseCard = {
          card_id: row.card_id,
          name: row.name,
          rarity: row.rarity,
          image_url: row.image_url,
          base_power: {
            top: parseInt(row.base_power_top, 10),
            right: parseInt(row.base_power_right, 10),
            bottom: parseInt(row.base_power_bottom, 10),
            left: parseInt(row.base_power_left, 10),
          },
          special_ability_id: row.special_ability_id,
          tags: row.tags,
        };

        const instance: UserCardInstance = {
          user_card_instance_id: row.user_card_instance_id,
          user_id: row.user_id,
          card_id: row.card_id,
          level: row.level,
          xp: row.xp,
          power_enhancements: {
            // Assuming default if not stored
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          },
        };

        const ability: SpecialAbility | null = row.special_ability_id
          ? {
              ability_id: row.special_ability_id,
              id: row.ability_id_string || "",
              name: row.ability_name,
              description: row.ability_description,
              triggerMoment: row.ability_trigger_moment,
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
};

export default CardModel;
