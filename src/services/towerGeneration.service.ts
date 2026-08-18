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
import {
  TowerModifier,
  MAX_MODIFIERS_PER_FLOOR,
} from "../types/towerModifier.types";

// AI Player ID for creating decks
const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

// Generation lock to prevent concurrent generation
let isGenerating = false;

// Constants for deck constraints
const CARDS_PER_DECK = 20;

// Flavorful floor name components for fallback generation
const FLOOR_NAME_PREFIXES = [
  "The", "Realm of", "Domain of", "Temple of", "Shrine of", "Gates of",
  "Sanctum of", "Halls of", "Depths of", "Heights of", "Path of", "Trial of",
  "Chamber of", "Throne of", "Citadel of", "Fortress of", "Garden of",
  "Labyrinth of", "Crypt of", "Tower of", "Abyss of", "Pinnacle of"
];

const FLOOR_NAME_THEMES = [
  // Elemental themes
  "Eternal Flames", "Frozen Shadows", "Howling Winds", "Shifting Sands",
  "Thunderous Fury", "Raging Waters", "Living Stone", "Sacred Light",
  // Mythological themes
  "Forgotten Gods", "Ancient Titans", "Celestial Beings", "Primordial Chaos",
  "Divine Wrath", "Eternal Spirits", "Ancestral Power", "Mythic Heroes",
  // Atmospheric themes
  "Endless Night", "Crimson Dawn", "Starless Void", "Twilight Mists",
  "Golden Radiance", "Silver Moonlight", "Obsidian Darkness", "Emerald Dreams",
  // Challenge themes
  "Unyielding Trials", "Final Reckoning", "Supreme Test", "Ultimate Challenge",
  "Perilous Ascent", "Relentless Storm", "Unforgiving Judgment", "Fated Destiny",
  // Nature themes
  "Whispering Forest", "Roaring Seas", "Volcanic Fury", "Glacial Silence",
  "Desert Mirage", "Mountain's Peak", "Jungle's Heart", "Ocean's Depths",
  // Abstract themes
  "Lost Memories", "Shattered Dreams", "Burning Ambition", "Hollow Echoes",
  "Twisted Fate", "Broken Oaths", "Vengeful Spirits", "Triumphant Glory"
];

/**
 * Generate a creative floor name for fallback generation
 */
function generateCreativeFloorName(floorNumber: number): string {
  // Use floor number to seed somewhat consistent results
  const prefixIndex = floorNumber % FLOOR_NAME_PREFIXES.length;
  const themeIndex = Math.floor(floorNumber * 1.618) % FLOOR_NAME_THEMES.length; // Golden ratio for variety

  return `${FLOOR_NAME_PREFIXES[prefixIndex]} ${FLOOR_NAME_THEMES[themeIndex]}`;
}

/**
 * Check if a floor name is generic (just "Floor X")
 */
function isGenericFloorName(name: string): boolean {
  return /^Floor\s+\d+$/i.test(name.trim());
}

// AI deck constraints (more lenient than player decks)
const AI_MAX_LEGENDARY_CARDS = 4;
const AI_MAX_SAME_NAME_CARDS = 4;

// Player deck constraints (enforced at game start via the power budget)
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

// Milestone floors (every 100) act as soft-cap "gates": the AI level is
// spiked so they read as a wall players grind against, with easier stretches
// between. See MILESTONE_SPIKE.
const MILESTONE_INTERVAL = 100;
const MILESTONE_SPIKE = 1.3; // +30% AI level on every 100th floor

// Past floor 100, AI level is eased because Encounter Modifiers now add
// difficulty on every 5th floor. Applied before MILESTONE_SPIKE so the 100-floor
// gates stay proportionally as sharp as before.
const DEEP_FLOOR_EASE = 0.9;

