require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const AI_PLAYER_ID = process.env.AI_USER_ID || "00000000-0000-0000-0000-000000000000";
const CARDS_PER_DECK = 20;
const MAX_LEGENDARY_CARDS = 2;
const MAX_SAME_NAME_CARDS = 2;

// XP requirements for levels
const XP_REQUIREMENTS = {
  1: 0,
  2: 300,
  3: 1000, // 300 + 700
  4: 2500, // 1000 + 1500
  5: 6000, // 2500 + 3500
};

// Level power increments (round-robin pattern)
const LEVEL_POWER_INCREMENTS = {
  2: 'top',
  3: 'right',
  4: 'bottom',
  5: 'left'
};

// Story deck definitions
const STORY_DECKS = [
  {
    chapter: 1,
    name: "Forest Whispers",
    description: "Japanese Intro",
    cards: {
      legendary: ["Yamata no Orochi", "Hachiman"],
      epic: ["Benkei", "Benkei", "Momotaro", "Momotaro", "Tawara Tōda", "Tawara Tōda"],
      rare: ["Futakuchi-onna", "Futakuchi-onna", "Noppera-bō", "Noppera-bō", "Yuki-onna", "Yuki-onna", "Ushi-oni", "Ushi-oni"],
      common: ["Oni", "Tengu", "Kappa", "Tanuki"]
    }
  },
  {
    chapter: 2,
    name: "Sun over Steel",
    description: "Japanese mastery",
    cards: {
      legendary: ["Amaterasu", "Susanoo"],
      epic: ["Benkei", "Benkei", "Momotaro", "Momotaro", "Minamoto no Raikō", "Minamoto no Raikō"],
      rare: ["Futakuchi-onna", "Futakuchi-onna", "Noppera-bō", "Noppera-bō", "Nurarihyon", "Nurarihyon", "Yuki-onna", "Yuki-onna"],
      common: ["Tengu", "Tengu", "Kappa", "Oni"]
    }
  },
  {
    chapter: 3,
    name: "Winter of Ravens",
    description: "Norse intro",
    cards: {
      legendary: ["Vidar", "Jörmungandr"],
      epic: ["Frigg", "Frigg", "Bragi", "Bragi", "Skadi", "Skadi", "Tyr", "Tyr"],
      rare: ["Shieldmaiden", "Shieldmaiden", "Bear Totem", "Bear Totem", "Peasant Archer", "Peasant Archer"],
      common: ["Drenger", "Drenger", "Torchbearer", "Torchbearer"]
    }
  },
  {
    chapter: 4,
    name: "Hammerfall",
    description: "Norse mastery",
    cards: {
      legendary: ["Thor", "Baldr"],
      epic: ["Frigg", "Frigg", "Bragi", "Bragi", "Heimdall", "Njord", "Skadi", "Ran"],
      rare: ["Sigurd", "Freyja", "Shieldmaiden", "Shieldmaiden", "Norse Fox", "Norse Fox"],
      common: ["Peasant Archer", "Peasant Archer", "Drenger", "Torchbearer"]
    }
  },
  {
    chapter: 5,
    name: "Tides of Creation",
    description: "Polynesian intro",
    cards: {
      legendary: ["Pele", "Kanaloa"],
      epic: ["Hauwahine", "Hauwahine", "Mo‘oinanea", "Mo‘oinanea", "La‘amaomao", "La‘amaomao", "Hi‘iaka", "Kupua"],
      rare: ["Kapo", "Kapo", "Nightmarchers", "Nightmarchers"],
      common: ["Lava Scout", "Lava Scout", "Village Healer", "Village Healer", "Fisherman of Kuʻula", "Fisherman of Kuʻula"]
    }
  },
  {
    chapter: 6,
    name: "Heart of Fire",
    description: "Polynesian mastery",
    cards: {
      legendary: ["Kū", "Kāne"],
      epic: ["Kamapuaʻa", "Kamapuaʻa", "Māui", "Māui", "Lono", "Lono", "Kānehekili", "Kānehekili"],
      rare: ["Hauwahine", "Hauwahine", "Ukupanipo", "Ukupanipo"],
      common: ["Koa Warrior", "Koa Warrior", "Temple Drummer", "Temple Drummer", "Lava Scout", "Village Healer"]
    }
  },
  {
    chapter: 7,
    name: "Clash of Currents",
    description: "JP × Poly hybrid",
    cards: {
      legendary: ["Ryūjin", "Pele"],
      epic: ["Benkei", "Momotaro", "Tawara Tōda", "Mo‘oinanea", "La‘amaomao", "Kamapuaʻa", "Kupua", "Lono"],
      rare: ["Futakuchi-onna", "Futakuchi-onna", "Noppera-bō", "Noppera-bō", "Hauwahine", "Hauwahine", "Ushi-oni", "Ushi-oni"],
      common: ["Tengu", "Koa Warrior"]
    }
  },
  {
    chapter: 8,
    name: "Twilight Council",
    description: "Norse × Japanese hybrid",
    cards: {
      legendary: ["Odin", "Amaterasu"],
      epic: ["Heimdall", "Tyr", "Frigg", "Bragi", "Benkei", "Minamoto no Raikō"],
      rare: ["Noppera-bō", "Noppera-bō", "Futakuchi-onna", "Futakuchi-onna", "Shieldmaiden", "Shieldmaiden", "Bear Totem", "Bear Totem"],
      common: ["Torchbearer", "Torchbearer", "Drenger", "Tengu"]
    }
  },
  {
    chapter: 9,
    name: "When Worlds Collide",
    description: "Triple-culture",
    cards: {
      legendary: ["Loki", "Susanoo"],
      epic: ["Frigg", "Bragi", "Kānehekili", "Mo‘oinanea", "Lono", "Tyr"],
      rare: ["Hauwahine", "Hauwahine", "Noppera-bō", "Noppera-bō", "Futakuchi-onna", "Futakuchi-onna", "Ushi-oni", "Ushi-oni"],
      common: ["Peasant Archer", "Peasant Archer", "Tengu", "Tengu"]
    }
  },
  {
    chapter: 10,
    name: "The Convergence",
    description: "Boss prelude",
    cards: {
      legendary: ["Odin", "Hel"],
      epic: ["Heimdall", "Skadi", "Frigg", "Bragi", "Kamapuaʻa", "Mo‘oinanea", "Lono", "Tyr"],
      rare: ["Hauwahine", "Hauwahine", "Noppera-bō", "Noppera-bō", "Shieldmaiden", "Shieldmaiden"],
      common: ["Drenger", "Drenger", "Torchbearer", "Peasant Archer"]
    }
  }
];

