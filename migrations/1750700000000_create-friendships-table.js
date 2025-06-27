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
  // Create the friendships table
  pgm.createTable("friendships", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    requester_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    addressee_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "pending",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Add constraints
  pgm.addConstraint("friendships", "friendships_status_check", {
    check: "status IN ('pending', 'accepted', 'rejected', 'blocked')",
  });

  // Prevent users from friending themselves
  pgm.addConstraint("friendships", "friendships_no_self_friend", {
    check: "requester_id != addressee_id",
  });

  // Prevent duplicate friendship requests (regardless of direction)
  pgm.createIndex("friendships", ["requester_id", "addressee_id"], {
    unique: true,
    name: "friendships_unique_pair",
  });

  // Add indexes for efficient queries
  pgm.createIndex("friendships", "requester_id");
  pgm.createIndex("friendships", "addressee_id");
  pgm.createIndex("friendships", "status");
  pgm.createIndex("friendships", ["requester_id", "status"]);
  pgm.createIndex("friendships", ["addressee_id", "status"]);

  // Create a function to prevent bidirectional duplicates
  pgm.sql(`
    CREATE OR REPLACE FUNCTION prevent_duplicate_friendships()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Check if there's already a friendship request in either direction
      IF EXISTS (
        SELECT 1 FROM friendships 
        WHERE (requester_id = NEW.requester_id AND addressee_id = NEW.addressee_id)
           OR (requester_id = NEW.addressee_id AND addressee_id = NEW.requester_id)
      ) THEN
        RAISE EXCEPTION 'Friendship already exists between these users';
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create trigger to prevent bidirectional duplicates
  pgm.sql(`
    CREATE TRIGGER prevent_duplicate_friendships_trigger
    BEFORE INSERT ON friendships
    FOR EACH ROW
    EXECUTE FUNCTION prevent_duplicate_friendships();
  `);

  // Create function to update updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_friendship_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create trigger to automatically update updated_at
  pgm.sql(`
    CREATE TRIGGER update_friendship_updated_at_trigger
    BEFORE UPDATE ON friendships
    FOR EACH ROW
    EXECUTE FUNCTION update_friendship_updated_at();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop triggers first
  pgm.sql(
    "DROP TRIGGER IF EXISTS update_friendship_updated_at_trigger ON friendships;"
  );
  pgm.sql(
    "DROP TRIGGER IF EXISTS prevent_duplicate_friendships_trigger ON friendships;"
  );

  // Drop functions
  pgm.sql("DROP FUNCTION IF EXISTS update_friendship_updated_at();");
  pgm.sql("DROP FUNCTION IF EXISTS prevent_duplicate_friendships();");

  // Drop the table (this will also drop indexes and constraints)
  pgm.dropTable("friendships");
};
