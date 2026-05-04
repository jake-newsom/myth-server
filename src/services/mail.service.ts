import MailModel from "../models/mail.model";
import RewardService from "./reward.service";
import { mailRewardsToItems } from "../utils/rewards.helpers";
import { Mail, MailWithSender, MailStats } from "../types/database.types";
import { GrantedReward } from "../types/service.types";

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

interface ClaimRewardsResult {
  success: boolean;
  mail?: Mail;
  rewards_claimed?: {
    gems: number;
    packs: number;
    fate_coins: number;
    card_ids: string[];
    border_ids: string[];
    cards_awarded?: { user_card_instance_id: string; card_variant_id: string }[];
  };
  granted_items?: GrantedReward[];
  updated_currencies?: {
    gems: number;
    fate_coins: number;
    pack_count: number;
  };
  error?: string;
}

interface ClaimMultipleRewardsResult {
  success: boolean;
  claimed_mail: Mail[];
  total_rewards: {
    gold: number;
    gems: number;
    packs: number;
    fate_coins: number;
    card_ids: string[];
    border_ids: string[];
    cards_awarded?: { user_card_instance_id: string; card_variant_id: string }[];
  };
  granted_items?: GrantedReward[];
  updated_currencies?: {
    gems: number;
    fate_coins: number;
    pack_count: number;
  };
  failed_claims: string[];
  error?: string;
}