/**
 * Calculate target average card level for a given floor.
 *
 * Scaling philosophy (tuned 2026-06, see david-tower analysis):
 * - Early floors (1-50) start meaningfully above level 1 so they are NOT a
 *   free walk even for a fresh deck (previously floors 1-50 had a ~96% win
 *   rate; target ~75%).
 * - Deep floors stay only modestly above the old curve on purpose: the bigger
 *   deep-floor difficulty win comes from removing commons from AI decks (which
 *   were the entire base-power gap), so we avoid stacking two large buffs.
 * - Every 100th floor is a soft-cap gate spiked by MILESTONE_SPIKE.
 * - Past floor 100 the curve is eased by DEEP_FLOOR_EASE (2026-08): Encounter
 *   Modifiers now supply difficulty on every 5th floor, so raw AI level no
 *   longer has to carry deep-floor difficulty on its own. Floors 1-100 are
 *   untouched because modifiers only start past 100.
 *
 * NOTE: this function is triplicated in scripts/gen-tower-floors.js and
 * scripts/verify-tower.js. Change all three together or verify-tower will warn
 * on every floor.
 */
function calculateTargetAverageLevel(floorNumber: number): number {
  if (floorNumber <= 1) {
    return 2.0;
  }

  let baseLevel: number;
  if (floorNumber <= 50) {
    // Floors 1-50: 2.0 -> ~4.5
    baseLevel = 2.0 + (floorNumber - 1) * 0.05;
  } else if (floorNumber <= 100) {
    // Floors 51-100: 4.5 -> ~6.5
    baseLevel = 4.5 + (floorNumber - 50) * 0.04;
  } else if (floorNumber <= 200) {
    // Floors 101-200: 6.5 -> ~10.5, eased
    baseLevel = (6.5 + (floorNumber - 100) * 0.04) * DEEP_FLOOR_EASE;
  } else {
    // Floors 201+: ~10.5 -> grows ~0.045/floor, eased
    baseLevel = (10.5 + (floorNumber - 200) * 0.045) * DEEP_FLOOR_EASE;
  }

  // Soft-cap gate spike on milestone floors
  if (floorNumber % MILESTONE_INTERVAL === 0) {
    baseLevel *= MILESTONE_SPIKE;
  }

  return baseLevel;
}

// ---------------------------------------------------------------------------
// Encounter Modifiers (generation side)
// ---------------------------------------------------------------------------

/** Floors carrying modifiers: every 5th floor above 100. */
const MODIFIER_INTERVAL = 5;
const FIRST_MODIFIER_FLOOR = 100;

const MODIFIER_BANNABLE_TAGS = [
  "war", "sea", "mystic", "spirit", "nature", "trickster", "sky",
  "beast", "dragon", "underworld", "fire", "ice", "demon", "giant",
];
const MODIFIER_SETS = ["norse", "japanese", "polynesian"];

export function floorTakesModifiers(floorNumber: number): boolean {
  return (
    floorNumber > FIRST_MODIFIER_FLOOR &&
    floorNumber % MODIFIER_INTERVAL === 0
  );
}

/**
 * Sanitize the `modifiers` array an LLM returned for a floor.
 *
 * The model is treated as untrusted, exactly like the powerup totals it returns:
 * anything malformed, unknown, out of range, or against the authoring rules is
 * DROPPED rather than written. A bad generation must never be able to produce a
 * floor that cannot be entered, or one carrying modifiers where the design says
 * there should be none.
 */
