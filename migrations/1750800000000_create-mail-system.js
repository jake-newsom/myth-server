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
  // Create the mail table for user inbox system
  pgm.createTable("mail", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    mail_type: {
      type: "varchar(50)",
      notNull: true,
      default: "system",
    },
    subject: {
      type: "varchar(255)",
      notNull: true,
    },
    content: {
      type: "text",
      notNull: true,
    },
    sender_id: {
      type: "uuid",
      references: "users(user_id)",
      onDelete: "SET NULL",
    },
    sender_name: {
      type: "varchar(100)",
      notNull: true,
      default: "System",
    },
    is_read: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    is_claimed: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    has_rewards: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    reward_gold: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    reward_gems: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    reward_packs: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    reward_fate_coins: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    reward_card_ids: {
      type: "text[]",
      notNull: true,
      default: "'{}'",
    },
    expires_at: {
      type: "timestamp with time zone",
    },
    read_at: {
      type: "timestamp with time zone",
    },
    claimed_at: {
      type: "timestamp with time zone",
    },
    created_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Add indexes for better query performance
  pgm.createIndex("mail", "user_id");
  pgm.createIndex("mail", "mail_type");
  pgm.createIndex("mail", "is_read");
  pgm.createIndex("mail", "has_rewards");
  pgm.createIndex("mail", "is_claimed");
  pgm.createIndex("mail", "expires_at");
  pgm.createIndex("mail", "created_at");
  pgm.createIndex("mail", ["user_id", "is_read"]);
  pgm.createIndex("mail", ["user_id", "has_rewards", "is_claimed"]);

  // Add constraint to ensure mail_type is valid
  pgm.addConstraint("mail", "mail_type_check", {
    check:
      "mail_type IN ('system', 'achievement', 'friend', 'admin', 'event', 'welcome', 'reward')",
  });

  // Add constraint to ensure reward amounts are non-negative
  pgm.addConstraint("mail", "reward_gold_check", {
    check: "reward_gold >= 0",
  });
  pgm.addConstraint("mail", "reward_gems_check", {
    check: "reward_gems >= 0",
  });
  pgm.addConstraint("mail", "reward_packs_check", {
    check: "reward_packs >= 0",
  });
  pgm.addConstraint("mail", "reward_fate_coins_check", {
    check: "reward_fate_coins >= 0",
  });

  // Add constraint to ensure has_rewards is consistent with actual rewards
  pgm.addConstraint("mail", "has_rewards_consistency_check", {
    check: `
      (has_rewards = false AND reward_gold = 0 AND reward_gems = 0 AND reward_packs = 0 AND reward_fate_coins = 0 AND array_length(reward_card_ids, 1) IS NULL) OR
      (has_rewards = true AND (reward_gold > 0 OR reward_gems > 0 OR reward_packs > 0 OR reward_fate_coins > 0 OR array_length(reward_card_ids, 1) > 0))
    `,
  });

  // Create trigger to update updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_mail_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.createTrigger("mail", "update_mail_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    function: "update_mail_updated_at",
  });

  // Create trigger to set read_at timestamp when is_read changes to true
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_mail_read_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.is_read = true AND OLD.is_read = false THEN
        NEW.read_at = NOW();
      END IF;
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.createTrigger("mail", "set_mail_read_at", {
    when: "BEFORE",
    operation: "UPDATE",
    function: "set_mail_read_at",
  });

  // Create trigger to set claimed_at timestamp when is_claimed changes to true
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_mail_claimed_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.is_claimed = true AND OLD.is_claimed = false THEN
        NEW.claimed_at = NOW();
      END IF;
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.createTrigger("mail", "set_mail_claimed_at", {
    when: "BEFORE",
    operation: "UPDATE",
    function: "set_mail_claimed_at",
  });

  // Create function to get user mail statistics
  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_user_mail_stats(p_user_id UUID)
    RETURNS TABLE (
      total_mail INTEGER,
      unread_mail INTEGER,
      unclaimed_rewards INTEGER,
      expired_mail INTEGER
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT 
        COUNT(*)::INTEGER as total_mail,
        COUNT(CASE WHEN is_read = false THEN 1 END)::INTEGER as unread_mail,
        COUNT(CASE WHEN has_rewards = true AND is_claimed = false AND (expires_at IS NULL OR expires_at > NOW()) THEN 1 END)::INTEGER as unclaimed_rewards,
        COUNT(CASE WHEN expires_at IS NOT NULL AND expires_at <= NOW() THEN 1 END)::INTEGER as expired_mail
      FROM mail
      WHERE user_id = p_user_id;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create function to clean up old expired mail
  pgm.sql(`
    CREATE OR REPLACE FUNCTION cleanup_expired_mail()
    RETURNS INTEGER AS $$
    DECLARE
      deleted_count INTEGER;
    BEGIN
      DELETE FROM mail 
      WHERE expires_at IS NOT NULL 
        AND expires_at < NOW() - INTERVAL '30 days'
        AND (is_claimed = true OR has_rewards = false);
      
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop functions
  pgm.dropFunction("cleanup_expired_mail", []);
  pgm.dropFunction("get_user_mail_stats", ["UUID"]);

  // Drop triggers
  pgm.dropTrigger("mail", "set_mail_claimed_at");
  pgm.dropTrigger("mail", "set_mail_read_at");
  pgm.dropTrigger("mail", "update_mail_updated_at");

  // Drop trigger functions
  pgm.dropFunction("set_mail_claimed_at", []);
  pgm.dropFunction("set_mail_read_at", []);
  pgm.dropFunction("update_mail_updated_at", []);

  // Drop table (will automatically drop indexes and constraints)
  pgm.dropTable("mail");
};
