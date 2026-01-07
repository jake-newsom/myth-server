/**
 * Tower Generation Service - Uses Gemini AI to generate new tower floors
 */

import db from "../config/db.config";
import {
  GeneratedFloorDeck,
  GeneratedDeckCard,
  CardDataForGeneration,
  ReferenceDeckData,
} from "../types/tower.types";

// AI Player ID for creating decks
const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

// Generation lock to prevent concurrent generation
let isGenerating = false;

// Constants for deck constraints
const CARDS_PER_DECK = 20;

// AI deck constraints (more lenient than player decks)
const AI_MAX_LEGENDARY_CARDS = 4;
const AI_MAX_SAME_NAME_CARDS = 4;

// Player deck constraints (enforced at game start)
const PLAYER_MAX_LEGENDARY_CARDS = 2;
const PLAYER_MAX_SAME_NAME_CARDS = 2;

// Powerup scaling rules
const PLAYER_POWERUPS_PER_LEVEL = 1; // Players get 1 powerup point per level above 1
const AI_POWERUPS_PER_LEVEL = 3; // AI gets 3 powerup points per level above 1

/**
 * Calculate maximum powerup points for a card based on level
 */
function calculateMaxPowerups(level: number, isAI: boolean = true): number {
  const multiplier = isAI ? AI_POWERUPS_PER_LEVEL : PLAYER_POWERUPS_PER_LEVEL;
  return Math.max(0, (level - 1) * multiplier);
}

/**
 * Calculate target average card level for a given floor using gradual scaling
 * This ensures sustainable long-term progression
 */
function calculateTargetAverageLevel(floorNumber: number): number {
  // Base level is 1.0
  let baseLevel = 1.0;

  // Progressive scaling based on floor ranges
  if (floorNumber <= 1) {
    return 1.0;
  } else if (floorNumber <= 50) {
    // Floors 1-50: Very slow progression (1.0 -> 2.0)
    // ~0.02 per floor
    return baseLevel + (floorNumber - 1) * 0.02;
  } else if (floorNumber <= 100) {
    // Floors 51-100: Slightly faster (2.0 -> 3.5)
    // ~0.03 per floor
    const previousLevel = 2.0;
    return previousLevel + (floorNumber - 50) * 0.03;
  } else if (floorNumber <= 200) {
    // Floors 101-200: Steady progression (3.5 -> 6.5)
    // ~0.03 per floor
    const previousLevel = 3.5;
    return previousLevel + (floorNumber - 100) * 0.03;
  } else {
    // Floors 201+: Moderate scaling (~0.04 per floor)
    const previousLevel = 6.5;
    return previousLevel + (floorNumber - 200) * 0.04;
  }
}

class TowerGenerationService {
  /**
   * Trigger floor generation (called asynchronously from tower.service)
   */
  async triggerGeneration(
    startingFloor: number,
    count: number,
    referenceFloor: number
  ): Promise<void> {
    if (isGenerating) {
      console.log("[TowerGen] Generation already in progress, skipping");
      return;
    }

    try {
      isGenerating = true;
      console.log(
        `[TowerGen] Starting generation of floors ${startingFloor} to ${
          startingFloor + count - 1
        }`
      );

      // Get reference deck data
      const TowerService = require("./tower.service").default;
      const referenceDeck = await TowerService.getReferenceDeckData(
        referenceFloor
      );

      if (!referenceDeck) {
        console.error(
          `[TowerGen] Could not get reference deck for floor ${referenceFloor}`
        );
        return;
      }

      // Get all available cards
      const allCards = await this.getAllCardsForGeneration();

      // Generate floors using Gemini
      const generatedFloors = await this.generateFloorsWithGemini(
        allCards,
        referenceDeck,
        startingFloor,
        count
      );

      // Create the floors in database
      for (const floor of generatedFloors) {
        await this.createFloorFromGenerated(floor);
      }

      console.log(
        `[TowerGen] Successfully generated ${generatedFloors.length} floors`
      );
    } catch (error) {
      console.error("[TowerGen] Generation failed:", error);
      throw error;
    } finally {
      isGenerating = false;
    }
  }

