import db from "../config/db.config";
import { Mail, MailWithSender, MailStats } from "../types/database.types";

interface CreateMailInput {
  user_id: string;
  mail_type?:
    | "system"
    | "achievement"
    | "friend"
    | "admin"
    | "event"
    | "welcome"
    | "reward";
  subject: string;
  content: string;
  sender_id?: string;
  sender_name?: string;
  has_rewards?: boolean;
  reward_gold?: number;
  reward_gems?: number;
  reward_packs?: number;
  reward_fate_coins?: number;
  reward_card_ids?: string[];
  expires_at?: Date;
}

interface MailFilters {
  mail_type?: string;
  is_read?: boolean;
  has_rewards?: boolean;
  is_claimed?: boolean;
  include_expired?: boolean;
}

interface PaginationOptions {
  page?: number;
  limit?: number;
  sort_by?: "created_at" | "updated_at" | "expires_at";
  sort_order?: "ASC" | "DESC";
}

const MailModel = {
  /**
   * Create a new mail entry
   */
  async create(mailData: CreateMailInput): Promise<Mail> {
    const {
      user_id,
      mail_type = "system",
      subject,
      content,
      sender_id = null,
      sender_name = "System",
      has_rewards = false,
      reward_gold = 0,
      reward_gems = 0,
      reward_packs = 0,
      reward_fate_coins = 0,
      reward_card_ids = [],
      expires_at = null,
    } = mailData;

    const query = `
      INSERT INTO mail (
        user_id, mail_type, subject, content, sender_id, sender_name,
        has_rewards, reward_gold, reward_gems, reward_packs, reward_fate_coins,
        reward_card_ids, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;

    const values = [
      user_id,
      mail_type,
      subject,
      content,
      sender_id,
      sender_name,
      has_rewards,
      reward_gold,
      reward_gems,
      reward_packs,
      reward_fate_coins,
      reward_card_ids,
      expires_at,
    ];

    const { rows } = await db.query(query, values);
    return rows[0];
  },

  /**
   * Get mail by ID
   */
  async findById(mailId: string): Promise<Mail | null> {
    const query = `SELECT * FROM mail WHERE id = $1;`;
    const { rows } = await db.query(query, [mailId]);
    return rows[0] || null;
  },

  /**
   * Get mail by ID with sender information
   */
  async findByIdWithSender(mailId: string): Promise<MailWithSender | null> {
    const query = `
      SELECT 
        m.*,
        u.username as sender_username
      FROM mail m
      LEFT JOIN users u ON m.sender_id = u.user_id
      WHERE m.id = $1;
    `;
    const { rows } = await db.query(query, [mailId]);
    return rows[0] || null;
  },

  /**
   * Get user's mail with optional filters and pagination
   */
  async getUserMail(
    userId: string,
    filters: MailFilters = {},
    pagination: PaginationOptions = {}
  ): Promise<{
    mail: MailWithSender[];
    total_count: number;
    page: number;
    limit: number;
    total_pages: number;
  }> {
    const {
      mail_type,
      is_read,
      has_rewards,
      is_claimed,
      include_expired = false,
    } = filters;

    const {
      page = 1,
      limit = 20,
      sort_by = "created_at",
      sort_order = "DESC",
    } = pagination;

    const offset = (page - 1) * limit;

    // Build WHERE clause
    const whereConditions = ["m.user_id = $1"];
    const queryParams: any[] = [userId];
    let paramIndex = 2;

    if (mail_type) {
      whereConditions.push(`m.mail_type = $${paramIndex}`);
      queryParams.push(mail_type);
      paramIndex++;
    }

    if (is_read !== undefined) {
      whereConditions.push(`m.is_read = $${paramIndex}`);
      queryParams.push(is_read);
      paramIndex++;
    }

    if (has_rewards !== undefined) {
      whereConditions.push(`m.has_rewards = $${paramIndex}`);
      queryParams.push(has_rewards);
      paramIndex++;
    }

    if (is_claimed !== undefined) {
      whereConditions.push(`m.is_claimed = $${paramIndex}`);
      queryParams.push(is_claimed);
      paramIndex++;
    }

    if (!include_expired) {
      whereConditions.push(`(m.expires_at IS NULL OR m.expires_at > NOW())`);
    }

    const whereClause = whereConditions.join(" AND ");

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total_count
      FROM mail m
      WHERE ${whereClause};
    `;

    // Main query
    const mainQuery = `
      SELECT 
        m.*,
        u.username as sender_username
      FROM mail m
      LEFT JOIN users u ON m.sender_id = u.user_id
      WHERE ${whereClause}
      ORDER BY m.${sort_by} ${sort_order}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;

    queryParams.push(limit, offset);

    const [countResult, mailResult] = await Promise.all([
      db.query(countQuery, queryParams.slice(0, -2)),
      db.query(mainQuery, queryParams),
    ]);

    const total_count = parseInt(countResult.rows[0].total_count);
    const total_pages = Math.ceil(total_count / limit);

    return {
      mail: mailResult.rows,
      total_count,
      page,
      limit,
      total_pages,
    };
  },

  /**
   * Mark mail as read
   */
  async markAsRead(mailId: string, userId: string): Promise<Mail | null> {
    const query = `
      UPDATE mail 
      SET is_read = true
      WHERE id = $1 AND user_id = $2 AND is_read = false
      RETURNING *;
    `;
    const { rows } = await db.query(query, [mailId, userId]);
    return rows[0] || null;
  },

  /**
   * Mark multiple mail as read
   */
  async markMultipleAsRead(mailIds: string[], userId: string): Promise<Mail[]> {
    if (mailIds.length === 0) return [];

    const placeholders = mailIds.map((_, index) => `$${index + 2}`).join(", ");
    const query = `
      UPDATE mail 
      SET is_read = true
      WHERE id IN (${placeholders}) AND user_id = $1 AND is_read = false
      RETURNING *;
    `;
    const { rows } = await db.query(query, [userId, ...mailIds]);
    return rows;
  },

  /**
   * Mark all user's mail as read
   */
  async markAllAsRead(userId: string): Promise<number> {
    const query = `
      UPDATE mail 
      SET is_read = true
      WHERE user_id = $1 AND is_read = false
      RETURNING id;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows.length;
  },

  /**
   * Claim mail rewards
   */
  async claimRewards(mailId: string, userId: string): Promise<Mail | null> {
    const query = `
      UPDATE mail 
      SET is_claimed = true
      WHERE id = $1 AND user_id = $2 AND has_rewards = true AND is_claimed = false
        AND (expires_at IS NULL OR expires_at > NOW())
      RETURNING *;
    `;
    const { rows } = await db.query(query, [mailId, userId]);
    return rows[0] || null;
  },

  /**
   * Get claimable mail with rewards
   */
  async getClaimableMail(userId: string): Promise<MailWithSender[]> {
    const query = `
      SELECT 
        m.*,
        u.username as sender_username
      FROM mail m
      LEFT JOIN users u ON m.sender_id = u.user_id
      WHERE m.user_id = $1 
        AND m.has_rewards = true 
        AND m.is_claimed = false
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
      ORDER BY m.created_at ASC;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
  },

  /**
   * Get mail statistics for a user
   */
  async getUserMailStats(userId: string): Promise<MailStats> {
    const query = `SELECT * FROM get_user_mail_stats($1);`;
    const { rows } = await db.query(query, [userId]);
    return rows[0];
  },

  /**
   * Delete mail (only for system cleanup)
   */
  async delete(mailId: string): Promise<boolean> {
    const query = `DELETE FROM mail WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(query, [mailId]);
    return rows.length > 0;
  },

  /**
   * Delete expired mail that has been claimed or has no rewards
   */
  async cleanupExpiredMail(): Promise<number> {
    const query = `
      DELETE FROM mail 
      WHERE expires_at IS NOT NULL 
        AND expires_at < NOW() 
        AND (is_claimed = true OR has_rewards = false)
      RETURNING id;
    `;
    const { rows } = await db.query(query);
    return rows.length;
  },

  /**
   * Get recent mail for a user (last 30 days)
   */
  async getRecentMail(
    userId: string,
    limit: number = 10
  ): Promise<MailWithSender[]> {
    const query = `
      SELECT 
        m.*,
        u.username as sender_username
      FROM mail m
      LEFT JOIN users u ON m.sender_id = u.user_id
      WHERE m.user_id = $1 
        AND m.created_at > NOW() - INTERVAL '30 days'
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
      ORDER BY m.created_at DESC
      LIMIT $2;
    `;
    const { rows } = await db.query(query, [userId, limit]);
    return rows;
  },

  /**
   * Send system mail to a user
   */
  async sendSystemMail(
    userId: string,
    subject: string,
    content: string,
    rewards?: {
      gold?: number;
      gems?: number;
      packs?: number;
      fate_coins?: number;
      card_ids?: string[];
    },
    expiresInDays?: number
  ): Promise<Mail> {
    const has_rewards =
      rewards &&
      Object.values(rewards).some((v) =>
        Array.isArray(v) ? v.length > 0 : v && v > 0
      );

    const expires_at = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    return await this.create({
      user_id: userId,
      mail_type: "system",
      subject,
      content,
      sender_name: "System",
      has_rewards: has_rewards || false,
      reward_gold: rewards?.gold || 0,
      reward_gems: rewards?.gems || 0,
      reward_packs: rewards?.packs || 0,
      reward_fate_coins: rewards?.fate_coins || 0,
      reward_card_ids: rewards?.card_ids || [],
      expires_at,
    });
  },

  /**
   * Send achievement mail to a user
   */
  async sendAchievementMail(
    userId: string,
    achievementTitle: string,
    achievementDescription: string,
    rewards: {
      gold?: number;
      gems?: number;
      packs?: number;
    }
  ): Promise<Mail> {
    const subject = `🏆 Achievement Unlocked: ${achievementTitle}`;
    const content = `Congratulations! You've unlocked the "${achievementTitle}" achievement.\n\n${achievementDescription}\n\nYour rewards are attached to this message.`;

    return await this.create({
      user_id: userId,
      mail_type: "achievement",
      subject,
      content,
      sender_name: "Achievement System",
      has_rewards: true,
      reward_gold: rewards.gold || 0,
      reward_gems: rewards.gems || 0,
      reward_packs: rewards.packs || 0,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });
  },

  /**
   * Send welcome mail to new users
   */
  async sendWelcomeMail(userId: string, username: string): Promise<Mail> {
    const subject = "🎉 Welcome to the Vue Card Game!";
    const content = `Welcome ${username}!\n\nThank you for joining the Vue Card Game community. Here's a starter pack to help you begin your journey!\n\nEnjoy collecting cards, battling other players, and climbing the leaderboards.\n\nGood luck, and have fun!`;

    return await this.create({
      user_id: userId,
      mail_type: "welcome",
      subject,
      content,
      sender_name: "VCG Team",
      has_rewards: true,
      reward_gold: 200,
      reward_gems: 10,
      reward_packs: 2,
      reward_fate_coins: 5,
    });
  },

  /**
   * Send friend request notification mail
   */
  async sendFriendRequestMail(
    userId: string,
    senderUsername: string,
    senderId: string
  ): Promise<Mail> {
    const subject = `👋 Friend Request from ${senderUsername}`;
    const content = `${senderUsername} has sent you a friend request! You can accept or decline it from your friends list.`;

    return await this.create({
      user_id: userId,
      mail_type: "friend",
      subject,
      content,
      sender_id: senderId,
      sender_name: senderUsername,
      has_rewards: false,
    });
  },

  /**
   * Get unread mail count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count 
      FROM mail 
      WHERE user_id = $1 
        AND is_read = false 
        AND (expires_at IS NULL OR expires_at > NOW());
    `;
    const { rows } = await db.query(query, [userId]);
    return parseInt(rows[0].count);
  },

  /**
   * Get unclaimed rewards count for a user
   */
  async getUnclaimedRewardsCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count 
      FROM mail 
      WHERE user_id = $1 
        AND has_rewards = true 
        AND is_claimed = false 
        AND (expires_at IS NULL OR expires_at > NOW());
    `;
    const { rows } = await db.query(query, [userId]);
    return parseInt(rows[0].count);
  },
};

export default MailModel;
