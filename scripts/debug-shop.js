const db = require("../dist/config/db.config.js").default;

/**
 * Debug daily shop issues
 */
async function debugShop() {
  try {
    console.log("🔍 Debugging daily shop...");

    // Get current shop date
    const now = new Date();
    const shopDate = now.toISOString().split('T')[0]; // YYYY-MM-DD format
    console.log(`📅 Current shop date: ${shopDate}`);
    console.log(`🕐 Current UTC time: ${now.toISOString()}`);

    // Check shop configuration
    console.log("\n📋 Checking shop configuration...");
    const configQuery = `
      SELECT item_type, daily_limit, price, currency, daily_availability, is_active
      FROM daily_shop_config
      ORDER BY item_type;
    `;
    const { rows: configs } = await db.query(configQuery);
    
    if (configs.length === 0) {
      console.log("❌ No shop configuration found! Run setup-default-shop-config.js");
      return;
    }
    
    configs.forEach(config => {
      console.log(`  ✅ ${config.item_type}: ${config.price} ${config.currency}, limit ${config.daily_limit}/day, active: ${config.is_active}`);
    });

    // Check if offerings exist for today
    console.log("\n🏪 Checking today's offerings...");
    const offeringsQuery = `
      SELECT offering_id, item_type, card_id, mythology, price, currency, slot_number
      FROM daily_shop_offerings
      WHERE shop_date = $1
      ORDER BY slot_number;
    `;
    const { rows: offerings } = await db.query(offeringsQuery, [shopDate]);
    
    if (offerings.length === 0) {
      console.log("❌ No offerings found for today! Need to generate offerings.");
      
      // Check if we have cards to offer
      console.log("\n🃏 Checking available cards...");
      const cardsQuery = `
        SELECT COUNT(*) as total_cards,
               COUNT(CASE WHEN rarity = 'legendary' THEN 1 END) as legendary_count,
               COUNT(CASE WHEN rarity = 'epic' THEN 1 END) as epic_count
        FROM cards;
      `;
      const { rows: cardStats } = await db.query(cardsQuery);
      const stats = cardStats[0];
      
      console.log(`  📊 Total cards: ${stats.total_cards}`);
      console.log(`  🌟 Legendary cards: ${stats.legendary_count}`);
      console.log(`  ⚡ Epic cards: ${stats.epic_count}`);
      
      if (stats.total_cards === 0) {
        console.log("❌ No cards in database! Need to add cards first.");
        return;
      }
      
      console.log("\n🔧 Attempting to generate offerings...");
      const DailyShopService = require("../dist/services/dailyShop.service.js").default;
      await DailyShopService.generateDailyOfferings(shopDate);
      console.log("✅ Generated daily offerings!");
      
      // Check again
      const { rows: newOfferings } = await db.query(offeringsQuery, [shopDate]);
      console.log(`🎉 Now have ${newOfferings.length} offerings for today`);
      
    } else {
      console.log(`✅ Found ${offerings.length} offerings for today:`);
      offerings.forEach(offering => {
        console.log(`  - ${offering.item_type} (slot ${offering.slot_number}): ${offering.price} ${offering.currency}`);
      });
    }

    // Check mythology rotations
    console.log("\n🔄 Checking mythology rotations...");
    const rotationsQuery = `
      SELECT mythology, item_type, current_card_index, last_updated
      FROM daily_shop_rotations
      ORDER BY mythology, item_type;
    `;
    const { rows: rotations } = await db.query(rotationsQuery);
    
    if (rotations.length === 0) {
      console.log("❌ No mythology rotations found! Run setup-default-shop-config.js");
    } else {
      rotations.forEach(rotation => {
        console.log(`  🔄 ${rotation.mythology} ${rotation.item_type}: index ${rotation.current_card_index}`);
      });
    }

    console.log("\n🎉 Shop debug complete!");
    
  } catch (error) {
    console.error("❌ Error debugging shop:", error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  debugShop()
    .then(() => {
      console.log("Debug completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Debug failed:", error);
      process.exit(1);
    });
}

module.exports = { debugShop };