  /**
   * Get all cards with their data for the Gemini prompt
   */
  private async getAllCardsForGeneration(): Promise<CardDataForGeneration[]> {
    const result = await db.query(`
      SELECT 
        c.card_id,
        c.name,
        c.rarity,
        c.power->>'top' as power_top,
        c.power->>'right' as power_right,
        c.power->>'bottom' as power_bottom,
        c.power->>'left' as power_left,
        sa.name as ability_name,
        sa.description as ability_description
      FROM cards c
      LEFT JOIN special_abilities sa ON c.special_ability_id = sa.ability_id
      WHERE c.rarity::text NOT LIKE '%+'
      ORDER BY c.name
    `);

    return result.rows.map((row) => ({
      card_id: row.card_id,
      name: row.name,
      rarity: row.rarity,
      base_power: {
        top: parseInt(row.power_top || "0"),
        right: parseInt(row.power_right || "0"),
        bottom: parseInt(row.power_bottom || "0"),
        left: parseInt(row.power_left || "0"),
      },
      special_ability: row.ability_name
        ? {
            name: row.ability_name,
            description: row.ability_description,
          }
        : undefined,
    }));
  }

  /**
   * Generate floors using Gemini AI
   */
  private async generateFloorsWithGemini(
    allCards: CardDataForGeneration[],
    referenceDeck: ReferenceDeckData,
    startingFloor: number,
    count: number
  ): Promise<GeneratedFloorDeck[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-pro";

    if (!apiKey) {
      console.warn(
        "[TowerGen] GEMINI_API_KEY not set, using fallback generation"
      );
      return [];
    }

    const prompt = this.buildGeminiPrompt(
      allCards,
      referenceDeck,
      startingFloor,
      count
    );

    // Log the prompt being sent
    console.log("[TowerGen] ========================================");
    console.log("[TowerGen] Sending prompt to Gemini API");
    console.log("[TowerGen] Model:", modelName);
    console.log("[TowerGen] Prompt length:", prompt.length, "characters");
    console.log("[TowerGen] ========================================");
    console.log(prompt);
    console.log("[TowerGen] ========================================");

    try {
      // Call Gemini API using the configured model
      console.log(`[TowerGen] Calling Gemini API with model: ${modelName}...`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 16384,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[TowerGen] Gemini API error:", errorText);
        return this.generateFallbackFloors(
          allCards,
          referenceDeck,
          startingFloor,
          count
        );
      }

      const data = await response.json();
      const generatedText =
        data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Log the response received
      console.log("[TowerGen] ========================================");
      console.log("[TowerGen] Received response from Gemini API");
      console.log(
        "[TowerGen] Response length:",
        generatedText.length,
        "characters"
      );
      console.log("[TowerGen] ========================================");
      console.log(generatedText);
      console.log("[TowerGen] ========================================");

      return this.parseGeminiResponse(generatedText, startingFloor, count);
    } catch (error) {
      console.error("[TowerGen] Error calling Gemini:", error);
      return this.generateFallbackFloors(
        allCards,
        referenceDeck,
        startingFloor,
        count
      );
    }
  }

