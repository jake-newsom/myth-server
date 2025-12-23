// Load environment variables from .env file
require('dotenv').config();

const db = require("../dist/config/db.config.js").default;

/**
 * Comprehensive diagnostic script for daily shop issues
 */
async function diagnoseShopIssue() {
  try {
    console.log("🔍 DAILY SHOP DIAGNOSTIC REPORT");
    console.log("=".repeat(60));
    
    const now = new Date();
    const shopDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    
    console.log(`\n📅 Current UTC Date: ${shopDate}`);
    console.log(`🕐 Current UTC Time: ${now.toISOString()}`);
    
    // 1. Check shop configuration
    console.log("\n" + "=".repeat(60));
    console.log("1️⃣  SHOP CONFIGURATION CHECK");
    console.log("=".repeat(60));
    
    const configQuery = `
      SELECT config_id, item_type, daily_limit, price, currency, 
             daily_availability, is_active, reset_price_gems, created_at, updated_at
      FROM daily_shop_config
      ORDER BY item_type;
    `;
    const { rows: configs } = await db.query(configQuery);
    
    if (configs.length === 0) {
      console.log("❌ NO SHOP CONFIGURATION FOUND!");
      console.log("   Run: node scripts/setup-default-shop-config.js");
      return;
    }
    
    console.log(`\n✅ Found ${configs.length} shop configurations:\n`);
    configs.forEach(config => {
      const status = config.is_active ? "✅ ACTIVE" : "❌ INACTIVE";
      console.log(`  ${status} | ${config.item_type}`);
      console.log(`    Price: ${config.price} ${config.currency}`);
      console.log(`    Daily Limit: ${config.daily_limit}`);
      console.log(`    Daily Availability: ${config.daily_availability}`);
      console.log(`    Reset Cost: ${config.reset_price_gems} gems`);
      console.log(`    Last Updated: ${config.updated_at}`);
      console.log("");
    });
    
    // 2. Check for legendary/epic cards in database
    console.log("=".repeat(60));
    console.log("2️⃣  CARD AVAILABILITY CHECK");
    console.log("=".repeat(60));
    
    const cardStatsQuery = `
      SELECT 
        COUNT(*) as total_cards,
        COUNT(CASE WHEN rarity::text = 'legendary' THEN 1 END) as legendary_count,
        COUNT(CASE WHEN rarity::text = 'epic' THEN 1 END) as epic_count,
        COUNT(CASE WHEN 'norse' = ANY(tags) AND rarity::text = 'legendary' THEN 1 END) as norse_legendary,
        COUNT(CASE WHEN 'japanese' = ANY(tags) AND rarity::text = 'legendary' THEN 1 END) as japanese_legendary,
        COUNT(CASE WHEN 'polynesian' = ANY(tags) AND rarity::text = 'legendary' THEN 1 END) as polynesian_legendary,
        COUNT(CASE WHEN 'norse' = ANY(tags) AND rarity::text = 'epic' THEN 1 END) as norse_epic,
        COUNT(CASE WHEN 'japanese' = ANY(tags) AND rarity::text = 'epic' THEN 1 END) as japanese_epic,
        COUNT(CASE WHEN 'polynesian' = ANY(tags) AND rarity::text = 'epic' THEN 1 END) as polynesian_epic
      FROM cards;
    `;
    const { rows: cardStats } = await db.query(cardStatsQuery);
    const stats = cardStats[0];
    
    console.log(`\n📊 Card Database Statistics:`);
    console.log(`  Total Cards: ${stats.total_cards}`);
    console.log(`  Total Legendary: ${stats.legendary_count}`);
    console.log(`  Total Epic: ${stats.epic_count}`);
    console.log("");
    console.log("  Legendary by Mythology:");
    console.log(`    Norse: ${stats.norse_legendary}`);
    console.log(`    Japanese: ${stats.japanese_legendary}`);
    console.log(`    Polynesian: ${stats.polynesian_legendary}`);
    console.log("");
    console.log("  Epic by Mythology:");
    console.log(`    Norse: ${stats.norse_epic}`);
    console.log(`    Japanese: ${stats.japanese_epic}`);
    console.log(`    Polynesian: ${stats.polynesian_epic}`);
    
    // Check for issues
    const mythologies = ['norse', 'japanese', 'polynesian'];
    const hasLegendaryIssue = mythologies.some(myth => 
      stats[`${myth}_legendary`] === '0' || stats[`${myth}_legendary`] === 0
    );
    const hasEpicIssue = mythologies.some(myth => 
      stats[`${myth}_epic`] === '0' || stats[`${myth}_epic`] === 0
    );
    
    if (hasLegendaryIssue) {
      console.log("\n⚠️  WARNING: Some mythologies have no legendary cards!");
    }
    if (hasEpicIssue) {
      console.log("⚠️  WARNING: Some mythologies have no epic cards!");
    }
    
    // 3. Check current shop offerings
    console.log("\n" + "=".repeat(60));
    console.log("3️⃣  CURRENT SHOP OFFERINGS");
    console.log("=".repeat(60));
    
    const offeringsQuery = `
      SELECT offering_id, shop_date, item_type, card_id, mythology, 
             price, currency, slot_number, created_at
      FROM daily_shop_offerings
      WHERE shop_date = $1
      ORDER BY slot_number;
    `;
    const { rows: offerings } = await db.query(offeringsQuery, [shopDate]);
    
    if (offerings.length === 0) {
      console.log(`\n❌ NO OFFERINGS FOUND FOR ${shopDate}!`);
      console.log("   This is the problem - offerings should be generated daily.");
    } else {
      console.log(`\n✅ Found ${offerings.length} offerings for ${shopDate}:\n`);
      offerings.forEach(offering => {
        console.log(`  Slot ${offering.slot_number}: ${offering.item_type}`);
        console.log(`    Mythology: ${offering.mythology || 'N/A'}`);
        console.log(`    Card ID: ${offering.card_id || 'N/A'}`);
        console.log(`    Price: ${offering.price} ${offering.currency}`);
        console.log(`    Created: ${offering.created_at}`);
        console.log("");
      });
      
      // Check if legendary/epic cards are present
      const hasLegendary = offerings.some(o => o.item_type === 'legendary_card');
      const hasEpic = offerings.some(o => o.item_type === 'epic_card');
      
      if (!hasLegendary) {
        console.log("⚠️  WARNING: No legendary cards in today's offerings!");
      }
      if (!hasEpic) {
        console.log("⚠️  WARNING: No epic cards in today's offerings!");
      }
    }
    
    // 4. Check offerings for the last 5 days
    console.log("\n" + "=".repeat(60));
    console.log("4️⃣  HISTORICAL OFFERINGS (Last 5 Days)");
    console.log("=".repeat(60));
    
    const historyQuery = `
      SELECT shop_date, item_type, COUNT(*) as count
      FROM daily_shop_offerings
      WHERE shop_date >= CURRENT_DATE - INTERVAL '5 days'
      GROUP BY shop_date, item_type
      ORDER BY shop_date DESC, item_type;
    `;
    const { rows: history } = await db.query(historyQuery);
    
    if (history.length === 0) {
      console.log("\n❌ NO HISTORICAL OFFERINGS FOUND!");
      console.log("   The shop generation may have stopped working.");
    } else {
      console.log("\n");
      let currentDate = null;
      history.forEach(row => {
        if (row.shop_date !== currentDate) {
          if (currentDate !== null) console.log("");
          currentDate = row.shop_date;
          console.log(`  📅 ${row.shop_date}:`);
        }
        console.log(`    ${row.item_type}: ${row.count} offerings`);
      });
    }
    
    // 5. Check rotation states
    console.log("\n" + "=".repeat(60));
    console.log("5️⃣  ROTATION STATES");
    console.log("=".repeat(60));
    
    const rotationsQuery = `
      SELECT mythology, item_type, current_card_index, last_updated
      FROM daily_shop_rotations
      ORDER BY mythology, item_type;
    `;
    const { rows: rotations } = await db.query(rotationsQuery);
    
    if (rotations.length === 0) {
      console.log("\n⚠️  No rotation states found (will be created on first generation)");
    } else {
      console.log("\n");
      rotations.forEach(rotation => {
        console.log(`  ${rotation.mythology} - ${rotation.item_type}:`);
        console.log(`    Current Index: ${rotation.current_card_index}`);
        console.log(`    Last Updated: ${rotation.last_updated}`);
        console.log("");
      });
    }
    
    // 6. Check server logs for errors
    console.log("=".repeat(60));
    console.log("6️⃣  RECOMMENDATIONS");
    console.log("=".repeat(60));
    console.log("");
    
    if (offerings.length === 0) {
      console.log("🔧 IMMEDIATE ACTION REQUIRED:");
      console.log("   1. Check if the cron job is running (DailyRewardsService.startDailyRewardsScheduler)");
      console.log("   2. Check server logs for errors during shop generation");
      console.log("   3. Manually generate offerings: node -e 'require(\"./dist/services/dailyShop.service.js\").default.generateDailyOfferings()'");
      console.log("");
    }
    
    if (hasLegendaryIssue || hasEpicIssue) {
      console.log("🔧 CARD DATABASE ISSUE:");
      console.log("   Some mythologies are missing legendary or epic cards.");
      console.log("   Add cards to the database or check card tags.");
      console.log("");
    }
    
    const inactiveConfigs = configs.filter(c => !c.is_active);
    if (inactiveConfigs.length > 0) {
      console.log("🔧 INACTIVE CONFIGURATIONS:");
      inactiveConfigs.forEach(c => {
        console.log(`   ${c.item_type} is marked as INACTIVE`);
      });
      console.log("");
    }
    
    console.log("=".repeat(60));
    console.log("✅ DIAGNOSTIC COMPLETE");
    console.log("=".repeat(60));
    
  } catch (error) {
    console.error("\n❌ Error during diagnosis:", error);
    throw error;
  } finally {
    await db.pool.end();
  }
}

// Run the diagnostic
diagnoseShopIssue()
  .then(() => {
    console.log("\n✅ Diagnosis completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Diagnosis failed:", error);
    process.exit(1);
  });

