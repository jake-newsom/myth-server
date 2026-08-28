/* eslint-disable camelcase */

/**
 * Introduces "Embers", the entry currency for solo and Ascendant's Spire games.
 *
 * An ember is spent when a solo/tower game is created. A game that spent one is
 * "ember funded" and pays out card XP and season souls as it always has. A game
 * started with an empty ember balance still plays — it just earns no card XP and
 * its souls never reach the player's season total. Embers are not involved in
 * PvP, ranked draft, or Sagas.
 *
 * Regeneration: +1 every 30 minutes up to a soft cap of 60. The cap is a
 * regeneration ceiling, not a hard maximum — purchases and rewards can push the
 * balance above it, and regeneration simply stops contributing while it is over.
 *
 * Everything here is additive and safe against clients that predate it:
 *
 *   - users.embers / users.embers_last_regen_at are new columns with defaults,
 *     so every existing row is valid the moment they exist. Existing accounts
 *     start at the full cap rather than 0 so nobody logs in to an empty meter
 *     they did not spend.
 *
 *   - games.ember_funded defaults to TRUE, which is deliberate. The column
 *     means "this game pays out XP and souls", and every game that exists when
 *     this migration runs — including games in progress right now — was played
 *     under the old rules and must keep paying out. Only game creation writes
 *     an explicit FALSE, so a game can only become unfunded by being started
 *     with no embers. A default of FALSE would silently void the rewards of
 *     every in-flight game at deploy time.
 *
 *   - achievements.reward_embers is nullable with no default, exactly like
 *     reward_fate_coins and reward_card_fragments before it. Every existing
 *     achievement leaves it NULL and awards no embers. No achievement rows are
 *     touched here; retuning rewards is a separate, deliberate change.
 *
 * The enum values for the new reward and shop types, and the shop's ember
 * bundle row, are in the migration immediately after this one — see the note
 * beside the feature flag insert for why they cannot share a transaction.
 *
 * The economy itself ships dark behind the `embers-economy` feature flag: with
 * it off the server spends nothing and every game stays ember funded, which is
 * exactly today's behaviour. The flag is seeded off at the bottom of this file.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumns("users", {
    embers: {
      type: "integer",
      notNull: true,
      default: 60,
      comment:
        "Entry currency for solo and tower games. Regenerates +1 per 30 " +
        "minutes up to 60; purchases and rewards may push it above that.",
    },
    embers_last_regen_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
      comment:
        "High-water mark that ember regeneration has been credited through. " +
        "Advances by whole 10-minute intervals only, so partial progress " +
        "toward the next ember is never lost to rounding.",
    },
  });

  // Regeneration sweeps read "who is below the cap, oldest first". Partial so
  // the index stays small: accounts sitting at or above the cap are the common
  // case and are irrelevant to the sweep.
  pgm.createIndex("users", "embers_last_regen_at", {
    name: "idx_users_embers_regen_pending",
    where: "embers < 60",
  });

  pgm.addColumns("games", {
    ember_funded: {
      type: "boolean",
      notNull: true,
      default: true,
      comment:
        "Whether this game paid its ember at creation. FALSE means it awards " +
        "no card XP and its souls are excluded from the season total. " +
        "Defaults TRUE so pre-existing and in-flight games keep paying out.",
    },
  });

  pgm.addColumns("achievements", {
    reward_embers: {
      type: "integer",
      notNull: false,
      default: null,
      comment:
        "Embers granted when this achievement is claimed. NULL or 0 grants none.",
    },
  });

  // The two enum values this feature needs live in the migration that follows
  // this one. `ALTER TYPE ... ADD VALUE` cannot be used by a later statement in
  // the same transaction, and node-pg-migrate runs each migration in one, so
  // adding the value and inserting a row that uses it must be separate files.

  pgm.sql(`
    INSERT INTO feature_flags (key, description, enabled_globally)
    VALUES (
      'embers-economy',
      'Spends an ember to start a solo or tower game, and withholds card XP and season souls from games started with none. Off: nothing is spent and every game pays out as before.',
      false
    )
    ON CONFLICT (key) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM feature_flags WHERE key = 'embers-economy';`);

  pgm.dropColumns("achievements", ["reward_embers"]);
  pgm.dropColumns("games", ["ember_funded"]);
  pgm.dropIndex("users", "embers_last_regen_at", {
    name: "idx_users_embers_regen_pending",
    ifExists: true,
  });
  pgm.dropColumns("users", ["embers", "embers_last_regen_at"]);
};
