const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/mythgame',
});

/**
 * Helper function to escape single quotes in SQL strings
 */
function escapeSql(str) {
  if (typeof str !== "string") return str;
  return str.replace(/'/g, "''");
}

/**
 * Initial sets data
 */
const initialSets = [
  {
    name: "Core Set",
    description: "The original set of cards for the Viking Vengeance game",
    is_released: true,
    image_url: "/assets/images/sets/core_set.jpg"
  },
  {
    name: "Expansion Pack 1",
    description: "First expansion with new cards and abilities",
    is_released: false,
    image_url: "/assets/images/sets/expansion_1.jpg"
  }
];

/**
 * Initial special abilities data
 */
const initialAbilities = [
  {
    id: "ability_card2",
    name: "Shieldmaidens Unite",
    description: "Gain +1 to all stats if adjacent to another Shield Maiden",
    trigger: "OnPlace",
  },
  {
    id: "ability_card5",
    name: "Hunt Charge",
    description: "+3 Right if it defeats an enemy this turn",
    trigger: "OnFlipped",
  },
  {
    id: "ability_card7",
    name: "Watery Depths",
    description: "+2 Bottom if adjacent to a Sea card",
    trigger: "OnPlace",
  },
  {
    id: "ability_card8",
    name: "Inspiring Song",
    description: "+1 to adjacent ally stats while on the board",
    trigger: "OnPlace",
  },
  {
    id: "ability_card13",
    name: "Icy Grasp",
    description: "Reduce adjacent enemy power by 2 before attack",
    trigger: "OnPlace",
  },
  {
    id: "ability_card14",
    name: "Young Fury",
    description: "+2 Top if it defeats an enemy",
    trigger: "OnFlipped",
  },
  {
    id: "ability_card16",
    name: "Swarm Tactics",
    description: "+2 to all power when surrounded by 2 or more cards",
    trigger: "OnPlace",
  },
  {
    id: "ability_card19",
    name: "Cunning Flank",
    description: "+1 to all powers if flanked on both sides by enemies",
    trigger: "OnPlace",
  },
  {
    id: "ability_card20",
    name: "Corner Light",
    description: "+1 all stats when placed in corner",
    trigger: "OnPlace",
  },
  {
    id: "ability_card21",
    name: "Heaven's Wrath",
    description: "Defeats all adjacent enemies if placed in top row",
    trigger: "OnPlace",
  },
  {
    id: "ability_card22",
    name: "Grave Vengeance",
    description: "50% chance to defeat 1 adjacent enemy back when defeated",
    trigger: "OnFlipped",
  },
  {
    id: "ability_card23",
    name: "Switcheroo",
    description: "Once: swap places with 1 adjacent enemy card",
    trigger: "OnPlace",
  },
  {
    id: "ability_card25",
    name: "Boatman's Bonus",
    description: "+2 Right if adjacent to boat or sea creature",
    trigger: "OnPlace",
  },
  {
    id: "ability_card26",
    name: "Runic Aura",
    description: "+1 to adjacent ally stats",
    trigger: "OnPlace",
  },
  {
    id: "ability_card27",
    name: "Devour Essence",
    description: "+1 to all stats for each defeated enemy",
    trigger: "OnPlace",
  },
  {
    id: "ability_card28",
    name: "Totem Empower",
    description: "+1 to top/bottom of adjacent Beast allies",
    trigger: "OnPlace",
  },
  {
    id: "ability_card29",
    name: "Storm Strike",
    description: "Reduce an adjacent enemy card's power by 2 for 1 turn",
    trigger: "OnPlace",
  },
  {
    id: "ability_card30",
    name: "Frost Roots",
    description: "+2 all stats if placed in bottom row",
    trigger: "OnPlace",
  },
  {
    id: "ability_card31",
    name: "Stone Wall",
    description: "Cannot be defeated for 1 turn after placement",
    trigger: "OnPlace",
  },
  {
    id: "ability_card32",
    name: "Mirror Mist",
    description: "Once: swap this card's left/right values",
    trigger: "OnPlace",
  },
  {
    id: "ability_card33",
    name: "Ice Line Bonus",
    description: "+2 Bottom if adjacent to a water-based card",
    trigger: "OnPlace",
  },
  {
    id: "ability_card34",
    name: "Flame Touch",
    description: "Reduce adjacent enemy power by 1 before attack",
    trigger: "OnPlace",
  },
  {
    id: "ability_card35",
    name: "Wind Push",
    description: "Push 1 adjacent enemy card away (if space open)",
    trigger: "OnPlace",
  },
  {
    id: "ability_card36",
    name: "Divine Judgment",
    description: "Defeats any adjacent card with lower total power",
    trigger: "OnPlace",
  },
  {
    id: "ability_card37",
    name: "Bloodlust",
    description: "Defeated enemies become permanent allies",
    trigger: "OnAnyFlip",
  },
  {
    id: "ability_card38",
    name: "Thunder Response",
    description: "+3 all stats if placed after opponent's turn",
    trigger: "OnPlace",
  },
  {
    id: "ability_card39",
    name: "Titan Shell",
    description: "Cannot be defeated",
    trigger: "OnPlace",
  },
  {
    id: "ability_card40",
    name: "Warrior's Blessing",
    description: "Allies adjacent gain +2 while Freya is on the board",
    trigger: "OnPlace",
  }
];

/**
 * Initial cards data
 */
const initialCards = [
  {
    name: "Thrall",
    type: "warrior",
    rarity: "common",
    image: "/assets/images/cards/thrall.svg",
    power: { top: 3, right: 4, bottom: 3, left: 4 },
    tags: ["human"],
    ability_id: null,
    set_name: "Core Set"
  },
  {
    name: "Shield Maiden",
    type: "warrior",
    rarity: "common",
    image: "/assets/images/cards/shield_maiden.svg",
    power: { top: 5, right: 6, bottom: 6, left: 5 },
    tags: ["human"],
    ability_id: "ability_card2",
    set_name: "Core Set"
  },
  {
    name: "Wolf Pup",
    type: "beast",
    rarity: "common",
    image: "/assets/images/cards/wolf_pup.svg",
    power: { top: 4, right: 8, bottom: 2, left: 6 },
    tags: ["beast"],
    ability_id: null,
    set_name: "Core Set"
  },
  {
    name: "Drengr",
    type: "warrior",
    rarity: "common",
    image: "/assets/images/cards/drengr_warrior.svg",
    power: { top: 6, right: 5, bottom: 7, left: 3 },
    tags: ["warrior", "human"],
    ability_id: null,
    set_name: "Core Set"
  },
  {
    name: "Boar of the Hunt",
    type: "beast",
    rarity: "common",
    image: "/assets/images/cards/boar_of_the_hunt.svg",
    power: { top: 3, right: 9, bottom: 3, left: 5 },
    tags: ["beast"],
    ability_id: "ability_card5",
    set_name: "Core Set"
  },
  {
    name: "Kraken",
    type: "sea",
    rarity: "rare",
    image: "/assets/images/cards/kraken.svg",
    power: { top: 8, right: 5, bottom: 9, left: 6 },
    tags: ["sea", "mythical"],
    ability_id: "ability_card7",
    set_name: "Core Set"
  },
  {
    name: "Skald",
    type: "support",
    rarity: "uncommon",
    image: "/assets/images/cards/skald.svg",
    power: { top: 4, right: 3, bottom: 5, left: 4 },
    tags: ["human", "support"],
    ability_id: "ability_card8",
    set_name: "Core Set"
  },
  {
    name: "Frost Giant",
    type: "giant",
    rarity: "epic",
    image: "/assets/images/cards/frost_giant.svg",
    power: { top: 7, right: 8, bottom: 8, left: 7 },
    tags: ["giant", "ice"],
    ability_id: "ability_card13",
    set_name: "Core Set"
  },
  {
    name: "Young Berserker",
    type: "warrior",
    rarity: "common",
    image: "/assets/images/cards/young_berserker.svg",
    power: { top: 5, right: 6, bottom: 4, left: 5 },
    tags: ["human", "berserker"],
    ability_id: "ability_card14",
    set_name: "Core Set"
  },
  {
    name: "Raven Swarm",
    type: "beast",
    rarity: "uncommon",
    image: "/assets/images/cards/raven_swarm.svg",
    power: { top: 3, right: 4, bottom: 3, left: 4 },
    tags: ["beast", "flying"],
    ability_id: "ability_card16",
    set_name: "Core Set"
  }
];

/**
 * Seed the database with initial data
 */
async function seedDatabase() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🌱 Starting database seeding...');
    
    // 1. Seed sets
    console.log('📦 Seeding sets...');
    for (const set of initialSets) {
      await client.query(`
        INSERT INTO sets (name, description, is_released, image_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (name) DO NOTHING
      `, [set.name, set.description, set.is_released, set.image_url]);
    }
    
    // 2. Seed special abilities
    console.log('⚡ Seeding special abilities...');
    for (const ability of initialAbilities) {
      await client.query(`
        INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `, [ability.id, ability.name, ability.description, ability.trigger, '{}']);
    }
    
    // 3. Seed cards
    console.log('🃏 Seeding cards...');
    for (const card of initialCards) {
      // Get set_id and ability_id if they exist
      const setResult = await client.query('SELECT set_id FROM sets WHERE name = $1', [card.set_name]);
      const set_id = setResult.rows[0]?.set_id || null;
      
      let ability_id = null;
      if (card.ability_id) {
        const abilityResult = await client.query('SELECT ability_id FROM special_abilities WHERE id = $1', [card.ability_id]);
        ability_id = abilityResult.rows[0]?.ability_id || null;
      }
      
      await client.query(`
        INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (name) DO NOTHING
      `, [
        card.name,
        card.type,
        card.rarity,
        card.image,
        JSON.stringify(card.power),
        ability_id,
        card.tags,
        set_id
      ]);
    }
    
    await client.query('COMMIT');
    console.log('✅ Database seeding completed successfully!');
    
    // Print summary
    const setCount = await client.query('SELECT COUNT(*) FROM sets');
    const abilityCount = await client.query('SELECT COUNT(*) FROM special_abilities');
    const cardCount = await client.query('SELECT COUNT(*) FROM cards');
    
    console.log('\n📊 Seeding Summary:');
    console.log(`   Sets: ${setCount.rows[0].count}`);
    console.log(`   Abilities: ${abilityCount.rows[0].count}`);
    console.log(`   Cards: ${cardCount.rows[0].count}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await seedDatabase();
    console.log('\n🎉 All done! Database has been seeded with initial data.');
  } catch (error) {
    console.error('💥 Seeding failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { seedDatabase }; 