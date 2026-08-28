import db from "../config/db.config";
import {
  DailyShopConfig,
  DailyShopOffering,
  DailyShopOfferingWithCard,
  DailyShopPurchase,
  DailyShopRotation,
  ShopItemType,
  ShopTab,
  ShopTabReset,
  CurrencyType,
} from "../types/database.types";
import { QueryExecutor } from "../config/db.config";

const DailyShopModel = {
  // Configuration Management
  async getShopConfig(): Promise<DailyShopConfig[]> {
    const query = `
      SELECT config_id, item_type, daily_limit, price, currency, 
             daily_availability, is_active, reset_price_gems, created_at, updated_at
      FROM daily_shop_config
      WHERE is_active = true
      ORDER BY item_type;
    `;
    const { rows } = await db.query(query);
    return rows;
  },

  async getConfigByItemType(
    itemType: ShopItemType
  ): Promise<DailyShopConfig | null> {
    const query = `
      SELECT config_id, item_type, daily_limit, price, currency, 
             daily_availability, is_active, reset_price_gems, created_at, updated_at
      FROM daily_shop_config
      WHERE item_type = $1 AND is_active = true;
    `;
    const { rows } = await db.query(query, [itemType]);
    return rows[0] || null;
  },

  async updateShopConfig(
    itemType: ShopItemType,
    updates: Partial<
      Omit<
        DailyShopConfig,
        "config_id" | "item_type" | "created_at" | "updated_at"
      >
    >
  ): Promise<DailyShopConfig | null> {
    const setClause = [];
    const values = [];
    let paramIndex = 2;

    if (updates.daily_limit !== undefined) {
      setClause.push(`daily_limit = $${paramIndex++}`);
      values.push(updates.daily_limit);
    }
    if (updates.price !== undefined) {
      setClause.push(`price = $${paramIndex++}`);
      values.push(updates.price);
    }
    if (updates.currency !== undefined) {
      setClause.push(`currency = $${paramIndex++}`);
      values.push(updates.currency);
    }
    if (updates.daily_availability !== undefined) {
      setClause.push(`daily_availability = $${paramIndex++}`);
      values.push(updates.daily_availability);
    }
    if (updates.is_active !== undefined) {
      setClause.push(`is_active = $${paramIndex++}`);
      values.push(updates.is_active);
    }
    if (updates.reset_price_gems !== undefined) {
      setClause.push(`reset_price_gems = $${paramIndex++}`);
      values.push(updates.reset_price_gems);
    }

    if (setClause.length === 0) {
      return null;
    }

    setClause.push("updated_at = current_timestamp");

    const query = `
      UPDATE daily_shop_config
      SET ${setClause.join(", ")}
      WHERE item_type = $1
      RETURNING config_id, item_type, daily_limit, price, currency, 
                daily_availability, is_active, reset_price_gems, created_at, updated_at;
    `;

    const { rows } = await db.query(query, [itemType, ...values]);
    return rows[0] || null;
  },

  // Shop Offerings Management
  /**
   * Today's offerings, optionally restricted to a set of tabs.
   *
   * The default is `["daily"]` rather than "everything": the Soul Shop puts
   * hundreds of rows in this table per day, and shipped clients render
   * `offerings[]` as one flat list. Callers that want the soul catalogue ask
   * for it explicitly.
   */
  async getTodaysOfferings(
    shopDate: string,
    tabs: ShopTab[] = ["daily"]
  ): Promise<DailyShopOfferingWithCard[]> {
    const query = `
      SELECT 
        dso.offering_id, dso.shop_date, dso.item_type, dso.card_id, 
        dso.mythology, dso.price, dso.currency, dso.slot_number,
        dso.shop_tab, dso.created_at,
        cv.card_variant_id as card_card_id, ch.name as card_name, cv.rarity as card_rarity, 
        cv.image_url as card_image_url, ch.tags as card_tags, ch.set_id as card_set_id,
        ch.description as card_description,
        ch.base_power->>'top' as card_power_top,
        ch.base_power->>'right' as card_power_right, 
        ch.base_power->>'bottom' as card_power_bottom, 
        ch.base_power->>'left' as card_power_left,
        ch.special_ability_id as card_special_ability_id,
        COALESCE(cv.sound_effect, ch.sound_effect) as card_sound_effect,
        sa.name as ability_name, sa.description as ability_description,
        sa.trigger_moments as ability_trigger_moments, sa.parameters as ability_parameters,
        sa.id as ability_id_string, sa.sound_effect as ability_sound_effect
      FROM daily_shop_offerings dso
      LEFT JOIN card_variants cv ON dso.card_id = cv.card_variant_id
      LEFT JOIN characters ch ON cv.character_id = ch.character_id
      LEFT JOIN special_abilities sa ON ch.special_ability_id = sa.ability_id
      WHERE dso.shop_date = $1
        AND dso.shop_tab = ANY($2::text[])
        AND (
          dso.card_id IS NULL
          OR (
            COALESCE(cv.is_exclusive, false) = false
            AND cv.rarity::text <> 'legendary+++'
            AND cv.released_at <= NOW()
            AND ch.released_at <= NOW()
          )
        )
      ORDER BY dso.item_type, dso.slot_number;
    `;

    const { rows } = await db.query(query, [shopDate, tabs]);

    return rows.map((row) => ({
      offering_id: row.offering_id,
      shop_date: row.shop_date,
      item_type: row.item_type,
      card_id: row.card_id,
      mythology: row.mythology,
      price: row.price,
      currency: row.currency,
      slot_number: row.slot_number,
      shop_tab: row.shop_tab ?? "daily",
      created_at: row.created_at,
      card: row.card_name
        ? {
            card_id: row.card_card_id,
            // Clients key ownership ("NEW" badge) off base_card_id, the variant
            // UUID. Emitted alongside card_id, which older clients still read.
            base_card_id: row.card_card_id,
            name: row.card_name,
            description: row.card_description ?? null,
            rarity: row.card_rarity,
            image_url: row.card_image_url,
            tags: row.card_tags || [],
            set_id: row.card_set_id,
            base_power: {
              top: parseInt(row.card_power_top) || 0,
              right: parseInt(row.card_power_right) || 0,
              bottom: parseInt(row.card_power_bottom) || 0,
              left: parseInt(row.card_power_left) || 0,
            },
            special_ability: row.ability_name
              ? {
                  ability_id: row.card_special_ability_id,
                  name: row.ability_name,
                  description: row.ability_description,
                  trigger_moments: row.ability_trigger_moments || [],
                  parameters: row.ability_parameters,
                  ...(row.ability_sound_effect && {
                    sound_effect: row.ability_sound_effect,
                  }),
                }
              : null,
            ...(row.card_sound_effect && {
              sound_effect: row.card_sound_effect,
            }),
          }
        : undefined,
    }));
  },

  async createOffering(
    offering: Omit<DailyShopOffering, "offering_id" | "created_at">,
    executor: QueryExecutor = db
  ): Promise<DailyShopOffering> {
    const query = `
      INSERT INTO daily_shop_offerings (shop_date, item_type, card_id, mythology, price, currency, slot_number, shop_tab)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING offering_id, shop_date, item_type, card_id, mythology, price, currency, slot_number, shop_tab, created_at;
    `;

    const { rows } = await executor.query(query, [
      offering.shop_date,
      offering.item_type,
      offering.card_id,
      offering.mythology,
      offering.price,
      offering.currency,
      offering.slot_number,
      offering.shop_tab ?? "daily",
    ]);

    return rows[0];
  },

  /**
   * Bulk-insert offerings in a single round trip.
   *
   * The Soul Shop writes the entire common+rare pool every day — hundreds of
   * rows — and one INSERT per card is hundreds of sequential round trips on the
   * daily rotation path.
   */
  async createOfferingsBulk(
    offerings: Omit<DailyShopOffering, "offering_id" | "created_at">[],
    executor: QueryExecutor = db
  ): Promise<number> {
    if (offerings.length === 0) return 0;

    const query = `
      INSERT INTO daily_shop_offerings
        (shop_date, item_type, card_id, mythology, price, currency, slot_number, shop_tab)
      SELECT * FROM UNNEST(
        $1::date[], $2::shop_item_type[], $3::uuid[], $4::varchar[],
        $5::integer[], $6::currency_type[], $7::integer[], $8::varchar[]
      );
    `;

    await executor.query(query, [
      offerings.map((o) => o.shop_date),
      offerings.map((o) => o.item_type),
      offerings.map((o) => o.card_id ?? null),
      offerings.map((o) => o.mythology ?? null),
      offerings.map((o) => o.price),
      offerings.map((o) => o.currency),
      offerings.map((o) => o.slot_number),
      offerings.map((o) => o.shop_tab ?? "daily"),
    ]);

    return offerings.length;
  },

  /**
   * Clear a date's offerings, optionally only for some tabs.
   *
   * Tab-scoped by default at the call sites so regenerating the daily rotation
   * cannot wipe the soul catalogue (or vice versa) as a side effect.
   */
  async clearOfferingsForDate(
    shopDate: string,
    tabs?: ShopTab[],
    executor: QueryExecutor = db
  ): Promise<void> {
    if (tabs && tabs.length > 0) {
      await executor.query(
        `DELETE FROM daily_shop_offerings WHERE shop_date = $1 AND shop_tab = ANY($2::text[]);`,
        [shopDate, tabs]
      );
      return;
    }
    await executor.query(
      `DELETE FROM daily_shop_offerings WHERE shop_date = $1;`,
      [shopDate]
    );
  },

  // Purchase Management
  async getUserPurchasesForDate(
    userId: string,
    shopDate: string
  ): Promise<DailyShopPurchase[]> {
    const query = `
      SELECT purchase_id, user_id, offering_id, shop_date, item_type, 
             quantity_purchased, total_cost, currency_used, resets_used, purchased_at
      FROM daily_shop_purchases
      WHERE user_id = $1 AND shop_date = $2
      ORDER BY purchased_at;
    `;

    const { rows } = await db.query(query, [userId, shopDate]);
    return rows;
  },

  async getUserPurchasesByItemType(
    userId: string,
    shopDate: string,
    itemType: ShopItemType
  ): Promise<DailyShopPurchase[]> {
    const query = `
      SELECT purchase_id, user_id, offering_id, shop_date, item_type, 
             quantity_purchased, total_cost, currency_used, resets_used, purchased_at
      FROM daily_shop_purchases
      WHERE user_id = $1 AND shop_date = $2 AND item_type = $3
      ORDER BY purchased_at;
    `;

    const { rows } = await db.query(query, [userId, shopDate, itemType]);
    return rows;
  },

  async createPurchase(
    purchase: Omit<DailyShopPurchase, "purchase_id" | "purchased_at">
  ): Promise<DailyShopPurchase> {
    const query = `
      INSERT INTO daily_shop_purchases (user_id, offering_id, shop_date, item_type, 
                                       quantity_purchased, total_cost, currency_used, resets_used)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING purchase_id, user_id, offering_id, shop_date, item_type, 
                quantity_purchased, total_cost, currency_used, resets_used, purchased_at;
    `;

    const { rows } = await db.query(query, [
      purchase.user_id,
      purchase.offering_id,
      purchase.shop_date,
      purchase.item_type,
      purchase.quantity_purchased,
      purchase.total_cost,
      purchase.currency_used,
      purchase.resets_used,
    ]);

    return rows[0];
  },

  // Rotation Management
  async getRotationState(
    mythology: string,
    itemType: ShopItemType
  ): Promise<DailyShopRotation | null> {
    const query = `
      SELECT rotation_id, mythology, item_type, current_card_index, last_updated
      FROM daily_shop_rotations
      WHERE mythology = $1 AND item_type = $2;
    `;

    const { rows } = await db.query(query, [mythology, itemType]);
    return rows[0] || null;
  },

  async updateRotationState(
    mythology: string,
    itemType: ShopItemType,
    newIndex: number
  ): Promise<DailyShopRotation> {
    const query = `
      INSERT INTO daily_shop_rotations (mythology, item_type, current_card_index, last_updated)
      VALUES ($1, $2, $3, current_timestamp)
      ON CONFLICT (mythology, item_type) 
      DO UPDATE SET 
        current_card_index = EXCLUDED.current_card_index,
        last_updated = current_timestamp
      RETURNING rotation_id, mythology, item_type, current_card_index, last_updated;
    `;

    const { rows } = await db.query(query, [mythology, itemType, newIndex]);
    return rows[0];
  },

  async getAllRotationStates(): Promise<DailyShopRotation[]> {
    const query = `
      SELECT rotation_id, mythology, item_type, current_card_index, last_updated
      FROM daily_shop_rotations
      ORDER BY mythology, item_type;
    `;

    const { rows } = await db.query(query);
    return rows;
  },

  // Utility Methods
  async getCardsByMythologyAndRarity(
    mythology: string,
    rarity: string
  ): Promise<any[]> {
    // Map mythology name to set name (capitalize first letter)
    const setName = mythology.charAt(0).toUpperCase() + mythology.slice(1);
    
    const query = `
      SELECT cv.card_variant_id as card_id, ch.name, cv.rarity, cv.image_url, ch.tags
      FROM card_variants cv
      JOIN characters ch ON cv.character_id = ch.character_id
      INNER JOIN sets s ON ch.set_id = s.set_id
      WHERE s.name = $1 AND cv.rarity::text = $2
        AND COALESCE(cv.is_exclusive, false) = false
        AND cv.rarity::text <> 'legendary+++'
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW()
      ORDER BY ch.name;
    `;

    console.log(`[DEBUG] getCardsByMythologyAndRarity called with mythology="${mythology}", rarity="${rarity}", setName="${setName}"`);
    const { rows } = await db.query(query, [setName, rarity]);
    console.log(`[DEBUG] Query returned ${rows.length} cards`);
    return rows;
  },

  async getEnhancedCards(limit: number = 10): Promise<any[]> {
    const query = `
      SELECT cv.card_variant_id as card_id, ch.name, cv.rarity, cv.image_url, ch.tags, s.name as set_name
      FROM card_variants cv
      JOIN characters ch ON cv.character_id = ch.character_id
      INNER JOIN sets s ON ch.set_id = s.set_id
      WHERE cv.rarity::text ~ '^(common|uncommon|rare|epic|legendary)\\+{1,3}$'
        AND COALESCE(cv.is_exclusive, false) = false
        AND cv.rarity::text <> 'legendary+++'
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW()
      ORDER BY cv.card_variant_id;
    `;

    const { rows } = await db.query(query);
    if (rows.length <= limit) {
      return rows;
    }

    // Fisher-Yates shuffle in memory to avoid ORDER BY RANDOM() on large sets
    const shuffled = [...rows];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, limit);
  },

  /**
   * Every released card at a given BASE rarity, across all sets.
   *
   * Base rarity, not exact rarity: `rarity` packs the tier and the cosmetic
   * upgrade (`rare`, `rare+`, `rare++`…), so an exact comparison would silently
   * drop every upgraded printing. The Soul Shop stocks the plain printing only
   * — `rarity::text = $1` with no suffix — because that is the one every player
   * needs for a collection achievement, and it keeps the catalogue a fixed size.
   *
   * Ordered by card_variant_id so the catalogue is stable day to day.
   */
  async getCardsByBaseRarity(baseRarity: string): Promise<any[]> {
    const query = `
      SELECT cv.card_variant_id as card_id, ch.name, cv.rarity, cv.image_url,
             ch.tags, s.name as set_name
      FROM card_variants cv
      JOIN characters ch ON cv.character_id = ch.character_id
      LEFT JOIN sets s ON ch.set_id = s.set_id
      WHERE cv.rarity::text = $1
        AND COALESCE(cv.is_exclusive, false) = false
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW()
      ORDER BY cv.card_variant_id;
    `;
    const { rows } = await db.query(query, [baseRarity]);
    return rows;
  },

  // Tab Reset Management
  /**
   * Every reset counter a player currently holds, keyed by tab.
   *
   * Reads by period_key rather than deleting stale rows: an expired period is
   * simply never queried again, so there is no cleanup job and no window where
   * a reset count is wrong because a sweep has not run yet.
   */
  async getTabResets(
    userId: string,
    periodKeys: Record<string, string>
  ): Promise<Record<string, ShopTabReset>> {
    const tabs = Object.keys(periodKeys);
    if (tabs.length === 0) return {};

    const query = `
      SELECT reset_id, user_id, shop_tab, period_key, resets_used, gems_spent, updated_at
      FROM shop_tab_resets
      WHERE user_id = $1
        AND (shop_tab, period_key) IN (
          SELECT * FROM UNNEST($2::text[], $3::text[])
        );
    `;
    const { rows } = await db.query(query, [
      userId,
      tabs,
      tabs.map((t) => periodKeys[t]),
    ]);

    const byTab: Record<string, ShopTabReset> = {};
    for (const row of rows) {
      byTab[row.shop_tab] = row;
    }
    return byTab;
  },

  /**
   * Increment a tab's reset counter and return the new state.
   *
   * The whole read-modify-write is one statement so two concurrent resets
   * cannot both read the same count and charge the same price twice.
   */
  async incrementTabReset(
    userId: string,
    shopTab: string,
    periodKey: string,
    gemsSpent: number,
    executor: QueryExecutor = db
  ): Promise<ShopTabReset> {
    const query = `
      INSERT INTO shop_tab_resets (user_id, shop_tab, period_key, resets_used, gems_spent, updated_at)
      VALUES ($1, $2, $3, 1, $4, current_timestamp)
      ON CONFLICT (user_id, shop_tab, period_key)
      DO UPDATE SET
        resets_used = shop_tab_resets.resets_used + 1,
        gems_spent = shop_tab_resets.gems_spent + EXCLUDED.gems_spent,
        updated_at = current_timestamp
      RETURNING reset_id, user_id, shop_tab, period_key, resets_used, gems_spent, updated_at;
    `;
    const { rows } = await executor.query(query, [
      userId,
      shopTab,
      periodKey,
      gemsSpent,
    ]);
    return rows[0];
  },

  /**
   * Drop a user's purchases for one tab's offerings on a date.
   *
   * A paid reset has to clear the per-item purchase records too, otherwise the
   * rerolled shop would come back already "sold out" for the item types the
   * player had bought. Scoped to the offerings of that tab and that date only.
   */
  async clearUserPurchasesForTab(
    userId: string,
    shopDate: string,
    shopTab: string,
    executor: QueryExecutor = db
  ): Promise<void> {
    const query = `
      DELETE FROM daily_shop_purchases dsp
      USING daily_shop_offerings dso
      WHERE dsp.offering_id = dso.offering_id
        AND dsp.user_id = $1
        AND dsp.shop_date = $2
        AND dso.shop_tab = $3;
    `;
    await executor.query(query, [userId, shopDate, shopTab]);
  },

  // Admin Methods
  async resetAllPurchasesForDate(shopDate: string): Promise<void> {
    const query = `DELETE FROM daily_shop_purchases WHERE shop_date = $1;`;
    await db.query(query, [shopDate]);
  },

  async getPurchaseStats(shopDate: string): Promise<any> {
    const query = `
      SELECT 
        item_type,
        COUNT(*) as total_purchases,
        SUM(quantity_purchased) as total_quantity,
        SUM(total_cost) as total_revenue,
        currency_used,
        COUNT(DISTINCT user_id) as unique_buyers
      FROM daily_shop_purchases
      WHERE shop_date = $1
      GROUP BY item_type, currency_used
      ORDER BY item_type, currency_used;
    `;

    const { rows } = await db.query(query, [shopDate]);
    return rows;
  },
};

export default DailyShopModel;