  /**
   * Build the prompt for Gemini
   * Note: count is typically 2 for testing purposes
   */
  private buildGeminiPrompt(
    allCards: CardDataForGeneration[],
    referenceDeck: ReferenceDeckData,
    startingFloor: number,
    count: number
  ): string {
    // Group cards by rarity for easier reference
    const cardsByRarity: Record<string, CardDataForGeneration[]> = {};
    for (const card of allCards) {
      if (!cardsByRarity[card.rarity]) {
        cardsByRarity[card.rarity] = [];
      }
      cardsByRarity[card.rarity].push(card);
    }

    const cardListText = Object.entries(cardsByRarity)
      .map(([rarity, cards]) => {
        const cardDescriptions = cards
          .map((c) => {
            const power = `[${c.base_power.top}/${c.base_power.right}/${c.base_power.bottom}/${c.base_power.left}]`;
            const ability = c.special_ability
              ? ` - ${c.special_ability.name}: ${c.special_ability.description}`
              : "";
            return `  - ${c.name} ${power}${ability}`;
          })
          .join("\n");
        return `${rarity.toUpperCase()}:\n${cardDescriptions}`;
      })
      .join("\n\n");

    const referenceDeckText = referenceDeck.cards
      .map(
        (c) =>
          `  - ${c.name} (Level ${c.level}) [${c.effective_power.top}/${c.effective_power.right}/${c.effective_power.bottom}/${c.effective_power.left}]`
      )
      .join("\n");

    // Calculate expected target levels for context
    const targetLevels = [];
    for (let i = 0; i < count; i++) {
      const floorNum = startingFloor + i;
      const target = calculateTargetAverageLevel(floorNum);
      targetLevels.push(`Floor ${floorNum}: ~${target.toFixed(1)}`);
    }

    return `You are a game designer for a card battle game. Generate ${count} AI opponent decks for tower floors ${startingFloor} to ${
      startingFloor + count - 1
    }.

AVAILABLE CARDS:
${cardListText}

REFERENCE DECK (Floor ${referenceDeck.floor_number}, Average Level: ${
      referenceDeck.cards.reduce((sum, c) => sum + c.level, 0) /
      referenceDeck.cards.length
    }, Average Power: ${referenceDeck.average_power.toFixed(1)}):
${referenceDeckText}

TARGET AVERAGE LEVELS FOR THESE FLOORS:
${targetLevels.join("\n")}
(These are targets - you can vary by ±0.3, but try to stay close)

DECK CONSTRAINTS:
- Each deck must have exactly ${CARDS_PER_DECK} cards
- Maximum ${AI_MAX_LEGENDARY_CARDS} legendary cards per deck
- Maximum ${AI_MAX_SAME_NAME_CARDS} copies of the same card name
- Card levels can be any positive integer (no cap, scales infinitely)

POWERUP RULES (IMPORTANT):
- AI cards get ${AI_POWERUPS_PER_LEVEL} powerup points per level above 1
- Formula: max_powerups = (level - 1) × ${AI_POWERUPS_PER_LEVEL}
- Examples:
  * Level 1 card: 0 powerup points available
  * Level 2 card: ${AI_POWERUPS_PER_LEVEL} powerup points available
  * Level 5 card: ${(5 - 1) * AI_POWERUPS_PER_LEVEL} powerup points available
  * Level 10 card: ${(10 - 1) * AI_POWERUPS_PER_LEVEL} powerup points available
- Distribute these points across the 4 edges (top, right, bottom, left)
- Total of all 4 edges must equal or be less than max_powerups
- Use strategic distribution (e.g., focus on 2 strong edges, or balance all 4)

DIFFICULTY SCALING STRATEGY:
- Scale difficulty primarily through AVERAGE CARD LEVEL
- Use VERY GRADUAL scaling for long-term progression:
  * Floors 1-50: Stay mostly at level 1-2 (increase ~0.02 per floor)
  * Floors 51-100: Slowly reach level 3-4 (increase ~0.03 per floor)
  * Floors 101-200: Progress to level 5-7 (increase ~0.03 per floor)
  * After floor 200: Can scale slightly faster (increase ~0.04 per floor)
- Target average levels as reference:
  * Floor 1: avg 1.0
  * Floor 10: avg 1.2
  * Floor 25: avg 1.5
  * Floor 50: avg 2.0
  * Floor 100: avg 3.5
  * Floor 200: avg 6.5
- For the current floors (${startingFloor}-${startingFloor + count - 1}):
  * Match or slightly exceed the reference deck's average level
  * Keep progression gradual and sustainable
- Vary individual card levels for interesting deck composition:
  * Some cards at higher levels (powerhouses)
  * Some cards at lower levels (support/filler)
  * Higher rarity cards can be higher level
- Powerups are automatically determined by level, so focus on level distribution

DECK DESIGN TIPS:
- Create synergistic decks with varied power levels
- Use higher-level legendary/epic cards as anchors
- Balance the deck with lower-level commons/uncommons
- Consider card abilities when choosing levels
- Make each floor feel unique and challenging

OUTPUT FORMAT (JSON array):
[
  {
    "floor_number": ${startingFloor},
    "floor_name": "The Frozen Wastes",
    "deck_name": "Frost Giants Deck",
    "cards": [
      {
        "card_name": "Card Name",
        "level": 2,
        "power_ups": {"top": 1, "right": 2, "bottom": 0, "left": 0}
      },
      ...
    ]
  },
  ...
]

IMPORTANT: 
- Output ONLY the JSON array, no other text
- Use exact card names from the available cards list
- Ensure powerup totals match the level formula: (level - 1) × ${AI_POWERUPS_PER_LEVEL}
- Focus on creating interesting level distributions within each deck
- Give each floor a creative, thematic name (floor_name) that hints at the challenge
- Give each deck a thematic name (deck_name) that matches the floor theme
- Make names evocative and exciting (e.g., "The Abyssal Depths", "Olympian Heights", "Realm of Shadows")`;
  }

