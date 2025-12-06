/**
 * Simple test script for win-streak bonus functionality
 * Tests the win-streak multiplier system for online (PvP) games
 */

const UserModel = require('../dist/models/user.model').default;
const GameRewardsService = require('../dist/services/gameRewards.service').default;
const db = require('../dist/config/db.config').default;

async function runTests() {
  console.log('🧪 Starting Win Streak Bonus Tests...\n');
  
  let testUserId;
  let testsPassed = 0;
  let testsTotal = 0;

  try {
    // Create a test user
    console.log('📝 Creating test user...');
    const testUser = await UserModel.create({
      username: 'winstreaktest_' + Date.now(),
      email: `winstreak${Date.now()}@test.com`,
      password: 'testpassword123'
    });
    testUserId = testUser.user_id;
    console.log(`✅ Test user created: ${testUserId}\n`);

    // Test 1: Initial multiplier should be 1.0
    testsTotal++;
    console.log('🔍 Test 1: Initial multiplier should be 1.0');
    const initialMultiplier = await UserModel.getWinStreakMultiplier(testUserId);
    if (initialMultiplier === 1.0) {
      console.log('✅ PASS: Initial multiplier is 1.0');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 1.0, got ${initialMultiplier}`);
    }

    // Test 2: Increment multiplier
    testsTotal++;
    console.log('\n🔍 Test 2: Increment multiplier by 0.1');
    await UserModel.incrementWinStreakMultiplier(testUserId);
    const incrementedMultiplier = await UserModel.getWinStreakMultiplier(testUserId);
    if (incrementedMultiplier === 1.1) {
      console.log('✅ PASS: Multiplier incremented to 1.1');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 1.1, got ${incrementedMultiplier}`);
    }

    // Test 3: Cap at 5.0
    testsTotal++;
    console.log('\n🔍 Test 3: Multiplier should cap at 5.0');
    // Set to 4.9 first
    await db.query('UPDATE "users" SET win_streak_multiplier = 4.9 WHERE user_id = $1', [testUserId]);
    await UserModel.incrementWinStreakMultiplier(testUserId);
    await UserModel.incrementWinStreakMultiplier(testUserId);
    const cappedMultiplier = await UserModel.getWinStreakMultiplier(testUserId);
    if (cappedMultiplier === 5.0) {
      console.log('✅ PASS: Multiplier capped at 5.0');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 5.0, got ${cappedMultiplier}`);
    }

    // Test 4: Reset multiplier
    testsTotal++;
    console.log('\n🔍 Test 4: Reset multiplier to 1.0');
    await UserModel.resetWinStreakMultiplier(testUserId);
    const resetMultiplier = await UserModel.getWinStreakMultiplier(testUserId);
    if (resetMultiplier === 1.0) {
      console.log('✅ PASS: Multiplier reset to 1.0');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 1.0, got ${resetMultiplier}`);
    }

    // Test 5: PvP victory rewards with multiplier
    testsTotal++;
    console.log('\n🔍 Test 5: PvP victory rewards with 2.5x multiplier');
    const pvpRewards = GameRewardsService.calculateCurrencyRewards(
      testUserId,
      testUserId, // user wins
      'pvp',
      120, // 2 minutes
      2.5 // 2.5x multiplier
    );
    // Base PvP win: 10 gems + 3 quick bonus = 13 gems
    // With 2.5x multiplier: floor(13 * 2.5) = 32 gems
    if (pvpRewards.gems === 32) {
      console.log('✅ PASS: PvP victory rewards correctly multiplied (32 gems)');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 32 gems, got ${pvpRewards.gems}`);
    }

    // Test 6: Solo game rewards should NOT be multiplied
    testsTotal++;
    console.log('\n🔍 Test 6: Solo game rewards should NOT be multiplied');
    const soloRewards = GameRewardsService.calculateCurrencyRewards(
      testUserId,
      testUserId, // user wins
      'solo',
      120, // 2 minutes
      4.0 // 4.0x multiplier (should not be applied)
    );
    // Base solo win: 5 gems + 2 quick bonus = 7 gems (no multiplier)
    if (soloRewards.gems === 7) {
      console.log('✅ PASS: Solo rewards not multiplied (7 gems)');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 7 gems, got ${soloRewards.gems}`);
    }

    // Test 7: PvP loss should NOT be multiplied
    testsTotal++;
    console.log('\n🔍 Test 7: PvP loss rewards should NOT be multiplied');
    const lossRewards = GameRewardsService.calculateCurrencyRewards(
      testUserId,
      'other-player-id', // user loses
      'pvp',
      120,
      3.0 // 3.0x multiplier (should not be applied to losses)
    );
    // Base PvP loss: 2 gems (no multiplier applied)
    if (lossRewards.gems === 2) {
      console.log('✅ PASS: PvP loss rewards not multiplied (2 gems)');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Expected 2 gems, got ${lossRewards.gems}`);
    }

    // Test 8: Integration test - win streak tracking
    testsTotal++;
    console.log('\n🔍 Test 8: Integration test - win streak tracking in game completion');
    await UserModel.resetWinStreakMultiplier(testUserId);
    
    const mockGameState = {
      winner: testUserId,
      board: Array(4).fill(null).map(() => Array(4).fill(null)),
      player1: { user_id: testUserId, discard_pile: [] },
      player2: { user_id: 'opponent-id', discard_pile: [] },
      hydrated_card_data_cache: {}
    };

    const result = await GameRewardsService.processGameCompletion(
      testUserId,
      mockGameState,
      'pvp',
      new Date(Date.now() - 120000), // 2 minutes ago
      testUserId,
      'opponent-id',
      'deck-id',
      'game-id-1'
    );

    if (result.win_streak_info && 
        result.win_streak_info.multiplier_applied === 1.0 && 
        result.win_streak_info.new_multiplier === 1.1) {
      console.log('✅ PASS: Win streak tracking works correctly');
      testsPassed++;
    } else {
      console.log(`❌ FAIL: Win streak tracking failed. Result:`, result.win_streak_info);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    // Clean up test user
    if (testUserId) {
      try {
        await db.query('DELETE FROM "users" WHERE user_id = $1', [testUserId]);
        console.log('\n🧹 Test user cleaned up');
      } catch (cleanupError) {
        console.error('⚠️  Failed to clean up test user:', cleanupError);
      }
    }

    // Close database connection
    await db.end();
  }

  // Print results
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Test Results: ${testsPassed}/${testsTotal} tests passed`);
  
  if (testsPassed === testsTotal) {
    console.log('🎉 All tests passed! Win streak bonus system is working correctly.');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Please check the implementation.');
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('💥 Test suite failed:', error);
  process.exit(1);
});


