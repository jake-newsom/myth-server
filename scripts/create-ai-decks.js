require("dotenv").config();
const { Pool } = require("pg");

// DB connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const NUM_DECKS = 10;
const CARDS_PER_DECK = 20;
const MAX_LEGENDARY_CARDS = 2;
const MAX_SAME_NAME_CARDS = 2;

async function createAIDecks() {
  const client = await pool.connect();

  try {
    // Start a transaction
    await client.query("BEGIN");

    // Get all available cards
    const { rows: allCards } = await client.query(`
      SELECT * FROM "cards"
    `);

    if (allCards.length === 0) {
      console.error("No cards found in the database. Please seed cards first.");
      return;
    }

    console.log(`Found ${allCards.length} cards in the database.`);

    // Create card instances for AI user if they don't exist yet
    await createCardInstances(client, allCards);

    // Get all card instances owned by AI
    const { rows: aiCardInstances } = await client.query(
      `
      SELECT * FROM "user_owned_cards" 
      WHERE user_id = $1
    `,
      [AI_PLAYER_ID]
    );

    if (aiCardInstances.length === 0) {
      console.error(
        "No AI card instances found. Failed to create card instances."
      );
      return;
    }

    console.log(`Found ${aiCardInstances.length} card instances for AI.`);

    // Group card instances by card_id for easier access
    const cardInstancesByCardId = {};
    for (const instance of aiCardInstances) {
      if (!cardInstancesByCardId[instance.card_id]) {
        cardInstancesByCardId[instance.card_id] = [];
      }
      cardInstancesByCardId[instance.card_id].push(instance);
    }

    // Create deck themes based on card types
    const deckThemes = generateDeckThemes(allCards);

    // Create decks
    for (let i = 0; i < NUM_DECKS; i++) {
      const deckTheme = deckThemes[i % deckThemes.length];
      const deckName = `AI ${deckTheme.name} Deck ${
        Math.floor(i / deckThemes.length) + 1
      }`;

      // Create deck
      const { rows: deckRows } = await client.query(
        `
        INSERT INTO "decks" (user_id, name, created_at, last_updated)
        VALUES ($1, $2, NOW(), NOW())
        RETURNING deck_id
      `,
        [AI_PLAYER_ID, deckName]
      );

      const deckId = deckRows[0].deck_id;
      console.log(`Created deck: ${deckName} with ID: ${deckId}`);

      // Select cards for this deck based on theme
      const selectedCards = selectCardsForDeck(
        allCards,
        deckTheme,
        cardInstancesByCardId
      );

      // Add cards to deck
      for (const cardInstance of selectedCards) {
        await client.query(
          `
          INSERT INTO "deck_cards" (deck_id, user_card_instance_id)
          VALUES ($1, $2)
        `,
          [deckId, cardInstance.user_card_instance_id]
        );
      }

      console.log(`Added ${selectedCards.length} cards to deck ${deckId}`);
    }

    // Commit transaction
    await client.query("COMMIT");
    console.log(`Successfully created ${NUM_DECKS} decks for AI player.`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating AI decks:", error);
  } finally {
    client.release();
    pool.end();
  }
}

// Create card instances for AI user
async function createCardInstances(client, allCards) {
  // Check if AI already has card instances
  const { rows: existingInstances } = await client.query(
    `
    SELECT COUNT(*) as count FROM "user_owned_cards" 
    WHERE user_id = $1
  `,
    [AI_PLAYER_ID]
  );

  if (parseInt(existingInstances[0].count) > 0) {
    console.log(
      `AI already has ${existingInstances[0].count} card instances. Skipping creation.`
    );
    return;
  }

  console.log("Creating card instances for AI player...");

  // Create instances for each card (3 instances per card for variety)
  for (const card of allCards) {
    for (let i = 0; i < 3; i++) {
      await client.query(
        `
        INSERT INTO "user_owned_cards" (user_id, card_id, level, xp)
        VALUES ($1, $2, $3, 0)
      `,
        [AI_PLAYER_ID, card.card_id, 1]
      );
    }
  }

  console.log(`Created card instances for ${allCards.length} different cards.`);
}

// Generate deck themes based on card types
function generateDeckThemes(allCards) {
  // Extract all unique types
  const types = [...new Set(allCards.map((card) => card.type))];

  // Create themes based on types
  const themes = types.map((type) => ({
    name: capitalizeFirstLetter(type),
    primaryType: type,
    secondaryTypes: types.filter((t) => t !== type).slice(0, 2), // Include 2 secondary types
  }));

  // Add mixed themes
  themes.push({
    name: "Balanced",
    primaryType: null,
    secondaryTypes: types.slice(0, 4), // Include up to 4 types
  });

  return themes;
}

// Helper to capitalize first letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Select cards for a deck based on theme
function selectCardsForDeck(allCards, theme, cardInstancesByCardId) {
  const selectedCardInstances = [];
  const selectedCardNames = new Map(); // To track cards by name
  let legendaryCount = 0;

  // Filter cards based on theme
  let eligibleCards = allCards;
  if (theme.primaryType) {
    // Prioritize cards of primary type (60%), then secondary types (40%)
    const primaryCards = allCards.filter(
      (card) => card.type === theme.primaryType
    );
    const secondaryCards = allCards.filter((card) =>
      theme.secondaryTypes.includes(card.type)
    );
    const otherCards = allCards.filter(
      (card) =>
        card.type !== theme.primaryType &&
        !theme.secondaryTypes.includes(card.type)
    );

    // Mix them with appropriate weighting
    eligibleCards = [
      ...shuffleArray(primaryCards),
      ...shuffleArray(secondaryCards),
      ...shuffleArray(otherCards),
    ];
  } else {
    // For balanced decks, just shuffle all cards
    eligibleCards = shuffleArray([...allCards]);
  }

  // Loop through eligible cards and select for deck
  for (const card of eligibleCards) {
    // Skip if we already have the max number of cards
    if (selectedCardInstances.length >= CARDS_PER_DECK) break;

    // Skip if we already have max number of this card name
    const currentNameCount = selectedCardNames.get(card.name) || 0;
    if (currentNameCount >= MAX_SAME_NAME_CARDS) continue;

    // Skip if it's a legendary card and we already have max legendary cards
    if (card.rarity === "legendary" && legendaryCount >= MAX_LEGENDARY_CARDS)
      continue;

    // Skip if no instances available for this card
    if (
      !cardInstancesByCardId[card.card_id] ||
      cardInstancesByCardId[card.card_id].length === 0
    )
      continue;

    // Get an instance of this card
    const cardInstance = cardInstancesByCardId[card.card_id].pop();
    if (!cardInstance) continue; // Skip if no instance available

    // Add to selected cards
    selectedCardInstances.push(cardInstance);
    selectedCardNames.set(card.name, currentNameCount + 1);

    // Increment legendary count if applicable
    if (card.rarity === "legendary") {
      legendaryCount++;
    }
  }

  // If we don't have enough cards, fill with any available cards
  if (selectedCardInstances.length < CARDS_PER_DECK) {
    for (const cardId in cardInstancesByCardId) {
      if (selectedCardInstances.length >= CARDS_PER_DECK) break;

      const instances = cardInstancesByCardId[cardId];
      if (instances && instances.length > 0) {
        const card = allCards.find(
          (c) => c.card_id.toString() === cardId.toString()
        );

        // Skip if it's a legendary card and we already have max legendary cards
        if (
          card.rarity === "legendary" &&
          legendaryCount >= MAX_LEGENDARY_CARDS
        )
          continue;

        // Skip if we already have max number of this card name
        const currentNameCount = selectedCardNames.get(card.name) || 0;
        if (currentNameCount >= MAX_SAME_NAME_CARDS) continue;

        const cardInstance = instances.pop();
        selectedCardInstances.push(cardInstance);
        selectedCardNames.set(card.name, currentNameCount + 1);

        if (card.rarity === "legendary") {
          legendaryCount++;
        }
      }
    }
  }

  return selectedCardInstances;
}

// Fisher-Yates shuffle algorithm
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

createAIDecks();
