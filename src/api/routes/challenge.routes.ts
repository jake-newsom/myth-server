import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import challengeController from "../controllers/challenge.controller";

const router = Router();

router.use(protect);

router.get("/online-players", challengeController.getOnlinePlayers.bind(challengeController));
router.post("/send", challengeController.sendChallenge.bind(challengeController));
router.post("/respond", challengeController.respondToChallenge.bind(challengeController));
router.post("/confirm-deck", challengeController.confirmDeck.bind(challengeController));
router.post("/cancel", challengeController.cancelChallenge.bind(challengeController));

export default router;