const MailService = {
  /**
   * Get user's mail with filters and pagination
   */
  async getUserMail(
    userId: string,
    filters: MailFilters = {},
    pagination: PaginationOptions = {}
  ): Promise<{
    success: boolean;
    mail: MailWithSender[];
    pagination: {
      total_count: number;
      page: number;
      limit: number;
      total_pages: number;
    };
    stats: MailStats;
  }> {
    try {
      const [mailResult, stats] = await Promise.all([
        MailModel.getUserMail(userId, filters, pagination),
        MailModel.getUserMailStats(userId),
      ]);

      return {
        success: true,
        mail: mailResult.mail,
        pagination: {
          total_count: mailResult.total_count,
          page: mailResult.page,
          limit: mailResult.limit,
          total_pages: mailResult.total_pages,
        },
        stats,
      };
    } catch (error) {
      console.error("Error fetching user mail:", error);
      return {
        success: false,
        mail: [],
        pagination: {
          total_count: 0,
          page: 1,
          limit: 20,
          total_pages: 0,
        },
        stats: {
          total_mail: 0,
          unread_mail: 0,
          unclaimed_rewards: 0,
          expired_mail: 0,
        },
      };
    }
  },

  /**
   * Get specific mail by ID
   */
  async getMailById(
    mailId: string,
    userId: string
  ): Promise<{
    success: boolean;
    mail?: MailWithSender;
    error?: string;
  }> {
    try {
      const mail = await MailModel.findByIdWithSender(mailId);

      if (!mail) {
        return {
          success: false,
          error: "Mail not found",
        };
      }

      if (mail.user_id !== userId) {
        return {
          success: false,
          error: "Access denied",
        };
      }

      return {
        success: true,
        mail,
      };
    } catch (error) {
      console.error("Error fetching mail by ID:", error);
      return {
        success: false,
        error: "Failed to fetch mail",
      };
    }
  },

  /**
   * Delete specific mail by ID
   */
  async deleteMail(
    mailId: string,
    userId: string
  ): Promise<{
    success: boolean;
    deleted_mail_id?: string;
    message?: string;
    error?: string;
  }> {
    try {
      const mail = await MailModel.findById(mailId);

      if (!mail) {
        return {
          success: false,
          error: "Mail not found",
        };
      }

      if (mail.user_id !== userId) {
        return {
          success: false,
          error: "Access denied",
        };
      }

      const deletedMail = await MailModel.deleteForUser(mailId, userId);

      if (!deletedMail) {
        return {
          success: false,
          error: "Failed to delete mail",
        };
      }

      return {
        success: true,
        deleted_mail_id: deletedMail.id,
        message: "Mail deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting mail:", error);
      return {
        success: false,
        error: "Failed to delete mail",
      };
    }
  },

  /**
   * Mark mail as read
   */
  async markAsRead(
    mailId: string,
    userId: string
  ): Promise<{
    success: boolean;
    mail?: Mail;
    error?: string;
  }> {
    try {
      const mail = await MailModel.markAsRead(mailId, userId);

      if (!mail) {
        return {
          success: false,
          error: "Mail not found or already read",
        };
      }

      return {
        success: true,
        mail,
      };
    } catch (error) {
      console.error("Error marking mail as read:", error);
      return {
        success: false,
        error: "Failed to mark mail as read",
      };
    }
  },

  /**
   * Mark multiple mail as read
   */
  async markMultipleAsRead(
    mailIds: string[],
    userId: string
  ): Promise<{
    success: boolean;
    marked_count: number;
    error?: string;
  }> {
    try {
      if (mailIds.length === 0) {
        return {
          success: true,
          marked_count: 0,
        };
      }

      const markedMail = await MailModel.markMultipleAsRead(mailIds, userId);

      return {
        success: true,
        marked_count: markedMail.length,
      };
    } catch (error) {
      console.error("Error marking multiple mail as read:", error);
      return {
        success: false,
        marked_count: 0,
        error: "Failed to mark mail as read",
      };
    }
  },

  /**
   * Mark all mail as read
   */
  async markAllAsRead(userId: string): Promise<{
    success: boolean;
    marked_count: number;
    error?: string;
  }> {
    try {
      const markedCount = await MailModel.markAllAsRead(userId);

      return {
        success: true,
        marked_count: markedCount,
      };
    } catch (error) {
      console.error("Error marking all mail as read:", error);
      return {
        success: false,
        marked_count: 0,
        error: "Failed to mark all mail as read",
      };
    }
  },

  /**
   * Claim rewards from a mail
   */
  async claimRewards(
    mailId: string,
    userId: string
  ): Promise<ClaimRewardsResult> {
    try {
      // First verify the mail exists and has claimable rewards
      const mail = await MailModel.findById(mailId);

      if (!mail) {
        return {
          success: false,
          error: "Mail not found",
        };
      }

      if (mail.user_id !== userId) {
        return {
          success: false,
          error: "Access denied",
        };
      }

      if (!mail.has_rewards) {
        return {
          success: false,
          error: "This mail has no rewards",
        };
      }

      if (mail.is_claimed) {
        return {
          success: false,
          error: "Rewards already claimed",
        };
      }

      if (mail.expires_at && new Date(mail.expires_at) < new Date()) {
        return {
          success: false,
          error: "Mail has expired",
        };
      }

      // Claim the rewards in mail table
      const claimedMail = await MailModel.claimRewards(mailId, userId);

      if (!claimedMail) {
        return {
          success: false,
          error: "Failed to claim rewards",
        };
      }

      const items = mailRewardsToItems(claimedMail);
      const grantResult = await RewardService.grantRewards(userId, items);

      if (!grantResult.success) {
        return {
          success: false,
          mail: claimedMail,
          error: grantResult.error || "Failed to apply rewards to user",
        };
      }

      const cardsAwarded = grantResult.granted
        .filter(
          (g): g is GrantedReward & { user_card_instance_id: string } =>
            g.item.type === "card" && !!g.user_card_instance_id
        )
        .map((g) => ({
          user_card_instance_id: g.user_card_instance_id,
          card_variant_id:
            g.item.type === "card" ? g.item.card_variant_id : "",
        }));

      return {
        success: true,
        mail: claimedMail,
        rewards_claimed: {
          gems: claimedMail.reward_gems,
          packs: claimedMail.reward_packs,
          fate_coins: claimedMail.reward_fate_coins,
          card_ids: claimedMail.reward_card_ids,
          border_ids: claimedMail.reward_border_id
            ? [claimedMail.reward_border_id]
            : [],
          cards_awarded: cardsAwarded.length > 0 ? cardsAwarded : undefined,
        },
        granted_items: grantResult.granted,
        updated_currencies: grantResult.updated_currencies
          ? {
              gems: grantResult.updated_currencies.gems,
              fate_coins: grantResult.updated_currencies.fate_coins,
              pack_count: grantResult.updated_currencies.pack_count,
            }
          : undefined,
      };
    } catch (error) {
      console.error("Error claiming mail rewards:", error);
      return {
        success: false,
        error: "Failed to claim rewards",
      };
    }
  },

  /**
   * Claim all available rewards
   */
  async claimAllRewards(userId: string): Promise<ClaimMultipleRewardsResult> {
    try {
      const claimableMail = await MailModel.getClaimableMail(userId);

      if (claimableMail.length === 0) {
        return {
          success: true,
          claimed_mail: [],
          total_rewards: {
            gold: 0,
            gems: 0,
            packs: 0,
            fate_coins: 0,
            card_ids: [],
            border_ids: [],
          },
          failed_claims: [],
        };
      }

      const claimedMail: Mail[] = [];
      const failedClaims: string[] = [];
      const totalRewards = {
        gold: 0,
        gems: 0,
        packs: 0,
        fate_coins: 0,
        card_ids: [] as string[],
        border_ids: [] as string[],
      };

      // First pass: mark each mail as claimed and aggregate the reward
      // payload. We defer all currency/card/border granting until after the
      // loop so RewardService can apply them in a single batched transaction.
      for (const mail of claimableMail) {
        try {
          const claimedSingle = await MailModel.claimRewards(mail.id, userId);
          if (claimedSingle) {
            claimedMail.push(claimedSingle);
            totalRewards.gold += claimedSingle.reward_gold;
            totalRewards.gems += claimedSingle.reward_gems;
            totalRewards.packs += claimedSingle.reward_packs;
            totalRewards.fate_coins += claimedSingle.reward_fate_coins;
            totalRewards.card_ids.push(...claimedSingle.reward_card_ids);
            if (claimedSingle.reward_border_id) {
              totalRewards.border_ids.push(claimedSingle.reward_border_id);
            }
          } else {
            failedClaims.push(mail.id);
          }
        } catch (error) {
          console.error(`Failed to claim mail ${mail.id}:`, error);
          failedClaims.push(mail.id);
        }
      }

      const items = claimedMail.flatMap(mailRewardsToItems);
      const grantResult = await RewardService.grantRewards(userId, items);

      const allCardsAwarded = grantResult.granted
        .filter(
          (g): g is GrantedReward & { user_card_instance_id: string } =>
            g.item.type === "card" && !!g.user_card_instance_id
        )
        .map((g) => ({
          user_card_instance_id: g.user_card_instance_id,
          card_variant_id:
            g.item.type === "card" ? g.item.card_variant_id : "",
        }));

      return {
        success: grantResult.success,
        claimed_mail: claimedMail,
        total_rewards: {
          ...totalRewards,
          cards_awarded:
            allCardsAwarded.length > 0 ? allCardsAwarded : undefined,
        },
        granted_items: grantResult.granted,
        updated_currencies: grantResult.updated_currencies
          ? {
              gems: grantResult.updated_currencies.gems,
              fate_coins: grantResult.updated_currencies.fate_coins,
              pack_count: grantResult.updated_currencies.pack_count,
            }
          : undefined,
        failed_claims: failedClaims,
      };
    } catch (error) {
      console.error("Error claiming all rewards:", error);
      return {
        success: false,
        claimed_mail: [],
        total_rewards: {
          gold: 0,
          gems: 0,
          packs: 0,
          fate_coins: 0,
          card_ids: [],
          border_ids: [],
        },
        failed_claims: [],
        error: "Failed to claim rewards",
      };
    }
  },

  /**
   * Get mail statistics
   */
  async getMailStats(userId: string): Promise<{
    success: boolean;
    stats: MailStats;
  }> {
    try {
      const stats = await MailModel.getUserMailStats(userId);

      return {
        success: true,
        stats,
      };
    } catch (error) {
      console.error("Error fetching mail stats:", error);
      return {
        success: false,
        stats: {
          total_mail: 0,
          unread_mail: 0,
          unclaimed_rewards: 0,
          expired_mail: 0,
        },
      };
    }
  },

  /**
   * Get recent mail
   */
  async getRecentMail(
    userId: string,
    limit: number = 10
  ): Promise<{
    success: boolean;
    mail: MailWithSender[];
  }> {
    try {
      const mail = await MailModel.getRecentMail(userId, limit);

      return {
        success: true,
        mail,
      };
    } catch (error) {
      console.error("Error fetching recent mail:", error);
      return {
        success: false,
        mail: [],
      };
    }
  },

  /**
   * Send system notification
   */
  async sendSystemNotification(
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
  ): Promise<{
    success: boolean;
    mail?: Mail;
    error?: string;
  }> {
    try {
      const mail = await MailModel.sendSystemMail(
        userId,
        subject,
        content,
        rewards,
        expiresInDays
      );

      return {
        success: true,
        mail,
      };
    } catch (error) {
      console.error("Error sending system notification:", error);
      return {
        success: false,
        error: "Failed to send notification",
      };
    }
  },

  /**
   * Send welcome mail to new user
   */
  async sendWelcomeMail(
    userId: string,
    username: string
  ): Promise<{
    success: boolean;
    mail?: Mail;
    error?: string;
  }> {
    try {
      const mail = await MailModel.sendWelcomeMail(userId, username);

      return {
        success: true,
        mail,
      };
    } catch (error) {
      console.error("Error sending welcome mail:", error);
      return {
        success: false,
        error: "Failed to send welcome mail",
      };
    }
  },

  /**
   * Send achievement notification mail
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
  ): Promise<{
    success: boolean;
    mail?: Mail;
    error?: string;
  }> {
    try {
      const mail = await MailModel.sendAchievementMail(
        userId,
        achievementTitle,
        achievementDescription,
        rewards
      );

      return {
        success: true,
        mail,
      };
    } catch (error) {
      console.error("Error sending achievement mail:", error);
      return {
        success: false,
        error: "Failed to send achievement mail",
      };
    }
  },

  /**
   * Send friend request notification
   */
  async sendFriendRequestNotification(
    userId: string,
    senderUsername: string,
    senderId: string
  ): Promise<{
    success: boolean;
    mail?: Mail;
    error?: string;
  }> {
    try {
      const mail = await MailModel.sendFriendRequestMail(
        userId,
        senderUsername,
        senderId
      );

      return {
        success: true,
        mail,
      };
    } catch (error) {
      console.error("Error sending friend request notification:", error);
      return {
        success: false,
        error: "Failed to send friend request notification",
      };
    }
  },

  /**
   * Clean up expired mail
   */
  async cleanupExpiredMail(): Promise<{
    success: boolean;
    cleaned_count: number;
  }> {
    try {
      const cleanedCount = await MailModel.cleanupExpiredMail();

      return {
        success: true,
        cleaned_count: cleanedCount,
      };
    } catch (error) {
      console.error("Error cleaning up expired mail:", error);
      return {
        success: false,
        cleaned_count: 0,
      };
    }
  },

  /**
   * Get unread and unclaimed counts for user
   */
  async getMailCounts(userId: string): Promise<{
    success: boolean;
    unread_count: number;
    unclaimed_rewards_count: number;
    total_count: number;
  }> {
    try {
      const [unreadCount, unclaimedCount, totalCount] = await Promise.all([
        MailModel.getUnreadCount(userId),
        MailModel.getUnclaimedRewardsCount(userId),
        MailModel.getTotalCount(userId),
      ]);

      return {
        success: true,
        unread_count: unreadCount,
        unclaimed_rewards_count: unclaimedCount,
        total_count: totalCount,
      };
    } catch (error) {
      console.error("Error fetching mail counts:", error);
      return {
        success: false,
        unread_count: 0,
        unclaimed_rewards_count: 0,
        total_count: 0,
      };
    }
  },
};

export default MailService;
