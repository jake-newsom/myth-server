/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add base_achievement_key column for grouping tiered achievements
  pgm.addColumn("achievements", {
    base_achievement_key: {
      type: "varchar(100)",
      notNull: false,
      comment: "Groups related tiered achievements together",
    },
  });

  // Add tier_level column for tier progression (1-based)
  pgm.addColumn("achievements", {
    tier_level: {
      type: "integer",
      notNull: false,
      comment: "Tier level for tiered achievements (1-based). NULL for standalone achievements.",
    },
  });

  // Add story_id column to link achievements to specific story modes
  pgm.addColumn("achievements", {
    story_id: {
      type: "uuid",
      notNull: false,
      references: "story_mode_config(story_id)",
      onDelete: "SET NULL",
      comment: "Links achievement to specific story mode. NULL for general achievements.",
    },
  });

  // Add index on base_achievement_key for efficient tier queries
  pgm.createIndex("achievements", "base_achievement_key", {
    name: "idx_achievements_base_key",
    where: "base_achievement_key IS NOT NULL",
  });

  // Add index on story_id for efficient story-linked achievement queries
  pgm.createIndex("achievements", "story_id", {
    name: "idx_achievements_story_id",
    where: "story_id IS NOT NULL",
  });

  // Add constraint: if tier_level is set, base_achievement_key must also be set
  pgm.addConstraint("achievements", "achievements_tier_requires_base_key", {
    check: "(tier_level IS NULL) OR (base_achievement_key IS NOT NULL)",
  });

  // Add constraint: tier_level must be >= 1 if not null
  pgm.addConstraint("achievements", "achievements_tier_level_check", {
    check: "(tier_level IS NULL) OR (tier_level >= 1)",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop constraints first
  pgm.dropConstraint("achievements", "achievements_tier_level_check");
  pgm.dropConstraint("achievements", "achievements_tier_requires_base_key");

  // Drop indexes
  pgm.dropIndex("achievements", "idx_achievements_story_id");
  pgm.dropIndex("achievements", "idx_achievements_base_key");

  // Drop columns
  pgm.dropColumn("achievements", "story_id");
  pgm.dropColumn("achievements", "tier_level");
  pgm.dropColumn("achievements", "base_achievement_key");
};

