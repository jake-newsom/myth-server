/**
 * Test suite for win-streak bonus functionality
 * 
 * Tests the win-streak multiplier system for online (PvP) games:
 * - Multiplier starts at 1.0
 * - Increases by 0.1 for each consecutive win (max 5.0)
 * - Resets to 1.0 on any loss
 * - Only applies to PvP games, not solo games
 */

const UserModel = require('../dist/models/user.model').default;
const GameRewardsService = require('../dist/services/gameRewards.service').default;
const db = require('../dist/config/db.config').default;

describe('Win Streak Bonus System', () => {
  let testUserId;
  
  beforeAll(async () => {
    // Create a test user for testing
    const testUser = await UserModel.create({
      username: 'winstreaktest',
      email: 'winstreak@test.com',
      password: 'testpassword123'
    });
    testUserId = testUser.user_id;
  });

  afterAll(async () => {
    // Clean up test user
    if (testUserId) {
      await db.query('DELETE FROM "users" WHERE user_id = $1', [testUserId]);
    }
  });

  describe('Win Streak Multiplier Management', () => {
    test('should start with multiplier of 1.0 for new users', async () => {
      const multiplier = await UserModel.getWinStreakMultiplier(testUserId);
      expect(multiplier).toBe(1.0);
    });

    test('should increment multiplier by 0.1 on win', async () => {
      await UserModel.incrementWinStreakMultiplier(testUserId);
      const multiplier = await UserModel.getWinStreakMultiplier(testUserId);
      expect(multiplier).toBe(1.1);
    });

    test('should cap multiplier at 5.0', async () => {
      // Set to 4.9 first
      await db.query('UPDATE "users" SET win_streak_multiplier = 4.9 WHERE user_id = $1', [testUserId]);
      
      // Increment twice (should cap at 5.0)
      await UserModel.incrementWinStreakMultiplier(testUserId);
      await UserModel.incrementWinStreakMultiplier(testUserId);
      
      const multiplier = await UserModel.getWinStreakMultiplier(testUserId);
      expect(multiplier).toBe(5.0);
    });

    test('should reset multiplier to 1.0 on loss', async () => {
      // Set to some high value first
      await db.query('UPDATE "users" SET win_streak_multiplier = 3.5 WHERE user_id = $1', [testUserId]);
      
      await UserModel.resetWinStreakMultiplier(testUserId);
      const multiplier = await UserModel.getWinStreakMultiplier(testUserId);
      expect(multiplier).toBe(1.0);
    });
  });

  // The win streak no longer multiplies gems. It is still tracked and still
  // climbs (see the block above), but every gem payout below is the flat base
  // regardless of the multiplier passed in.
  describe('Reward Calculation ignores the win streak', () => {
    test('should NOT apply multiplier to PvP victory rewards', () => {
      const baseRewards = GameRewardsService.calculateCurrencyRewards(
        testUserId,
        testUserId, // user wins
        'pvp',
        120, // 2 minutes
        2.5 // 2.5x multiplier (must be ignored)
      );

      // PvP win: 10 gems + 3 quick bonus = 13 gems, unmultiplied.
      expect(baseRewards.gems).toBe(13);
    });

    test('should NOT apply multiplier to PvP draw rewards', () => {
      const drawRewards = GameRewardsService.calculateCurrencyRewards(
        testUserId,
        null, // draw
        'pvp',
        120,
        2.0 // 2.0x multiplier (must be ignored)
      );

      // PvP draw: 3 gems, unmultiplied.
      expect(drawRewards.gems).toBe(3);
    });

    test('should NOT apply multiplier to PvP loss rewards', () => {
      const lossRewards = GameRewardsService.calculateCurrencyRewards(
        testUserId,
        'other-player-id', // user loses
        'pvp',
        120,
        3.0 // 3.0x multiplier (must be ignored)
      );

      // PvP loss participation reward: 5 gems.
      expect(lossRewards.gems).toBe(5);
    });

    test('should NOT apply multiplier to solo game rewards', () => {
      const soloRewards = GameRewardsService.calculateCurrencyRewards(
        testUserId,
        testUserId, // user wins
        'solo',
        120,
        4.0 // 4.0x multiplier (should not be applied to solo)
      );

      // Base solo win: 5 gems + 2 quick bonus = 7 gems (no multiplier)
      expect(soloRewards.gems).toBe(7);
    });
  });

  describe('Integration with Game Completion', () => {
    test('should track win streaks correctly in PvP games', async () => {
      // Reset multiplier to 1.0
      await UserModel.resetWinStreakMultiplier(testUserId);
      
      // Mock game state for a completed PvP game
      const mockGameState = {
        winner: testUserId,
        board: Array(4).fill(null).map(() => Array(4).fill(null)),
        player1: { user_id: testUserId, discard_pile: [] },
        player2: { user_id: 'opponent-id', discard_pile: [] }
      };

      // Simulate first win
      const result1 = await GameRewardsService.processGameCompletion(
        testUserId,
        mockGameState,
        'pvp',
        new Date(Date.now() - 120000), // 2 minutes ago
        testUserId,
        'opponent-id',
        'deck-id',
        'game-id-1'
      );

      // multiplier_applied is always 1.0 now: nothing multiplies gems. The
      // streak itself still climbs, so new_multiplier stays truthful.
      expect(result1.win_streak_info).toBeDefined();
      expect(result1.win_streak_info.multiplier_applied).toBe(1.0);
      expect(result1.win_streak_info.new_multiplier).toBe(1.1);

      // Simulate second win
      const result2 = await GameRewardsService.processGameCompletion(
        testUserId,
        mockGameState,
        'pvp',
        new Date(Date.now() - 120000),
        testUserId,
        'opponent-id',
        'deck-id',
        'game-id-2'
      );

      expect(result2.win_streak_info.multiplier_applied).toBe(1.0);
      expect(result2.win_streak_info.new_multiplier).toBe(1.2);
    });

    test('should reset streak on PvP loss', async () => {
      // Set up a win streak first
      await db.query('UPDATE "users" SET win_streak_multiplier = 2.5 WHERE user_id = $1', [testUserId]);

      // Mock game state for a loss
      const mockGameState = {
        winner: 'opponent-id', // user loses
        board: Array(4).fill(null).map(() => Array(4).fill(null)),
        player1: { user_id: testUserId, discard_pile: [] },
        player2: { user_id: 'opponent-id', discard_pile: [] }
      };

      const result = await GameRewardsService.processGameCompletion(
        testUserId,
        mockGameState,
        'pvp',
        new Date(Date.now() - 120000),
        testUserId,
        'opponent-id',
        'deck-id',
        'game-id-3'
      );

      expect(result.win_streak_info.multiplier_applied).toBe(2.5);
      expect(result.win_streak_info.new_multiplier).toBe(1.0); // Reset to 1.0
    });

    test('should NOT include win streak info for solo games', async () => {
      const mockGameState = {
        winner: testUserId,
        board: Array(4).fill(null).map(() => Array(4).fill(null)),
        player1: { user_id: testUserId, discard_pile: [] },
        player2: { user_id: 'ai-player', discard_pile: [] }
      };

      const result = await GameRewardsService.processGameCompletion(
        testUserId,
        mockGameState,
        'solo', // Solo game
        new Date(Date.now() - 120000),
        testUserId,
        'ai-player',
        'deck-id',
        'game-id-4'
      );

      expect(result.win_streak_info).toBeUndefined();
    });
  });
});

// Helper function to simulate win streak progression
async function simulateWinStreak(userId, wins) {
  await UserModel.resetWinStreakMultiplier(userId);
  
  for (let i = 0; i < wins; i++) {
    await UserModel.incrementWinStreakMultiplier(userId);
  }
  
  return await UserModel.getWinStreakMultiplier(userId);
}

module.exports = { simulateWinStreak };
