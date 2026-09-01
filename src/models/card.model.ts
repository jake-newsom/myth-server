import db, { QueryExecutor } from "../config/db.config";
import {
  andCatalogReleased,
  CatalogQueryOptions,
} from "../utils/catalogRelease";
import { CardResponse } from "../types/api.types";
import {
  UserCardInstance,
  Card as BaseCard,
  SpecialAbility,
  EquippedBorder,
} from "../types/database.types";
import { TriggerMoment } from "../types/card.types";
import PowerUpService from "../services/powerUp.service";
import StatRollService from "../services/statRoll.service";

/**
 * Common SQL fragment that hydrates a `user_owned_cards` row with all the
 * data needed to build a CardResponse: variant + character + special ability
 * + currently equipped border. Centralising this avoids a copy-paste drift
 * across the four query functions that need it.
 */
const USER_CARD_SELECT_COLUMNS = `
  uoc.user_card_instance_id, uoc.user_id, uoc.card_variant_id, uoc.level, uoc.xp,
  uoc.is_locked, uoc.equipped_border_id,
  ch.character_id, ch.name, ch.description, ch.type,
  ch.base_power->>'top' as base_power_top,
  ch.base_power->>'right' as base_power_right,
  ch.base_power->>'bottom' as base_power_bottom,
  ch.base_power->>'left' as base_power_left,
  ch.special_ability_id, ch.set_id, ch.tags,
  cv.rarity, cv.image_url, cv.attack_animation, cv.is_exclusive,
  COALESCE(cv.sound_effect, ch.sound_effect) as sound_effect,
  sa.name as ability_name, sa.description as ability_description,
  sa.trigger_moments as ability_trigger_moments, sa.parameters as ability_parameters,
  sa.id as ability_id_string, sa.sound_effect as ability_sound_effect,
  cb.border_id as cb_border_id, cb.name as cb_name,
  cb.image_url as cb_image_url, cb.animation_key as cb_animation_key
`;

const USER_CARD_JOINS = `
  FROM "user_owned_cards" uoc
  JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
  JOIN "characters" ch ON cv.character_id = ch.character_id
  LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
  LEFT JOIN "card_borders" cb ON uoc.equipped_border_id = cb.border_id
`;

function rowToEquippedBorder(row: any): EquippedBorder | null {
  if (!row.cb_border_id) return null;
  return {
    border_id: row.cb_border_id,
    name: row.cb_name,
    image_url: row.cb_image_url,
    animation_key: row.cb_animation_key ?? null,
  };
}

// Helper to format the card instance response
function formatUserCardInstanceResponse(
  baseCard: BaseCard,
  instance: UserCardInstance,
  ability: SpecialAbility | null,
  equippedBorder: EquippedBorder | null = null,
  /**
   * Whether this instance has a reforge roll — i.e. whether the stat-roll map
   * the caller already fetched has a row for it. Passed in rather than looked
   * up here so this stays a pure formatter and the batched call sites keep
   * their single lookup.
   */
  isForged = false
): CardResponse {
  return {
    user_card_instance_id: instance.user_card_instance_id,
    base_card_id: baseCard.card_id,
    character_id: baseCard.character_id ?? "",
    name: baseCard.name,
    description: baseCard.description ?? null, // Include description from character
    rarity: baseCard.rarity,
    image_url: baseCard.image_url,
    base_power: baseCard.base_power,
    level: instance.level,
    xp: instance.xp,
    is_locked: instance.is_locked,
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
          ...(ability.sound_effect && { sound_effect: ability.sound_effect }),
        }
      : null,
    ...(baseCard.attack_animation && {
      attack_animation: baseCard.attack_animation,
    }),
    ...(baseCard.sound_effect && { sound_effect: baseCard.sound_effect }),
    ...(baseCard.is_exclusive !== undefined && {
      is_exclusive: baseCard.is_exclusive,
    }),
    // Only emitted when true, like the other optional flags above: every
    // non-forged card's payload is byte-identical to before this change.
    ...(isForged && { is_forged: true }),
    equipped_border: equippedBorder,
  };
}

// Helper to format static card response
function formatStaticCardResponse(
  baseCard: BaseCard & {
    sound_effect?: string;
    special_ability?: {
      ability_id: string;
      name: string;
      description: string;
      triggerMoments: string[];
      parameters: any;
      sound_effect?: string | null;
    } | null;
  }
): Omit<
  CardResponse,
  "user_card_instance_id" | "level" | "xp" | "power_enhancements"
