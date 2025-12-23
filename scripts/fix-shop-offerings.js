// Load environment variables from .env file
require('dotenv').config();

const DailyShopService = require("../dist/services/dailyShop.service.js").default;

/**
 * Manually generate daily shop offerings for today (or specified date)
 */
async function fixShopOfferings() {
  try {
    const targetDate = process.argv[2]; // Optional: specify date as YYYY-MM-DD
    
    if (targetDate) {
      console.log(`🔧 Generating shop offerings for ${targetDate}...`);
    } else {
      const shopDate = DailyShopService.getCurrentShopDate();
      console.log(`🔧 Generating shop offerings for today (${shopDate})...`);
    }
    
    await DailyShopService.generateDailyOfferings(targetDate);
    
    console.log("✅ Shop offerings generated successfully!");
    console.log("\n💡 Tip: Run 'node scripts/diagnose-shop-issue.js' to verify.");
    
  } catch (error) {
    console.error("\n❌ Error generating shop offerings:", error);
    throw error;
  } finally {
    // Give time for any pending operations
    setTimeout(() => process.exit(0), 1000);
  }
}

// Run the fix
fixShopOfferings()
  .catch((error) => {
    console.error("\n❌ Fix failed:", error);
    setTimeout(() => process.exit(1), 1000);
  });

