import { Router } from "express";
import { StoryModeController } from "../controllers/storyMode.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { moderateRateLimit } from "../middlewares/rateLimit.middleware";

const router = Router();

// All admin routes require authentication
// Note: You may want to add additional admin role checking middleware

/**
 * @swagger
 * /api/admin/story-modes:
 *   get:
 *     summary: Get all story mode configurations (admin)
 *     tags: [Admin - Story Mode]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all story mode configurations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 story_modes:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StoryModeWithRewards'
 *                 total_count:
 *                   type: integer
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get("/", authenticateJWT, StoryModeController.getAllStoryModes);

/**
 * @swagger
 * /api/admin/story-modes:
 *   post:
 *     summary: Create a new story mode configuration
 *     tags: [Admin - Story Mode]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateStoryModeRequest'
 *     responses:
 *       201:
 *         description: Story mode created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 story_mode:
 *                   $ref: '#/components/schemas/StoryModeWithRewards'
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.post("/", authenticateJWT, moderateRateLimit, StoryModeController.createStoryMode);

/**
 * @swagger
 * /api/admin/story-modes/{storyId}:
 *   get:
 *     summary: Get a specific story mode configuration
 *     tags: [Admin - Story Mode]
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
 *         description: Story mode configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 story_mode:
 *                   $ref: '#/components/schemas/StoryModeWithRewards'
 *       404:
 *         description: Story mode not found
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get("/:storyId", authenticateJWT, StoryModeController.getStoryMode);

/**
 * @swagger
 * /api/admin/story-modes/{storyId}:
 *   put:
 *     summary: Update a story mode configuration
 *     tags: [Admin - Story Mode]
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateStoryModeRequest'
 *     responses:
 *       200:
 *         description: Story mode updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 story_mode:
 *                   $ref: '#/components/schemas/StoryModeWithRewards'
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: Story mode not found
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.put("/:storyId", authenticateJWT, moderateRateLimit, StoryModeController.updateStoryMode);

/**
 * @swagger
 * /api/admin/story-modes/{storyId}:
 *   delete:
 *     summary: Delete a story mode configuration
 *     tags: [Admin - Story Mode]
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
 *         description: Story mode deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       404:
 *         description: Story mode not found
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.delete("/:storyId", authenticateJWT, moderateRateLimit, StoryModeController.deleteStoryMode);

export default router;
