/**
 * Patch script to regenerate creative names for tower floors that have generic "Floor X" names
 * 
 * Usage: node scripts/patch-generic-floor-names.js [--dry-run] [--use-local]
 * 
 * Options:
 *   --dry-run    Show what would be changed without making changes
 *   --use-local  Use local name generation instead of Gemini API
 */

require("dotenv").config();
const db = require("../dist/config/db.config").default;

// Flavorful floor name components (same as in towerGeneration.service.ts)
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
 * Generate a creative floor name using local arrays
 */
function generateLocalFloorName(floorNumber) {
  const prefixIndex = floorNumber % FLOOR_NAME_PREFIXES.length;
  const themeIndex = Math.floor(floorNumber * 1.618) % FLOOR_NAME_THEMES.length;
  return `${FLOOR_NAME_PREFIXES[prefixIndex]} ${FLOOR_NAME_THEMES[themeIndex]}`;
}

/**
 * Generate creative names using Gemini API
 */
async function generateNamesWithGemini(floorNumbers) {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  if (!apiKey) {
    console.log("⚠️  GEMINI_API_KEY not set, using local generation");
    return null;
  }

  const prompt = `Generate creative, evocative names for tower floors in a mythology-themed card game.

I need names for these floor numbers: ${floorNumbers.join(", ")}

Requirements:
- Each name should be 3-6 words
- Draw inspiration from mythology, nature, epic fantasy, and elemental themes
- Names should feel challenging and epic
- NO generic names like "Floor X" or just numbers
- Each name should be unique

Examples of good names:
- "The Sunken Temple of Leviathan"
- "Realm of Forgotten Ancestors"  
- "Citadel of Eternal Storms"
- "The Crimson Halls of Judgment"
- "Domain of the Frost Giants"
- "Shrine of the Celestial Serpent"
- "The Abyssal Depths of Tartarus"
- "Halls of the Thunder God"

Output ONLY a JSON object mapping floor numbers to names, like:
{
  "39": "The Shattered Throne of Chaos",
  "40": "Realm of the Forgotten Titans"
}`;

  try {
    console.log(`📡 Calling Gemini API (${modelName})...`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 2048 }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Gemini API error:", errorText);
      return null;
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Extract JSON from response
    let jsonText = generatedText;
    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    // Try to find JSON object
    const objectMatch = jsonText.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonText = objectMatch[0];
    }

    const parsed = JSON.parse(jsonText);
    console.log("✅ Successfully generated names from Gemini");
    return parsed;
  } catch (error) {
    console.error("❌ Error calling Gemini:", error.message);
    return null;
  }
}

/**
 * Check if a name is generic
 */
function isGenericName(name) {
  return /^Floor\s+\d+$/i.test(name.trim());
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const useLocal = args.includes("--use-local");

  console.log("\n=== Tower Floor Name Patcher ===\n");

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No changes will be made\n");
  }

  try {
    // Find all floors with generic names
    const result = await db.query(`
      SELECT floor_number, name, ai_deck_id
      FROM tower_floors 
      WHERE is_active = true
      ORDER BY floor_number ASC
    `);

    const genericFloors = result.rows.filter(row => isGenericName(row.name));

    if (genericFloors.length === 0) {
      console.log("✅ No floors with generic names found. All floors have creative names!");
      process.exit(0);
    }

    console.log(`Found ${genericFloors.length} floors with generic names:\n`);
    genericFloors.forEach(floor => {
      console.log(`  Floor ${floor.floor_number}: "${floor.name}"`);
    });
    console.log();

    // Generate new names
    const floorNumbers = genericFloors.map(f => f.floor_number);
    let newNames = {};

    if (useLocal) {
      console.log("📝 Using local name generation...\n");
      for (const num of floorNumbers) {
        newNames[num] = generateLocalFloorName(num);
      }
    } else {
      // Try Gemini first, fall back to local
      const geminiNames = await generateNamesWithGemini(floorNumbers);

      if (geminiNames) {
        newNames = geminiNames;
      } else {
        console.log("\n📝 Falling back to local name generation...\n");
        for (const num of floorNumbers) {
          newNames[num] = generateLocalFloorName(num);
        }
      }
    }

    // Display proposed changes
    console.log("\nProposed changes:\n");
    console.log("Floor | Old Name      | New Name");
    console.log("------|---------------|------------------------------------------");

    for (const floor of genericFloors) {
      const newName = newNames[floor.floor_number] || newNames[String(floor.floor_number)];
      if (newName) {
        console.log(
          `${floor.floor_number.toString().padStart(5)} | ${floor.name.padEnd(13)} | ${newName}`
        );
      }
    }

    if (dryRun) {
      console.log("\n🔍 DRY RUN - No changes made. Remove --dry-run to apply changes.");
      process.exit(0);
    }

    // Apply changes
    console.log("\n📝 Applying changes...\n");

    let updated = 0;
    for (const floor of genericFloors) {
      const newName = newNames[floor.floor_number] || newNames[String(floor.floor_number)];
      if (!newName) {
        console.log(`  ⚠️  Floor ${floor.floor_number}: No new name generated, skipping`);
        continue;
      }

      // Update floor name
      await db.query(
        "UPDATE tower_floors SET name = $1 WHERE floor_number = $2",
        [newName, floor.floor_number]
      );

      // Also update the deck name to match
      const newDeckName = `${newName} Deck`;
      await db.query(
        "UPDATE decks SET name = $1 WHERE deck_id = $2",
        [newDeckName, floor.ai_deck_id]
      );

      console.log(`  ✅ Floor ${floor.floor_number}: "${floor.name}" → "${newName}"`);
      updated++;
    }

    console.log(`\n✅ Successfully updated ${updated} floor names!\n`);

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
