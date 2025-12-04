/**
 * Demo script for win-streak bonus functionality
 * Shows how the win-streak multiplier system works for online (PvP) games
 */

const GameRewardsService = require('../dist/services/gameRewards.service').default;

function demoWinStreakBonus() {
  console.log('🎮 Win Streak Bonus System Demo');
  console.log('='.repeat(50));
  console.log();

  console.log('📋 System Rules:');
  console.log('• Multiplier starts at 1.0 for all players');
  console.log('• Increases by 0.1 for each consecutive PvP win (max 5.0)');
  console.log('• Resets to 1.0 on any PvP loss');
  console.log('• Only applies to online (PvP) games, NOT solo games');
  console.log('• Applied to victory and draw rewards, NOT loss rewards');
  console.log();

  // Demo scenarios
  const scenarios = [
    {
      title: 'PvP Victory - No Streak (1.0x)',
      gameMode: 'pvp',
      winnerId: 'player1',
      userId: 'player1',
      duration: 180, // 3 minutes
      multiplier: 1.0
    },
    {
      title: 'PvP Victory - 5 Win Streak (1.5x)',
      gameMode: 'pvp',
      winnerId: 'player1',
      userId: 'player1',
      duration: 120, // 2 minutes (quick win bonus)
      multiplier: 1.5
    },
    {
      title: 'PvP Victory - Max Streak (5.0x)',
      gameMode: 'pvp',
      winnerId: 'player1',
      userId: 'player1',
      duration: 90, // 1.5 minutes (quick win bonus)
      multiplier: 5.0
    },
    {
      title: 'PvP Draw - 3 Win Streak (1.3x)',
      gameMode: 'pvp',
      winnerId: null, // draw
      userId: 'player1',
      duration: 200,
      multiplier: 1.3
    },
    {
      title: 'PvP Loss - 10 Win Streak (NO multiplier)',
      gameMode: 'pvp',
      winnerId: 'player2', // player1 loses
      userId: 'player1',
      duration: 150,
      multiplier: 10.0 // Should not be applied
    },
    {
      title: 'Solo Victory - Max Streak (NO multiplier)',
      gameMode: 'solo',
      winnerId: 'player1',
      userId: 'player1',
      duration: 120,
      multiplier: 5.0 // Should not be applied to solo games
    }
  ];

  scenarios.forEach((scenario, index) => {
    console.log(`🎯 Scenario ${index + 1}: ${scenario.title}`);
    
    const rewards = GameRewardsService.calculateCurrencyRewards(
      scenario.userId,
      scenario.winnerId,
      scenario.gameMode,
      scenario.duration,
      scenario.multiplier
    );

    // Calculate what the base reward would be without multiplier
    const baseRewards = GameRewardsService.calculateCurrencyRewards(
      scenario.userId,
      scenario.winnerId,
      scenario.gameMode,
      scenario.duration,
      1.0 // no multiplier
    );

    console.log(`   Base reward: ${baseRewards.gems} gems`);
    console.log(`   Multiplier: ${scenario.multiplier}x`);
    console.log(`   Final reward: ${rewards.gems} gems`);
    
    if (scenario.gameMode === 'pvp' && scenario.winnerId === scenario.userId) {
      const expectedMultiplied = Math.floor(baseRewards.gems * scenario.multiplier);
      if (rewards.gems === expectedMultiplied) {
        console.log('   ✅ Multiplier applied correctly');
      } else {
        console.log('   ❌ Multiplier not applied correctly');
      }
    } else if (scenario.gameMode === 'pvp' && scenario.winnerId === null) {
      const expectedMultiplied = Math.floor(baseRewards.gems * scenario.multiplier);
      if (rewards.gems === expectedMultiplied) {
        console.log('   ✅ Multiplier applied correctly to draw');
      } else {
        console.log('   ❌ Multiplier not applied correctly to draw');
      }
    } else {
      if (rewards.gems === baseRewards.gems) {
        console.log('   ✅ Multiplier correctly NOT applied');
      } else {
        console.log('   ❌ Multiplier incorrectly applied');
      }
    }
    console.log();
  });

  console.log('💡 Win Streak Progression Example:');
  console.log('   Game 1 (Win):  1.0x → 1.1x');
  console.log('   Game 2 (Win):  1.1x → 1.2x');
  console.log('   Game 3 (Win):  1.2x → 1.3x');
  console.log('   Game 4 (Win):  1.3x → 1.4x');
  console.log('   Game 5 (Win):  1.4x → 1.5x');
  console.log('   ...');
  console.log('   Game 40 (Win): 4.9x → 5.0x (capped)');
  console.log('   Game 41 (Win): 5.0x → 5.0x (stays at max)');
  console.log('   Game 42 (Loss): 5.0x → 1.0x (reset)');
  console.log();

  console.log('🎉 Demo completed! The win-streak bonus system is ready for online play.');
}

// Run the demo
demoWinStreakBonus();
