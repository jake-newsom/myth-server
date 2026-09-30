/**
 * Events system: a single hub table (`events`) with every subsystem attached
 * as an OPTIONAL, nullable attachment, plus a standalone reusable
 * login-sequence system that events may point at by id.
 *
 * Release safety
 * --------------
 * This migration is purely additive: new tables, plus nullable/defaulted
 * columns on existing tables. Nothing is dropped, renamed, or retyped, and no
 * existing request/response shape changes. Old clients that never ask for
 * event data are completely unaffected — every read path added on top of this
 * returns "no active event" when the tables are empty.
 *
 * Access model (start/end vs. feature flag)
 * -----------------------------------------
 * An event is visible when EITHER:
 *   - now() is within [starts_at, ends_at)                    -> everyone, or
 *   - the user has `preview_feature_flag_key` enabled          -> early access
 * The flag is therefore a *preview* mechanism, not a gate on the live window,
 * which is why it is nullable and why the live window does not consult it.
 * `kill_switch_flag_key` is the inverse and is checked separately: it hides an
 * event mid-flight without a redeploy.
 */

exports.up = (pgm) => {
  // ---- Login sequences (standalone; usable with or without an event) -------
  //
  // A sequence is an ordered ladder of rewards keyed by *login count*, not by
  // calendar day: `day_index` 3 means "the third day you logged in during the
  // window", so a player who misses a day does not lose the ladder. The
  // window itself is on the sequence, so the same sequence can be re-run later
  // by cloning it with new dates.
  pgm.sql(`
    CREATE TABLE login_sequences (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sequence_key text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (ends_at > starts_at)
    );

    -- One row per rung of the ladder. Reward columns mirror the existing
    -- reward vocabulary (see utils/rewards.helpers) so the rows can be mapped
    -- straight to RewardItem[] and granted through RewardService.
    CREATE TABLE login_sequence_rewards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sequence_id uuid NOT NULL REFERENCES login_sequences(id) ON DELETE CASCADE,
      day_index integer NOT NULL CHECK (day_index >= 1),
      reward_gold integer NOT NULL DEFAULT 0 CHECK (reward_gold >= 0),
      reward_gems integer NOT NULL DEFAULT 0 CHECK (reward_gems >= 0),
      reward_fate_coins integer NOT NULL DEFAULT 0 CHECK (reward_fate_coins >= 0),
      reward_card_fragments integer NOT NULL DEFAULT 0 CHECK (reward_card_fragments >= 0),
      reward_packs integer NOT NULL DEFAULT 0 CHECK (reward_packs >= 0),
      reward_embers integer NOT NULL DEFAULT 0 CHECK (reward_embers >= 0),
      -- Event currency is granted through the same ladder; the currency it
      -- refers to is the event's own (events.currency_id), resolved at claim
      -- time so a sequence stays reusable across events.
      reward_event_currency integer NOT NULL DEFAULT 0 CHECK (reward_event_currency >= 0),
      reward_card_variant_id uuid REFERENCES card_variants(card_variant_id) ON DELETE SET NULL,
      reward_border_id uuid REFERENCES card_borders(border_id) ON DELETE SET NULL,
      reward_card_back_id uuid REFERENCES card_backs(back_id) ON DELETE SET NULL,
      is_milestone boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (sequence_id, day_index)
    );

    -- Per-user ladder progress. days_claimed is the high-water mark of rungs
    -- taken; last_credited_date is the UTC date that last incremented it, and
    -- is what makes crediting idempotent within a day.
    CREATE TABLE user_login_sequence_progress (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      sequence_id uuid NOT NULL REFERENCES login_sequences(id) ON DELETE CASCADE,
      days_credited integer NOT NULL DEFAULT 0 CHECK (days_credited >= 0),
      days_claimed integer NOT NULL DEFAULT 0 CHECK (days_claimed >= 0),
      last_credited_date date,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, sequence_id),
      CHECK (days_claimed <= days_credited)
    );
    CREATE INDEX login_sequence_rewards_seq ON login_sequence_rewards(sequence_id, day_index);
    CREATE INDEX login_sequences_window ON login_sequences(starts_at, ends_at) WHERE is_active;
  `);

  // ---- Event currencies ----------------------------------------------------
  //
  // Deliberately NOT a new column on `users`: an event currency is temporary
  // and there may be many over time, so balances live in their own ledger
  // table keyed by (user, currency). That keeps `users` stable and lets a
  // retired event's balances be dropped without touching the hot table.
  pgm.sql(`
    CREATE TABLE event_currencies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      currency_key text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      icon_url text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE user_event_currency_balances (
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      currency_id uuid NOT NULL REFERENCES event_currencies(id) ON DELETE CASCADE,
      balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
      lifetime_earned integer NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, currency_id)
    );
  `);

  // ---- Events --------------------------------------------------------------
  //
  // Every attachment below is nullable. An event with all of them NULL is a
  // valid, purely-cosmetic event (name + window + background).
  pgm.sql(`
    CREATE TABLE events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_key text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      is_active boolean NOT NULL DEFAULT true,

      -- Early access before starts_at. NOT consulted during the live window.
      preview_feature_flag_key text,
      -- Inverse gate: when this flag is enabled for a user, the event is
      -- hidden from them even inside the live window (kill switch / rollback).
      kill_switch_flag_key text,

      -- Optional attachments -------------------------------------------------
      currency_id uuid REFERENCES event_currencies(id) ON DELETE SET NULL,
      -- Chance in [0,1] that a completed game drops event currency, and how
      -- much. NULL currency_id disables the drop regardless of these.
      currency_drop_chance numeric(5,4) NOT NULL DEFAULT 0
        CHECK (currency_drop_chance >= 0 AND currency_drop_chance <= 1),
      currency_drop_min integer NOT NULL DEFAULT 0 CHECK (currency_drop_min >= 0),
      currency_drop_max integer NOT NULL DEFAULT 0 CHECK (currency_drop_max >= 0),
      -- Per-mode multipliers on the drop, e.g. {"pvp": 1.5, "solo": 1.0}.
      -- Absent mode = 1.0. Lets one event pay out differently per game mode
      -- without a column per mode.
      currency_drop_mode_multipliers jsonb NOT NULL DEFAULT '{}'::jsonb,

      login_sequence_id uuid REFERENCES login_sequences(id) ON DELETE SET NULL,

      -- Identifier of the engine mechanic this event turns on. Resolved
      -- against a code-side registry rather than an enum so that adding a
      -- mechanic is a code change only, with no migration and no enum value
      -- that old clients could receive and fail to parse.
      mechanic_key text,
      -- Free-form tuning for that mechanic (per-mechanic shape).
      mechanic_config jsonb NOT NULL DEFAULT '{}'::jsonb,

      -- Cosmetics
      background_image_url text,
      board_background_image_url text,
      theme_color text,
      icon_url text,

      -- When true, the event exposes a playable mode entry point in the UI
      -- (its own tile on the play screen) that starts a match with
      -- mechanic_key applied.
      has_game_mode boolean NOT NULL DEFAULT false,
      game_mode_label text,
      game_mode_description text,

      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (ends_at > starts_at),
      CHECK (currency_drop_max >= currency_drop_min)
    );
    CREATE INDEX events_window ON events(starts_at, ends_at) WHERE is_active;

    -- Event shop: standalone from daily_shop_offerings because its lifecycle
    -- is the event window (not a shop_date rotation) and its prices are
    -- normally denominated in the event currency. Reusing the daily shop
    -- would have meant widening currency_type and the daily rotation logic —
    -- a change to live, shipped shop behavior. This keeps event shopping
    -- entirely additive.
    CREATE TABLE event_shop_offerings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      slot_number integer NOT NULL,
      -- What the slot sells. Mirrors the reward vocabulary; exactly one of the
      -- grant_* columns should be meaningful per row.
      item_type text NOT NULL CHECK (item_type IN
        ('card','pack','border','card_back','gems','gold','fate_coins','card_fragments','embers')),
      grant_card_variant_id uuid REFERENCES card_variants(card_variant_id) ON DELETE CASCADE,
      grant_border_id uuid REFERENCES card_borders(border_id) ON DELETE CASCADE,
      grant_card_back_id uuid REFERENCES card_backs(back_id) ON DELETE CASCADE,
      grant_amount integer NOT NULL DEFAULT 1 CHECK (grant_amount >= 0),

      -- Price. Paid in the event currency when price_currency = 'event',
      -- otherwise in the named standard currency.
      price integer NOT NULL CHECK (price >= 0),
      price_currency text NOT NULL DEFAULT 'event'
        CHECK (price_currency IN ('event','gems','gold','fate_coins','card_fragments','embers')),

      -- NULL = unlimited for the event's duration.
      purchase_limit integer CHECK (purchase_limit IS NULL OR purchase_limit >= 1),
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (event_id, slot_number)
    );

    CREATE TABLE event_shop_purchases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      offering_id uuid NOT NULL REFERENCES event_shop_offerings(id) ON DELETE CASCADE,
      quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
      price_paid integer NOT NULL CHECK (price_paid >= 0),
      price_currency text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX event_shop_purchases_user ON event_shop_purchases(user_id, offering_id);
  `);

  // ---- Event-scoped achievements ------------------------------------------
  //
  // Rather than a parallel achievement system, event achievements are ordinary
  // rows in `achievements` tagged with an event. All existing progress
  // tracking, claiming and reward granting therefore works unchanged; the only
  // new behavior is visibility filtering (hidden unless the event is live for
  // that user). Nullable column => every existing achievement keeps NULL and
  // behaves exactly as before.
  pgm.sql(`
    ALTER TABLE achievements
      ADD COLUMN event_id uuid REFERENCES events(id) ON DELETE CASCADE,
      ADD COLUMN reward_event_currency integer NOT NULL DEFAULT 0
        CHECK (reward_event_currency >= 0);
    CREATE INDEX achievements_event ON achievements(event_id) WHERE event_id IS NOT NULL;
  `);

  // ---- Event participation on games ---------------------------------------
  //
  // Records which event (and mechanic) a match was played under, so reward
  // attribution and post-hoc analysis don't have to re-derive it. Nullable:
  // every normal match leaves it NULL.
  pgm.sql(`
    ALTER TABLE games
      ADD COLUMN event_id uuid REFERENCES events(id) ON DELETE SET NULL,
      ADD COLUMN event_mechanic_key text;
    CREATE INDEX games_event ON games(event_id) WHERE event_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS games_event;
    ALTER TABLE games DROP COLUMN IF EXISTS event_id, DROP COLUMN IF EXISTS event_mechanic_key;
    DROP INDEX IF EXISTS achievements_event;
    ALTER TABLE achievements
      DROP COLUMN IF EXISTS event_id, DROP COLUMN IF EXISTS reward_event_currency;
    DROP TABLE IF EXISTS event_shop_purchases, event_shop_offerings, events;
    DROP TABLE IF EXISTS user_event_currency_balances, event_currencies;
    DROP TABLE IF EXISTS user_login_sequence_progress, login_sequence_rewards, login_sequences;
  `);
};
