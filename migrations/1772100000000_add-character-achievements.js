/**
 * Add character-scoped achievements while keeping a single achievements table.
 *
 * - achievement_kind: "standard" | "character"
 * - character_id: required when kind is "character"
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("achievements", {
    achievement_kind: {
      type: "varchar(20)",
      notNull: true,
      default: "standard",
    },
    character_id: {
      type: "uuid",
      notNull: false,
      references: "characters(character_id)",
      onDelete: "CASCADE",
    },
  });

  pgm.addConstraint("achievements", "achievements_kind_check", {
    check: "achievement_kind IN ('standard', 'character')",
  });

  pgm.addConstraint("achievements", "achievements_character_kind_check", {
    check:
      "(achievement_kind <> 'character') OR (character_id IS NOT NULL)",
  });

  pgm.createIndex("achievements", "character_id", {
    name: "achievements_character_id_active_idx",
    where: "achievement_kind = 'character' AND is_active = true",
  });

  // Seed: Fenrir character achievement + matching character-locked border.
  // This is idempotent so local down/up iteration is safe.
  pgm.sql(`
    WITH fenrir AS (
      SELECT character_id
      FROM characters
      WHERE name = 'Fenrir'
      LIMIT 1
    )
    INSERT INTO card_borders (
      border_id,
      name,
      description,
      image_url,
      animation_key,
      character_id,
      set_id,
      is_active
    )
    SELECT
      '7f52c228-04f6-4ac7-84d0-f5c1f98ce77f'::uuid,
      'Ravenous Fang',
      'Awarded for proving Fenrir''s hunger: destroy 1,000 enemies with Devourer''s Surge.',
      '/borders/ravenous-fang.png',
      'fenrir_devourers_surge',
      f.character_id,
      NULL,
      true
    FROM fenrir f
    ON CONFLICT (border_id) DO UPDATE
      SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        image_url = EXCLUDED.image_url,
        animation_key = EXCLUDED.animation_key,
        character_id = EXCLUDED.character_id,
        set_id = EXCLUDED.set_id,
        is_active = true,
        updated_at = NOW();
  `);

  pgm.sql(`
    WITH fenrir AS (
      SELECT character_id
      FROM characters
      WHERE name = 'Fenrir'
      LIMIT 1
    )
    INSERT INTO achievements (
      achievement_key,
      title,
      description,
      achievement_kind,
      character_id,
      category,
      type,
      target_value,
      rarity,
      reward_gems,
      reward_packs,
      reward_fate_coins,
      reward_card_fragments,
      reward_border_id,
      icon_url,
      is_active,
      sort_order
    )
    SELECT
      'fenrir_devourers_surge_destroy_1000',
      'Devourer''s Legacy',
      'Destroy 1,000 enemies with Devourer''s Surge.',
      'character',
      f.character_id,
      'gameplay',
      'progress',
      1000,
      'legendary',
      0,
      0,
      0,
      0,
      '7f52c228-04f6-4ac7-84d0-f5c1f98ce77f'::uuid,
      NULL,
      true,
      900
    FROM fenrir f
    ON CONFLICT (achievement_key) DO UPDATE
      SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        achievement_kind = EXCLUDED.achievement_kind,
        character_id = EXCLUDED.character_id,
        category = EXCLUDED.category,
        type = EXCLUDED.type,
        target_value = EXCLUDED.target_value,
        rarity = EXCLUDED.rarity,
        reward_gems = EXCLUDED.reward_gems,
        reward_packs = EXCLUDED.reward_packs,
        reward_fate_coins = EXCLUDED.reward_fate_coins,
        reward_card_fragments = EXCLUDED.reward_card_fragments,
        reward_border_id = EXCLUDED.reward_border_id,
        icon_url = EXCLUDED.icon_url,
        is_active = EXCLUDED.is_active,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM achievements
    WHERE achievement_key = 'fenrir_devourers_surge_destroy_1000';
  `);

  pgm.sql(`
    DELETE FROM card_borders
    WHERE border_id = '7f52c228-04f6-4ac7-84d0-f5c1f98ce77f'::uuid;
  `);

  pgm.dropIndex("achievements", "character_id", {
    name: "achievements_character_id_active_idx",
    ifExists: true,
  });

  pgm.dropConstraint("achievements", "achievements_character_kind_check", {
    ifExists: true,
  });
  pgm.dropConstraint("achievements", "achievements_kind_check", {
    ifExists: true,
  });

  pgm.dropColumn("achievements", "character_id");
  pgm.dropColumn("achievements", "achievement_kind");
};
