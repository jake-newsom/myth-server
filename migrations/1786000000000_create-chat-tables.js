/**
 * Chat feature: messages, per-user chat state, and abuse reports.
 *
 * Channel addressing is (channel_type, channel_key) from day one so that
 * guild/regional channels can ship later without migrating existing rows.
 * `channel_key` is NULL for global and deliberately not a FK to guilds --
 * guilds do not exist yet, and entitlement is enforced by the server-side
 * channel resolver rather than by referential integrity.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createType("chat_channel_type", ["global", "guild", "system"]);
  pgm.createType("chat_message_kind", [
    "text",
    "card_share",
    "pack_pull",
    "system_announcement",
  ]);

  pgm.createTable("chat_messages", {
    message_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    // --- Channel addressing (forward-compatible) ---
    channel_type: { type: "chat_channel_type", notNull: true },
    // NULL for global. For guild: the guild_id. Later: region code, etc.
    channel_key: { type: "text", notNull: false },

    // --- Author ---
    // NULL sender => server-authored (system_announcement, future bots).
    sender_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
      notNull: false,
    },
    // Denormalized so history still renders after a rename or account
    // deletion (ON DELETE SET NULL would otherwise erase attribution).
    sender_username: { type: "text", notNull: false },

    // --- Body ---
    kind: { type: "chat_message_kind", notNull: true, default: "text" },
    // Raw, unfiltered text. Masking is a render-time concern so that
    // moderation review sees what was actually said.
    body: { type: "text", notNull: false },
    // Kind-specific snapshot (card stats at share time, etc).
    payload: { type: "jsonb", notNull: false },

    // --- Moderation ---
    is_deleted: { type: "boolean", notNull: true, default: false },
    deleted_by: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
      notNull: false,
    },
    deleted_at: { type: "timestamptz", notNull: false },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // Primary read path: newest-N within a channel.
  pgm.createIndex(
    "chat_messages",
    ["channel_type", "channel_key", "created_at"],
    { name: "chat_messages_channel_recent_idx" }
  );
  // Moderation / rate-limit lookback by author.
  pgm.createIndex("chat_messages", ["sender_id", "created_at"]);
  // Retention sweeper.
  pgm.createIndex("chat_messages", "created_at");

  pgm.createTable("chat_user_state", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users",
      onDelete: "CASCADE",
    },
    profanity_filter_enabled: { type: "boolean", notNull: true, default: true },
    muted_until: { type: "timestamptz", notNull: false },
    muted_reason: { type: "text", notNull: false },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("chat_reports", {
    report_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    message_id: {
      type: "uuid",
      notNull: true,
      references: "chat_messages",
      onDelete: "CASCADE",
    },
    reporter_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    reason: { type: "text", notNull: false },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // One report per user per message; a repeat report is a no-op upsert
  // rather than a way to inflate a report count.
  pgm.addConstraint(
    "chat_reports",
    "chat_reports_unique_reporter_message",
    "UNIQUE (message_id, reporter_id)"
  );
  pgm.createIndex("chat_reports", "created_at");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("chat_reports");
  pgm.dropTable("chat_user_state");
  pgm.dropTable("chat_messages");
  pgm.dropType("chat_message_kind");
  pgm.dropType("chat_channel_type");
};
