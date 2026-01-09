/**
 * Tower Routes - Infinite Tower API endpoints
 */

import { Router } from "express";
import { TowerController } from "../controllers/tower.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { gameActionRateLimit } from "../middlewares/rateLimit.middleware";

const router = Router();

/**
 * @swagger
 * /api/tower/progress:
 *   get:
 *     summary: Get user's tower progress
 *     tags: [Tower]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's current tower floor and progress
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     current_floor:
 *                       type: integer
 *                     highest_completed:
 *                       type: integer
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get("/progress", authenticateJWT, TowerController.getProgress);

/**
 * @swagger
 * /api/tower/floors:
 *   get:
 *     summary: Get available floors near user's current progress
 *     tags: [Tower]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Number of floors before and after current floor to return
 *     responses:
 *       200:
 *         description: List of tower floors with preview data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     current_floor:
 *                       type: integer
 *                     floors:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           floor_number:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           ai_deck_id:
 *                             type: string
 *                           preview_cards:
 *                             type: array
 *                             items:
 *                               type: string
 *                           reward_preview:
 *                             type: object
 *                     max_available_floor:
 *                       type: integer
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get("/floors", authenticateJWT, TowerController.getFloors);

/**
 * @swagger
 * /api/tower/floor/{floorNumber}:
 *   get:
 *     summary: Get details for a specific floor
 *     tags: [Tower]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: floorNumber
 *         required: true
 *         schema:
 *           type: integer
 *         description: Floor number to get details for
 *     responses:
 *       200:
 *         description: Floor details with reward preview
 *       400:
 *         description: Invalid floor number
 *       404:
 *         description: Floor not found
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get("/floor/:floorNumber", authenticateJWT, TowerController.getFloor);

/**
 * @swagger
 * /api/tower/rewards/{floor}:
 *   get:
 *     summary: Preview rewards for a specific floor
 *     tags: [Tower]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: floor
 *         required: true
 *         schema:
 *           type: integer
 *         description: Floor number to preview rewards for
 *     responses:
 *       200:
 *         description: Reward structure for the floor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     floor:
 *                       type: integer
 *                     band:
 *                       type: integer
 *                     tier:
 *                       type: string
 *                       enum: [E, D, C, B, A, S]
 *                     reward_gems:
 *                       type: integer
 *                     reward_packs:
 *                       type: integer
 *                     reward_card_fragments:
 *                       type: integer
 *                     reward_rare_art_card:
 *                       type: integer
 *                     reward_legendary_card:
 *                       type: integer
 *                     reward_epic_card:
 *                       type: integer
 *       400:
 *         description: Invalid floor number
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get(
  "/rewards/:floor",
  authenticateJWT,
  TowerController.getRewardsPreview
);

/**
 * @swagger
 * /api/tower/start:
 *   post:
 *     summary: Start a tower game for user's current floor
 *     tags: [Tower]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - player_deck_id
 *             properties:
 *               player_deck_id:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the player's deck to use
 *     responses:
 *       200:
 *         description: Tower game started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     game_id:
 *                       type: string
 *                       format: uuid
 *                     floor_number:
 *                       type: integer
 *                     floor_name:
 *                       type: string
 *                     ai_deck_preview:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         card_count:
 *                           type: integer
 *       400:
 *         description: Invalid request or floor not available
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.post(
  "/start",
  authenticateJWT,
  gameActionRateLimit,
  TowerController.startGame
);

/**
 * @swagger
 * /api/tower/complete:
 *   post:
 *     summary: Process tower game completion (internal endpoint)
 *     tags: [Tower]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - floor_number
 *               - won
 *             properties:
 *               floor_number:
 *                 type: integer
 *                 description: The floor number that was completed
 *               won:
 *                 type: boolean
 *                 description: Whether the user won the game
 *               game_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional game ID for verification
 *     responses:
 *       200:
 *         description: Tower completion processed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     won:
 *                       type: boolean
 *                     floor_number:
 *                       type: integer
 *                     rewards_earned:
 *                       type: object
 *                     new_floor:
 *                       type: integer
 *       400:
 *         description: Invalid request
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.post(
  "/complete",
  authenticateJWT,
  gameActionRateLimit,
  TowerController.processCompletion
);

export default router;


