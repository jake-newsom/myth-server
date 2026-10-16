/* eslint-disable camelcase */

/**
 * Achievement-earned titles.
 *
 * Eight titles, each the reward_title_id of a standard achievement:
 *   Allfather           title_allfather            #1 on the Ranked Draft ladder (>= 30 games that season), ever
 *   Herald of Ruin      pvp_wins_100 (existing)    win 100 PvP matches
 *   Bane of the Serpent title_bane_of_the_serpent  Thor defeats Jormungandr x10
 *   Trickster           title_trickster            25 Trickster's Gambit flips
 *   The Unfading        title_the_unfading         Baldr returns to hand x50
 *   Fire Walker         title_fire_walker          25 wins with >= 3 LAVA tiles at the end
 *   Tidecaller          title_tidecaller           create / play onto 100 WATER tiles
 *   Bane of the Yokai   title_bane_of_the_yokai    defeat 200 YOKAI or DEMON cards
 *
 * Herald of Ruin reuses pvp_wins_100 so existing progress counts. Players who
 * already claimed it never pass through the claim path again, so they are
 * granted the title here.
 *
 * Additive only: new rows, one nullable column set on an existing row.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO titles (code_key, name, description, accent) VALUES
      ('allfather', 'Allfather', 'Reached #1 on the Ranked leaderboard.', 'gold'),
      ('herald_of_ruin', 'Herald of Ruin', 'Won 100 PvP matches.', 'red'),
      ('bane_of_the_serpent', 'Bane of the Serpent', 'Defeated Jormungandr with Thor 10 times.', 'green'),
      ('trickster', 'Trickster', 'Gained control of 25 cards through Trickster''s Gambit.', 'purple'),
      ('the_unfading', 'The Unfading', 'Baldr returned to hand 50 times through Mistilteinn''s Absence.', 'gold'),
      ('fire_walker', 'Fire Walker', 'Won 25 matches with at least 3 LAVA tiles on the board.', 'orange'),
      ('tidecaller', 'Tidecaller', 'Created or played onto 100 WATER tiles.', 'blue'),
      ('bane_of_the_yokai', 'Bane of the Yokai', 'Defeated 200 YOKAI or DEMON cards.', 'red')
    ON CONFLICT (code_key) DO NOTHING;

    INSERT INTO achievements
      (achievement_key, title, description, category, type, target_value, rarity,
       reward_gems, reward_packs, is_active, sort_order, achievement_kind,
       win_condition, reward_title_id)
    SELECT v.key, v.title, v.description, v.category, 'progress', v.target, v.rarity,
           0, 0, true, v.sort_order, 'standard', v.win_condition::jsonb, t.title_id
      FROM (VALUES
        ('title_allfather', 'Allfather', 'Reach #1 on the Ranked leaderboard (min. 30 ranked games in the season)', 'special', 1, 'legendary', 5000, 'allfather', NULL),
        ('title_bane_of_the_serpent', 'Bane of the Serpent', 'Defeat Jormungandr with Thor 10 times', 'gameplay', 10, 'epic', 5010, 'bane_of_the_serpent', NULL),
        ('title_trickster', 'Trickster', 'Gain control of 25 cards through Loki''s Trickster''s Gambit', 'gameplay', 25, 'rare', 5020, 'trickster', NULL),
        ('title_the_unfading', 'The Unfading', 'Have Baldr return to your hand 50 times through Mistilteinn''s Absence', 'gameplay', 50, 'rare', 5030, 'the_unfading', NULL),
        ('title_fire_walker', 'Fire Walker', 'Win 25 matches with at least 3 LAVA tiles on the board at the end', 'gameplay', 25, 'epic', 5040, 'fire_walker', '{"min_lava_tiles": 3}'),
        ('title_tidecaller', 'Tidecaller', 'Create or play onto 100 WATER tiles', 'gameplay', 100, 'rare', 5050, 'tidecaller', NULL),
        ('title_bane_of_the_yokai', 'Bane of the Yokai', 'Defeat 200 YOKAI or DEMON cards', 'gameplay', 200, 'epic', 5060, 'bane_of_the_yokai', NULL)
      ) AS v(key, title, description, category, target, rarity, sort_order, title_code, win_condition)
      JOIN titles t ON t.code_key = v.title_code
    ON CONFLICT (achievement_key) DO NOTHING;

    UPDATE achievements
       SET reward_title_id = (SELECT title_id FROM titles WHERE code_key = 'herald_of_ruin')
     WHERE achievement_key = 'pvp_wins_100' AND reward_title_id IS NULL;

    INSERT INTO user_owned_titles (user_id, title_id, source)
    SELECT ua.user_id, t.title_id, 'reward'
      FROM user_achievements ua
      JOIN achievements a ON a.id = ua.achievement_id AND a.achievement_key = 'pvp_wins_100'
      JOIN titles t ON t.code_key = 'herald_of_ruin'
     WHERE ua.is_claimed = true
    ON CONFLICT DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM achievements WHERE achievement_key IN (
      'title_allfather', 'title_bane_of_the_serpent', 'title_trickster',
      'title_the_unfading', 'title_fire_walker', 'title_tidecaller',
      'title_bane_of_the_yokai'
    );
    UPDATE achievements SET reward_title_id = NULL
     WHERE achievement_key = 'pvp_wins_100'
       AND reward_title_id = (SELECT title_id FROM titles WHERE code_key = 'herald_of_ruin');
    DELETE FROM titles WHERE code_key IN (
      'allfather', 'herald_of_ruin', 'bane_of_the_serpent', 'trickster',
      'the_unfading', 'fire_walker', 'tidecaller', 'bane_of_the_yokai'
    );
  `);
};