  /**
   * Parse Gemini response into GeneratedFloorDeck[]
   */
  private parseGeminiResponse(
    responseText: string,
    startingFloor: number,
    expectedCount: number
  ): GeneratedFloorDeck[] {
    try {
      console.log("[TowerGen] Parsing Gemini response...");

      // Extract JSON from response (might have markdown code blocks)
      let jsonText = responseText;
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        console.log("[TowerGen] Found JSON in markdown code block");
        jsonText = jsonMatch[1].trim();
      }

      // Try to find JSON array in the text
      const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        console.log("[TowerGen] Extracted JSON array from text");
        jsonText = arrayMatch[0];
      }

      const parsed = JSON.parse(jsonText);

      if (!Array.isArray(parsed)) {
        throw new Error("Response is not an array");
      }

      console.log(
        `[TowerGen] Successfully parsed ${parsed.length} floors from response`
      );

      // Validate and normalize the response
      const normalized: GeneratedFloorDeck[] = parsed.map(
        (floor: any, index: number) => {
          const cards = (floor.cards || []).map((card: any) => {
            const level = Math.max(1, card.level || 1);
            const maxPowerups = calculateMaxPowerups(level, true);

            // Get powerups from response or default to empty
            let powerUps = card.power_ups || {
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
            };

            // Validate and normalize powerups
            const totalPowerups =
              (powerUps.top || 0) +
              (powerUps.right || 0) +
              (powerUps.bottom || 0) +
              (powerUps.left || 0);

            // If total exceeds max, scale down proportionally
            if (totalPowerups > maxPowerups) {
              const scale = maxPowerups / totalPowerups;
              powerUps = {
                top: Math.floor((powerUps.top || 0) * scale),
                right: Math.floor((powerUps.right || 0) * scale),
                bottom: Math.floor((powerUps.bottom || 0) * scale),
                left: Math.floor((powerUps.left || 0) * scale),
              };
              console.log(
                `[TowerGen]   ⚠️  Card "${
                  card.card_name || card.name
                }" level ${level} had ${totalPowerups} powerups (max: ${maxPowerups}), scaled down`
              );
            }

            return {
              card_name: card.card_name || card.name,
              level,
              power_ups: powerUps,
            };
          });

          // Calculate average card level
          const totalLevel = cards.reduce(
            (sum: number, card: GeneratedDeckCard) => sum + card.level,
            0
          );
          const average_card_level =
            cards.length > 0
              ? Math.round((totalLevel / cards.length) * 10) / 10 // Round to 1 decimal
              : 1;

          return {
            floor_number: floor.floor_number || startingFloor + index,
            floor_name: floor.floor_name || `Floor ${startingFloor + index}`,
            deck_name: floor.deck_name || `Floor ${startingFloor + index} Deck`,
            cards,
            average_card_level,
          };
        }
      );

      console.log("[TowerGen] Floor parsing summary:");
      normalized.forEach((floor) => {
        console.log(
          `  - Floor ${floor.floor_number}: ${floor.cards.length} cards, avg level: ${floor.average_card_level}`
        );
      });

