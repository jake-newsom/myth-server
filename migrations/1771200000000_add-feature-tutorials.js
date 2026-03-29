/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("users", {
    completed_feature_tutorials: {
      type: "text[]",
      notNull: true,
      default: "{}",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("users", "completed_feature_tutorials");
};
