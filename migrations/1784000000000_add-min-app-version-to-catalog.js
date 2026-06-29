/**
 * Add min_app_version to the cosmetic/catalog tables: characters, card_variants,
 * card_borders, card_backs.
 *
 * Semantics (enforced in the application layer, see utils/catalogVersion.ts):
 *   - NULL  = unrestricted; visible to every client regardless of version.
 *   - "X.Y.Z" = only served to clients whose X-Client-Version >= this value.
 *
 * Existing rows are left NULL so all current content stays visible. The column
 * is plain TEXT (not validated in SQL) because semver comparison happens in
 * Node via compareSemver(), the same comparator used for client feature gating.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const TABLES = ["characters", "card_variants", "card_borders", "card_backs"];

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  for (const table of TABLES) {
    pgm.addColumn(table, {
      min_app_version: {
        type: "text",
        notNull: false,
        default: null,
      },
    });
  }
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  for (const table of TABLES) {
    pgm.dropColumn(table, "min_app_version");
  }
};
