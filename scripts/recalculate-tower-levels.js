/**
 * Script to recalculate and display the expected average card levels for tower floors
 * This helps verify the scaling curve is appropriate
 */

/**
 * Calculate target average card level for a given floor using gradual scaling
 */
function calculateTargetAverageLevel(floorNumber) {
  let baseLevel = 1.0;
  
  if (floorNumber <= 1) {
    return 1.0;
  } else if (floorNumber <= 50) {
    // Floors 1-50: Very slow progression (1.0 -> 2.0)
    return baseLevel + (floorNumber - 1) * 0.02;
  } else if (floorNumber <= 100) {
    // Floors 51-100: Slightly faster (2.0 -> 3.5)
    const previousLevel = 2.0;
    return previousLevel + (floorNumber - 50) * 0.03;
  } else if (floorNumber <= 200) {
    // Floors 101-200: Steady progression (3.5 -> 6.5)
    const previousLevel = 3.5;
    return previousLevel + (floorNumber - 100) * 0.03;
  } else {
    // Floors 201+: Moderate scaling
    const previousLevel = 6.5;
    return previousLevel + (floorNumber - 200) * 0.04;
  }
}

// Display scaling curve for first 300 floors
console.log("\n=== Tower Difficulty Scaling Curve ===\n");

const milestones = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300];

console.log("Floor | Target Avg Level | Increase from Previous");
console.log("------|------------------|----------------------");

let previousLevel = 1.0;
for (const floor of milestones) {
  const targetLevel = calculateTargetAverageLevel(floor);
  const increase = targetLevel - previousLevel;
  console.log(
    `${floor.toString().padStart(5)} | ${targetLevel.toFixed(2).padStart(16)} | +${increase.toFixed(2).padStart(4)}`
  );
  previousLevel = targetLevel;
}

console.log("\n=== Current Tower State ===\n");

// Connect to database and show actual levels
const db = require("../dist/config/db.config").default;

async function showCurrentTower() {
  try {
    const result = await db.query(`
      SELECT 
        floor_number, 
        name, 
        average_card_level
      FROM tower_floors 
      ORDER BY floor_number ASC
      LIMIT 50
    `);

    if (result.rows.length === 0) {
      console.log("No floors found in database.");
      return;
    }

    console.log("Floor | Name                          | Actual Avg | Expected Avg | Difference");
    console.log("------|-------------------------------|------------|--------------|------------");

    for (const row of result.rows) {
      const expected = calculateTargetAverageLevel(row.floor_number);
      const actual = row.average_card_level || 0;
      const diff = actual - expected;
      const diffStr = diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
      
      console.log(
        `${row.floor_number.toString().padStart(5)} | ${row.name.padEnd(29)} | ${actual.toFixed(2).padStart(10)} | ${expected.toFixed(2).padStart(12)} | ${diffStr.padStart(10)}`
      );
    }

    console.log("\n");
  } catch (error) {
    console.error("Error querying database:", error);
  } finally {
    process.exit(0);
  }
}

showCurrentTower();