/**
 * Calculate power for a card at a specific level
 */
function calculateLevelPower(basePower, level) {
  const power = { ...basePower };
  
  for (let l = 2; l <= level; l++) {
    const side = LEVEL_POWER_INCREMENTS[l];
    if (side) {
      power[side] = (power[side] || 0) + 1;
    }
  }
  
  return power;
}

/**
 * Find card by name (case-insensitive, handles variants)
 */
async function findCardByName(client, cardName, rarity = null) {
  let query = `
    SELECT card_id, name, rarity, power 
    FROM cards 
    WHERE LOWER(name) = LOWER($1)
  `;
  const params = [cardName];
  
  if (rarity) {
    query += ` AND rarity = $2`;
    params.push(rarity);
  }
  
  // Prefer base rarity over variants if no specific rarity requested
  if (!rarity) {
    query += ` ORDER BY 
      CASE 
        WHEN rarity::text NOT LIKE '%+%' THEN 1
        ELSE 2
      END,
      rarity
    LIMIT 1`;
  } else {
    query += ` LIMIT 1`;
  }
  
  const result = await client.query(query, params);
  return result.rows[0] || null;
}

/**
 * Find rarity variant cards (+, ++, +++)
 */
async function findRarityVariants(client, baseCardName, baseRarity) {
  const variants = ['+', '++', '+++'];
  const foundVariants = [];
  
  for (const variant of variants) {
    const variantRarity = baseRarity + variant;
    const card = await findCardByName(client, baseCardName, variantRarity);
    if (card) {
      foundVariants.push(card);
    }
  }
  
  return foundVariants;
}

