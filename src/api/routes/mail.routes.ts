import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  strictRateLimit,
  moderateRateLimit,
  lenientRateLimit,
} from "../middlewares/rateLimit.middleware";
import * as mailController from "../controllers/mail.controller";

const router = Router();

/**
 * GET /api/mail
 * Get user's mail with optional filters and pagination
 * Query params:
 * - page: number (optional, default: 1)
 * - limit: number (optional, default: 20, max: 50)
 * - mail_type: string (optional) - filter by mail type
 * - is_read: boolean (optional) - filter by read status
 * - has_rewards: boolean (optional) - filter by reward presence
 * - is_claimed: boolean (optional) - filter by claim status
 * - include_expired: boolean (optional, default: false) - include expired mail
 * - sort_by: string (optional, default: "created_at") - sort field
 * - sort_order: string (optional, default: "DESC") - sort order
 */
router.get(
  "/",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for mail listing
  mailController.getUserMail
);

/**
 * GET /api/mail/stats
 * Get mail statistics for the user
 */
router.get(
  "/stats",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for stats
  mailController.getMailStats
);

/**
 * GET /api/mail/counts
 * Get unread and unclaimed reward counts
 */
router.get(
  "/counts",
  authMiddleware.protect, // Requires authentication
  lenientRateLimit, // Lenient rate limiting for quick counts
  mailController.getMailCounts
);

/**
 * GET /api/mail/recent
 * Get recent mail for the user
 * Query params:
 * - limit: number (optional, default: 10, max: 50)
 */
router.get(
  "/recent",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for recent mail
  mailController.getRecentMail
);

/**
 * GET /api/mail/:mailId
 * Get specific mail by ID
 * Params:
 * - mailId: string - mail ID
 */
router.get(
  "/:mailId",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for individual mail
  mailController.getMailById
);

/**
 * PUT /api/mail/:mailId/read
 * Mark specific mail as read
 * Params:
 * - mailId: string - mail ID
 */
router.put(
  "/:mailId/read",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for marking as read
  mailController.markAsRead
);

/**
 * PUT /api/mail/read/multiple
 * Mark multiple mail as read
 * Body:
 * - mailIds: string[] - array of mail IDs (max 100)
 */
router.put(
  "/read/multiple",
  authMiddleware.protect, // Requires authentication
  strictRateLimit, // Strict rate limiting for bulk operations
  mailController.markMultipleAsRead
);

/**
 * PUT /api/mail/read/all
 * Mark all mail as read
 */
router.put(
  "/read/all",
  authMiddleware.protect, // Requires authentication
  strictRateLimit, // Strict rate limiting for bulk operations
  mailController.markAllAsRead
);

/**
 * POST /api/mail/:mailId/claim
 * Claim rewards from specific mail
 * Params:
 * - mailId: string - mail ID
 */
router.post(
  "/:mailId/claim",
  authMiddleware.protect, // Requires authentication
  strictRateLimit, // Strict rate limiting for reward claiming
  mailController.claimRewards
);

/**
 * POST /api/mail/claim/all
 * Claim all available rewards
 */
router.post(
  "/claim/all",
  authMiddleware.protect, // Requires authentication
  strictRateLimit, // Strict rate limiting for bulk reward claiming
  mailController.claimAllRewards
);

/**
 * POST /api/mail/send/system
 * Send system notification (admin only)
 * Body:
 * - targetUserId: string - target user ID
 * - subject: string - mail subject
 * - content: string - mail content
 * - rewards: object (optional) - reward object with gold, gems, packs, fate_coins, card_ids
 * - expiresInDays: number (optional) - expiration in days
 */
router.post(
  "/send/system",
  authMiddleware.protect, // Requires authentication
  strictRateLimit, // Strict rate limiting for sending notifications
  mailController.sendSystemNotification
);

export default router;
