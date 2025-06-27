import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  strictRateLimit,
  moderateRateLimit,
} from "../middlewares/rateLimit.middleware";
import {
  getFriends,
  getFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  searchUsers,
  checkFriendshipStatus,
} from "../controllers/friends.controller";
import { challengeFriend } from "../controllers/friendChallenge.controller";

const router = Router();

// All friends routes require authentication
router.use(authMiddleware.protect);

// Read-only endpoints (moderate rate limiting)
router.get("/", moderateRateLimit, getFriends);
router.get("/requests", moderateRateLimit, getFriendRequests);
router.get("/search", moderateRateLimit, searchUsers);
router.get("/status/:userId", moderateRateLimit, checkFriendshipStatus);

// Write operations (strict rate limiting to prevent abuse)
router.post("/add", strictRateLimit, sendFriendRequest);
router.post("/accept/:friendshipId", strictRateLimit, acceptFriendRequest);
router.post("/reject/:friendshipId", strictRateLimit, rejectFriendRequest);
router.post("/challenge/:friendId", strictRateLimit, challengeFriend);
router.delete("/:friendshipId", strictRateLimit, removeFriend);

export default router;