/**
 * Get or create card instance for AI user
 * Returns an instance that hasn't been used yet (not in usedInstanceIds set)
 */
async function getOrCreateCardInstance(client, cardId, level, basePower, usedInstanceIds = new Set()) {
  // Get all available instances for this card/level
  const existing = await client.query(
    `SELECT user_card_instance_id FROM user_owned_cards 
     WHERE user_id = $1 AND card_id = $2 AND level = $3 
     ORDER BY created_at`,
    [AI_PLAYER_ID, cardId, level]
  );
  
  // Find an instance that hasn't been used yet
  for (const row of existing.rows) {
    if (!usedInstanceIds.has(row.user_card_instance_id)) {
      return row.user_card_instance_id;
    }
  }
  
  // All instances are used, create a new one
  const leveledPower = calculateLevelPower(basePower, level);
  const xpRequired = XP_REQUIREMENTS[level] || 0;
  
  const result = await client.query(
    `INSERT INTO user_owned_cards (user_id, card_id, level, xp, created_at)
     VALUES ($1, $2, $3, 0, NOW())
     RETURNING user_card_instance_id`,
    [AI_PLAYER_ID, cardId, level]
  );
  
  return result.rows[0].user_card_instance_id;
}

/**
 * Seed AI inventory with 10 copies of each card (2 per level 1-5)
 * Includes both base cards and rarity variants
 */
async function seedAIInventory(client) {
  console.log("\n📦 Seeding AI inventory...");
  
  const { rows: allCards } = await client.query(`SELECT card_id, name, rarity, power FROM cards ORDER BY name, rarity`);
  
  if (allCards.length === 0) {
    throw new Error("No cards found in database. Please seed cards first.");
  }
  
  console.log(`Found ${allCards.length} cards in database`);
  
  let totalCreated = 0;
  let totalSkipped = 0;
  
  for (const card of allCards) {
    for (let level = 1; level <= 5; level++) {
      // Create 2 instances per level
      for (let copy = 0; copy < 2; copy++) {
        const existing = await client.query(
          `SELECT user_card_instance_id FROM user_owned_cards 
           WHERE user_id = $1 AND card_id = $2 AND level = $3 
           LIMIT 1`,
          [AI_PLAYER_ID, card.card_id, level]
        );
        
        if (existing.rows.length === 0) {
          await getOrCreateCardInstance(client, card.card_id, level, card.power);
          totalCreated++;
        } else {
          totalSkipped++;
        }
      }
    }
  }
  
  console.log(`✅ Created ${totalCreated} new card instances`);
  console.log(`⏭️  Skipped ${totalSkipped} existing instances`);
  
  return { created: totalCreated, skipped: totalSkipped };
}

/**
 * Select cards for a deck, respecting constraints
 */
