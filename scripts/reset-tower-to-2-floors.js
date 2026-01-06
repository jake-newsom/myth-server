/**
 * Script to reset tower to only 2 floors for testing
 * This removes all floors except 1 and 2
 */

// Load environment variables from .env file
require("dotenv").config();

const { Pool } = require("pg");

// Create database connection using environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL configuration for cloud databases
  ssl:
    process.env.DATABASE_URL?.includes("render.com") ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function resetTowerFloors() {
  try {
    console.log("Starting tower reset...");
    console.log(`Using database: ${process.env.DATABASE_URL?.split("@")[1] || "local"}`);

    // Get all tower floors
    const floorsResult = await pool.query(
      "SELECT floor_number, ai_deck_id FROM tower_floors ORDER BY floor_number"
    );
    console.log(`Found ${floorsResult.rows.length} floors`);

    // Get floors to delete (everything except 1 and 2)
    const floorsToDelete = floorsResult.rows.filter(
      (f) => f.floor_number > 2
    );

    if (floorsToDelete.length === 0) {
      console.log("✓ Already at 2 floors or less. No changes needed.");
      await pool.end();
      process.exit(0);
    }

    console.log(`Will delete ${floorsToDelete.length} floors (3+)`);

    // Delete floors 3 and above
    const deleteResult = await pool.query(
      "DELETE FROM tower_floors WHERE floor_number > 2"
    );
    console.log(`✓ Deleted ${deleteResult.rowCount} floors`);

    // Verify
    const remainingResult = await pool.query(
      "SELECT floor_number FROM tower_floors ORDER BY floor_number"
    );
    console.log(
      `✓ Remaining floors: ${remainingResult.rows.map((r) => r.floor_number).join(", ")}`
    );

    console.log("\n✅ Tower reset complete! Only floors 1-2 remain.");
    console.log(
      "When a user beats floor 2, the system will generate floors 3-4."
    );

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error resetting tower:", error);
    await pool.end();
    process.exit(1);
  }
}

resetTowerFloors();

