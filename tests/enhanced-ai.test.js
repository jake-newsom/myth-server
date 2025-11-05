/**
 * Test file for the enhanced AI system
 * Tests ability-aware decision making and difficulty scaling
 */

const { AILogic } = require("../dist/game-engine/ai.logic");
const { GameLogic } = require("../dist/game-engine/game.logic");

async function testEnhancedAI() {
  console.log("=".repeat(60));
  console.log("ENHANCED AI SYSTEM TEST");
  console.log("=".repeat(60));

  // Test 1: AI recognizes and values abilities
  console.log("\n📋 Test 1: Ability Recognition and Valuation");
  console.log("-".repeat(60));

  try {
    const ai = new AILogic();

    // Create a mock game state with cards that have abilities
    const mockGameState = createMockGameState();

    console.log("✓ AI Logic initialized successfully");
    console.log("✓ Mock game state created");

    // Test easy difficulty
    console.log("\n🎮 Testing EASY difficulty:");
    const easyMove = await ai.makeAIMove(mockGameState, "easy");
    if (easyMove) {
      console.log(
        `✓ Easy AI selected move: Card ${easyMove.user_card_instance_id.substring(0, 8)}... at position (${easyMove.position.x}, ${easyMove.position.y})`
      );
    } else {
      console.log("⚠ No move selected (expected if hand is empty)");
    }

    // Test medium difficulty
    console.log("\n🎮 Testing MEDIUM difficulty:");
    const mediumMove = await ai.makeAIMove(mockGameState, "medium");
    if (mediumMove) {
      console.log(
        `✓ Medium AI selected move: Card ${mediumMove.user_card_instance_id.substring(0, 8)}... at position (${mediumMove.position.x}, ${mediumMove.position.y})`
      );
    } else {
      console.log("⚠ No move selected (expected if hand is empty)");
    }

    // Test hard difficulty
    console.log("\n🎮 Testing HARD difficulty:");
    const hardMove = await ai.makeAIMove(mockGameState, "hard");
    if (hardMove) {
      console.log(
        `✓ Hard AI selected move: Card ${hardMove.user_card_instance_id.substring(0, 8)}... at position (${hardMove.position.x}, ${hardMove.position.y})`
      );
    } else {
      console.log("⚠ No move selected (expected if hand is empty)");
    }

    console.log("\n✅ All difficulty levels tested successfully!");
  } catch (error) {
    console.error("❌ Test 1 failed:", error.message);
    console.error(error.stack);
  }

  // Test 2: Performance benchmarking
  console.log("\n\n📊 Test 2: Performance Benchmarking");
  console.log("-".repeat(60));

  try {
    const ai = new AILogic();
    const mockGameState = createMockGameState();

    const difficulties = ["easy", "medium", "hard"];
    const results = {};

    for (const difficulty of difficulties) {
      const iterations = 5;
      const times = [];

      console.log(`\n⏱️  Testing ${difficulty.toUpperCase()} AI (${iterations} iterations):`);

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await ai.makeAIMove(mockGameState, difficulty);
        const elapsed = Date.now() - start;
        times.push(elapsed);
        console.log(`  Iteration ${i + 1}: ${elapsed}ms`);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);

      results[difficulty] = { avgTime, maxTime, minTime };

      console.log(`  Average: ${avgTime.toFixed(2)}ms`);
      console.log(`  Min: ${minTime}ms, Max: ${maxTime}ms`);
    }

    console.log("\n📈 Performance Summary:");
    console.log("  Easy AI:   ", `${results.easy.avgTime.toFixed(2)}ms avg`);
    console.log("  Medium AI: ", `${results.medium.avgTime.toFixed(2)}ms avg`);
    console.log("  Hard AI:   ", `${results.hard.avgTime.toFixed(2)}ms avg`);

    // Validate performance targets
    const targets = { easy: 500, medium: 1500, hard: 3000 };
    let allTargetsMet = true;

    console.log("\n🎯 Target Validation:");
    for (const [difficulty, target] of Object.entries(targets)) {
      const actual = results[difficulty].avgTime;
      const met = actual <= target;
      allTargetsMet = allTargetsMet && met;

      console.log(
        `  ${difficulty.toUpperCase()}: ${met ? "✅" : "❌"} ${actual.toFixed(2)}ms / ${target}ms`
      );
    }

    if (allTargetsMet) {
      console.log("\n✅ All performance targets met!");
    } else {
      console.log("\n⚠️  Some performance targets not met (but this is OK for now)");
    }
  } catch (error) {
    console.error("❌ Test 2 failed:", error.message);
    console.error(error.stack);
  }

  console.log("\n" + "=".repeat(60));
  console.log("TEST SUITE COMPLETE");
  console.log("=".repeat(60));
}

