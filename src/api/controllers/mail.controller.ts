import { Request, Response } from "express";
import MailService from "../../services/mail.service";
import { AuthenticatedRequest } from "../../types";

/**
 * Get user's mail with optional filters and pagination
 */
export const getUserMail = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to view your mail",
        },
      });
    }

    // Parse query parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit as string) || 20)
    );
    const mail_type = req.query.mail_type as string;
    const is_read =
      req.query.is_read === "true"
        ? true
        : req.query.is_read === "false"
        ? false
        : undefined;
    const has_rewards =
      req.query.has_rewards === "true"
        ? true
        : req.query.has_rewards === "false"
        ? false
        : undefined;
    const is_claimed =
      req.query.is_claimed === "true"
        ? true
        : req.query.is_claimed === "false"
        ? false
        : undefined;
    const include_expired = req.query.include_expired === "true";
    const sort_by = (req.query.sort_by as string) || "created_at";
    const sort_order = (req.query.sort_order as string) || "DESC";

    // Validate sort_by parameter
    const validSortFields = ["created_at", "updated_at", "expires_at"];
    if (!validSortFields.includes(sort_by)) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Invalid sort field",
          suggestion: `Sort by must be one of: ${validSortFields.join(", ")}`,
        },
      });
    }

    // Validate sort_order parameter
    if (!["ASC", "DESC"].includes(sort_order)) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Invalid sort order",
          suggestion: "Sort order must be ASC or DESC",
        },
      });
    }

    const filters = {
      mail_type,
      is_read,
      has_rewards,
      is_claimed,
      include_expired,
    };

    const pagination = {
      page,
      limit,
      sort_by: sort_by as "created_at" | "updated_at" | "expires_at",
      sort_order: sort_order as "ASC" | "DESC",
    };

    const result = await MailService.getUserMail(userId, filters, pagination);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching user mail:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "MAIL_ERROR",
        message: "Failed to fetch mail",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get specific mail by ID
 */
export const getMailById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to view mail",
        },
      });
    }

    const { mailId } = req.params;

    if (!mailId) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Mail ID is required",
          suggestion: "Provide a valid mail ID",
        },
      });
    }

    const result = await MailService.getMailById(mailId, userId);

    if (!result.success) {
      const statusCode =
        result.error === "Mail not found"
          ? 404
          : result.error === "Access denied"
          ? 403
          : 400;
      return res.status(statusCode).json({
        success: false,
        error: {
          type: "MAIL_ERROR",
          message: result.error,
          suggestion: "Please check the mail ID and try again",
        },
      });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching mail by ID:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "MAIL_ERROR",
        message: "Failed to fetch mail",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Mark mail as read
 */
export const markAsRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to mark mail as read",
        },
      });
    }

    const { mailId } = req.params;

    if (!mailId) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Mail ID is required",
          suggestion: "Provide a valid mail ID",
        },
      });
    }

    const result = await MailService.markAsRead(mailId, userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          type: "MAIL_ERROR",
          message: result.error,
          suggestion: "Please check the mail ID and try again",
        },
      });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("Error marking mail as read:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "MAIL_ERROR",
        message: "Failed to mark mail as read",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Mark multiple mail as read
 */
export const markMultipleAsRead = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to mark mail as read",
        },
      });
    }

    const { mailIds } = req.body;

    if (!Array.isArray(mailIds)) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Mail IDs must be an array",
          suggestion: "Provide an array of mail IDs",
        },
      });
    }

    if (mailIds.length > 100) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Too many mail IDs",
          suggestion: "Maximum 100 mail IDs per request",
        },
      });
    }

    const result = await MailService.markMultipleAsRead(mailIds, userId);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error marking multiple mail as read:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "MAIL_ERROR",
        message: "Failed to mark mail as read",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Mark all mail as read
 */
export const markAllAsRead = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to mark mail as read",
        },
      });
    }

    const result = await MailService.markAllAsRead(userId);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error marking all mail as read:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "MAIL_ERROR",
        message: "Failed to mark all mail as read",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Claim rewards from a mail
 */
export const claimRewards = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to claim rewards",
        },
      });
    }

    const { mailId } = req.params;

    if (!mailId) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Mail ID is required",
          suggestion: "Provide a valid mail ID",
        },
      });
    }

    const result = await MailService.claimRewards(mailId, userId);

    if (!result.success) {
      const statusCode =
        result.error === "Mail not found"
          ? 404
          : result.error === "Access denied"
          ? 403
          : result.error === "Mail has expired"
          ? 410
          : 400;
      return res.status(statusCode).json({
        success: false,
        error: {
          type: "CLAIM_ERROR",
          message: result.error,
          suggestion: "Please check the mail and try again",
        },
      });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("Error claiming mail rewards:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "CLAIM_ERROR",
        message: "Failed to claim rewards",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Claim all available rewards
 */
export const claimAllRewards = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to claim rewards",
        },
      });
    }

    const result = await MailService.claimAllRewards(userId);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error claiming all rewards:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "CLAIM_ERROR",
        message: "Failed to claim all rewards",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get mail statistics
 */
export const getMailStats = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to view mail statistics",
        },
      });
    }

    const result = await MailService.getMailStats(userId);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching mail stats:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "MAIL_ERROR",
        message: "Failed to fetch mail statistics",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get recent mail
 */
export const getRecentMail = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to view recent mail",
        },
      });
    }

    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit as string) || 10)
    );

    const result = await MailService.getRecentMail(userId, limit);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching recent mail:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "MAIL_ERROR",
        message: "Failed to fetch recent mail",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get mail counts (unread and unclaimed rewards)
 */
export const getMailCounts = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to view mail counts",
        },
      });
    }

    const result = await MailService.getMailCounts(userId);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching mail counts:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "MAIL_ERROR",
        message: "Failed to fetch mail counts",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Send system notification (admin only)
 * SECURITY: This endpoint should only be accessible to admins
 */
export const sendSystemNotification = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to send notifications",
        },
      });
    }

    // Check if user has admin role
    if (req.user?.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: {
          type: "AUTHORIZATION_ERROR",
          message: "Admin access required",
          suggestion: "Only admins can send system notifications",
        },
      });
    }

    const { targetUserId, subject, content, rewards, expiresInDays } = req.body;

    if (!targetUserId || !subject || !content) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Target user ID, subject, and content are required",
          suggestion: "Provide all required fields",
        },
      });
    }

    const result = await MailService.sendSystemNotification(
      targetUserId,
      subject,
      content,
      rewards,
      expiresInDays
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          type: "MAIL_ERROR",
          message: result.error,
          suggestion: "Please check the request and try again",
        },
      });
    }

    res.status(201).json(result);
  } catch (error) {
    console.error("Error sending system notification:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "MAIL_ERROR",
        message: "Failed to send notification",
        suggestion: "Please try again later",
      },
    });
  }
};
