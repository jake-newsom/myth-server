require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixMigrationSequence() {
  const client = await pool.connect();
  
  try {
    console.log("🔧 Fixing pgmigrations sequence...");
    
    // Get the max ID from pgmigrations
    const maxResult = await client.query('SELECT MAX(id) as max_id FROM pgmigrations');
    const maxId = maxResult.rows[0].max_id || 0;
    
    // Reset the sequence to be higher than the max ID
    await client.query(`SELECT setval('pgmigrations_id_seq', $1, true)`, [maxId + 1]);
    
    console.log(`✅ Sequence reset to ${maxId + 1}`);
    
    // Check if story mode migration is already recorded
    const checkResult = await client.query(
      "SELECT name FROM pgmigrations WHERE name = '1762400000000_create-story-mode-tables'"
    );
    
    if (checkResult.rows.length === 0) {
      // Insert the migration record manually
      await client.query(
        "INSERT INTO pgmigrations (name, run_on) VALUES ('1762400000000_create-story-mode-tables', NOW())"
      );
      console.log("✅ Manually inserted story mode tables migration record");
    } else {
      console.log("⏭️  Story mode tables migration already recorded");
    }
    
    console.log("\n✅ Migration sequence fixed! You can now run migrations normally.");
    
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  fixMigrationSequence().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = { fixMigrationSequence };

