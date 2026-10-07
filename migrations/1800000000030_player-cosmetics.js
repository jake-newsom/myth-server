/* eslint-disable camelcase */

/**
 * Player identity cosmetics: titles, avatars and avatar frames.
 *
 * - titles / avatar_frames are granted (achievements, season payouts, events)
 *   into user_owned_titles / user_owned_frames.
 * - avatars are a curated library of character faces. Ownership is NOT stored:
 *   a player may use an avatar when they own any card variant of its character
 *   (or the avatar is flagged is_default).
 * - One frame (is_unique) is held by exactly one player at a time. Its holder
 *   lives in unique_frame_holders, not user_owned_frames, and moves on ranked
 *   PvP losses / 7 days of ranked inactivity (UniqueFrameService).
 *
 * Entirely additive: new tables, nullable users columns, nullable reward
 * columns. The event shop item_type CHECK is only widened.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE titles (
      title_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code_key text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      -- Accent used by the client to tint the title text (blue/gold/purple/...).
      accent text NOT NULL DEFAULT 'blue',
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE avatar_frames (
      frame_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code_key text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      -- Cell key in the client's frame sprite sheet.
      sprite_key text NOT NULL,
      -- Exactly one holder at a time; never granted via user_owned_frames.
      is_unique boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE avatars (
      avatar_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id uuid REFERENCES characters(character_id) ON DELETE CASCADE,
      -- Cell key in the client's avatar sprite sheet.
      sprite_key text NOT NULL UNIQUE,
      sort_order integer NOT NULL DEFAULT 0,
      -- Usable by everyone regardless of card ownership.
      is_default boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX avatars_character ON avatars(character_id);

    CREATE TABLE user_owned_titles (
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      title_id uuid NOT NULL REFERENCES titles(title_id) ON DELETE CASCADE,
      source text,
      acquired_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, title_id)
    );

    CREATE TABLE user_owned_frames (
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      frame_id uuid NOT NULL REFERENCES avatar_frames(frame_id) ON DELETE CASCADE,
      source text,
      acquired_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, frame_id)
    );

    ALTER TABLE users
      ADD COLUMN equipped_title_id uuid REFERENCES titles(title_id) ON DELETE SET NULL,
      ADD COLUMN equipped_frame_id uuid REFERENCES avatar_frames(frame_id) ON DELETE SET NULL,
      ADD COLUMN equipped_avatar_id uuid REFERENCES avatars(avatar_id) ON DELETE SET NULL;

    CREATE TABLE unique_frame_holders (
      frame_id uuid PRIMARY KEY REFERENCES avatar_frames(frame_id) ON DELETE CASCADE,
      -- NULL = unclaimed; the next ranked winner claims it.
      user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      acquired_at timestamptz,
      acquired_via text
    );

    CREATE TABLE unique_frame_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      frame_id uuid NOT NULL REFERENCES avatar_frames(frame_id) ON DELETE CASCADE,
      from_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      to_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      -- 'claim' | 'defeat' | 'inactivity' | 'admin' | 'release'
      reason text NOT NULL,
      game_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX unique_frame_history_frame ON unique_frame_history(frame_id, created_at DESC);

    -- Reward hooks. Nullable, so existing rows and readers are unaffected.
    ALTER TABLE achievements
      ADD COLUMN reward_title_id uuid REFERENCES titles(title_id) ON DELETE SET NULL,
      ADD COLUMN reward_frame_id uuid REFERENCES avatar_frames(frame_id) ON DELETE SET NULL;
    ALTER TABLE login_sequence_rewards
      ADD COLUMN reward_title_id uuid REFERENCES titles(title_id) ON DELETE SET NULL,
      ADD COLUMN reward_frame_id uuid REFERENCES avatar_frames(frame_id) ON DELETE SET NULL;
    ALTER TABLE event_milestones
      ADD COLUMN reward_title_id uuid REFERENCES titles(title_id) ON DELETE SET NULL,
      ADD COLUMN reward_frame_id uuid REFERENCES avatar_frames(frame_id) ON DELETE SET NULL;
    ALTER TABLE event_shop_offerings
      ADD COLUMN grant_title_id uuid REFERENCES titles(title_id) ON DELETE CASCADE,
      ADD COLUMN grant_frame_id uuid REFERENCES avatar_frames(frame_id) ON DELETE CASCADE;
    ALTER TABLE mail
      ADD COLUMN reward_title_id uuid REFERENCES titles(title_id) ON DELETE SET NULL,
      ADD COLUMN reward_frame_id uuid REFERENCES avatar_frames(frame_id) ON DELETE SET NULL;
  `);

  // Widen the event shop item_type CHECK (constraint name is Postgres' default).
  pgm.sql(`
    ALTER TABLE event_shop_offerings DROP CONSTRAINT IF EXISTS event_shop_offerings_item_type_check;
    ALTER TABLE event_shop_offerings ADD CONSTRAINT event_shop_offerings_item_type_check
      CHECK (item_type IN ('card','pack','event_pack','border','card_back','gems','gold',
                           'fate_coins','card_fragments','embers','title','avatar_frame'));
  `);

  // Seed: the unique frame, a few starter titles/frames, and one avatar per
  // character. Avatar art is added to the client sprite sheet over time; a
  // sprite_key with no art yet falls back to the username initial.
  pgm.sql(`
    INSERT INTO avatar_frames (code_key, name, description, sprite_key, is_unique) VALUES
      ('one_frame', 'One Frame to Rule Them All',
       'Held by a single player. Lose a ranked match and it passes to your victor. Go 7 days without a ranked match and it passes to the highest ranked active player.',
       'one_frame', true),
      ('bronze', 'Bronze Laurel', 'A simple laurel of bronze.', 'bronze', false),
      ('silver', 'Silver Laurel', 'A laurel of silver.', 'silver', false),
      ('gold', 'Gold Laurel', 'A laurel of gold.', 'gold', false);

    INSERT INTO unique_frame_holders (frame_id, user_id)
      SELECT frame_id, NULL FROM avatar_frames WHERE code_key = 'one_frame';

    INSERT INTO titles (code_key, name, description, accent) VALUES
      ('the_wanderer', 'The Wanderer', 'Your journey has begun.', 'neutral'),
      ('season_champion', 'Season Champion', 'Finished a season at #1.', 'gold'),
      ('season_elite', 'Season Elite', 'Finished a season in the top tier.', 'purple');

    INSERT INTO avatars (character_id, sprite_key, sort_order, is_default)
      SELECT c.character_id,
             btrim(regexp_replace(lower(c.name), '[^a-z0-9]+', '_', 'g'), '_'),
             row_number() OVER (ORDER BY c.name),
             c.name = 'Shieldmaiden'
        FROM characters c
      ON CONFLICT (sprite_key) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE mail DROP COLUMN IF EXISTS reward_title_id, DROP COLUMN IF EXISTS reward_frame_id;
    ALTER TABLE event_shop_offerings DROP COLUMN IF EXISTS grant_title_id, DROP COLUMN IF EXISTS grant_frame_id;
    ALTER TABLE event_milestones DROP COLUMN IF EXISTS reward_title_id, DROP COLUMN IF EXISTS reward_frame_id;
    ALTER TABLE login_sequence_rewards DROP COLUMN IF EXISTS reward_title_id, DROP COLUMN IF EXISTS reward_frame_id;
    ALTER TABLE achievements DROP COLUMN IF EXISTS reward_title_id, DROP COLUMN IF EXISTS reward_frame_id;
    ALTER TABLE users DROP COLUMN IF EXISTS equipped_title_id,
                      DROP COLUMN IF EXISTS equipped_frame_id,
                      DROP COLUMN IF EXISTS equipped_avatar_id;
    DROP TABLE IF EXISTS unique_frame_history;
    DROP TABLE IF EXISTS unique_frame_holders;
    DROP TABLE IF EXISTS user_owned_frames;
    DROP TABLE IF EXISTS user_owned_titles;
    DROP TABLE IF EXISTS avatars;
    DROP TABLE IF EXISTS avatar_frames;
    DROP TABLE IF EXISTS titles;
  `);
};
