import db from "../config/db.config";
import {
  DailyShopConfig,
  DailyShopOffering,
  DailyShopOfferingWithCard,
  DailyShopPurchase,
  DailyShopRotation,
  ShopItemType,
  CurrencyType,
} from "../types/database.types";

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
  async getTodaysOfferings(
    shopDate: string
  ): Promise<DailyShopOfferingWithCard[]> {
    const query = `
      SELECT 
        dso.offering_id, dso.shop_date, dso.item_type, dso.card_id, 
        dso.mythology, dso.price, dso.currency, dso.slot_number, dso.created_at,
        c.card_id as card_card_id, c.name as card_name, c.rarity as card_rarity, 
        c.image_url as card_image_url, c.tags as card_tags, c.set_id as card_set_id,
        c.power->>'top' as card_power_top,
        c.power->>'right' as card_power_right, 
        c.power->>'bottom' as card_power_bottom, 
        c.power->>'left' as card_power_left,
        c.special_ability_id as card_special_ability_id,
        sa.name as ability_name, sa.description as ability_description, 
        sa.trigger_moment as ability_trigger_moment, sa.parameters as ability_parameters,
        sa.id as ability_id_string
      FROM daily_shop_offerings dso
      LEFT JOIN cards c ON dso.card_id = c.card_id
      LEFT JOIN special_abilities sa ON c.special_ability_id = sa.ability_id
      WHERE dso.shop_date = $1
      ORDER BY dso.item_type, dso.slot_number;
    `;

    const { rows } = await db.query(query, [shopDate]);

    return rows.map((row) => ({
      offering_id: row.offering_id,
      shop_date: row.shop_date,
      item_type: row.item_type,
      card_id: row.card_id,
      mythology: row.mythology,
      price: row.price,
      currency: row.currency,
      slot_number: row.slot_number,
      created_at: row.created_at,
      card: row.card_name
        ? {
            card_id: row.card_card_id,
            name: row.card_name,
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
                  trigger_moment: row.ability_trigger_moment,
                  parameters: row.ability_parameters,
                }
              : null,
          }
        : undefined,
    }));
  },

  async createOffering(
    offering: Omit<DailyShopOffering, "offering_id" | "created_at">
  ): Promise<DailyShopOffering> {
    const query = `
      INSERT INTO daily_shop_offerings (shop_date, item_type, card_id, mythology, price, currency, slot_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING offering_id, shop_date, item_type, card_id, mythology, price, currency, slot_number, created_at;
    `;

    const { rows } = await db.query(query, [
      offering.shop_date,
      offering.item_type,
      offering.card_id,
      offering.mythology,
      offering.price,
      offering.currency,
      offering.slot_number,
    ]);

    return rows[0];
  },

  async clearOfferingsForDate(shopDate: string): Promise<void> {
    const query = `DELETE FROM daily_shop_offerings WHERE shop_date = $1;`;
    await db.query(query, [shopDate]);
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
    const query = `
      SELECT card_id, name, rarity, image_url, tags
      FROM cards
      WHERE $1 = ANY(tags) AND rarity::text = $2
      ORDER BY name;
    `;

    const { rows } = await db.query(query, [mythology, rarity]);
    return rows;
  },

  async getEnhancedCards(limit: number = 10): Promise<any[]> {
    const query = `
      SELECT card_id, name, rarity, image_url, tags
      FROM cards
      WHERE rarity::text ~ '^(common|uncommon|rare|epic|legendary)\\+{1,3}$'
      ORDER BY RANDOM()
      LIMIT $1;
    `;

    const { rows } = await db.query(query, [limit]);
    return rows;
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