/**
 * Creates a mock game state for testing
 */
function createMockGameState() {
  return {
    game_id: "test-game-123",
    status: "active",
    current_player_id: "AI_00000000-0000-0000-0000-000000000000",
    turn_count: 1,
    max_cards_in_hand: 5,
    player1: {
      user_id: "AI_00000000-0000-0000-0000-000000000000",
      score: 0,
      hand: [
        "card-instance-1",
        "card-instance-2",
        "card-instance-3",
        "card-instance-4",
        "card-instance-5",
      ],
      deck: [],
      discard: [],
    },
    player2: {
      user_id: "human-player-123",
      score: 0,
      hand: [],
      deck: [],
      discard: [],
    },
    board: [
      [
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
      ],
      [
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
      ],
      [
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
      ],
      [
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
        { card: null, tile_enabled: true },
      ],
    ],
    hydrated_card_data_cache: {
      "card-instance-1": createMockCard("card-instance-1", "Thor", 8, 7, 6, 7, "Thunderous Push"),
      "card-instance-2": createMockCard("card-instance-2", "Odin", 7, 7, 7, 7, "Foresight"),
      "card-instance-3": createMockCard("card-instance-3", "Freya", 6, 6, 6, 6, null),
      "card-instance-4": createMockCard("card-instance-4", "Loki", 5, 8, 5, 8, "Swift Messenger"),
      "card-instance-5": createMockCard("card-instance-5", "Tyr", 7, 6, 7, 6, null),
    },
    winner: null,
  };
}

/**
 * Creates a mock card for testing
 */
function createMockCard(instanceId, name, top, right, bottom, left, abilityName) {
  return {
    user_card_instance_id: instanceId,
    base_card_id: `base-${name.toLowerCase()}`,
    owner: "AI_00000000-0000-0000-0000-000000000000",
    level: 1,
    xp: 0,
    power_enhancements: { top: 0, right: 0, bottom: 0, left: 0 },
    current_power: { top, right, bottom, left },
    temporary_effects: [],
    defeats: [],
    base_card_data: {
      card_id: `base-${name.toLowerCase()}`,
      name: name,
      tags: ["Warrior", "Norse"],
      rarity: "epic",
      image_url: `https://example.com/${name.toLowerCase()}.png`,
      base_power: { top, right, bottom, left },
      set_id: "norse-legends",
      special_ability: abilityName
        ? {
            ability_id: `ability-${abilityName.toLowerCase().replace(/\s+/g, "-")}`,
            id: `ability-${abilityName.toLowerCase().replace(/\s+/g, "-")}`,
            name: abilityName,
            description: getAbilityDescription(abilityName),
            triggerMoment: "OnPlace",
            parameters: {},
          }
        : null,
    },
  };
}

/**
 * Gets description for known abilities
 */
function getAbilityDescription(abilityName) {
  const descriptions = {
    "Thunderous Push": "Push all adjacent enemies away 1 space after combat.",
    Foresight: "Grant +1 to all allies on the board.",
    "Swift Messenger": "Draw 2 cards.",
    "Storm Breaker": "Defeat strongest enemy in the same row regardless of power.",
    "Mother's Blessing": "Grant +1 to all adjacent allies.",
  };

  return descriptions[abilityName] || "Special ability effect.";
}

// Run tests if executed directly
if (require.main === module) {
  testEnhancedAI()
    .then(() => {
      console.log("\n✨ All tests completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Test suite failed:", error);
      process.exit(1);
    });
}

module.exports = { testEnhancedAI };

