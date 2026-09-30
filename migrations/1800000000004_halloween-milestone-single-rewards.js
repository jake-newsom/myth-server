/**
 * Consolidate the Halloween milestone ladder to ONE reward per tier.
 *
 * The event page presents each milestone as a single reward tile, so a tier
 * granting "25 gems + 1000 gold + 10 fragments + a card" cannot be shown
 * honestly in that layout. This rewrites the five tiers to one reward each,
 * matching the design:
 *
 *   250  -> 25 Gems
 *   750  -> 50 Card Fragments
 *   1500 -> 1 Event Pack
 *   2250 -> Veilbreaker Card Border
 *   3000 -> Hallowed Card Back
 *
 * NOTE ON THE DESIGN: the mock labels tier 2 "50 Wandering Souls". Echoes (the
 * saga currency) is NOT part of the shared RewardItem vocabulary that
 * RewardService grants — wiring it in would touch every claim path in the app.
 * Card fragments are used instead: a real, grantable currency at a comparable
 * value. Swapping it later is a data edit, not a code change.
 *
 * Data-only and idempotent. Claims already made are untouched: a player who
 * claimed a tier keeps what they were given at the time.
 */

exports.up = (pgm) => {
  // Clear every reward column first, so a tier only carries what is set below
  // and no stale currency survives the rewrite.
  pgm.sql(`
    UPDATE event_milestones SET
      reward_gems = 0, reward_gold = 0, reward_fate_coins = 0,
      reward_card_fragments = 0, reward_packs = 0, reward_embers = 0,
      reward_card_variant_id = NULL, reward_border_id = NULL,
      reward_card_back_id = NULL
    WHERE event_id = (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);

  pgm.sql(`
    UPDATE event_milestones m SET
      name = v.name,
      description = v.description,
      reward_gems = v.gems,
      reward_card_fragments = v.fragments,
      reward_packs = v.packs
    FROM (VALUES
      (250,  'First Harvest',   'Earn 250 Candy.',   25, 0,  0),
      (750,  'Wandering Souls', 'Earn 750 Candy.',   0,  50, 0),
      (1500, 'The Long Night',  'Earn 1,500 Candy.', 0,  0,  1)
    ) AS v(threshold, name, description, gems, fragments, packs)
    WHERE m.threshold = v.threshold
      AND m.event_id = (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);

  // Cosmetic tiers. Resolved by lookup so a database missing the asset row
  // simply leaves the tier empty rather than failing the migration.
  pgm.sql(`
    UPDATE event_milestones SET
      name = 'Veilbreaker',
      description = 'Earn 2,250 Candy.',
      reward_border_id = (SELECT border_id FROM card_borders WHERE name = 'Hallowed Veil')
    WHERE threshold = 2250
      AND event_id = (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);

  pgm.sql(`
    UPDATE event_milestones SET
      name = 'Hallowed',
      description = 'Earn 3,000 Candy.',
      reward_card_back_id = (SELECT back_id FROM card_backs WHERE code_key = 'halloween-2026-back')
    WHERE threshold = 3000
      AND event_id = (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);
};

exports.down = () => {
  // No-op: this rewrites reward configuration in place. Reverting would mean
  // restoring the previous multi-reward values, which the earlier content
  // migration owns — re-run that to get them back.
};
