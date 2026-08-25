/* eslint-disable camelcase */

/**
 * Tracks whether a user has deliberately picked their own username.
 *
 * Social signup (Apple/Google/Facebook) auto-generates a name from the
 * provider profile — see FacebookService.generateUsername and the Apple/Google
 * equivalents in auth.controller.ts. Those names are serviceable but not
 * chosen, and there was previously no way to tell one apart from a name the
 * user actually wanted: both are just a string in `username`.
 *
 * NULL means "never prompted, never chosen" and is the single signal the
 * first-run username prompt keys off. Nullable with no default, so adding the
 * column changes nothing for code that does not read it.
 *
 * The backfill below is deliberate and is what keeps this off live users'
 * screens: every account that already exists is treated as having chosen,
 * so only accounts created after this ships can ever see the prompt. It runs
 * in the same migration as the column add ONLY because it touches a column no
 * deployed code reads yet — there is no shipped reader to race with.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumns("users", {
    username_chosen_at: {
      type: "timestamptz",
      notNull: false,
      default: null,
    },
  });

  // Existing accounts are grandfathered as "already chose". Without this every
  // live social user would be prompted on their next Home visit.
  pgm.sql(`
    UPDATE "users"
       SET username_chosen_at = created_at
     WHERE username_chosen_at IS NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumns("users", ["username_chosen_at"]);
};
