// Load environment variables from .env file
require('dotenv').config();

const db = require("../dist/config/db.config.js").default;
const DailyShopService = require("../dist/services/dailyShop.service.js").default;

/**
 * Check and fix daily shop issues
 */
async function checkAndFixShop() {
  try {
    console.log("🔍 CHECKING DAILY SHOP SYSTEM");
    console.log("=".repeat(60));
    
    const now = new Date();
    const shopDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    
    console.log(`📅 Current UTC Date: ${shopDate}`);
    console.log(`🕐 Current UTC Time: ${now.toISOString()}\n`);
    
    // Step 1: Check shop configuration
    console.log("Step 1: Checking shop configuration...");
    const configQuery = `
      SELECT config_id, item_type, is_active
      FROM daily_shop_config
      WHERE item_type IN ('legendary_card', 'epic_card')
      ORDER BY item_type;
    `;
    const { rows: configs } = await db.query(configQuery);
    
    if (configs.length === 0) {
      console.log("❌ No shop configuration found for legendary/epic cards!");
      console.log("   Run: node scripts/setup-default-shop-config.js");
      await db.pool.end();
      return;
    }
    
    const inactiveConfigs = configs.filter(c => !c.is_active);
    if (inactiveConfigs.length > 0) {
      console.log("⚠️  WARNING: Some configurations are INACTIVE:");
      inactiveConfigs.forEach(c => {
        console.log(`   - ${c.item_type} is INACTIVE`);
      });
      console.log("\n   To activate, run:");
      inactiveConfigs.forEach(c => {
        console.log(`   UPDATE daily_shop_config SET is_active = true WHERE item_type = '${c.item_type}';`);
      });
      console.log("");
    } else {
      console.log("✅ Shop configurations are active");
    }
    
    // Step 2: Check for cards
    console.log("\nStep 2: Checking for legendary/epic cards...");
    const cardCheckQuery = `
      SELECT 
        COUNT(CASE WHEN 'norse' = ANY(tags) AND rarity::text = 'legendary' THEN 1 END) as norse_legendary,
        COUNT(CASE WHEN 'japanese' = ANY(tags) AND rarity::text = 'legendary' THEN 1 END) as japanese_legendary,
        COUNT(CASE WHEN 'polynesian' = ANY(tags) AND rarity::text = 'legendary' THEN 1 END) as polynesian_legendary,
        COUNT(CASE WHEN 'norse' = ANY(tags) AND rarity::text = 'epic' THEN 1 END) as norse_epic,
        COUNT(CASE WHEN 'japanese' = ANY(tags) AND rarity::text = 'epic' THEN 1 END) as japanese_epic,
        COUNT(CASE WHEN 'polynesian' = ANY(tags) AND rarity::text = 'epic' THEN 1 END) as polynesian_epic
      FROM cards;
    `;
    const { rows: cardCounts } = await db.query(cardCheckQuery);
    const counts = cardCounts[0];
    
    console.log("  Legendary cards:");
    console.log(`    Norse: ${counts.norse_legendary}`);
    console.log(`    Japanese: ${counts.japanese_legendary}`);
    console.log(`    Polynesian: ${counts.polynesian_legendary}`);
    console.log("  Epic cards:");
    console.log(`    Norse: ${counts.norse_epic}`);
    console.log(`    Japanese: ${counts.japanese_epic}`);
    console.log(`    Polynesian: ${counts.polynesian_epic}`);
    
    const mythologies = ['norse', 'japanese', 'polynesian'];
    const missingLegendary = mythologies.filter(myth => 
      parseInt(counts[`${myth}_legendary`]) === 0
    );
    const missingEpic = mythologies.filter(myth => 
      parseInt(counts[`${myth}_epic`]) === 0
    );
    
    if (missingLegendary.length > 0) {
      console.log(`\n⚠️  WARNING: Missing legendary cards for: ${missingLegendary.join(', ')}`);
    }
    if (missingEpic.length > 0) {
      console.log(`⚠️  WARNING: Missing epic cards for: ${missingEpic.join(', ')}`);
    }
    
    if (missingLegendary.length === 0 && missingEpic.length === 0) {
      console.log("\n✅ All mythologies have legendary and epic cards");
    }
    
    // Step 3: Check current offerings
    console.log("\nStep 3: Checking current shop offerings...");
    const offeringsQuery = `
      SELECT item_type, COUNT(*) as count
      FROM daily_shop_offerings
      WHERE shop_date = $1
      GROUP BY item_type;
    `;
    const { rows: offerings } = await db.query(offeringsQuery, [shopDate]);
    
    const legendaryOfferings = offerings.find(o => o.item_type === 'legendary_card');
    const epicOfferings = offerings.find(o => o.item_type === 'epic_card');
    
    console.log(`  Legendary card offerings: ${legendaryOfferings?.count || 0}`);
    console.log(`  Epic card offerings: ${epicOfferings?.count || 0}`);
    
    const needsGeneration = !legendaryOfferings || !epicOfferings || 
                           parseInt(legendaryOfferings?.count || 0) === 0 || 
                           parseInt(epicOfferings?.count || 0) === 0;
    
    if (needsGeneration) {
      console.log("\n❌ Missing legendary/epic offerings for today!");
      
      // Check if we have the cards to generate
      if (missingLegendary.length > 0 || missingEpic.length > 0) {
        console.log("\n⚠️  Cannot generate offerings - missing cards in database!");
        console.log("   Please add legendary/epic cards for all mythologies first.");
      } else if (inactiveConfigs.length > 0) {
        console.log("\n⚠️  Cannot generate offerings - configurations are inactive!");
        console.log("   Please activate the shop configurations first.");
      } else {
        console.log("\n🔧 Attempting to generate offerings...");
        try {
          await DailyShopService.generateDailyOfferings(shopDate);
          console.log("✅ Offerings generated successfully!");
          
          // Verify
          const { rows: newOfferings } = await db.query(offeringsQuery, [shopDate]);
          const newLegendary = newOfferings.find(o => o.item_type === 'legendary_card');
          const newEpic = newOfferings.find(o => o.item_type === 'epic_card');
          console.log(`\n  New legendary card offerings: ${newLegendary?.count || 0}`);
          console.log(`  New epic card offerings: ${newEpic?.count || 0}`);
        } catch (error) {
          console.error("\n❌ Failed to generate offerings:", error.message);
          console.error("   Full error:", error);
        }
      }
    } else {
      console.log("\n✅ Legendary and epic offerings are present for today");
    }
    
    // Step 4: Check last 3 days
    console.log("\nStep 4: Checking last 3 days of offerings...");
    const historyQuery = `
      SELECT shop_date, item_type, COUNT(*) as count
      FROM daily_shop_offerings
      WHERE shop_date >= CURRENT_DATE - INTERVAL '3 days'
        AND item_type IN ('legendary_card', 'epic_card')
      GROUP BY shop_date, item_type
      ORDER BY shop_date DESC, item_type;
    `;
    const { rows: history } = await db.query(historyQuery);
    
    if (history.length === 0) {
      console.log("❌ No legendary/epic offerings found in the last 3 days!");
      console.log("   This confirms the issue - shop generation has been failing.");
    } else {
      console.log("");
      let currentDate = null;
      const dates = [...new Set(history.map(h => h.shop_date))];
      
      dates.forEach(date => {
        const dateOfferings = history.filter(h => h.shop_date === date);
        const legendary = dateOfferings.find(o => o.item_type === 'legendary_card');
        const epic = dateOfferings.find(o => o.item_type === 'epic_card');
        
        const legendaryCount = parseInt(legendary?.count || 0);
        const epicCount = parseInt(epic?.count || 0);
        
        const status = (legendaryCount > 0 && epicCount > 0) ? "✅" : "❌";
        console.log(`  ${status} ${date}: Legendary=${legendaryCount}, Epic=${epicCount}`);
      });
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY & RECOMMENDATIONS");
    console.log("=".repeat(60));
    
    if (inactiveConfigs.length > 0) {
      console.log("\n🔧 ACTION REQUIRED: Activate shop configurations");
      console.log("   Run these SQL commands:");
      inactiveConfigs.forEach(c => {
        console.log(`   UPDATE daily_shop_config SET is_active = true WHERE item_type = '${c.item_type}';`);
      });
    }
    
    if (missingLegendary.length > 0 || missingEpic.length > 0) {
      console.log("\n🔧 ACTION REQUIRED: Add missing cards");
      console.log("   Missing legendary cards for:", missingLegendary.join(', ') || 'none');
      console.log("   Missing epic cards for:", missingEpic.join(', ') || 'none');
      console.log("   Ensure cards have proper mythology tags: 'norse', 'japanese', or 'polynesian'");
    }
    
    if (needsGeneration && missingLegendary.length === 0 && missingEpic.length === 0 && inactiveConfigs.length === 0) {
      console.log("\n🔧 ACTION REQUIRED: Check cron scheduler");
      console.log("   The cron job may not be running properly.");
      console.log("   Check server logs for errors during midnight UTC (00:00).");
      console.log("   You can manually generate offerings with:");
      console.log("   node scripts/fix-shop-offerings.js");
    }
    
    console.log("\n✅ Check complete");
    
  } catch (error) {
    console.error("\n❌ Error during check:", error);
    throw error;
  } finally {
    await db.pool.end();
  }
}

// Run the check
checkAndFixShop()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Check failed:", error);
    process.exit(1);
  });

