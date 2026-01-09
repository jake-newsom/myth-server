/**
 * Cache Invalidation Service
 * 
 * Centralized service for invalidating user-specific and global caches.
 * This ensures consistent cache invalidation across the application.
 * 
 * Cache Key Patterns:
 * - User cards: `{userId}:cards:all`
 * - User decks: `{userId}:decks:all`
 * - User profile: `{userId}:profile`
 * - Global cards: `cards:all`
 */

import { redisCache } from './redis.cache.service';
import logger from '../utils/logger';

class CacheInvalidationService {
  /**
   * Invalidate all card-related caches for a specific user
   * Use this when user's card collection changes (new cards, sacrificed cards, etc.)
   */
  async invalidateUserCards(userId: string): Promise<void> {
    try {
      await redisCache.purgeByPattern(`${userId}:cards:*`);
      logger.debug(`Invalidated card caches for user ${userId}`);
    } catch (error: any) {
      logger.error(`Failed to invalidate card caches for user ${userId}`, undefined, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Invalidate all deck-related caches for a specific user
   * Use this when user's decks change (created, updated, deleted)
   */
  async invalidateUserDecks(userId: string): Promise<void> {
    try {
      await redisCache.purgeByPattern(`${userId}:decks:*`);
      logger.debug(`Invalidated deck caches for user ${userId}`);
    } catch (error: any) {
      logger.error(`Failed to invalidate deck caches for user ${userId}`, undefined, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Invalidate user profile cache
   * Use this when user profile data changes
   */
  async invalidateUserProfile(userId: string): Promise<void> {
    try {
      await redisCache.delete(`${userId}:profile`);
      logger.debug(`Invalidated profile cache for user ${userId}`);
    } catch (error: any) {
      logger.error(`Failed to invalidate profile cache for user ${userId}`, undefined, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Invalidate all caches for a specific user
   * Use this for major user changes (logout, account updates, etc.)
   */
  async invalidateAllUserCaches(userId: string): Promise<void> {
    try {
      await redisCache.purgeByPattern(`${userId}:*`);
      logger.info(`Invalidated all caches for user ${userId}`);
    } catch (error: any) {
      logger.error(`Failed to invalidate all caches for user ${userId}`, undefined, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Invalidate global card cache
   * Use this when card definitions change (rare - usually only in admin operations)
   */
  async invalidateGlobalCards(): Promise<void> {
    try {
      await redisCache.delete('cards:all');
      logger.info('Invalidated global cards cache');
    } catch (error: any) {
      logger.error('Failed to invalidate global cards cache', undefined, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Invalidate card caches for multiple users
   * Use this for bulk operations affecting multiple users
   */
  async invalidateMultipleUserCards(userIds: string[]): Promise<void> {
    try {
      const promises = userIds.map(userId => this.invalidateUserCards(userId));
      await Promise.all(promises);
      logger.debug(`Invalidated card caches for ${userIds.length} users`);
    } catch (error: any) {
      logger.error(`Failed to invalidate card caches for multiple users`, undefined, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Invalidate user cards due to pack opening
   * This is a specific use case that might trigger additional invalidations
   */
  async invalidateAfterPackOpen(userId: string): Promise<void> {
    await this.invalidateUserCards(userId);
    // Could also invalidate achievements, stats, etc. if needed
  }

  /**
   * Invalidate user cards due to card level up
   * Only invalidates if the level actually changed
   */
  async invalidateAfterLevelUp(userId: string): Promise<void> {
    await this.invalidateUserCards(userId);
  }

  /**
   * Invalidate user cards due to power enhancement changes
   */
  async invalidateAfterPowerEnhancement(userId: string): Promise<void> {
    await this.invalidateUserCards(userId);
  }

  /**
   * Invalidate user cards due to card sacrifice
   */
  async invalidateAfterSacrifice(userId: string): Promise<void> {
    await this.invalidateUserCards(userId);
  }

  /**
   * Invalidate user cards due to shop purchase (if card was purchased)
   */
  async invalidateAfterShopPurchase(userId: string, itemType: string): Promise<void> {
    if (itemType === 'legendary_card' || itemType === 'epic_card' || itemType === 'enhanced_card') {
      await this.invalidateUserCards(userId);
    }
  }

  /**
   * Invalidate user cards due to reward claim (achievement, daily task, monthly reward)
   */
  async invalidateAfterRewardClaim(userId: string, rewardIncludesCards: boolean): Promise<void> {
    if (rewardIncludesCards) {
      await this.invalidateUserCards(userId);
    }
  }
}

// Export singleton instance
export const cacheInvalidation = new CacheInvalidationService();

// Export class for testing
export { CacheInvalidationService };



