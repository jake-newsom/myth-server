#!/usr/bin/env node
/**
 * Production-safe migration script
 * 
 * This script handles migration ordering issues that can occur when:
 * - Baseline migration (0000000000000) was run after other migrations
 * - Migrations were run out of order
 * - Migration files were renamed/consolidated
 * 
 * Usage:
 *   node scripts/prod-migrate-safe.js
 * 
 * Or set as DATABASE_URL and run:
 *   DATABASE_URL="your-url" node scripts/prod-migrate-safe.js
 */

require("dotenv").config();
const { execSync } = require("child_process");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkMigrationStatus() {
  const client = await pool.connect();
  
  try {
    // Get all migrations that have been run
    const runMigrations = await client.query(
      "SELECT name FROM pgmigrations ORDER BY run_on"
    );
    
    const runNames = new Set(runMigrations.rows.map(r => r.name));
    
    console.log("📊 Migration Status:");
    console.log(`   Run: ${runNames.size} migrations`);
    console.log(`   Latest: ${runMigrations.rows[runMigrations.rows.length - 1]?.name || 'none'}`);
    
    return { runNames, runMigrations: runMigrations.rows };
  } catch (error) {
    console.error("❌ Error checking migration status:", error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrationsWithBypass() {
  try {
    console.log("🚀 Running migrations with order check bypassed...\n");
    
    // Use --check-order=false to bypass ordering validation
    execSync(
      "npx node-pg-migrate -m ./migrations up --check-order=false",
      { 
        stdio: 'inherit',
        env: process.env
      }
    );
    
    console.log("\n✅ Migrations completed successfully!");
    
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  }
}

async function main() {
  try {
    console.log("🔍 Checking migration status...\n");
    await checkMigrationStatus();
    
    console.log("\n⚠️  Note: Bypassing migration order check");
    console.log("   This is safe if migrations have been run out of order\n");
    
    await runMigrationsWithBypass();
    
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkMigrationStatus, runMigrationsWithBypass };

