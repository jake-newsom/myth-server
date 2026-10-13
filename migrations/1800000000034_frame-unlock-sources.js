/* eslint-disable camelcase */

/**
 * Unlock sources for the avatar frames that had art but no way to earn them.
 *
 * - Achievements: one per frame (crimson reuses pvp_wins_25). Frames ride the
 *   existing reward_frame_id claim path (RewardService -> grantFrame).
 * - achievements.win_condition (new, nullable jsonb): matched against each
 *   game_victory by AchievementService.handleGameVictory, so new "win with X"
 *   achievements are data-only. Keys, all optional and ANDed:
 *     played_character  character_id the winner played (board or discard)
 *     deck_effect       winner's set passive ("norse" | "japanese" | "polynesian")
 *     game_mode         eventData.gameMode ("saga", "pvp", ...)
 *     mechanic          battle mechanic id present in the game (e.g. "worlds_end")
 * - Season: Silver on ranked_draft Ascendant/Immortal, Gold on Titan and up
 *   (a player is paid exactly one tier, so each frame is on every tier above
 *   its threshold).
 * - Event shop: Restless Spirit in Hallow's Eve, if that event exists.
 *
 * Backfills progress for tower floors, tutorial and collection, and grants
 * Crimson directly to anyone who already claimed pvp_wins_25 (the claim
 * would never fire again for them).
 *
 * Jade is intentionally left without a source (no permanent login sequence).
 */

exports.shorthands = undefined;

