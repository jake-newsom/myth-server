/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Insert all new tiered achievements
  // Rewards are placeholders (TBD) - will be updated based on ECONOMY_BALANCING.md
  
  pgm.sql(`
    INSERT INTO achievements (
      achievement_key, title, description, category, type, target_value, 
      rarity, reward_gems, reward_packs, base_achievement_key, tier_level, sort_order
    ) VALUES
    -- Solo Wins (4 tiers)
    ('solo_wins_50', 'Solo Champion', 'Win 50 solo games', 'gameplay', 'progress', 50, 'uncommon', 5, 0, 'solo_wins', 1, 100),
    ('solo_wins_200', 'Solo Master', 'Win 200 solo games', 'gameplay', 'progress', 200, 'rare', 12, 0, 'solo_wins', 2, 101),
    ('solo_wins_500', 'Solo Legend', 'Win 500 solo games', 'gameplay', 'progress', 500, 'epic', 25, 0, 'solo_wins', 3, 102),
    ('solo_wins_1000', 'Solo God', 'Win 1000 solo games', 'gameplay', 'progress', 1000, 'epic', 50, 0, 'solo_wins', 4, 103),
    
    -- Multiplayer Wins (5 tiers)
    ('pvp_wins_25', 'PvP Novice', 'Win 25 multiplayer games', 'gameplay', 'progress', 25, 'uncommon', 6, 0, 'pvp_wins', 1, 110),
    ('pvp_wins_100', 'PvP Warrior', 'Win 100 multiplayer games', 'gameplay', 'progress', 100, 'rare', 15, 0, 'pvp_wins', 2, 111),
    ('pvp_wins_250', 'PvP Champion', 'Win 250 multiplayer games', 'gameplay', 'progress', 250, 'epic', 30, 0, 'pvp_wins', 3, 112),
    ('pvp_wins_500', 'PvP Master', 'Win 500 multiplayer games', 'gameplay', 'progress', 500, 'epic', 50, 0, 'pvp_wins', 4, 113),
    ('pvp_wins_1000', 'PvP Legend', 'Win 1000 multiplayer games', 'gameplay', 'progress', 1000, 'legendary', 100, 0, 'pvp_wins', 5, 114),
    
    -- Win Streaks - Multiplayer Only (4 tiers)
    ('pvp_win_streak_10', 'Hot Streak', 'Win 10 multiplayer games in a row', 'gameplay', 'single', 10, 'rare', 8, 0, 'pvp_win_streak', 1, 120),
    ('pvp_win_streak_15', 'On Fire', 'Win 15 multiplayer games in a row', 'gameplay', 'single', 15, 'rare', 15, 0, 'pvp_win_streak', 2, 121),
    ('pvp_win_streak_20', 'Unstoppable', 'Win 20 multiplayer games in a row', 'gameplay', 'single', 20, 'epic', 25, 0, 'pvp_win_streak', 3, 122),
    ('pvp_win_streak_30', 'Invincible', 'Win 30 multiplayer games in a row', 'gameplay', 'single', 30, 'epic', 50, 0, 'pvp_win_streak', 4, 123),
    
    -- Pack Opening (7 tiers)
    ('pack_opening_10', 'Pack Collector', 'Open 10 packs', 'collection', 'progress', 10, 'common', 3, 0, 'pack_opening', 1, 200),
    ('pack_opening_25', 'Pack Enthusiast', 'Open 25 packs', 'collection', 'progress', 25, 'uncommon', 8, 0, 'pack_opening', 2, 201),
    ('pack_opening_50', 'Pack Addict', 'Open 50 packs', 'collection', 'progress', 50, 'rare', 15, 0, 'pack_opening', 3, 202),
    ('pack_opening_100', 'Pack Master', 'Open 100 packs', 'collection', 'progress', 100, 'epic', 30, 0, 'pack_opening', 4, 203),
    ('pack_opening_250', 'Pack Legend', 'Open 250 packs', 'collection', 'progress', 250, 'epic', 60, 0, 'pack_opening', 5, 204),
    ('pack_opening_500', 'Pack Deity', 'Open 500 packs', 'collection', 'progress', 500, 'legendary', 100, 0, 'pack_opening', 6, 205),
    ('pack_opening_1000', 'Pack God', 'Open 1000 packs', 'collection', 'progress', 1000, 'legendary', 150, 0, 'pack_opening', 7, 206),
    
    -- Card Collection (2 tiers)
    ('card_collection_50', 'Card Collector', 'Collect 50 different cards', 'collection', 'milestone', 50, 'uncommon', 10, 0, 'card_collection', 1, 210),
    ('card_collection_200', 'Card Master', 'Collect 200 different cards', 'collection', 'milestone', 200, 'epic', 30, 0, 'card_collection', 2, 211),
    
    -- Card Leveling by Rarity - Epic (4 tiers)
    ('level_epic_2', 'Epic Leveler', 'Reach level 2 with 20 epic cards', 'progression', 'milestone', 2, 'uncommon', 5, 0, 'level_epic', 1, 300),
    ('level_epic_3', 'Epic Expert', 'Reach level 3 with 20 epic cards', 'progression', 'milestone', 3, 'rare', 10, 0, 'level_epic', 2, 301),
    ('level_epic_4', 'Epic Master', 'Reach level 4 with 20 epic cards', 'progression', 'milestone', 4, 'epic', 20, 0, 'level_epic', 3, 302),
    ('level_epic_5', 'Epic Legend', 'Reach level 5 with 20 epic cards', 'progression', 'milestone', 5, 'epic', 40, 0, 'level_epic', 4, 303),
    
    -- Card Leveling by Rarity - Legendary (4 tiers)
    ('level_legendary_2', 'Legendary Leveler', 'Reach level 2 with 20 legendary cards', 'progression', 'milestone', 2, 'rare', 8, 0, 'level_legendary', 1, 310),
    ('level_legendary_3', 'Legendary Expert', 'Reach level 3 with 20 legendary cards', 'progression', 'milestone', 3, 'epic', 15, 0, 'level_legendary', 2, 311),
    ('level_legendary_4', 'Legendary Master', 'Reach level 4 with 20 legendary cards', 'progression', 'milestone', 4, 'epic', 30, 0, 'level_legendary', 3, 312),
    ('level_legendary_5', 'Legendary Legend', 'Reach level 5 with 20 legendary cards', 'progression', 'milestone', 5, 'legendary', 60, 0, 'level_legendary', 4, 313),
    
    -- Card Leveling by Rarity - Rare (4 tiers)
    ('level_rare_2', 'Rare Leveler', 'Reach level 2 with 20 rare cards', 'progression', 'milestone', 2, 'common', 3, 0, 'level_rare', 1, 320),
    ('level_rare_3', 'Rare Expert', 'Reach level 3 with 20 rare cards', 'progression', 'milestone', 3, 'uncommon', 8, 0, 'level_rare', 2, 321),
    ('level_rare_4', 'Rare Master', 'Reach level 4 with 20 rare cards', 'progression', 'milestone', 4, 'rare', 15, 0, 'level_rare', 3, 322),
    ('level_rare_5', 'Rare Legend', 'Reach level 5 with 20 rare cards', 'progression', 'milestone', 5, 'epic', 25, 0, 'level_rare', 4, 323),
    
    -- Mythic Card Collection (3 tiers)
    ('mythic_collection_10', 'Mythic Collector', 'Collect 10 unique mythic cards', 'collection', 'progress', 10, 'rare', 15, 0, 'mythic_collection', 1, 330),
    ('mythic_collection_25', 'Mythic Enthusiast', 'Collect 25 unique mythic cards', 'collection', 'progress', 25, 'epic', 35, 0, 'mythic_collection', 2, 331),
    ('mythic_collection_50', 'Mythic Master', 'Collect 50 unique mythic cards', 'collection', 'progress', 50, 'legendary', 75, 0, 'mythic_collection', 3, 332),
    
    -- Card Sacrifice (4 tiers)
    ('card_sacrifice_50', 'Sacrifice Novice', 'Sacrifice 50 cards for XP', 'progression', 'progress', 50, 'uncommon', 5, 0, 'card_sacrifice', 1, 340),
    ('card_sacrifice_200', 'Sacrifice Master', 'Sacrifice 200 cards for XP', 'progression', 'progress', 200, 'rare', 15, 0, 'card_sacrifice', 2, 341),
    ('card_sacrifice_500', 'Sacrifice Expert', 'Sacrifice 500 cards for XP', 'progression', 'progress', 500, 'epic', 40, 0, 'card_sacrifice', 3, 342),
    ('card_sacrifice_1000', 'Sacrifice Legend', 'Sacrifice 1000 cards for XP', 'progression', 'progress', 1000, 'legendary', 80, 0, 'card_sacrifice', 4, 343),
    
    -- Total Matches Played (7 tiers)
    ('total_matches_100', 'Veteran Player', 'Play 100 matches', 'gameplay', 'progress', 100, 'uncommon', 8, 0, 'total_matches', 1, 350),
    ('total_matches_250', 'Dedicated Player', 'Play 250 matches', 'gameplay', 'progress', 250, 'rare', 15, 0, 'total_matches', 2, 351),
    ('total_matches_500', 'Experienced Player', 'Play 500 matches', 'gameplay', 'progress', 500, 'epic', 30, 0, 'total_matches', 3, 352),
    ('total_matches_1000', 'Seasoned Player', 'Play 1000 matches', 'gameplay', 'progress', 1000, 'epic', 50, 0, 'total_matches', 4, 353),
    ('total_matches_2500', 'Elite Player', 'Play 2500 matches', 'gameplay', 'progress', 2500, 'legendary', 100, 0, 'total_matches', 5, 354),
    ('total_matches_5000', 'Master Player', 'Play 5000 matches', 'gameplay', 'progress', 5000, 'legendary', 150, 0, 'total_matches', 6, 355),
    ('total_matches_10000', 'Legendary Player', 'Play 10000 matches', 'gameplay', 'progress', 10000, 'legendary', 250, 0, 'total_matches', 7, 356);
  `);
  
  // Note: Story mode achievements will be created dynamically per story via a script
  // They follow the pattern: story_{storyId}_wins and story_{storyId}_victory_margin
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Delete all new tiered achievements by base_achievement_key
  pgm.sql(`
    DELETE FROM achievements 
    WHERE base_achievement_key IN (
      'solo_wins', 'pvp_wins', 'pvp_win_streak', 'pack_opening', 
      'card_collection', 'level_epic', 'level_legendary', 'level_rare',
      'mythic_collection', 'card_sacrifice', 'total_matches'
    );
  `);
};

