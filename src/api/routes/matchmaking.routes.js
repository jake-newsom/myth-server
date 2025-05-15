const express = require("express");
const MatchmakingController = require("../controllers/matchmaking.controller");
const { protect } = require("../middlewares/auth.middleware");

const router = express.Router();

// All matchmaking routes require authentication
router.use(protect);

// Routes for matchmaking
router.post("/join", MatchmakingController.joinQueue); // Join matchmaking queue
router.get("/status", MatchmakingController.getMatchStatus); // Check matchmaking status
router.post("/leave", MatchmakingController.leaveQueue); // Leave matchmaking queue

module.exports = router;