async function selectCardsForDeck(client, deckSpec, targetLevel, useVariants = false) {
  const selectedInstances = [];
  const usedInstanceIds = new Set(); // Track used instance IDs to prevent duplicates
  const nameCounts = {};
  let legendaryCount = 0;
  let variantCount = 0;
  const targetVariantCount = useVariants ? 4 + Math.floor(Math.random() * 3) : 0; // 4-6 variants
  
  // Collect all card names
  const allCardNames = [];
  
  // Process cards by rarity to collect names
  const rarities = ['legendary', 'epic', 'rare', 'common'];
  for (const rarity of rarities) {
    if (!deckSpec.cards[rarity]) continue;
    for (const cardName of deckSpec.cards[rarity]) {
      allCardNames.push({ name: cardName, rarity });
    }
  }
  
  // Pre-check which cards have variants available (only if using variants)
  const cardsWithVariants = new Set();
  if (useVariants) {
    for (const { name: cardName, rarity } of allCardNames) {
      const baseCard = await findCardByName(client, cardName);
      if (baseCard) {
        const variants = await findRarityVariants(client, cardName, baseCard.rarity);
        if (variants.length > 0) {
          cardsWithVariants.add(cardName);
        }
      }
    }
  }
  
  // Separate cards into those with variants and those without
  const cardsWithVariantsList = allCardNames.filter(c => cardsWithVariants.has(c.name));
  const cardsWithoutVariantsList = allCardNames.filter(c => !cardsWithVariants.has(c.name));
  
  // Shuffle both lists
  const shuffledWithVariants = [...cardsWithVariantsList].sort(() => Math.random() - 0.5);
  const shuffledWithoutVariants = [...cardsWithoutVariantsList].sort(() => Math.random() - 0.5);
  
  // Process cards with variants first (to meet variant count target)
  for (const { name: cardName, rarity } of shuffledWithVariants) {
    if (selectedInstances.length >= CARDS_PER_DECK) break;
    
    // Check name limit
    if (nameCounts[cardName] >= MAX_SAME_NAME_CARDS) {
      continue;
    }
    
    // Check legendary limit
    if (rarity === 'legendary' && legendaryCount >= MAX_LEGENDARY_CARDS) {
      continue;
    }
    
    const baseCard = await findCardByName(client, cardName);
    if (!baseCard) {
      console.warn(`⚠️  Base card not found: ${cardName}`);
      continue;
    }
    
    let card = null;
    let instanceId = null;
    let isVariant = false;
    
    // Use variant if we haven't reached target yet
    if (variantCount < targetVariantCount) {
      const variants = await findRarityVariants(client, cardName, baseCard.rarity);
      if (variants.length > 0) {
        // Use a random variant
        const variant = variants[Math.floor(Math.random() * variants.length)];
        card = variant;
        isVariant = true;
        instanceId = await getOrCreateCardInstance(
          client, 
          variant.card_id, 
          targetLevel, 
          variant.power,
          usedInstanceIds
        );
      }
    }
    
    // Fall back to base card if variant wasn't used
    if (!card) {
      card = baseCard;
      instanceId = await getOrCreateCardInstance(
        client, 
        baseCard.card_id, 
        targetLevel, 
        baseCard.power,
        usedInstanceIds
      );
    }
    
    if (card && instanceId && !usedInstanceIds.has(instanceId)) {
      selectedInstances.push(instanceId);
      usedInstanceIds.add(instanceId);
      nameCounts[cardName] = (nameCounts[cardName] || 0) + 1;
      if (rarity === 'legendary') {
        legendaryCount++;
      }
      if (isVariant) {
        variantCount++;
      }
    }
  }
  
  // Process remaining cards (those without variants or cards that still need more copies)
  // Combine both lists - nameCounts will prevent exceeding limits
  const remainingCards = [...shuffledWithoutVariants, ...shuffledWithVariants];
  
  for (const { name: cardName, rarity } of remainingCards) {
    if (selectedInstances.length >= CARDS_PER_DECK) break;
    
    // Check name limit
    if (nameCounts[cardName] >= MAX_SAME_NAME_CARDS) {
      continue;
    }
    
    // Check legendary limit
    if (rarity === 'legendary' && legendaryCount >= MAX_LEGENDARY_CARDS) {
      continue;
    }
    
    // Use base card
    const card = await findCardByName(client, cardName);
    if (card) {
      const instanceId = await getOrCreateCardInstance(
        client, 
        card.card_id, 
        targetLevel, 
        card.power,
        usedInstanceIds
      );
      
      if (instanceId && !usedInstanceIds.has(instanceId)) {
        selectedInstances.push(instanceId);
        usedInstanceIds.add(instanceId);
        nameCounts[cardName] = (nameCounts[cardName] || 0) + 1;
        if (rarity === 'legendary') {
          legendaryCount++;
        }
      }
    } else {
      console.warn(`⚠️  Card not found: ${cardName}`);
    }
  }
  
  if (useVariants && variantCount < 4) {
    console.warn(`  ⚠️  Only ${variantCount} variant cards used (target: 4-6)`);
  }
  
  return selectedInstances;
}

