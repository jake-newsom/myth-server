import { Response } from "express";
import { Server as IoServer } from "socket.io";
import { AuthenticatedRequest } from "../../types/middleware.types";
import ChallengeService, { ChallengeError } from "../../services/challenge.service";
import UserModel from "../../models/user.model";
import DeckModel from "../../models/deck.model";
import DeckService from "../../services/deck.service";
import GameService from "../../services/game.service";
import { GameLogic } from "../../game-engine/game.logic";
import { DECK_CONFIG } from "../../config/constants";
import {
  getPresenceConnectedUserIds,
  getPresenceSocketCountForUser,
  userRoom,
} from "../../sockets/namespace.presence";
import logger from "../../utils/logger";
import { getGameNamespaceConnectedUserIds } from "../../sockets/namespace.game";
import { isUserInMatchmakingQueue } from "./matchmaking.controller";

class ChallengeController {
  private attachPresenceEmitter(req: AuthenticatedRequest): void {
    const io = req.app.get("io") as IoServer | undefined;
    if (!io) {
      return;
    }

    ChallengeService.setPresenceEmitter((userId, event, payload) => {
      const socketCount = getPresenceSocketCountForUser(userId);
      // INFO (not debug) so this is visible on prod, where LOG_LEVEL
      // defaults to INFO. socketCount === 0 means the target user has no
      // connected /presence socket, so the emit goes to an empty room and
      // is silently dropped (i.e. the recipient never gets the popup).
      logger.info("[challenge] presence emit", {
        userId,
        event,
        room: userRoom(userId),
        socketCount,
        connectedUsers: getPresenceConnectedUserIds(),
      });
      io.of("/presence").to(userRoom(userId)).emit(event, payload);
    });
  }

