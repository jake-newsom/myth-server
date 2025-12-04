#!/usr/bin/env node
/**
 * Fix migration ordering issue
 * 
 * This script marks migrations that were consolidated into the baseline
 * as already run, so that newer migrations can run properly.
 * 
 * Usage: node scripts/fix-migration-order.js
 */

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixMigrationOrder() {
  const client = await pool.connect();
  
  try {
    console.log("🔧 Fixing migration order...\n");
    
    // Check what migrations are currently recorded
    const existingMigrations = await client.query(
      "SELECT name FROM pgmigrations ORDER BY name"
    );
    console.log("📋 Currently recorded migrations:");
    existingMigrations.rows.forEach(row => {
      console.log(`  - ${row.name}`);
    });
    
    // The migration that's causing the issue
    // 1747305666855_create-users-table was run but the file doesn't exist
    // We need to ensure 1761299613891_add-user-sessions-table can run
    
    // Check if 1761299613891 is already recorded
    const check1761299613891 = await client.query(
      "SELECT name FROM pgmigrations WHERE name = '1761299613891_add-user-sessions-table'"
    );
    
    if (check1761299613891.rows.length === 0) {
      console.log("\n⚠️  Migration 1761299613891_add-user-sessions-table is not recorded");
      console.log("   This migration needs to be run, but it's blocked by ordering.");
      console.log("\n💡 Solution: Mark it as run manually if the schema already exists,");
      console.log("   OR ensure all migrations between 1747305666855 and 1761299613891 are marked as run.");
      
      // Check if user_sessions table already exists (meaning migration was already applied)
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'user_sessions'
        );
      `);
      
      if (tableExists.rows[0].exists) {
        console.log("\n✅ user_sessions table already exists - marking migration as run");
        await client.query(
          "INSERT INTO pgmigrations (name, run_on) VALUES ('1761299613891_add-user-sessions-table', NOW())"
        );
        console.log("✅ Migration marked as run");
      } else {
        console.log("\n❌ user_sessions table does NOT exist");
        console.log("   The migration needs to be run, but there's an ordering conflict.");
        console.log("\n🔍 Checking for missing migrations between timestamps...");
        
        // Check what migrations exist in the filesystem between these timestamps
        // Since 1747305666855 was consolidated into baseline, we should mark it properly
        // But actually, if 1747305666855 is recorded, that's fine - we just need to run 1761299613891
        
        console.log("\n💡 Try running: npm run migrate:up");
        console.log("   If that fails, you may need to manually mark migrations as run.");
      }
    } else {
      console.log("\n✅ Migration 1761299613891_add-user-sessions-table is already recorded");
    }
    
    console.log("\n✅ Migration order check complete!");
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  fixMigrationOrder().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = { fixMigrationOrder };