export function sanitizeGeneratedModifiers(
  raw: unknown,
  floorNumber: number
): TowerModifier[] {
  if (!floorTakesModifiers(floorNumber)) return [];
  if (!Array.isArray(raw)) return [];

  const cleaned: TowerModifier[] = [];
  let restrictions = 0;

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const type = String(candidate.type ?? "");
    const label = String(candidate.label ?? "").trim();
    const description = String(candidate.description ?? "").trim();

    // Display copy is shown verbatim in the app; without it, drop the modifier
    // rather than invent wording here.
    if (!label || !description) continue;

    let value: number | string | undefined;

    switch (type) {
      case "no_legendary":
        break;
      case "single_set": {
        const set = String(candidate.value ?? "").toLowerCase();
        if (!MODIFIER_SETS.includes(set)) continue;
        value = set;
        break;
      }
      case "no_tag": {
        const tag = String(candidate.value ?? "").toLowerCase();
        // god/human are deliberately never bannable.
        if (!MODIFIER_BANNABLE_TAGS.includes(tag)) continue;
        value = tag;
        break;
      }
      case "max_budget": {
        // Must land strictly below DECK_CONFIG.POWER_BUDGET (40) to restrict
        // anything at all, with 30 as the tightest cap we allow.
        const budget = Number(candidate.value);
        if (!Number.isFinite(budget) || budget < 30 || budget > 39) continue;
        value = Math.round(budget);
        break;
      }
      case "poison": {
        const amount = Number(candidate.value);
        const normalized = Number.isFinite(amount) && amount >= 2 ? 2 : 1;
        // Poison 2 is reserved for the deepest band.
        value = floorNumber > 300 ? normalized : 1;
        break;
      }
      default:
        continue;
    }

    const isRestriction = type !== "poison";
    if (isRestriction) {
      // At most one deck restriction per floor — stacking them can wall a floor.
      if (restrictions >= 1) continue;
      restrictions += 1;
    } else if (cleaned.some((m) => m.type === "poison")) {
      continue;
    }

    cleaned.push({
      type: type as TowerModifier["type"],
      ...(value !== undefined ? { value } : {}),
      label,
      description,
    });

    if (cleaned.length >= MAX_MODIFIERS_PER_FLOOR) break;
  }

  return cleaned;
}

/**
 * Deterministic modifiers for a floor, used when the LLM is unavailable.
 *
 * Delegates to scripts/assign-tower-modifiers.js so the fallback and the
 * backfill can never drift apart — the script is the single definition of "what
 * modifiers does floor N get". Required lazily and defensively: this is a
 * best-effort enrichment, and a resolution failure must not break generation.
 */