/**
 * Create a deck with specified cards
 */
async function createDeck(client, deckSpec, level, deckNumber) {
  const deckName = `AI Story ${deckSpec.chapter} - ${deckSpec.name} (L${level})`;
  
  // Check if deck already exists
  const existing = await client.query(
    `SELECT deck_id FROM decks WHERE user_id = $1 AND name = $2`,
    [AI_PLAYER_ID, deckName]
  );
  
  let deckId;
  
  if (existing.rows.length > 0) {
    deckId = existing.rows[0].deck_id;
    console.log(`  Deck "${deckName}" already exists, updating cards...`);
    
    // Delete existing cards
    await client.query(
      `DELETE FROM deck_cards WHERE deck_id = $1`,
      [deckId]
    );
  } else {
    // Create new deck
    const deckResult = await client.query(
      `INSERT INTO decks (user_id, name, created_at, last_updated)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING deck_id`,
      [AI_PLAYER_ID, deckName]
    );
    deckId = deckResult.rows[0].deck_id;
  }
  
  // Select cards for this deck
  const useVariants = level >= 4;
  const cardInstances = await selectCardsForDeck(client, deckSpec, level, useVariants);
  
  if (cardInstances.length !== CARDS_PER_DECK) {
    console.warn(`  ⚠️  Deck has ${cardInstances.length} cards, expected ${CARDS_PER_DECK}`);
  }
  
  // Add cards to deck
  for (let i = 0; i < cardInstances.length; i++) {
    await client.query(
      `INSERT INTO deck_cards (deck_id, user_card_instance_id)
       VALUES ($1, $2)`,
      [deckId, cardInstances[i]]
    );
  }
  
  // Check actual variant count after insertion
  let variantCount = 0;
  if (useVariants) {
    const variantResult = await client.query(
      `SELECT COUNT(*) as count
       FROM deck_cards dc
       JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
       JOIN cards c ON c.card_id = uoc.card_id
       WHERE dc.deck_id = $1 AND c.rarity::text LIKE '%+%'`,
      [deckId]
    );
    variantCount = parseInt(variantResult.rows[0].count);
  }
  
  return {
    deckId,
    name: deckName,
    cardCount: cardInstances.length,
    chapter: deckSpec.chapter,
    level,
    variantCount
  };
}

/**
 * Validate deck constraints
 */
async function validateDeck(client, deckId, deckName) {
  const issues = [];
  
  // Check card count
  const cardCount = await client.query(
    `SELECT COUNT(*) as count FROM deck_cards WHERE deck_id = $1`,
    [deckId]
  );
  
  if (parseInt(cardCount.rows[0].count) !== CARDS_PER_DECK) {
    issues.push(`Card count: ${cardCount.rows[0].count} (expected ${CARDS_PER_DECK})`);
  }
  
  // Check per-name limit
  const nameCounts = await client.query(
    `SELECT c.name, COUNT(*) as count
     FROM deck_cards dc
     JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
     JOIN cards c ON c.card_id = uoc.card_id
     WHERE dc.deck_id = $1
     GROUP BY c.name
     HAVING COUNT(*) > $2`,
    [deckId, MAX_SAME_NAME_CARDS]
  );
  
  if (nameCounts.rows.length > 0) {
    issues.push(`Name limit exceeded: ${nameCounts.rows.map(r => `${r.name} (${r.count})`).join(', ')}`);
  }
  
  // Check legendary limit
  const legendaryCount = await client.query(
    `SELECT COUNT(*) as count
     FROM deck_cards dc
     JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
     JOIN cards c ON c.card_id = uoc.card_id
     WHERE dc.deck_id = $1 AND c.rarity::text LIKE 'legendary%'`,
    [deckId]
  );
  
  if (parseInt(legendaryCount.rows[0].count) > MAX_LEGENDARY_CARDS) {
    issues.push(`Legendary count: ${legendaryCount.rows[0].count} (max ${MAX_LEGENDARY_CARDS})`);
  }
  
  if (issues.length > 0) {
    console.warn(`  ⚠️  Validation issues for "${deckName}":`);
    issues.forEach(issue => console.warn(`     - ${issue}`));
  }
  
  return issues.length === 0;
}

