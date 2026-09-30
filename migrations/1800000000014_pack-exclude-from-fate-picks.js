/**
 * Per-pack opt-out from Fate picks.
 *
 * Until now the only gate on creating a Fate pick from an opening was "the
 * pack produced exactly 5 cards", so every 5-card pack fed the Fate pool.
 * Event//promo packs sometimes shouldn't: their cards are meant to stay with
 * the player who earned them rather than becoming steal-able by the pool.
 *
 * This is a data switch, deliberately not a feature flag -- flipping the
 * column on a pack row takes effect on the next opening with no redeploy, and
 * flipping it back is the full rollback. Defaulted false so every existing
 * pack keeps exactly today's behavior.
 *
 * Only NEW openings are affected. Fate picks already created from an excluded
 * pack are left alone: they're live rows other players may have already paid
 * wonder coins to participate in.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("packs", {
    excluded_from_fate_picks: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn("packs", "excluded_from_fate_picks");
};
