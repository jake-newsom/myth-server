#!/usr/bin/env node

/**
 * REGENERATE DAILY SHOP
 * =====================
 * 
 * This script manually regenerates the daily shop offerings for a specific date.
 * This is an ADMIN-ONLY operation that should only be run by server administrators
 * with shell access to the server.
 * 
 * SECURITY NOTE:
 * - This script requires direct server/shell access to run
 * - It bypasses the API layer entirely
 * - The API endpoint /api/daily-shop/admin/refresh requires admin role authentication
 * 
 * AUTOMATED REGENERATION:
 * - The daily shop is automatically regenerated at 12:00 AM UTC by a cron job
 * - See src/services/dailyRewards.service.ts -> startDailyRewardsScheduler()
 * - Manual regeneration is only needed for debugging or fixing issues
 * 
 * USAGE:
 * ------
 * # Regenerate shop for today
 * node scripts/regenerate-daily-shop.js
 * 
 * # Regenerate shop for a specific date
 * node scripts/regenerate-daily-shop.js 2025-12-29
 * 
 * # See what would be generated without actually generating
 * node scripts/regenerate-daily-shop.js --dry-run
 * 
 * # Regenerate for specific date (dry run)
 * node scripts/regenerate-daily-shop.js 2025-12-29 --dry-run
 */

// Load environment variables from .env file
require('dotenv').config();

const DailyShopService = require("../dist/services/dailyShop.service.js").default;
const DailyShopModel = require("../dist/models/dailyShop.model.js").default;

// Parse command line arguments
const args = process.argv.slice(2);
let targetDate = null;
let dryRun = false;

for (const arg of args) {
  if (arg === '--dry-run' || arg === '-d') {
    dryRun = true;
  } else if (arg.match(/^\d{4}-\d{2}-\d{2}$/)) {
    targetDate = arg;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
REGENERATE DAILY SHOP
=====================

This script manually regenerates the daily shop offerings.
Requires server/shell access - for use by administrators only.

USAGE:
  node scripts/regenerate-daily-shop.js [DATE] [OPTIONS]

ARGUMENTS:
  DATE        Optional date in YYYY-MM-DD format (defaults to today)

OPTIONS:
  --dry-run   Show what would be generated without actually generating
  --help      Show this help message

EXAMPLES:
  node scripts/regenerate-daily-shop.js
  node scripts/regenerate-daily-shop.js 2025-12-29
  node scripts/regenerate-daily-shop.js --dry-run
  node scripts/regenerate-daily-shop.js 2025-12-29 --dry-run

NOTE: The daily shop is automatically regenerated at 12:00 AM UTC daily.
Manual regeneration is only needed for debugging or fixing issues.
`);
    process.exit(0);
  }
}

/**
 * Main function to regenerate daily shop
 */
async function regenerateShop() {
  try {
    const shopDate = targetDate || DailyShopService.getCurrentShopDate();
    
    console.log("\n" + "=".repeat(60));
    console.log("🏪 DAILY SHOP REGENERATION");
    console.log("=".repeat(60));
    console.log(`Target Date: ${shopDate}`);
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
    console.log("=".repeat(60) + "\n");

    // Get shop configuration
    console.log("📋 Checking shop configuration...");
    const configs = await DailyShopModel.getShopConfig();
    
    if (configs.length === 0) {
      console.error("❌ ERROR: No shop configuration found!");
      console.error("   Run 'node scripts/setup-default-shop-config.js' first.");
      process.exit(1);
    }
    
    console.log(`✅ Found ${configs.length} shop configuration(s):\n`);
    configs.forEach(config => {
      console.log(`   - ${config.item_type.padEnd(20)} | ` +
        `${config.is_active ? '✓ Active' : '✗ Inactive'} | ` +
        `Price: ${config.price} ${config.currency} | ` +
        `Limit: ${config.daily_limit}/day`);
    });

    // Check existing offerings
    console.log(`\n🔍 Checking existing offerings for ${shopDate}...`);
    const existingOfferings = await DailyShopModel.getTodaysOfferings(shopDate);
    
    if (existingOfferings.length > 0) {
      console.log(`⚠️  Found ${existingOfferings.length} existing offering(s) for ${shopDate}`);
      console.log("   These will be replaced with new offerings.\n");
      
      if (!dryRun) {
        existingOfferings.forEach((offering, idx) => {
          console.log(`   ${idx + 1}. ${offering.item_type} ` +
            `(Slot ${offering.slot_number}) - ` +
            `${offering.card_name || 'N/A'} ` +
            `[${offering.mythology || 'N/A'}]`);
        });
      }
    } else {
      console.log(`✅ No existing offerings found for ${shopDate}`);
    }

    if (dryRun) {
      console.log("\n" + "=".repeat(60));
      console.log("🔍 DRY RUN COMPLETE - No changes were made");
      console.log("=".repeat(60));
      console.log("\nTo actually regenerate the shop, run without --dry-run flag:");
      console.log(`   node scripts/regenerate-daily-shop.js ${targetDate || ''}`);
      console.log("\n");
      return;
    }

    // Generate new offerings
    console.log(`\n🔧 Generating new shop offerings for ${shopDate}...`);
    await DailyShopService.generateDailyOfferings(shopDate);
    
    // Verify new offerings
    const newOfferings = await DailyShopModel.getTodaysOfferings(shopDate);
    
    if (newOfferings.length === 0) {
      console.error("\n❌ ERROR: No offerings were generated!");
      console.error("   Check the logs above for errors.");
      process.exit(1);
    }

    console.log(`\n✅ Successfully generated ${newOfferings.length} offering(s):\n`);
    newOfferings.forEach((offering, idx) => {
      console.log(`   ${idx + 1}. ${offering.item_type.padEnd(20)} | ` +
        `Slot ${offering.slot_number} | ` +
        `${offering.price} ${offering.currency} | ` +
        `${offering.card_name || 'Pack'} ` +
        `${offering.mythology ? `[${offering.mythology}]` : ''}`);
    });

    console.log("\n" + "=".repeat(60));
    console.log("🎉 SHOP REGENERATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`\n💡 Tip: Run 'node scripts/diagnose-shop-issue.js' to verify.\n`);
    
  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("❌ ERROR: Shop regeneration failed");
    console.error("=".repeat(60));
    console.error("\nError details:");
    console.error(error);
    console.error("\n");
    throw error;
  }
}

// Run the regeneration
regenerateShop()
  .then(() => {
    setTimeout(() => process.exit(0), 1000);
  })
  .catch((error) => {
    setTimeout(() => process.exit(1), 1000);
  });