      return normalized;
    } catch (error) {
      console.error("[TowerGen] ========================================");
      console.error("[TowerGen] Failed to parse Gemini response");
      console.error("[TowerGen] Error:", error);
      console.error("[TowerGen] Response preview (first 500 chars):");
      console.error(responseText.substring(0, 500));
      console.error("[TowerGen] ========================================");
      return [];
    }
  }

  /**
   * Fallback floor generation when Gemini is unavailable
   */
  private async generateFallbackFloors(
    allCards: CardDataForGeneration[],
    referenceDeck: ReferenceDeckData,
    startingFloor: number,
    count: number
  ): Promise<GeneratedFloorDeck[]> {
    console.log("[TowerGen] Using fallback generation");

    const floors: GeneratedFloorDeck[] = [];

    // Calculate base level from reference
    const avgLevel =
      referenceDeck.cards.length > 0
        ? referenceDeck.cards.reduce((sum, c) => sum + c.level, 0) /
          referenceDeck.cards.length
        : 1;

    // Group cards by rarity
    const cardsByRarity: Record<string, CardDataForGeneration[]> = {};
    for (const card of allCards) {
      const baseRarity = card.rarity.replace(/\+/g, "");
      if (!cardsByRarity[baseRarity]) {
        cardsByRarity[baseRarity] = [];
      }
      cardsByRarity[baseRarity].push(card);
    }

    for (let i = 0; i < count; i++) {
      const floorNumber = startingFloor + i;

      // Calculate target level for this floor using gradual scaling formula
      const targetLevel = calculateTargetAverageLevel(floorNumber);
      const roundedLevel = Math.max(1, Math.round(targetLevel));

      const deckCards: GeneratedDeckCard[] = [];
      const usedNames: Map<string, number> = new Map();

      // Helper function to distribute powerups for a given level
      const distributePowerups = (level: number) => {
        const maxPowerups = calculateMaxPowerups(level, true);
        const powerUps = { top: 0, right: 0, bottom: 0, left: 0 };

        if (maxPowerups === 0) return powerUps;

        // Distribute powerups randomly but strategically
        let remaining = maxPowerups;
        const edges = ["top", "right", "bottom", "left"] as const;

        // Randomly decide on a distribution strategy
        const strategy = Math.random();

        if (strategy < 0.3) {
          // Focus on 2 edges (aggressive)
          const edge1 = edges[Math.floor(Math.random() * 4)];
          const edge2 = edges[Math.floor(Math.random() * 4)];
          powerUps[edge1] = Math.floor(remaining * 0.6);
          powerUps[edge2] = remaining - powerUps[edge1];
        } else if (strategy < 0.6) {
          // Balance across all 4 edges
          const perEdge = Math.floor(remaining / 4);
          powerUps.top = perEdge;
          powerUps.right = perEdge;
          powerUps.bottom = perEdge;
          powerUps.left = remaining - perEdge * 3;
        } else {
          // Random distribution
          while (remaining > 0) {
            const edge = edges[Math.floor(Math.random() * 4)];
            powerUps[edge]++;
            remaining--;
          }
        }

        return powerUps;
      };

      // Select up to 4 legendary cards (AI decks have more lenient rules)
      const legendaryCards = this.shuffleArray([
        ...(cardsByRarity["legendary"] || []),
      ]);
      for (const card of legendaryCards) {
        if (deckCards.length >= AI_MAX_LEGENDARY_CARDS) break;
        if ((usedNames.get(card.name) || 0) >= AI_MAX_SAME_NAME_CARDS) continue;
        deckCards.push({
          card_name: card.name,
          level: roundedLevel,
          power_ups: distributePowerups(roundedLevel),
        });
        usedNames.set(card.name, (usedNames.get(card.name) || 0) + 1);
      }

      // Select epic cards (6)
      const epicCards = this.shuffleArray([...(cardsByRarity["epic"] || [])]);
      for (const card of epicCards) {
        if (deckCards.length >= 10) break; // 4 legendary + 6 epic = 10
        if ((usedNames.get(card.name) || 0) >= AI_MAX_SAME_NAME_CARDS) continue;
        deckCards.push({
          card_name: card.name,
          level: roundedLevel,
          power_ups: distributePowerups(roundedLevel),
        });
        usedNames.set(card.name, (usedNames.get(card.name) || 0) + 1);
      }

      // Select rare cards (6)
      const rareCards = this.shuffleArray([...(cardsByRarity["rare"] || [])]);
      for (const card of rareCards) {
        if (deckCards.length >= 16) break; // 4 legendary + 6 epic + 6 rare = 16
        if ((usedNames.get(card.name) || 0) >= AI_MAX_SAME_NAME_CARDS) continue;
        deckCards.push({
          card_name: card.name,
          level: roundedLevel,
          power_ups: distributePowerups(roundedLevel),
        });
        usedNames.set(card.name, (usedNames.get(card.name) || 0) + 1);
      }

      // Fill remaining with common/uncommon (slightly lower level)
      const commonCards = this.shuffleArray([
        ...(cardsByRarity["common"] || []),
        ...(cardsByRarity["uncommon"] || []),
      ]);
      for (const card of commonCards) {
        if (deckCards.length >= CARDS_PER_DECK) break;
        if ((usedNames.get(card.name) || 0) >= AI_MAX_SAME_NAME_CARDS) continue;
        const lowerLevel = Math.max(1, roundedLevel - 1);
        deckCards.push({
          card_name: card.name,
          level: lowerLevel,
          power_ups: distributePowerups(lowerLevel),
        });
        usedNames.set(card.name, (usedNames.get(card.name) || 0) + 1);
      }

      // Calculate average card level
      const totalLevel = deckCards.reduce((sum, card) => sum + card.level, 0);
      const deckAvgLevel =
        deckCards.length > 0
          ? Math.round((totalLevel / deckCards.length) * 10) / 10 // Round to 1 decimal
          : 1;

      floors.push({
        floor_number: floorNumber,
        floor_name: `Floor ${floorNumber}`,
        deck_name: `Floor ${floorNumber} Deck`,
        cards: deckCards,
        average_card_level: deckAvgLevel,
      });
    }

    return floors;
  }

  /**
   * Create a floor in the database from generated data
   */
  private async createFloorFromGenerated(
    floor: GeneratedFloorDeck
  ): Promise<void> {
    console.log(
      `[TowerGen] Creating floor ${floor.floor_number} in database...`
    );
    console.log(`[TowerGen]   Floor Name: ${floor.floor_name}`);
    console.log(`[TowerGen]   Deck: ${floor.deck_name}`);
    console.log(`[TowerGen]   Cards: ${floor.cards.length}`);
    console.log(
      `[TowerGen]   Average Card Level: ${floor.average_card_level || "N/A"}`
    );

    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Check if floor already exists
      const existingFloor = await client.query(
        "SELECT floor_number FROM tower_floors WHERE floor_number = $1",
        [floor.floor_number]
      );

      if (existingFloor.rows.length > 0) {
        console.log(
          `[TowerGen] Floor ${floor.floor_number} already exists, skipping`
        );
        await client.query("ROLLBACK");
        return;
      }

      // Create deck for AI user
      console.log(`[TowerGen]   Creating AI deck...`);
      const deckResult = await client.query(
        `INSERT INTO decks (user_id, name, created_at, last_updated)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING deck_id`,
        [AI_PLAYER_ID, floor.deck_name]
      );
      const deckId = deckResult.rows[0].deck_id;
      console.log(`[TowerGen]   Deck ID: ${deckId}`);

      // Create card instances and add to deck
      let cardsAdded = 0;
      let cardsSkipped = 0;

      for (const card of floor.cards) {
        // Find the card ID by name
        const cardResult = await client.query(
          `SELECT card_id, power FROM cards 
           WHERE LOWER(name) = LOWER($1) 
           AND rarity::text NOT LIKE '%+'
           LIMIT 1`,
          [card.card_name]
        );

        if (cardResult.rows.length === 0) {
          console.warn(
            `[TowerGen]   ⚠️  Card not found: "${card.card_name}", skipping`
          );
          cardsSkipped++;
          continue;
        }

        const cardId = cardResult.rows[0].card_id;

        // Create card instance for AI
        const instanceResult = await client.query(
          `INSERT INTO user_owned_cards (user_id, card_id, level, xp, created_at)
           VALUES ($1, $2, $3, 0, NOW())
           RETURNING user_card_instance_id`,
          [AI_PLAYER_ID, cardId, card.level]
        );
        const instanceId = instanceResult.rows[0].user_card_instance_id;

        // Create powerup record if powerups exist
        if (card.power_ups) {
          const powerUpData = {
            top: card.power_ups.top || 0,
            right: card.power_ups.right || 0,
            bottom: card.power_ups.bottom || 0,
            left: card.power_ups.left || 0,
          };

          // Only create powerup record if at least one value is non-zero
          const hasPowerUps = Object.values(powerUpData).some((val) => val > 0);
          if (hasPowerUps) {
            const powerUpCount = Object.values(powerUpData).reduce(
              (sum, val) => sum + val,
              0
            );
            await client.query(
              `INSERT INTO user_card_power_ups (user_card_instance_id, power_up_count, power_up_data)
               VALUES ($1, $2, $3)`,
              [instanceId, powerUpCount, JSON.stringify(powerUpData)]
            );
          }
        }

        // Add to deck
        await client.query(
          `INSERT INTO deck_cards (deck_id, user_card_instance_id)
           VALUES ($1, $2)`,
          [deckId, instanceId]
        );
        cardsAdded++;
      }

      console.log(
        `[TowerGen]   Cards added: ${cardsAdded}, skipped: ${cardsSkipped}`
      );

      // Create tower floor entry
      await client.query(
        `INSERT INTO tower_floors (floor_number, name, ai_deck_id, average_card_level, is_active, created_at)
         VALUES ($1, $2, $3, $4, true, NOW())`,
        [
          floor.floor_number,
          floor.floor_name,
          deckId,
          floor.average_card_level || null,
        ]
      );

      await client.query("COMMIT");
      console.log(
        `[TowerGen] ✓ Successfully created floor ${floor.floor_number}`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(
        `[TowerGen] Failed to create floor ${floor.floor_number}:`,
        error
      );
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Shuffle array using Fisher-Yates algorithm
   */
  private shuffleArray<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }
}

export default new TowerGenerationService();
