/**
 * Move saga currency from saga_player_seasons.currency_balance to users.echoes.
 * Keep saga_player_seasons for season-scoped flags/purchases only.
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("users", {
    echoes: {
      type: "integer",
      notNull: true,
      default: 0,
    },
  });

  pgm.addConstraint("users", "users_echoes_check", {
    check: "echoes >= 0",
  });

  pgm.sql(`
    UPDATE users u
    SET echoes = COALESCE(src.currency_balance, 0)
    FROM (
      SELECT DISTINCT ON (player_id)
        player_id,
        currency_balance
      FROM saga_player_seasons
      ORDER BY player_id, updated_at DESC
    ) src
    WHERE src.player_id = u.user_id;
  `);

  pgm.dropColumn("saga_player_seasons", "currency_balance", { ifExists: true });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.addColumn("saga_player_seasons", {
    currency_balance: {
      type: "integer",
      notNull: true,
      default: 0,
    },
  });

  pgm.sql(`
    UPDATE saga_player_seasons sps
    SET currency_balance = COALESCE(u.echoes, 0)
    FROM users u
    WHERE u.user_id = sps.player_id;
  `);

  pgm.dropConstraint("users", "users_echoes_check", { ifExists: true });
  pgm.dropColumn("users", "echoes", { ifExists: true });
};
