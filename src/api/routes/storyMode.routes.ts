import { Router } from "express";
import { StoryModeController } from "../controllers/storyMode.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { gameActionRateLimit } from "../middlewares/rateLimit.middleware";

const router = Router();

// Player endpoints (require authentication)

/**
 * @swagger
 * /api/story-modes:
 *   get:
 *     summary: Get available story modes for the authenticated user
 *     tags: [Story Mode]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available story modes with user progress
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StoryModeListResponse'
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get("/", authenticateJWT, StoryModeController.getAvailableStoryModes);

/**
 * @swagger
 * /api/story-modes/start:
 *   post:
 *     summary: Start a story mode game
 *     tags: [Story Mode]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StoryGameStartRequest'
 *     responses:
 *       200:
 *         description: Story game started successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StoryGameStartResponse'
 *       400:
 *         description: Invalid request or requirements not met
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.post("/start", authenticateJWT, gameActionRateLimit, StoryModeController.startStoryGame);

/**
 * @swagger
 * /api/story-modes/progress:
 *   get:
 *     summary: Get user's story mode progress for all story modes
 *     tags: [Story Mode]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's story mode progress
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 progress:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserStoryProgress'
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get("/progress", authenticateJWT, StoryModeController.getUserProgress);

/**
 * @swagger
 * /api/story-modes/progress/{storyId}:
 *   get:
 *     summary: Get user's progress for a specific story mode
 *     tags: [Story Mode]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: storyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Story mode ID
 *     responses:
 *       200:
 *         description: User's progress for the specified story mode
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 progress:
 *                   $ref: '#/components/schemas/UserStoryProgress'
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get("/progress/:storyId", authenticateJWT, StoryModeController.getUserProgress);

/**
 * @swagger
 * /api/story-modes/complete:
 *   post:
 *     summary: Process story mode game completion (internal endpoint)
 *     tags: [Story Mode]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - story_id
 *               - game_result
 *             properties:
 *               story_id:
 *                 type: string
 *                 format: uuid
 *               game_result:
 *                 type: object
 *                 description: Game result object
 *               completion_time_seconds:
 *                 type: integer
 *                 description: Time taken to complete the game in seconds
 *     responses:
 *       200:
 *         description: Story completion processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StoryGameCompletionRewards'
 *       400:
 *         description: Invalid request
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.post("/complete", authenticateJWT, gameActionRateLimit, StoryModeController.processStoryCompletion);

/**
 * @swagger
 * /api/story-modes/{storyId}/unlock-status:
 *   get:
 *     summary: Check if user can unlock a specific story mode
 *     tags: [Story Mode]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: storyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Story mode ID
 *     responses:
 *       200:
 *         description: Unlock status for the story mode
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 story_id:
 *                   type: string
 *                   format: uuid
 *                 is_unlocked:
 *                   type: boolean
 *       400:
 *         description: Invalid story ID
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get("/:storyId/unlock-status", authenticateJWT, StoryModeController.checkUnlockStatus);

export default router;
