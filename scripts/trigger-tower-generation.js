/**
 * Script to manually trigger tower floor generation
 * Usage: node scripts/trigger-tower-generation.js [startFloor] [count] [referenceFloor]
 * 
 * Examples:
 *   node scripts/trigger-tower-generation.js 3 2 2
 *   node scripts/trigger-tower-generation.js 5 2 4
 */

// Load environment variables from .env file
require("dotenv").config();

async function triggerGeneration() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const startFloor = parseInt(args[0]) || 3;
    const count = parseInt(args[1]) || 2;
    const referenceFloor = parseInt(args[2]) || startFloor - 1;

    console.log("========================================");
    console.log("Manual Tower Floor Generation");
    console.log("========================================");
    console.log(`Starting Floor: ${startFloor}`);
    console.log(`Count: ${count}`);
    console.log(`Reference Floor: ${referenceFloor}`);
    console.log(`Database: ${process.env.DATABASE_URL?.split("@")[1] || "local"}`);
    console.log("========================================\n");

    // Import the tower generation service
    const TowerGenerationService = require("../dist/services/towerGeneration.service").default;

    // Trigger generation
    console.log("Starting generation...\n");
    await TowerGenerationService.triggerGeneration(
      startFloor,
      count,
      referenceFloor
    );

    console.log("\n========================================");
    console.log("✅ Generation completed successfully!");
    console.log("========================================");
    process.exit(0);
  } catch (error) {
    console.error("\n========================================");
    console.error("❌ Generation failed:");
    console.error(error);
    console.error("========================================");
    process.exit(1);
  }
}

// Show usage if help flag is present
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Tower Floor Generation Script

Usage:
  node scripts/trigger-tower-generation.js [startFloor] [count] [referenceFloor]

Arguments:
  startFloor      - First floor number to generate (default: 3)
  count           - Number of floors to generate (default: 2)
  referenceFloor  - Floor to use as power reference (default: startFloor - 1)

Examples:
  # Generate floors 3-4 using floor 2 as reference
  node scripts/trigger-tower-generation.js 3 2 2

  # Generate floors 5-6 using floor 4 as reference
  node scripts/trigger-tower-generation.js 5 2 4

  # Generate floors 10-11 using floor 9 as reference
  node scripts/trigger-tower-generation.js 10 2 9

  # Use defaults (floors 3-4, reference floor 2)
  node scripts/trigger-tower-generation.js

Notes:
  - Requires GEMINI_API_KEY in .env for AI generation (optional, has fallback)
  - Reference floor must exist in the database
  - Will skip floors that already exist
  - Check server logs for detailed generation progress
`);
  process.exit(0);
}

triggerGeneration();