const NEW_KEYS = [
  "total_wins_100",
  "card_collection_half",
  "tower_floor_50",
  "tower_floor_100",
  "tutorial_complete",
  "win_with_njord_50",
  "win_with_ragnarok_25",
  "win_with_oni_50",
  "win_with_kitsune_50",
  "win_norse_passive_50",
  "win_japanese_passive_50",
  "win_polynesian_passive_50",
  "saga_worlds_end",
];

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS win_condition jsonb;

    -- Fail loudly rather than insert a "played_character": null condition that
    -- could never match.
    DO $$
    DECLARE missing text;
    BEGIN
      SELECT string_agg(n, ', ') INTO missing
        FROM unnest(ARRAY['Njord','Ragnarok','Oni','Kitsune']) n
       WHERE NOT EXISTS (SELECT 1 FROM characters c WHERE c.name = n);
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'frame-unlock-sources: missing characters %', missing;
      END IF;
    END $$;

    WITH defs (achievement_key, title, description, category, rarity, target_value,
               reward_packs, frame_key, win_condition, sort_order) AS (
      VALUES
        ('total_wins_100', 'Centurion', 'Win 100 games in any mode',
         'gameplay', 'rare', 100, 2, 'ember', NULL::jsonb, 4100),
        ('card_collection_half', 'Half the Pantheon',
         'Collect half of all obtainable cards',
         'collection', 'epic',
         (SELECT CEIL(COUNT(DISTINCT card_variant_id) / 2.0)::int FROM pack_card_variants),
         3, 'emerald', NULL, 4101),
        ('tower_floor_50', 'Tower Climber', 'Clear floor 50 of the Infinite Tower',
         'progression', 'rare', 50, 2, 'sapphire', NULL, 4102),
        ('tower_floor_100', 'Tower Conqueror', 'Clear floor 100 of the Infinite Tower',
         'progression', 'epic', 100, 3, 'amethyst', NULL, 4103),
        ('tutorial_complete', 'First Steps', 'Complete the tutorial',
         'progression', 'common', 1, 0, 'ivory', NULL, 4104),
        ('win_with_njord_50', 'Lord of the Tides', 'Win 50 games after playing Njord',
         'gameplay', 'rare', 50, 2, 'tide',
         jsonb_build_object('played_character', (SELECT character_id FROM characters WHERE name = 'Njord')), 4105),
        ('win_with_ragnarok_25', 'Twilight of the Gods', 'Win 25 games after playing Ragnarok',
         'gameplay', 'rare', 25, 2, 'inferno',
         jsonb_build_object('played_character', (SELECT character_id FROM characters WHERE name = 'Ragnarok')), 4106),
        ('win_with_oni_50', 'Demon''s Grin', 'Win 50 games after playing Oni',
         'gameplay', 'rare', 50, 2, 'oni',
         jsonb_build_object('played_character', (SELECT character_id FROM characters WHERE name = 'Oni')), 4107),
        ('win_with_kitsune_50', 'Nine Tails', 'Win 50 games after playing Kitsune',
         'gameplay', 'rare', 50, 2, 'kitsune',
         jsonb_build_object('played_character', (SELECT character_id FROM characters WHERE name = 'Kitsune')), 4108),
        ('win_norse_passive_50', 'Eyes of Odin', 'Win 50 games with the Norse passive active',
         'gameplay', 'epic', 50, 3, 'ravens', '{"deck_effect": "norse"}', 4109),
        ('win_japanese_passive_50', 'Cherry Blossom Path', 'Win 50 games with the Japanese passive active',
         'gameplay', 'epic', 50, 3, 'sakura', '{"deck_effect": "japanese"}', 4110),
        ('win_polynesian_passive_50', 'Island Champion', 'Win 50 games with the Polynesian passive active',
         'gameplay', 'epic', 50, 3, 'tusk', '{"deck_effect": "polynesian"}', 4111),
        ('saga_worlds_end', 'Serpent''s Bane', 'Win a saga battle at World''s End',
         'gameplay', 'epic', 1, 2, 'jormungandr',
         '{"game_mode": "saga", "mechanic": "worlds_end"}', 4112)
    )
    INSERT INTO achievements
      (achievement_key, title, description, category, type, target_value, rarity,
       reward_packs, reward_frame_id, win_condition, sort_order)
    SELECT d.achievement_key, d.title, d.description, d.category,
           CASE WHEN d.target_value = 1 THEN 'single' ELSE 'progress' END,
           d.target_value, d.rarity, d.reward_packs, f.frame_id, d.win_condition, d.sort_order
      FROM defs d
      JOIN avatar_frames f ON f.code_key = d.frame_key
    ON CONFLICT (achievement_key) DO NOTHING;

    UPDATE achievements
       SET reward_frame_id = (SELECT frame_id FROM avatar_frames WHERE code_key = 'crimson')
     WHERE achievement_key = 'pvp_wins_25';

    -- Already-claimed pvp_wins_25 will never pay out again: grant Crimson now.
    INSERT INTO user_owned_frames (user_id, frame_id, source)
    SELECT ua.user_id, f.frame_id, 'achievement_backfill'
      FROM user_achievements ua
      JOIN achievements a ON a.id = ua.achievement_id AND a.achievement_key = 'pvp_wins_25'
      JOIN avatar_frames f ON f.code_key = 'crimson'
     WHERE ua.is_claimed
    ON CONFLICT DO NOTHING;

    -- Progress backfills. tower_floor is the floor the player is ON, so floors
    -- cleared = tower_floor - 1.
    INSERT INTO user_achievements (user_id, achievement_id, current_progress, is_completed, completed_at)
    SELECT u.user_id, a.id,
           LEAST(GREATEST(u.tower_floor - 1, 0), a.target_value),
           u.tower_floor - 1 >= a.target_value,
           CASE WHEN u.tower_floor - 1 >= a.target_value THEN NOW() END
      FROM users u
      JOIN achievements a ON a.achievement_key IN ('tower_floor_50', 'tower_floor_100')
     WHERE u.tower_floor > 1
    ON CONFLICT (user_id, achievement_id) DO NOTHING;

    INSERT INTO user_achievements (user_id, achievement_id, current_progress, is_completed, completed_at)
    SELECT u.user_id, a.id, 1, true, NOW()
      FROM users u
      JOIN achievements a ON a.achievement_key = 'tutorial_complete'
     WHERE u.tutorial_completed_at IS NOT NULL
    ON CONFLICT (user_id, achievement_id) DO NOTHING;

    INSERT INTO user_achievements (user_id, achievement_id, current_progress, is_completed, completed_at)
    SELECT c.user_id, a.id, LEAST(c.n, a.target_value), c.n >= a.target_value,
           CASE WHEN c.n >= a.target_value THEN NOW() END
      FROM (SELECT user_id, COUNT(DISTINCT card_variant_id)::int n
              FROM user_owned_cards GROUP BY user_id) c
      JOIN achievements a ON a.achievement_key = 'card_collection_half'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;

    -- Ranked draft season frames (default rows and any per-season overrides).
    UPDATE season_reward_tiers t
       SET bundle_json = jsonb_set(
             t.bundle_json, '{frame_ids}',
             COALESCE(t.bundle_json->'frame_ids', '[]'::jsonb)
               || to_jsonb(ARRAY[(SELECT frame_id::text FROM avatar_frames WHERE code_key = v.frame_key)]))
      FROM (VALUES ('ascendant', 'silver'), ('immortal', 'silver'),
                   ('titan', 'gold'), ('worldforger', 'gold'), ('zenith', 'gold')) v(tier_key, frame_key)
     WHERE t.axis = 'ranked_draft' AND t.tier_key = v.tier_key;

    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type, grant_frame_id, grant_amount, price, price_currency, purchase_limit, sort_order)
    SELECT e.id, 12, 'avatar_frame', f.frame_id, 1, 500, 'event', 1, 12
      FROM events e
      JOIN avatar_frames f ON f.code_key = 'spirit'
     WHERE e.name = 'Hallow''s Eve'
    ON CONFLICT (event_id, slot_number) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM event_shop_offerings
     WHERE item_type = 'avatar_frame'
       AND grant_frame_id = (SELECT frame_id FROM avatar_frames WHERE code_key = 'spirit');

    UPDATE season_reward_tiers t
       SET bundle_json = jsonb_set(t.bundle_json, '{frame_ids}',
             COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(t.bundle_json->'frame_ids') x
                        WHERE x #>> '{}' NOT IN (SELECT frame_id::text FROM avatar_frames
                                                  WHERE code_key IN ('silver', 'gold'))), '[]'::jsonb))
     WHERE t.axis = 'ranked_draft' AND t.bundle_json ? 'frame_ids';

    DELETE FROM user_owned_frames WHERE source = 'achievement_backfill';
    UPDATE achievements SET reward_frame_id = NULL WHERE achievement_key = 'pvp_wins_25';
    DELETE FROM achievements WHERE achievement_key IN (${NEW_KEYS.map((k) => `'${k}'`).join(", ")});
    ALTER TABLE achievements DROP COLUMN IF EXISTS win_condition;
  `);
};
