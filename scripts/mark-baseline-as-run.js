#!/usr/bin/env node
/**
 * Mark baseline migration as already run
 * 
 * This script marks the baseline migration (9999999999999_baseline.js) as already run
 * since the schema was already created by the original baseline migration.
 * 
 * Usage:
 *   DATABASE_URL="your-url" node scripts/mark-baseline-as-run.js
 */

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function markBaselineAsRun() {
  const client = await pool.connect();
  
  try {
    console.log("🔍 Checking migration status...\n");
    
    // Check if baseline is already marked as run
    const checkResult = await client.query(
      "SELECT name FROM pgmigrations WHERE name = '9999999999999_baseline'"
    );
    
    if (checkResult.rows.length > 0) {
      console.log("✅ Baseline migration already marked as run");
      return;
    }
    
    // Check if original baseline was run
    const originalBaseline = await client.query(
      "SELECT name FROM pgmigrations WHERE name = '0000000000000_baseline'"
    );
    
    if (originalBaseline.rows.length > 0) {
      console.log("📝 Original baseline (0000000000000_baseline) was already run");
      console.log("   Marking new baseline (9999999999999_baseline) as run...\n");
      
      // Mark the new baseline as run (fake it)
      await client.query(
        "INSERT INTO pgmigrations (name, run_on) VALUES ('9999999999999_baseline', NOW())"
      );
      
      console.log("✅ Baseline migration marked as already run");
      console.log("   You can now run migrations normally\n");
    } else {
      console.log("⚠️  Original baseline not found in migrations table");
      console.log("   This might be a fresh database. Run migrations normally.");
    }
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  markBaselineAsRun().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = { markBaselineAsRun };

