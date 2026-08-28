/* eslint-disable camelcase */

/**
 * Seeds the two flags the shop overhaul ships behind, both dark.
 *
 * `shop-overhaul` — off means: the daily shop keeps its existing index-based
 * rotation, no Soul Shop offerings are generated, the new consumable slots are
 * not offered, tab resets are refused, and a 10-pack open has no guaranteed
 * variant. In other words the flag-off path is exactly the behaviour that is
 * live today, which is what makes this revertible without a redeploy.
 *
 * `iap-store` — off means the paid ("Vault") tab is not returned by the API and
 * not rendered by the client. It stays off until real IAP exists; the tab's
 * contents are mock data.
 *
 * Ember purchasing remains gated by the pre-existing `embers-economy` flag —
 * this migration does not touch it.
 *
 * Seeding the rows (rather than relying on unknown-key => false) is what lets
 * the admin console grant per-user overrides for testing before rollout.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (key, description, enabled_globally)
    VALUES
      (
        'shop-overhaul',
        'Unified shop: deterministic set rotation, Soul Shop, tab resets, and the guaranteed art variant in a 10-pack.',
        false
      ),
      (
        'iap-store',
        'Show the paid shop tab. Mock listings only until real in-app purchases ship.',
        false
      )
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `DELETE FROM feature_flags WHERE key IN ('shop-overhaul', 'iap-store');`
  );
};
