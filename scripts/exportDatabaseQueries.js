const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  console.log(`Loading environment from ${envPath}`);
  dotenv.config({ path: envPath });
} else {
  console.log('No .env file found, using environment variables');
  dotenv.config();
}

// Database connection
console.log(`Using database connection: ${process.env.DATABASE_URL || 'No DATABASE_URL found in environment'}`);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Export SQL queries from the current database state
 */
async function exportDatabaseQueries() {
  const client = await pool.connect();
  
  try {
    console.log('📤 Exporting database queries...');
    
    // 1. Export sets data
    console.log('📦 Exporting sets data...');
    const setsResult = await client.query(`
      SELECT name, description, is_released, image_url
      FROM sets
      ORDER BY name
    `);
    
    let setsData = [];
    for (const set of setsResult.rows) {
      setsData.push({
        name: set.name,
        description: set.description || '',
        is_released: set.is_released,
        image_url: set.image_url || ''
      });
    }
    
    // 2. Export special abilities data
    console.log('⚡ Exporting special abilities data...');
    const abilitiesResult = await client.query(`
      SELECT id, name, description, trigger_moment, parameters
      FROM special_abilities
      ORDER BY id
    `);
    
    let abilitiesData = [];
    for (const ability of abilitiesResult.rows) {
      abilitiesData.push({
        id: ability.id,
        name: ability.name,
        description: ability.description,
        trigger_moment: ability.trigger_moment,
        parameters: ability.parameters
      });
    }
    
    // 3. Export cards data
    console.log('🃏 Exporting cards data...');
    const cardsResult = await client.query(`
      SELECT 
        c.name, 
        c.type, 
        c.rarity, 
        c.image_url, 
        c.power, 
        c.tags, 
        sa.id AS ability_id, 
        s.name AS set_name
      FROM cards c
      LEFT JOIN special_abilities sa ON c.special_ability_id = sa.ability_id
      LEFT JOIN sets s ON c.set_id = s.set_id
      ORDER BY c.name
    `);
    
    let cardsData = [];
    for (const card of cardsResult.rows) {
      cardsData.push({
        name: card.name,
        type: card.type,
        rarity: card.rarity,
        image_url: card.image_url,
        power: card.power,
        tags: card.tags,
        ability_id: card.ability_id,
        set_name: card.set_name
      });
    }
    
    // Format the data for game-data.js
    const gameDataContent = `// scripts/game-data.js
// Auto-generated from database on ${new Date().toISOString()}

const SPECIAL_ABILITIES_DATA = ${JSON.stringify(abilitiesData, null, 2)};

const CARDS_DATA = ${JSON.stringify(cardsData, null, 2)};

const SETS_DATA = ${JSON.stringify(setsData, null, 2)};

module.exports = { CARDS_DATA, SPECIAL_ABILITIES_DATA, SETS_DATA };`;

    fs.writeFileSync(path.join(__dirname, 'game-data.js'), gameDataContent);
    console.log('✅ Exported game-data.js');
    
    // Generate SQL queries for direct insertion
    let sqlQueries = `-- SQL Queries for direct database insertion
-- Generated from database on ${new Date().toISOString()}

-- Clear existing data (optional)
-- TRUNCATE sets CASCADE;
-- TRUNCATE special_abilities CASCADE;
-- TRUNCATE cards CASCADE;

-- Insert sets
`;

    setsData.forEach(set => {
      sqlQueries += `INSERT INTO sets (name, description, is_released, image_url)
VALUES ('${escapeSql(set.name)}', '${escapeSql(set.description)}', ${set.is_released}, '${escapeSql(set.image_url)}')
ON CONFLICT (name) DO UPDATE SET 
  description = EXCLUDED.description,
  is_released = EXCLUDED.is_released,
  image_url = EXCLUDED.image_url;
`;
    });

    sqlQueries += `\n-- Insert special abilities\n`;
    abilitiesData.forEach(ability => {
      sqlQueries += `INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('${escapeSql(ability.id)}', '${escapeSql(ability.name)}', '${escapeSql(ability.description)}', '${escapeSql(ability.trigger_moment)}', '${JSON.stringify(ability.parameters).replace(/'/g, "''")}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
`;
    });

    sqlQueries += `\n-- Insert cards\n`;
    sqlQueries += `-- Note: These queries assume sets and abilities are already inserted\n`;
    cardsData.forEach(card => {
      const abilityClause = card.ability_id 
        ? `(SELECT ability_id FROM special_abilities WHERE id = '${escapeSql(card.ability_id)}')`
        : 'NULL';
      
      sqlQueries += `INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  '${escapeSql(card.name)}',
  '${escapeSql(card.type)}',
  '${escapeSql(card.rarity)}',
  '${escapeSql(card.image_url)}',
  '${JSON.stringify(card.power).replace(/'/g, "''")}',
  ${abilityClause},
  ARRAY[${card.tags.map(tag => `'${escapeSql(tag)}'`).join(', ')}],
  (SELECT set_id FROM sets WHERE name = '${escapeSql(card.set_name)}')
)
ON CONFLICT (name) DO UPDATE SET 
  type = EXCLUDED.type,
  rarity = EXCLUDED.rarity,
  image_url = EXCLUDED.image_url,
  power = EXCLUDED.power,
  special_ability_id = EXCLUDED.special_ability_id,
  tags = EXCLUDED.tags,
  set_id = EXCLUDED.set_id;
`;
    });

    fs.writeFileSync(path.join(__dirname, 'database-queries.sql'), sqlQueries);
    console.log('✅ Exported database-queries.sql');
    
    console.log('\n📊 Export Summary:');
    console.log(`   Sets: ${setsData.length}`);
    console.log(`   Abilities: ${abilitiesData.length}`);
    console.log(`   Cards: ${cardsData.length}`);
    
  } catch (error) {
    console.error('❌ Error exporting database queries:', error);
    
    // Provide more helpful error message for connection issues
    if (error.code === 'ECONNREFUSED') {
      console.error('\n🔴 Database connection failed. Please check:');
      console.error('  1. Is your database server running?');
      console.error(`  2. Is DATABASE_URL set correctly in your .env file? Current value: ${process.env.DATABASE_URL || 'undefined'}`);
      console.error('  3. Do you need to use a different database name or credentials?');
    } else if (error.code === '3D000') {
      console.error('\n🔴 Database does not exist. Please check:');
      console.error(`  1. Is the database name in DATABASE_URL correct? Current value: ${process.env.DATABASE_URL || 'undefined'}`);
      console.error('  2. Have you created the database?');
    }
    
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Helper function to escape single quotes in SQL strings
 */
function escapeSql(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/'/g, "''");
}

/**
 * Main execution
 */
async function main() {
  try {
    await exportDatabaseQueries();
    console.log('\n🎉 All done! Database queries have been exported.');
  } catch (error) {
    console.error('💥 Export failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { exportDatabaseQueries };