> {
  const {
    special_ability_id,
    card_id,
    character_id,
    attack_animation,
    sound_effect,
    description,
    ...rest
  } = baseCard;
  return {
    ...rest,
    base_card_id: card_id,
    character_id: character_id ?? "",
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
    ...(sound_effect && { sound_effect }),
  };
}

const CardModel = {
  /**
   * Find all card instances owned by a user
   * Joins card_variants -> characters -> special_abilities
   */
  async findInstancesByUserId(
    userId: string,
    options: CatalogQueryOptions = {}
  ): Promise<CardResponse[]> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT ${USER_CARD_SELECT_COLUMNS}
      ${USER_CARD_JOINS}
      WHERE uoc.user_id = $1${andCatalogReleased("ch", "cv", includeUnreleased)}
      ORDER BY ch.name;
    `;

    const { rows } = await db.query(query, [userId]);

    // Get power ups for all card instances
    const instanceIds = rows.map((row) => row.user_card_instance_id);
    const powerUpsMap = await PowerUpService.getPowerUpsByCardInstances(
      instanceIds
    );
    // Reforge offsets, folded into base_power below. Fetched alongside the
    // power-ups (not per row) to keep this a two-query hydration.
    const statRollsMap = await StatRollService.getByCardInstances(instanceIds);

    return rows.map((row) => {
      const baseCard: BaseCard = {
        card_id: row.card_variant_id, // Use variant ID as card_id for compatibility
        character_id: row.character_id,
        name: row.name,
        description: row.description,
        rarity: row.rarity,
        image_url: row.image_url,
        // The catalogue power with this instance's reforge roll already
        // summed in. Folding it here rather than shipping a third field keeps
        // every existing consumer — the engine, the client mirror, GameCard,
        // and ALREADY-SHIPPED builds — correct without changes, since they all
        // compute base_power + power_enhancements.
        base_power: StatRollService.applyToBasePower(
          {
            top: parseInt(row.base_power_top, 10),
            right: parseInt(row.base_power_right, 10),
            bottom: parseInt(row.base_power_bottom, 10),
            left: parseInt(row.base_power_left, 10),
          },
          statRollsMap.get(row.user_card_instance_id)
        ),
        special_ability_id: row.special_ability_id,
        set_id: row.set_id,
        tags: row.tags,
        ...(row.attack_animation && { attack_animation: row.attack_animation }),
        ...(row.sound_effect && { sound_effect: row.sound_effect }),
      is_exclusive: row.is_exclusive ?? false,
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
        is_locked: row.is_locked,
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
            sound_effect: row.ability_sound_effect ?? null,
          }
        : null;

      return formatUserCardInstanceResponse(
        baseCard,
        instance,
        ability,
        rowToEquippedBorder(row),
        statRollsMap.has(row.user_card_instance_id)
      );
    });
  },

  /**
   * Find a card variant by ID (returns flattened card data)
   */
  async findById(
    cardVariantId: string,
    options: CatalogQueryOptions = {}
  ): Promise<BaseCard | null> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT
        cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation, cv.is_exclusive,
        ch.character_id, ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top, 
        ch.base_power->>'right' as base_power_right,
        ch.base_power->>'bottom' as base_power_bottom, 
        ch.base_power->>'left' as base_power_left,
        ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE cv.card_variant_id = $1${andCatalogReleased("ch", "cv", includeUnreleased)};
    `;
    const { rows } = await db.query(query, [cardVariantId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      card_id: row.card_variant_id,
      character_id: row.character_id,
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
      ...(row.sound_effect && { sound_effect: row.sound_effect }),
      is_exclusive: row.is_exclusive ?? false,
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
      SELECT ${USER_CARD_SELECT_COLUMNS}
      ${USER_CARD_JOINS}
      WHERE uoc.user_card_instance_id = $1 AND uoc.user_id = $2;
    `;
    const { rows } = await db.query(query, [instanceId, userId]);
    if (rows.length === 0) return null;

    const row = rows[0];

    // Get power up data for this instance
    const powerUp = await PowerUpService.getPowerUpByCardInstance(instanceId);
    const statRoll = await StatRollService.getByCardInstance(instanceId);
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
      is_locked: row.is_locked,
      power_enhancements: powerEnhancements,
    };

    const baseCard: BaseCard = {
      card_id: row.card_variant_id,
      character_id: row.character_id,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      image_url: row.image_url,
      // Catalogue power with this instance's reforge roll summed in; see the
      // note at the batched hydration sites.
      base_power: StatRollService.applyToBasePower(
        {
          top: parseInt(row.base_power_top, 10),
          right: parseInt(row.base_power_right, 10),
          bottom: parseInt(row.base_power_bottom, 10),
          left: parseInt(row.base_power_left, 10),
        },
        statRoll
      ),
      special_ability_id: row.special_ability_id,
      set_id: row.set_id,
      tags: row.tags,
      ...(row.attack_animation && { attack_animation: row.attack_animation }),
      ...(row.sound_effect && { sound_effect: row.sound_effect }),
      is_exclusive: row.is_exclusive ?? false,
    };

    const ability: SpecialAbility | null = row.special_ability_id
      ? {
          ability_id: row.special_ability_id,
          id: row.ability_id_string || "",
          name: row.ability_name,
          description: row.ability_description,
          triggerMoments: row.ability_trigger_moments || [],
          parameters: row.ability_parameters,
          sound_effect: row.ability_sound_effect ?? null,
        }
      : null;

    return formatUserCardInstanceResponse(
      baseCard,
      instance,
      ability,
      rowToEquippedBorder(row),
      statRoll !== null
    );
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
    limit = 20,
    options: CatalogQueryOptions = {}
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

      const includeUnreleased = options.includeUnreleased === true;

      // Build the query with placeholders
      let whereClauses: string[] = [];
      if (!includeUnreleased) {
        whereClauses.push("ch.released_at <= NOW()");
        whereClauses.push("cv.released_at <= NOW()");
      }
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
        SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation, cv.is_exclusive,
              ch.character_id, ch.name, ch.description, ch.type,
              ch.base_power->>'top' as base_power_top, 
              ch.base_power->>'right' as base_power_right, 
              ch.base_power->>'bottom' as base_power_bottom, 
              ch.base_power->>'left' as base_power_left, 
              ch.special_ability_id, ch.set_id, ch.tags,
              COALESCE(cv.sound_effect, ch.sound_effect) as sound_effect,
              sa.ability_id as sa_ability_id, sa.name as sa_name,
              sa.description as sa_description,
              sa.trigger_moments as sa_trigger_moments,
              sa.parameters as sa_parameters, sa.sound_effect as sa_sound_effect
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

          const fallbackReleased =
            includeUnreleased
              ? ""
              : " AND ch.released_at <= NOW() AND cv.released_at <= NOW()";
          const fallbackQuery = `
            SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation, cv.is_exclusive,
                  ch.character_id, ch.name, ch.description, ch.type,
                  ch.base_power->>'top' as base_power_top, 
                  ch.base_power->>'right' as base_power_right, 
                  ch.base_power->>'bottom' as base_power_bottom, 
                  ch.base_power->>'left' as base_power_left, 
                  ch.special_ability_id, ch.set_id, ch.tags,
                  COALESCE(cv.sound_effect, ch.sound_effect) as sound_effect,
                  sa.ability_id as sa_ability_id, sa.name as sa_name,
                  sa.description as sa_description,
                  sa.trigger_moments as sa_trigger_moments,
                  sa.parameters as sa_parameters, sa.sound_effect as sa_sound_effect
            FROM "card_variants" cv
            JOIN "characters" ch ON cv.character_id = ch.character_id
            LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
            WHERE cv.card_variant_id::text = ANY($1::text[])${fallbackReleased}
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
            const fallbackCountReleased = includeUnreleased
              ? ""
              : ` AND cv.released_at <= NOW()
                  AND EXISTS (
                    SELECT 1 FROM characters ch2
                    WHERE ch2.character_id = cv.character_id AND ch2.released_at <= NOW()
                  )`;
            const fallbackCountQuery = `
              SELECT COUNT(*) FROM "card_variants" cv
              WHERE cv.card_variant_id::text = ANY($1::text[])${fallbackCountReleased}`;
            const { rows: fallbackCountRows } = await db.query(
              fallbackCountQuery,
              [idArray]
            );

            const data = fallbackRows.map((row) => {
              const cardWithAbility = {
                card_id: row.card_variant_id,
                character_id: row.character_id,
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
                ...(row.sound_effect && { sound_effect: row.sound_effect }),
                is_exclusive: row.is_exclusive ?? false,
                special_ability: row.sa_ability_id
                  ? {
                      ability_id: row.sa_ability_id,
                      name: row.sa_name,
                      description: row.sa_description,
                      triggerMoments: row.sa_trigger_moments || [],
                      parameters: row.sa_parameters,
                      sound_effect: row.sa_sound_effect ?? null,
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
      const countParams = limit > 0 ? queryParams.slice(0, -2) : queryParams;

      const { rows: countRows } = await db.query(countQuery, countParams);

      const data = dataRows.map((row) => {
        const cardWithAbility = {
          card_id: row.card_variant_id,
          character_id: row.character_id,
          name: row.name,
          description: row.description,
          rarity: row.rarity,
          image_url: row.image_url,
          ...(row.attack_animation && {
            attack_animation: row.attack_animation,
          }),
          ...(row.sound_effect && { sound_effect: row.sound_effect }),
          is_exclusive: row.is_exclusive ?? false,
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
                sound_effect: row.sa_sound_effect ?? null,
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
    cardVariantId: string,
    options: CatalogQueryOptions = {}
  ): Promise<Omit<
    CardResponse,
    "user_card_instance_id" | "level" | "xp" | "power_enhancements"
  > | null> {
    const query = `
      SELECT
        cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation, cv.is_exclusive,
        ch.character_id, ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top, 
        ch.base_power->>'right' as base_power_right,
        ch.base_power->>'bottom' as base_power_bottom, 
        ch.base_power->>'left' as base_power_left,
        ch.special_ability_id, ch.set_id, ch.tags,
        COALESCE(cv.sound_effect, ch.sound_effect) as sound_effect,
        sa.ability_id as sa_ability_id, sa.name as sa_name, sa.description as sa_description,
        sa.trigger_moments as sa_trigger_moments, sa.parameters as sa_parameters,
        sa.sound_effect as sa_sound_effect
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
      WHERE cv.card_variant_id = $1${andCatalogReleased("ch", "cv", options.includeUnreleased === true)};
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
      character_id: row.character_id,
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
      ...(row.sound_effect && { sound_effect: row.sound_effect }),
      is_exclusive: row.is_exclusive ?? false,
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
            sound_effect: row.sa_sound_effect ?? null,
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
      SELECT ${USER_CARD_SELECT_COLUMNS}
      ${USER_CARD_JOINS}
      WHERE uoc.user_card_instance_id = ANY($1)
      ORDER BY ch.name;
    `;

    const { rows } = await db.query(query, [instanceIds]);

    // Get power ups for all card instances
    const powerUpsMap = await PowerUpService.getPowerUpsByCardInstances(
      instanceIds
    );
    // Reforge offsets, folded into base_power below. Fetched alongside the
    // power-ups (not per row) to keep this a two-query hydration.
    const statRollsMap = await StatRollService.getByCardInstances(instanceIds);

    return rows.map((row) => {
      const baseCard: BaseCard = {
        card_id: row.card_variant_id,
        character_id: row.character_id,
        name: row.name,
        description: row.description,
        rarity: row.rarity,
        image_url: row.image_url,
        // The catalogue power with this instance's reforge roll already
        // summed in. Folding it here rather than shipping a third field keeps
        // every existing consumer — the engine, the client mirror, GameCard,
        // and ALREADY-SHIPPED builds — correct without changes, since they all
        // compute base_power + power_enhancements.
        base_power: StatRollService.applyToBasePower(
          {
            top: parseInt(row.base_power_top, 10),
            right: parseInt(row.base_power_right, 10),
            bottom: parseInt(row.base_power_bottom, 10),
            left: parseInt(row.base_power_left, 10),
          },
          statRollsMap.get(row.user_card_instance_id)
        ),
        special_ability_id: row.special_ability_id,
        set_id: row.set_id,
        tags: row.tags,
        ...(row.attack_animation && { attack_animation: row.attack_animation }),
        ...(row.sound_effect && { sound_effect: row.sound_effect }),
      is_exclusive: row.is_exclusive ?? false,
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
        is_locked: row.is_locked,
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
            sound_effect: row.ability_sound_effect ?? null,
          }
        : null;

      return formatUserCardInstanceResponse(
        baseCard,
        instance,
        ability,
        rowToEquippedBorder(row),
        statRollsMap.has(row.user_card_instance_id)
      );
    });
  },

  /**
   * Find a card variant by character name (returns first match)
   */
  async findByName(
    name: string,
    options: CatalogQueryOptions = {}
  ): Promise<BaseCard | null> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation, cv.is_exclusive,
             ch.character_id, ch.name, ch.description,
             ch.base_power->>'top' as base_power_top, 
             ch.base_power->>'right' as base_power_right, 
             ch.base_power->>'bottom' as base_power_bottom, 
             ch.base_power->>'left' as base_power_left, 
             ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE ch.name = $1${andCatalogReleased("ch", "cv", includeUnreleased)}
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [name]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      card_id: row.card_variant_id,
      character_id: row.character_id,
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
      ...(row.sound_effect && { sound_effect: row.sound_effect }),
      is_exclusive: row.is_exclusive ?? false,
    };
  },

  /**
   * Find card variants by character names (returns one variant per name)
   */
  async findByNames(
    names: string[],
    options: CatalogQueryOptions = {}
  ): Promise<BaseCard[]> {
    if (names.length === 0) {
      return [];
    }
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT DISTINCT ON (ch.name) 
             cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation, cv.is_exclusive,
             ch.character_id, ch.name, ch.description,
             ch.base_power->>'top' as base_power_top, 
             ch.base_power->>'right' as base_power_right, 
             ch.base_power->>'bottom' as base_power_bottom, 
             ch.base_power->>'left' as base_power_left, 
             ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE ch.name = ANY($1::text[])${andCatalogReleased("ch", "cv", includeUnreleased)}
      ORDER BY ch.name, cv.rarity;
    `;
    const { rows } = await db.query(query, [names]);
    return rows.map((row) => ({
      card_id: row.card_variant_id,
      character_id: row.character_id,
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
      ...(row.sound_effect && { sound_effect: row.sound_effect }),
      is_exclusive: row.is_exclusive ?? false,
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
    limit = 20,
    options: CatalogQueryOptions = {}
  ): Promise<{
    data: CardResponse[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const { rarity, name, tag } = filters;
      const offset = (page - 1) * limit;
      const includeUnreleased = options.includeUnreleased === true;

      let whereClauses: string[] = ["uoc.user_id = $1"];
      if (!includeUnreleased) {
        whereClauses.push("ch.released_at <= NOW()");
        whereClauses.push("cv.released_at <= NOW()");
      }
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
        SELECT ${USER_CARD_SELECT_COLUMNS}
        ${USER_CARD_JOINS}
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
      // Reforge offsets, folded into base_power below. Fetched alongside the
      // power-ups (not per row) to keep this a two-query hydration.
      const statRollsMap = await StatRollService.getByCardInstances(
        instanceIds
      );

      const data = dataRows.map((row) => {
        const baseCard: BaseCard = {
          card_id: row.card_variant_id,
          character_id: row.character_id,
          name: row.name,
          description: row.description,
          rarity: row.rarity,
          image_url: row.image_url,
          // Catalogue power with this instance's reforge roll summed in; see
          // the note at the other hydration sites.
          base_power: StatRollService.applyToBasePower(
            {
              top: parseInt(row.base_power_top, 10),
              right: parseInt(row.base_power_right, 10),
              bottom: parseInt(row.base_power_bottom, 10),
              left: parseInt(row.base_power_left, 10),
            },
            statRollsMap.get(row.user_card_instance_id)
          ),
          special_ability_id: row.special_ability_id,
          set_id: row.set_id,
          tags: row.tags,
          is_exclusive: row.is_exclusive ?? false,
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
          is_locked: row.is_locked,
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
              sound_effect: row.ability_sound_effect ?? null,
            }
          : null;

        return formatUserCardInstanceResponse(
          baseCard,
          instance,
          ability,
          rowToEquippedBorder(row),
          statRollsMap.has(row.user_card_instance_id)
        );
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
    cardVariantId: string,
    client?: QueryExecutor,
    options?: { isLocked?: boolean }
  ): Promise<UserCardInstance> {
    const exec = client ?? db;
    const query = `
      INSERT INTO "user_owned_cards" (user_id, card_variant_id, level, xp, is_locked)
      VALUES ($1, $2, 1, 0, $3)
      RETURNING user_card_instance_id, user_id, card_variant_id, level, xp, is_locked, created_at;
    `;

    // Defaults to false, i.e. the column default, so every existing caller
    // keeps minting unlocked cards.
    const { rows } = await exec.query(query, [
      userId,
      cardVariantId,
      options?.isLocked === true,
    ]);
    return rows[0];
  },

  /**
   * Bulk insert cards for a user. Single round-trip; one row per provided
   * card_variant_id (duplicates produce multiple instances on purpose since
   * cards are not unique-per-user). Returns the new instance ids paired with
   * their card_variant_id in the same order they were inserted.
   */
  async addCardsToUserBulk(
    userId: string,
    cardVariantIds: string[],
    client?: QueryExecutor
  ): Promise<Array<{ user_card_instance_id: string; card_variant_id: string }>> {
    if (cardVariantIds.length === 0) return [];
    const exec = client ?? db;
    const query = `
      INSERT INTO "user_owned_cards" (user_id, card_variant_id, level, xp)
      SELECT $1, card_variant_id, 1, 0
      FROM unnest($2::uuid[]) WITH ORDINALITY AS t(card_variant_id, ord)
      ORDER BY ord
      RETURNING user_card_instance_id, card_variant_id;
    `;
    const { rows } = await exec.query(query, [userId, cardVariantIds]);
    return rows.map((r) => ({
      user_card_instance_id: r.user_card_instance_id,
      card_variant_id: r.card_variant_id,
    }));
  },

  /**
   * Set lock state for a specific user-owned card instance.
   */
  async setCardLockState(
    userId: string,
    userCardInstanceId: string,
    isLocked: boolean
  ): Promise<{ user_card_instance_id: string; is_locked: boolean } | null> {
    const query = `
      UPDATE "user_owned_cards"
      SET is_locked = $1
      WHERE user_card_instance_id = $2 AND user_id = $3
      RETURNING user_card_instance_id, is_locked;
    `;
    const { rows } = await db.query(query, [isLocked, userCardInstanceId, userId]);
    return rows[0] || null;
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
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE uoc.user_id = $1
        AND POSITION('+' IN cv.rarity::text) > 0
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW();
    `;
    const { rows } = await db.query(query, [userId]);
    return parseInt(rows[0].count, 10);
  },

  /**
   * For each set, count the distinct characters in that set the user owns at
   * least one card of. Returned keyed by lowercased set name (the same slug
   * convention used by the set-collection achievement keys).
   *
   * Sets with zero owned characters are still present in the result with a
   * count of 0, so callers can drive `mode: "set"` achievement progress from
   * the map directly without separately knowing which sets exist.
   */
  async getUserUniqueCharactersBySetSlug(
    userId: string
  ): Promise<Record<string, number>> {
    const query = `
      SELECT
        lower(s.name) AS set_slug,
        COUNT(DISTINCT ch.character_id) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM "user_owned_cards" uoc
            JOIN "card_variants" cv
              ON cv.card_variant_id = uoc.card_variant_id
            WHERE uoc.user_id = $1
              AND cv.character_id = ch.character_id
              AND cv.released_at <= NOW()
              AND ch.released_at <= NOW()
          )
        )::int AS owned_character_count
      FROM "sets" s
      LEFT JOIN "characters" ch ON ch.set_id = s.set_id AND ch.released_at <= NOW()
      GROUP BY s.name;
    `;
    const { rows } = await db.query(query, [userId]);

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.set_slug] = row.owned_character_count;
    }
    return result;
  },

  /**
   * Get count of cards at OR ABOVE each level, by rarity, for a user.
   *
   * The returned map is cumulative: result.epic[2] is the number of epic cards
   * at level 2 or higher, not the number sitting exactly at level 2. This is
   * what the level_* achievements mean by "reach level 2 with 20 epic cards" —
   * a card levelled to 5 has self-evidently reached level 2.
   *
   * This used to bucket by exact level, which made leveling a card REMOVE it
   * from every lower tier's count and left those achievements permanently
   * unreachable for active players.
   *
   * Levels below 2 are excluded because no achievement targets them; level 1 is
   * the default state of every owned card.
   */
  async getUserCardsAtLevelByRarity(
    userId: string
  ): Promise<Record<string, Record<number, number>>> {
    // Rarity is normalised to its base tier first: "+" / "++" / "+++" variants
    // are cosmetic upgrades of the same tier (see RarityUtils.getBaseRarity and
    // getUserUniqueCardCountByRarity above), so a levelled "epic++" must count
    // toward the epic achievements. Matching the raw enum would silently ignore
    // every upgraded card a player owns.
    //
    // The window then sums each rarity's per-level counts from the highest level
    // downward, so every row carries the total at-or-above its own level.
    const query = `
      SELECT
        rarity,
        level,
        SUM(level_count) OVER (
          PARTITION BY rarity
          ORDER BY level DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS at_or_above
      FROM (
        SELECT
          replace(cv.rarity::text, '+', '') AS rarity,
          uoc.level AS level,
          COUNT(*) AS level_count
        FROM "user_owned_cards" uoc
        JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
        JOIN "characters" ch ON cv.character_id = ch.character_id
        WHERE uoc.user_id = $1
          AND uoc.level >= 2
          AND replace(cv.rarity::text, '+', '') IN ('rare', 'epic', 'legendary')
          AND cv.released_at <= NOW()
          AND ch.released_at <= NOW()
        GROUP BY replace(cv.rarity::text, '+', ''), uoc.level
      ) per_level;
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
      const atOrAbove = parseInt(row.at_or_above, 10);

      if (result[rarity]) {
        result[rarity][level] = atOrAbove;
      }
    }

    // Only levels a user actually owns cards at appear above, so a gap leaves a
    // hole: owning legendaries at 5 and 6 but none at 3 or 4 yields keys 5 and 6
    // and nothing at 3, even though "3 or above" is 2. Fill every level from 2 up
    // to the highest seen so callers can index any level directly.
    for (const rarity of Object.keys(result)) {
      const levels = result[rarity];
      const owned = Object.keys(levels).map((lvl) => parseInt(lvl, 10));
      if (owned.length === 0) continue;

      const highest = Math.max(...owned);
      // Walk downward carrying the running total, so each missing level inherits
      // the count from the next level up.
      let carried = 0;
      for (let level = highest; level >= 2; level--) {
        if (levels[level] !== undefined) {
          carried = levels[level];
        } else {
          levels[level] = carried;
        }
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
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE uoc.user_id = $1
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW()
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
  async findVariantsByCharacterId(
    characterId: string,
    options: CatalogQueryOptions = {}
  ): Promise<BaseCard[]> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation, cv.is_exclusive,
             ch.name, ch.description,
             ch.base_power->>'top' as base_power_top, 
             ch.base_power->>'right' as base_power_right, 
             ch.base_power->>'bottom' as base_power_bottom, 
             ch.base_power->>'left' as base_power_left, 
             ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE cv.character_id = $1${andCatalogReleased("ch", "cv", includeUnreleased)}
      ORDER BY cv.rarity;
    `;
    const { rows } = await db.query(query, [characterId]);
    return rows.map((row) => ({
      card_id: row.card_variant_id,
      character_id: characterId,
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
      ...(row.sound_effect && { sound_effect: row.sound_effect }),
      is_exclusive: row.is_exclusive ?? false,
    }));
  },

  /**
   * Find all variants for a character by name
   */
  async findVariantsByCharacterName(
    characterName: string,
    options: CatalogQueryOptions = {}
  ): Promise<BaseCard[]> {
    const includeUnreleased = options.includeUnreleased === true;
    const query = `
      SELECT cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation, cv.is_exclusive,
             ch.character_id, ch.name, ch.description,
             ch.base_power->>'top' as base_power_top, 
             ch.base_power->>'right' as base_power_right, 
             ch.base_power->>'bottom' as base_power_bottom, 
             ch.base_power->>'left' as base_power_left, 
             ch.special_ability_id, ch.set_id, ch.tags
      FROM "card_variants" cv
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE ch.name = $1${andCatalogReleased("ch", "cv", includeUnreleased)}
      ORDER BY cv.rarity;
    `;
    const { rows } = await db.query(query, [characterName]);
    return rows.map((row) => ({
      card_id: row.card_variant_id,
      character_id: row.character_id,
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
      ...(row.sound_effect && { sound_effect: row.sound_effect }),
      is_exclusive: row.is_exclusive ?? false,
    }));
  },
};

export default CardModel;
