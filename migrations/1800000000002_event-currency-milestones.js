/**
 * Event currency milestones: rewards for TOTAL currency earned during an event.
 *
 * Progress is measured against `user_event_currency_balances.lifetime_earned`,
 * which only ever increases (spending decrements `balance` alone). That is what
 * makes a milestone track "how much you earned", not "how much you're holding" —
 * a player who spends in the shop keeps their milestone progress.
 *
 * Purely additive: two new tables, no changes to existing ones.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE event_milestones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      -- Total lifetime_earned required to unlock this rung.
      threshold integer NOT NULL CHECK (threshold > 0),
      name text,
      description text,

      -- Reward columns mirror the shared reward vocabulary so a row maps
      -- straight to RewardItem[] and grants through RewardService.
      reward_gold integer NOT NULL DEFAULT 0 CHECK (reward_gold >= 0),
      reward_gems integer NOT NULL DEFAULT 0 CHECK (reward_gems >= 0),
      reward_fate_coins integer NOT NULL DEFAULT 0 CHECK (reward_fate_coins >= 0),
      reward_card_fragments integer NOT NULL DEFAULT 0 CHECK (reward_card_fragments >= 0),
      reward_packs integer NOT NULL DEFAULT 0 CHECK (reward_packs >= 0),
      reward_embers integer NOT NULL DEFAULT 0 CHECK (reward_embers >= 0),
      reward_card_variant_id uuid REFERENCES card_variants(card_variant_id) ON DELETE SET NULL,
      reward_border_id uuid REFERENCES card_borders(border_id) ON DELETE SET NULL,
      reward_card_back_id uuid REFERENCES card_backs(back_id) ON DELETE SET NULL,

      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      -- One rung per threshold per event: makes the ladder unambiguous and
      -- gives the claim path a natural idempotency key.
      UNIQUE (event_id, threshold)
    );
    CREATE INDEX event_milestones_event ON event_milestones(event_id, threshold);

    -- One row per claimed rung. The PK is the idempotency guard: a duplicate
    -- claim violates it inside the transaction rather than double-granting.
    CREATE TABLE user_event_milestone_claims (
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      milestone_id uuid NOT NULL REFERENCES event_milestones(id) ON DELETE CASCADE,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, milestone_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS user_event_milestone_claims;
    DROP TABLE IF EXISTS event_milestones;
  `);
};
