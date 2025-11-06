// Load environment variables from .env file
require('dotenv').config();

const db = require("../dist/config/db.config.js").default;

/**
 * Setup default daily shop configuration
 */
async function setupDefaultShopConfig() {
  try {
    console.log("🏪 Setting up default daily shop configuration...");

    // Default shop configuration
    const defaultConfigs = [
      {
        item_type: 'legendary_card',
        daily_limit: 3, // Can buy each of the 3 legendary cards (1 per mythology)
        price: 100,
        currency: 'card_fragments',
        daily_availability: 3, // 1 per mythology
        reset_price_gems: 50
      },
      {
        item_type: 'epic_card',
        daily_limit: 3, // Can buy each of the 3 epic cards (1 per mythology)
        price: 50,
        currency: 'card_fragments',
        daily_availability: 3, // 1 per mythology
        reset_price_gems: 30
      },
      {
        item_type: 'enhanced_card',
        daily_limit: 2, // Can buy each of the 2 enhanced cards
        price: 1000,
        currency: 'gold',
        daily_availability: 2, // 2 random enhanced cards
        reset_price_gems: 20
      },
      {
        item_type: 'pack',
        daily_limit: 3, // Can buy 3 packs total (packs are not unique items)
        price: 50,
        currency: 'gold',
        daily_availability: 1, // Unlimited availability but limited purchases
        reset_price_gems: 25
      }
    ];

    // Insert default configurations
    for (const config of defaultConfigs) {
      const query = `
        INSERT INTO daily_shop_config (item_type, daily_limit, price, currency, daily_availability, reset_price_gems)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (item_type) DO UPDATE SET
          daily_limit = EXCLUDED.daily_limit,
          price = EXCLUDED.price,
          currency = EXCLUDED.currency,
          daily_availability = EXCLUDED.daily_availability,
          reset_price_gems = EXCLUDED.reset_price_gems,
          updated_at = current_timestamp;
      `;
      
      await db.query(query, [
        config.item_type,
        config.daily_limit,
        config.price,
        config.currency,
        config.daily_availability,
        config.reset_price_gems
      ]);
      
      console.log(`✅ Configured ${config.item_type}: ${config.price} ${config.currency}, limit ${config.daily_limit}/day`);
    }

    // Initialize mythology rotations
    const mythologies = ['norse', 'japanese', 'polynesian'];
    const cardTypes = ['legendary_card', 'epic_card'];

    for (const mythology of mythologies) {
      for (const cardType of cardTypes) {
        const rotationQuery = `
          INSERT INTO daily_shop_rotations (mythology, item_type, current_card_index)
          VALUES ($1, $2, $3)
          ON CONFLICT (mythology, item_type) DO UPDATE SET
            current_card_index = EXCLUDED.current_card_index,
            last_updated = current_timestamp;
        `;
        
        await db.query(rotationQuery, [mythology, cardType, 0]);
        console.log(`🔄 Initialized ${mythology} ${cardType} rotation`);
      }
    }

    console.log("🎉 Daily shop configuration setup complete!");
    
  } catch (error) {
    console.error("❌ Error setting up daily shop configuration:", error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupDefaultShopConfig()
    .then(() => {
      console.log("Setup completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Setup failed:", error);
      process.exit(1);
    });
}

module.exports = { setupDefaultShopConfig };