  private getUserId(req: AuthenticatedRequest, res: Response): string | null {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({
        error: { message: "Authentication required." },
      });
      return null;
    }
    return userId;
  }

  async getOnlinePlayers(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = this.getUserId(req, res);
      if (!userId) return;

      const onlineUserIds = getPresenceConnectedUserIds().filter((id) => id !== userId);
      if (onlineUserIds.length === 0) {
        res.status(200).json({ players: [] });
        return;
      }

      const inGameSet = new Set(getGameNamespaceConnectedUserIds());

      const users = await Promise.all(onlineUserIds.map((id) => UserModel.findById(id)));

      const players = users
        .filter((user): user is NonNullable<typeof user> => Boolean(user))
        .map((user) => ({
          user_id: user.user_id,
          username: user.username,
          is_in_game: inGameSet.has(user.user_id),
          is_in_queue: isUserInMatchmakingQueue(user.user_id),
        }));

      res.status(200).json({ players });
    } catch (error) {
      console.error("Error fetching online players:", error);
      res.status(500).json({
        error: { message: "Failed to load online players." },
      });
    }
  }

  async sendChallenge(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      // Entry log BEFORE any validation — proves the HTTP request actually
      // reached this controller. If a challenge produces no "[challenge]
      // sendChallenge entry" line, the POST /challenges/send never arrived
      // (routing, base URL, auth middleware, or it's being sent elsewhere).
      logger.info("[challenge] sendChallenge entry", {
        userId: req.user?.user_id,
        body: req.body,
      });

      const challengerId = this.getUserId(req, res);
      if (!challengerId) return;

      this.attachPresenceEmitter(req);

      const opponentId = req.body.opponentId ?? req.body.targetUserId;
      if (!opponentId) {
        res.status(400).json({
          error: { message: "opponentId is required." },
        });
        return;
      }

      const [challenger, opponent] = await Promise.all([
        UserModel.findById(challengerId),
        UserModel.findById(opponentId),
      ]);

      if (!challenger || !opponent) {
        res.status(404).json({
          error: { message: "User not found." },
        });
        return;
      }

      const challenge = ChallengeService.sendChallenge({
        challengerId,
        challengerUsername: challenger.username,
        opponentId,
        opponentUsername: opponent.username,
      });

      res.status(201).json({
        challengeId: challenge.challengeId,
        status: challenge.status,
        expiresAt: challenge.expiresAt,
      });
    } catch (error) {
      this.handleError(error, res, "Failed to send challenge.");
    }
  }

  async respondToChallenge(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = this.getUserId(req, res);
      if (!userId) return;

      this.attachPresenceEmitter(req);

      const { challengeId, accepted, accept, response } = req.body;
      if (!challengeId) {
        res.status(400).json({
          error: { message: "challengeId is required." },
        });
        return;
      }

      const isAccept =
        typeof accepted === "boolean"
          ? accepted
          : typeof accept === "boolean"
            ? accept
            : String(response).toLowerCase() === "accept";

      const challenge = ChallengeService.respondToChallenge({
        challengeId,
        userId,
        accepted: isAccept,
      });

      res.status(200).json({
        challengeId: challenge.challengeId,
        status: challenge.status,
      });
    } catch (error) {
      this.handleError(error, res, "Failed to respond to challenge.");
    }
  }

  async confirmDeck(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = this.getUserId(req, res);
      if (!userId) return;

      this.attachPresenceEmitter(req);

      const { challengeId, deckId } = req.body;
      if (!challengeId || !deckId) {
        res.status(400).json({
          error: { message: "challengeId and deckId are required." },
        });
        return;
      }

      const confirmation = ChallengeService.confirmDeck({
        challengeId,
        userId,
        deckId,
      });

      if (!confirmation.bothConfirmed) {
        res.status(200).json({
          challengeId,
          status: confirmation.challenge.status,
          waitingForOpponent: true,
        });
        return;
      }

      const challenge = confirmation.challenge;
      const challengerDeckId = challenge.challengerDeckId!;
      const opponentDeckId = challenge.opponentDeckId!;

      const [challengerDeck, opponentDeck] = await Promise.all([
        DeckModel.findDeckWithInstanceDetails(challengerDeckId, challenge.challengerId),
        DeckModel.findDeckWithInstanceDetails(opponentDeckId, challenge.opponentId),
      ]);

      if (!challengerDeck || !opponentDeck) {
        throw new ChallengeError("Selected deck could not be found.", 400);
      }

      if (challengerDeck.cards.length !== DECK_CONFIG.DECK_SIZE) {
        throw new ChallengeError(
          `Your deck "${challengerDeck.name}" must contain exactly ${DECK_CONFIG.DECK_SIZE} cards.`,
          400
        );
      }
      if (opponentDeck.cards.length !== DECK_CONFIG.DECK_SIZE) {
        throw new ChallengeError(
          `Your deck "${opponentDeck.name}" must contain exactly ${DECK_CONFIG.DECK_SIZE} cards.`,
          400
        );
      }

      const challengerCardIds = challengerDeck.cards
        .map((card) => card.user_card_instance_id)
        .filter((id): id is string => Boolean(id));
      const opponentCardIds = opponentDeck.cards
        .map((card) => card.user_card_instance_id)
        .filter((id): id is string => Boolean(id));

      const initialGameState = await GameLogic.initializeGame(
        challengerCardIds,
        opponentCardIds,
        challenge.challengerId,
        challenge.opponentId
      );

      const [challengerDeckEffect, opponentDeckEffect] = await Promise.all([
        DeckService.getDeckEffect(challengerDeckId),
        DeckService.getDeckEffect(opponentDeckId),
      ]);

      if (challengerDeckEffect) {
        initialGameState.player1.deck_effect = challengerDeckEffect;
        initialGameState.player1.deck_effect_state = { last_triggered_round: 0 };
      }
      if (opponentDeckEffect) {
        initialGameState.player2.deck_effect = opponentDeckEffect;
        initialGameState.player2.deck_effect_state = { last_triggered_round: 0 };
      }
      initialGameState.player1.equipped_card_back =
        challengerDeck.equipped_card_back ?? null;
      initialGameState.player2.equipped_card_back =
        opponentDeck.equipped_card_back ?? null;

      const game = await GameService.createGameRecord(
        challenge.challengerId,
        challenge.opponentId,
        challengerDeckId,
        opponentDeckId,
        "pvp",
        initialGameState
      );

      ChallengeService.markReady(challenge.challengeId, game.game_id);

      res.status(200).json({
        challengeId: challenge.challengeId,
        status: "ready",
        gameId: game.game_id,
      });
    } catch (error) {
      this.handleError(error, res, "Failed to confirm deck.");
    }
  }

  async cancelChallenge(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = this.getUserId(req, res);
      if (!userId) return;

      this.attachPresenceEmitter(req);

      const challenge = ChallengeService.cancelChallenge({
        userId,
        challengeId: req.body.challengeId,
      });

      res.status(200).json({
        challengeId: challenge.challengeId,
        status: challenge.status,
      });
    } catch (error) {
      this.handleError(error, res, "Failed to cancel challenge.");
    }
  }

  private handleError(error: unknown, res: Response, fallbackMessage: string): void {
    if (error instanceof ChallengeError) {
      res.status(error.statusCode).json({
        error: { message: error.message },
      });
      return;
    }

    console.error(fallbackMessage, error);
    res.status(500).json({
      error: { message: fallbackMessage },
    });
  }
}

export default new ChallengeController();