export function fallbackModifiersForFloor(floorNumber: number): TowerModifier[] {
  if (!floorTakesModifiers(floorNumber)) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { modifiersForFloor } = require("../../scripts/assign-tower-modifiers.js");
    return sanitizeGeneratedModifiers(modifiersForFloor(floorNumber), floorNumber);
  } catch (error) {
    console.warn(
      "[TowerGen] Could not load deterministic modifiers; floor will have none",
      error instanceof Error ? error.message : error
    );
    return [];
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
        `[TowerGen] Starting generation of floors ${startingFloor} to ${startingFloor + count - 1
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
        cv.card_variant_id as card_id,
        ch.name,
        cv.rarity,
        ch.base_power->>'top' as power_top,
        ch.base_power->>'right' as power_right,
        ch.base_power->>'bottom' as power_bottom,
        ch.base_power->>'left' as power_left,
        sa.name as ability_name,
        sa.description as ability_description
      FROM card_variants cv
      JOIN characters ch ON cv.character_id = ch.character_id
      LEFT JOIN special_abilities sa ON ch.special_ability_id = sa.ability_id
      WHERE cv.rarity::text NOT LIKE '%+'
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW()
      ORDER BY ch.name
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

    return `You are a game designer for a card battle game. Generate ${count} AI opponent decks for tower floors ${startingFloor} to ${startingFloor + count - 1
      }.

AVAILABLE CARDS:
${cardListText}

REFERENCE DECK (Floor ${referenceDeck.floor_number}, Average Level: ${referenceDeck.cards.reduce((sum, c) => sum + c.level, 0) /
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
- Use the TARGET AVERAGE LEVELS above as the source of truth for these floors
- General shape of the curve (for context only — trust the targets above):
  * Floor 1: avg ~2.0
  * Floor 50: avg ~4.5
  * Floor 100: avg ~8.5 (milestone gate, intentionally harder)
  * Floor 200: avg ~13.5 (milestone gate)
  * Floor 500: avg ~31 (milestone gate)
  * Every 100th floor is a difficulty GATE and is spiked ~30% higher
- For the current floors (${startingFloor}-${startingFloor + count - 1}):
  * Match the target average levels above as closely as you can
  * If a floor number is a multiple of 100, lean into the higher target
- Vary individual card levels for interesting deck composition:
  * Some cards at higher levels (powerhouses)
  * Some cards at lower levels (support/filler)
  * Higher rarity cards can be higher level
- Powerups are automatically determined by level, so focus on level distribution

CARD RARITY FLOOR (IMPORTANT):
- ${startingFloor > 50
        ? "These are deep floors (>50): use ZERO common and uncommon cards. Build the deck ENTIRELY from rare, epic, and legendary cards. Commons have roughly half the base power of epics and make the deck too weak regardless of level."
        : "These are early floors (<=50): commons and uncommons are acceptable as filler, but still prefer rare/epic where possible."}

DECK DESIGN TIPS:
- Create synergistic decks with varied power levels
- Use higher-level legendary/epic cards as anchors
${startingFloor > 50
        ? "- Fill remaining slots with rare/epic cards, NOT commons/uncommons"
        : "- Balance the deck with lower-level commons/uncommons"}
- Consider card abilities when choosing levels
- Make each floor feel unique and challenging

ENCOUNTER MODIFIERS:
- Every 5th floor ABOVE floor 100 (105, 110, 115, ...) carries Encounter Modifiers:
  extra rules the PLAYER must play around. Floors at or below 100, and floors not
  divisible by 5, must have an empty "modifiers": [].
- Maximum 2 modifiers per floor, and AT MOST ONE deck restriction. The optional
  second modifier must be the "poison" status. Never combine two deck restrictions
  — that can make a floor impossible to enter.
- Deck restrictions (pick at most one):
  * {"type":"no_legendary"} — no Legendary cards allowed
  * {"type":"single_set","value":"norse"|"japanese"|"polynesian"} — only that set
  * {"type":"no_tag","value":"<tag>"} — that tag is banned. Allowed values ONLY:
    war, sea, mystic, spirit, nature, trickster, sky, beast, dragon, underworld,
    fire, ice, demon, giant. NEVER use "god" or "human" — too much of the card
    pool carries them.
  * {"type":"max_budget","value":<30-39>} — caps the deck power budget (normally 40)
- Status (optional second slot):
  * {"type":"poison","value":1|2} — each turn a random card in the player's hand
    loses that much power. Use 2 only past floor 300.
- Every modifier MUST include a short evocative "label" (2-3 words) and a plain
  "description" written for the player. These are shown verbatim in the app, so
  they must read as finished copy, not as internal notes. Keep the description to
  one short clause — 8 words or fewer, no lead-in like "On this floor," — because
  it renders in a narrow chip beside the label.
- Make the floor_name and deck_name echo the modifier's theme where it fits
  (e.g. a "no_legendary" floor might be "The Hall of Mortals").
- Deeper floors should lean toward harsher modifiers (tighter budgets, poison 2).

OUTPUT FORMAT (JSON array):
[
  {
    "floor_number": ${startingFloor},
    "floor_name": "The Frozen Wastes",
    "deck_name": "Frost Giants Deck",
    "modifiers": [
      {
        "type": "no_legendary",
        "label": "Mortal Trial",
        "description": "No Legendary cards."
      },
      {
        "type": "poison",
        "value": 1,
        "label": "Creeping Venom",
        "description": "Hand loses 1 power per turn."
      }
    ],
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
- Include a "modifiers" array on every floor (empty [] when the floor is not an
  every-5th floor above 100)

FLOOR NAMING REQUIREMENTS (CRITICAL):
- Each floor_name MUST be creative and evocative (3-6 words)
- NEVER use generic names like "Floor 39" or "Floor X" - these will be rejected
- Draw from mythology, nature, emotions, and epic fantasy themes
- Examples of GOOD names:
  * "The Sunken Temple of Leviathan"
  * "Realm of Forgotten Ancestors"
  * "Citadel of Eternal Storms"
  * "The Crimson Halls of Judgment"
  * "Domain of the Frost Giants"
  * "Shrine of the Celestial Serpent"
- Give each deck a thematic name (deck_name) that matches the floor theme`;
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
                `[TowerGen]   ⚠️  Card "${card.card_name || card.name
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

          const floorNumber = floor.floor_number || startingFloor + index;

          // Get floor name - use provided name if flavorful, otherwise generate one
          let floorName = floor.floor_name;
          if (!floorName || isGenericFloorName(floorName)) {
            floorName = generateCreativeFloorName(floorNumber);
            console.log(
              `[TowerGen]   ⚠️  Floor ${floorNumber} had generic name, generated: "${floorName}"`
            );
          }

          // Get deck name - use provided or derive from floor name
          let deckName = floor.deck_name;
          if (!deckName || /^Floor\s+\d+\s+Deck$/i.test(deckName.trim())) {
            deckName = `${floorName} Deck`;
          }

          return {
            floor_number: floorNumber,
            floor_name: floorName,
            deck_name: deckName,
            cards,
            average_card_level,
            modifiers: sanitizeGeneratedModifiers(
              floor.modifiers,
              floorNumber
            ),
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

      // Fill remaining slots. Past floor 50 the AI should run almost no
      // commons/uncommons — those cards have ~half the base power of epics and
      // were the entire base-power gap that let strong player decks out-card a
      // heavily over-leveled AI. So at depth we backfill with more epic/rare
      // (re-shuffled, respecting the per-name cap) and only fall back to
      // commons if the higher-rarity pools are genuinely exhausted.
      const allowCommons = floorNumber <= 50;
      const fillerPool = this.shuffleArray([
        ...(cardsByRarity["epic"] || []),
        ...(cardsByRarity["rare"] || []),
        ...(allowCommons
          ? [
              ...(cardsByRarity["common"] || []),
              ...(cardsByRarity["uncommon"] || []),
            ]
          : []),
      ]);
      for (const card of fillerPool) {
        if (deckCards.length >= CARDS_PER_DECK) break;
        if ((usedNames.get(card.name) || 0) >= AI_MAX_SAME_NAME_CARDS) continue;
        deckCards.push({
          card_name: card.name,
          level: roundedLevel,
          power_ups: distributePowerups(roundedLevel),
        });
        usedNames.set(card.name, (usedNames.get(card.name) || 0) + 1);
      }

      // Last-resort backfill if even the high-rarity pools couldn't fill 20
      // (very small card sets) — only then accept commons/uncommons.
      if (deckCards.length < CARDS_PER_DECK) {
        const lastResort = this.shuffleArray([
          ...(cardsByRarity["common"] || []),
          ...(cardsByRarity["uncommon"] || []),
        ]);
        for (const card of lastResort) {
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
      }

      // Calculate average card level
      const totalLevel = deckCards.reduce((sum, card) => sum + card.level, 0);
      const deckAvgLevel =
        deckCards.length > 0
          ? Math.round((totalLevel / deckCards.length) * 10) / 10 // Round to 1 decimal
          : 1;

      // Generate creative floor name instead of generic "Floor X"
      const floorName = generateCreativeFloorName(floorNumber);

      floors.push({
        floor_number: floorNumber,
        floor_name: floorName,
        deck_name: `${floorName} Deck`,
        cards: deckCards,
        average_card_level: deckAvgLevel,
        // Reuse the deterministic backfill generator so a Gemini outage still
        // produces correctly-shaped modifiers rather than silently creating
        // modifier-less deep floors.
        modifiers: fallbackModifiersForFloor(floorNumber),
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
      const normalizedCardNames = Array.from(
        new Set(floor.cards.map((card) => card.card_name.toLowerCase()))
      );
      const variantsResult = await client.query(
        `SELECT DISTINCT ON (LOWER(ch.name))
            LOWER(ch.name) as normalized_name,
            cv.card_variant_id as card_id
         FROM card_variants cv
         JOIN characters ch ON cv.character_id = ch.character_id
         WHERE LOWER(ch.name) = ANY($1::text[])
           AND cv.rarity::text NOT LIKE '%+'
           AND cv.released_at <= NOW()
           AND ch.released_at <= NOW()
         ORDER BY LOWER(ch.name), cv.card_variant_id`,
        [normalizedCardNames]
      );

      const variantByName = new Map<string, string>();
      variantsResult.rows.forEach((row) => {
        variantByName.set(row.normalized_name, row.card_id);
      });

      const preparedCards: Array<{
        cardVariantId: string;
        level: number;
        powerUps?: { top: number; right: number; bottom: number; left: number };
      }> = [];

      for (const card of floor.cards) {
        const cardVariantId = variantByName.get(card.card_name.toLowerCase());
        if (!cardVariantId) {
          console.warn(
            `[TowerGen]   ⚠️  Card not found: "${card.card_name}", skipping`
          );
          cardsSkipped++;
          continue;
        }

        preparedCards.push({
          cardVariantId,
          level: card.level,
          powerUps: card.power_ups
            ? {
                top: card.power_ups.top || 0,
                right: card.power_ups.right || 0,
                bottom: card.power_ups.bottom || 0,
                left: card.power_ups.left || 0,
              }
            : undefined,
        });
      }

      if (preparedCards.length > 0) {
        const instanceInsertResult = await client.query(
          `INSERT INTO user_owned_cards (user_id, card_variant_id, level, xp, created_at)
           SELECT $1::uuid, data.card_variant_id, data.level, 0, NOW()
           FROM UNNEST($2::uuid[], $3::int[]) AS data(card_variant_id, level)
           RETURNING user_card_instance_id`,
          [
            AI_PLAYER_ID,
            preparedCards.map((card) => card.cardVariantId),
            preparedCards.map((card) => card.level),
          ]
        );

        const insertedInstanceIds = instanceInsertResult.rows.map(
          (row) => row.user_card_instance_id as string
        );
        cardsAdded = insertedInstanceIds.length;

        const powerUpInstanceIds: string[] = [];
        const powerUpCounts: number[] = [];
        const powerUpData: Record<string, number>[] = [];

        insertedInstanceIds.forEach((instanceId, index) => {
          const powerUps = preparedCards[index]?.powerUps;
          if (!powerUps) {
            return;
          }
          const hasPowerUps = Object.values(powerUps).some((value) => value > 0);
          if (!hasPowerUps) {
            return;
          }
          powerUpInstanceIds.push(instanceId);
          powerUpCounts.push(
            powerUps.top + powerUps.right + powerUps.bottom + powerUps.left
          );
          powerUpData.push(powerUps);
        });

        if (powerUpInstanceIds.length > 0) {
          await client.query(
            `INSERT INTO user_card_power_ups (user_card_instance_id, power_up_count, power_up_data)
             SELECT data.user_card_instance_id, data.power_up_count, data.power_up_data_json::jsonb
             FROM UNNEST($1::uuid[], $2::int[], $3::text[]) AS data(user_card_instance_id, power_up_count, power_up_data_json)`,
            [
              powerUpInstanceIds,
              powerUpCounts,
              powerUpData.map((payload) => JSON.stringify(payload)),
            ]
          );
        }

        await client.query(
          `INSERT INTO deck_cards (deck_id, user_card_instance_id)
           SELECT $1::uuid, unnest($2::uuid[])`,
          [deckId, insertedInstanceIds]
        );
      }

      console.log(
        `[TowerGen]   Cards added: ${cardsAdded}, skipped: ${cardsSkipped}`
      );

      // Create tower floor entry
      await client.query(
        `INSERT INTO tower_floors (floor_number, name, ai_deck_id, average_card_level, modifiers, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW())`,
        [
          floor.floor_number,
          floor.floor_name,
          deckId,
          floor.average_card_level || null,
          floor.modifiers && floor.modifiers.length > 0
            ? JSON.stringify(floor.modifiers)
            : null,
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