/**
 * Main execution
 */
async function main() {
  const client = await pool.connect();
  
  try {
    console.log("🚀 Starting AI Story Deck Seeding...");
    console.log(`AI User ID: ${AI_PLAYER_ID}`);
    
    // Verify AI user exists
    const userCheck = await client.query(
      `SELECT user_id FROM users WHERE user_id = $1`,
      [AI_PLAYER_ID]
    );
    
    if (userCheck.rows.length === 0) {
      throw new Error(`AI user with ID ${AI_PLAYER_ID} not found. Please create the AI user first.`);
    }
    
    await client.query('BEGIN');
    
    // Step 1: Seed AI inventory
    const inventoryResult = await seedAIInventory(client);
    
    // Step 2: Create decks (10 base decks × 5 levels = 50 decks)
    console.log("\n🎴 Creating story decks...");
    
    const createdDecks = [];
    
    for (const deckSpec of STORY_DECKS) {
      for (let level = 1; level <= 5; level++) {
        const deckNumber = (deckSpec.chapter - 1) * 5 + level;
        const deck = await createDeck(client, deckSpec, level, deckNumber);
        createdDecks.push(deck);
        
        // Validate deck
        await validateDeck(client, deck.deckId, deck.name);
        
        const variantInfo = deck.variantCount > 0 ? ` (${deck.variantCount} variants)` : '';
        console.log(`  ✅ Created: ${deck.name} (${deck.cardCount} cards${variantInfo})`);
      }
    }
    
    await client.query('COMMIT');
    
    // Summary
    console.log("\n📊 Summary:");
    console.log(`   Inventory: ${inventoryResult.created} created, ${inventoryResult.skipped} skipped`);
    console.log(`   Decks Created: ${createdDecks.length}`);
    console.log(`   - Level 1: ${createdDecks.filter(d => d.level === 1).length}`);
    console.log(`   - Level 2: ${createdDecks.filter(d => d.level === 2).length}`);
    console.log(`   - Level 3: ${createdDecks.filter(d => d.level === 3).length}`);
    console.log(`   - Level 4: ${createdDecks.filter(d => d.level === 4).length} (with variants)`);
    console.log(`   - Level 5: ${createdDecks.filter(d => d.level === 5).length} (with variants)`);
    
    const level4Decks = createdDecks.filter(d => d.level === 4);
    const level5Decks = createdDecks.filter(d => d.level === 5);
    const avgVariantsL4 = level4Decks.length > 0 
      ? (level4Decks.reduce((sum, d) => sum + d.variantCount, 0) / level4Decks.length).toFixed(1)
      : 0;
    const avgVariantsL5 = level5Decks.length > 0
      ? (level5Decks.reduce((sum, d) => sum + d.variantCount, 0) / level5Decks.length).toFixed(1)
      : 0;
    
    console.log(`   Variant Usage:`);
    console.log(`   - Level 4 average: ${avgVariantsL4} variant cards per deck`);
    console.log(`   - Level 5 average: ${avgVariantsL5} variant cards per deck`);
    
    console.log("\n✅ Story deck seeding completed successfully!");
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("\n❌ Error:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = { main, seedAIInventory, createDeck };
