import { v4 as uuidv4 } from "uuid";
import { PresenceNamespaceEvent } from "../types/socket.types";
import logger from "../utils/logger";

type ChallengeStatus =
  | "pending"
  | "accepted_waiting_decks"
  | "declined"
  | "cancelled"
  | "expired"
  | "ready";

interface ChallengeRecord {
  challengeId: string;
  challengerId: string;
  challengerUsername: string;
  opponentId: string;
  opponentUsername: string;
  status: ChallengeStatus;
  createdAt: number;
  expiresAt: number;
  challengerDeckId?: string;
  opponentDeckId?: string;
}

type QueueStatusResolver = (userId: string) => boolean;
type PresenceEmitter = (
  userId: string,
  event: PresenceNamespaceEvent,
  payload: Record<string, unknown>
) => void;

export class ChallengeError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "ChallengeError";
  }
}

const CHALLENGE_TTL_MS = 2 * 60 * 1000;

class ChallengeService {
  private challenges = new Map<string, ChallengeRecord>();
  private activeChallengeByUser = new Map<string, string>();
  private expiryTimers = new Map<string, NodeJS.Timeout>();
  private queueStatusResolver: QueueStatusResolver = () => false;
  private presenceEmitter?: PresenceEmitter;

  setQueueStatusResolver(resolver: QueueStatusResolver): void {
    this.queueStatusResolver = resolver;
  }

  setPresenceEmitter(emitter: PresenceEmitter): void {
    this.presenceEmitter = emitter;
  }

  isUserInMatchmakingQueue(userId: string): boolean {
    return this.queueStatusResolver(userId);
  }

  hasActiveChallengeLock(userId: string): boolean {
    const challenge = this.getActiveChallengeForUser(userId);
    if (!challenge) {
      this.activeChallengeByUser.delete(userId);
      return false;
    }

    if (!this.isLockStatus(challenge.status)) {
      this.activeChallengeByUser.delete(userId);
      return false;
    }

    return true;
  }

  getActiveChallengeForUser(userId: string): ChallengeRecord | null {
    const challengeId = this.activeChallengeByUser.get(userId);
    if (!challengeId) return null;
    return this.challenges.get(challengeId) ?? null;
  }

  sendChallenge(input: {
    challengerId: string;
    challengerUsername: string;
    opponentId: string;
    opponentUsername: string;
  }): ChallengeRecord {
    const {
      challengerId,
      challengerUsername,
      opponentId,
      opponentUsername,
    } = input;

    if (challengerId === opponentId) {
      throw new ChallengeError("You cannot challenge yourself.", 400);
    }

    if (this.hasActiveChallengeLock(challengerId)) {
      throw new ChallengeError(
        "You have a pending challenge. Cancel it before starting another game.",
        409
      );
    }

    if (this.isUserInMatchmakingQueue(challengerId)) {
      throw new ChallengeError(
        "Leave matchmaking queue before sending a challenge.",
        409
      );
    }

    if (this.hasActiveChallengeLock(opponentId)) {
      throw new ChallengeError("Selected player is already in a challenge.", 409);
    }

    const now = Date.now();
    const challenge: ChallengeRecord = {
      challengeId: uuidv4(),
      challengerId,
      challengerUsername,
      opponentId,
      opponentUsername,
      status: "pending",
      createdAt: now,
      expiresAt: now + CHALLENGE_TTL_MS,
    };

    this.challenges.set(challenge.challengeId, challenge);
    this.setActiveChallengeUsers(challenge);
    this.scheduleExpiry(challenge.challengeId);

    // INFO so prod surfaces the created challenge and, crucially, the
    // opponentId we're about to target — cross-check this against the
    // connectedUsers list in the "[challenge] presence emit" line to see
    // whether the recipient actually has a live /presence socket.
    logger.info("[challenge] created", {
      challengeId: challenge.challengeId,
      challengerId: challenge.challengerId,
      opponentId: challenge.opponentId,
    });

    this.emit(challenge.opponentId, PresenceNamespaceEvent.CHALLENGE_INCOMING, {
      challengeId: challenge.challengeId,
      challengerId: challenge.challengerId,
      challengerUsername: challenge.challengerUsername,
      expiresAt: challenge.expiresAt,
    });

    return challenge;
  }

  respondToChallenge(input: {
    challengeId: string;
    userId: string;
    accepted: boolean;
  }): ChallengeRecord {
    const challenge = this.requireChallenge(input.challengeId);

    if (challenge.opponentId !== input.userId) {
      throw new ChallengeError("Only the challenged player can respond.", 403);
    }

    if (challenge.status !== "pending") {
      throw new ChallengeError("Challenge is no longer pending.", 409);
    }

    if (!input.accepted) {
      challenge.status = "declined";
      this.teardownChallenge(challenge.challengeId);
      this.emit(
        challenge.challengerId,
        PresenceNamespaceEvent.CHALLENGE_DECLINED,
        { challengeId: challenge.challengeId }
      );
      return challenge;
    }

    challenge.status = "accepted_waiting_decks";
    this.emit(
      challenge.challengerId,
      PresenceNamespaceEvent.CHALLENGE_ACCEPTED,
      {
        challengeId: challenge.challengeId,
        challengerId: challenge.challengerId,
        challengerUsername: challenge.challengerUsername,
        challengedId: challenge.opponentId,
        challengedUsername: challenge.opponentUsername,
        opponentId: challenge.opponentId,
        opponentUsername: challenge.opponentUsername,
      }
    );
    this.emit(
      challenge.challengerId,
      PresenceNamespaceEvent.CHALLENGE_DECK_SELECTION_REQUIRED,
      {
        challengeId: challenge.challengeId,
        challengerId: challenge.challengerId,
        challengerUsername: challenge.challengerUsername,
        challengedId: challenge.opponentId,
        challengedUsername: challenge.opponentUsername,
      }
    );
    this.emit(
      challenge.opponentId,
      PresenceNamespaceEvent.CHALLENGE_DECK_SELECTION_REQUIRED,
      {
        challengeId: challenge.challengeId,
        challengerId: challenge.challengerId,
        challengerUsername: challenge.challengerUsername,
        challengedId: challenge.opponentId,
        challengedUsername: challenge.opponentUsername,
      }
    );

    return challenge;
  }

  confirmDeck(input: {
    challengeId: string;
    userId: string;
    deckId: string;
  }): { challenge: ChallengeRecord; bothConfirmed: boolean } {
    const challenge = this.requireChallenge(input.challengeId);
    const { userId, deckId } = input;

    if (
      challenge.status !== "accepted_waiting_decks" &&
      challenge.status !== "pending"
    ) {
      throw new ChallengeError("Challenge is not accepting deck confirmations.", 409);
    }

    if (challenge.status === "pending") {
      throw new ChallengeError("Challenge must be accepted first.", 409);
    }

    if (challenge.challengerId !== userId && challenge.opponentId !== userId) {
      throw new ChallengeError("You are not part of this challenge.", 403);
    }

    if (challenge.challengerId === userId) {
      challenge.challengerDeckId = deckId;
    } else {
      challenge.opponentDeckId = deckId;
    }

    this.emit(challenge.challengerId, PresenceNamespaceEvent.CHALLENGE_DECK_CONFIRMED, {
      challengeId: challenge.challengeId,
      userId,
    });
    this.emit(challenge.opponentId, PresenceNamespaceEvent.CHALLENGE_DECK_CONFIRMED, {
      challengeId: challenge.challengeId,
      userId,
    });

    return {
      challenge,
      bothConfirmed: Boolean(challenge.challengerDeckId && challenge.opponentDeckId),
    };
  }

  markReady(challengeId: string, gameId: string): ChallengeRecord {
    const challenge = this.requireChallenge(challengeId);
    challenge.status = "ready";

    this.emit(challenge.challengerId, PresenceNamespaceEvent.CHALLENGE_READY, {
      challengeId,
      gameId,
    });
    this.emit(challenge.opponentId, PresenceNamespaceEvent.CHALLENGE_READY, {
      challengeId,
      gameId,
    });

    this.teardownChallenge(challengeId);
    return challenge;
  }

  cancelChallenge(input: {
    userId: string;
    challengeId?: string;
  }): ChallengeRecord {
    const challenge =
      input.challengeId !== undefined
        ? this.requireChallenge(input.challengeId)
        : this.findChallengeForUserOrThrow(input.userId);

    if (
      challenge.challengerId !== input.userId &&
      challenge.opponentId !== input.userId
    ) {
      throw new ChallengeError("You are not part of this challenge.", 403);
    }

    if (!this.isLockStatus(challenge.status)) {
      throw new ChallengeError("Challenge cannot be cancelled in its current state.", 409);
    }

    challenge.status = "cancelled";
    this.teardownChallenge(challenge.challengeId);

    this.emit(challenge.challengerId, PresenceNamespaceEvent.CHALLENGE_CANCELLED, {
      challengeId: challenge.challengeId,
      cancelledBy: input.userId,
    });
    this.emit(challenge.opponentId, PresenceNamespaceEvent.CHALLENGE_CANCELLED, {
      challengeId: challenge.challengeId,
      cancelledBy: input.userId,
    });

    return challenge;
  }

  private findChallengeForUserOrThrow(userId: string): ChallengeRecord {
    const challenge = this.getActiveChallengeForUser(userId);
    if (!challenge) {
      throw new ChallengeError("No active challenge found.", 404);
    }
    return challenge;
  }

  private scheduleExpiry(challengeId: string): void {
    this.clearExpiryTimer(challengeId);

    const timer = setTimeout(() => {
      const challenge = this.challenges.get(challengeId);
      if (!challenge) return;
      if (!this.isLockStatus(challenge.status)) return;

      challenge.status = "expired";
      this.teardownChallenge(challenge.challengeId);

      this.emit(
        challenge.challengerId,
        PresenceNamespaceEvent.CHALLENGE_EXPIRED,
        { challengeId: challenge.challengeId }
      );
      this.emit(challenge.opponentId, PresenceNamespaceEvent.CHALLENGE_EXPIRED, {
        challengeId: challenge.challengeId,
      });
    }, CHALLENGE_TTL_MS);

    this.expiryTimers.set(challengeId, timer);
  }

  private clearExpiryTimer(challengeId: string): void {
    const timer = this.expiryTimers.get(challengeId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(challengeId);
    }
  }

  private emit(
    userId: string,
    event: PresenceNamespaceEvent,
    payload: Record<string, unknown>
  ): void {
    if (!this.presenceEmitter) return;
    this.presenceEmitter(userId, event, payload);
  }

  private isLockStatus(status: ChallengeStatus): boolean {
    return status === "pending" || status === "accepted_waiting_decks";
  }

  private setActiveChallengeUsers(challenge: ChallengeRecord): void {
    this.activeChallengeByUser.set(challenge.challengerId, challenge.challengeId);
    this.activeChallengeByUser.set(challenge.opponentId, challenge.challengeId);
  }

  private teardownChallenge(challengeId: string): void {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      this.clearExpiryTimer(challengeId);
      return;
    }

    this.activeChallengeByUser.delete(challenge.challengerId);
    this.activeChallengeByUser.delete(challenge.opponentId);
    this.challenges.delete(challengeId);
    this.clearExpiryTimer(challengeId);
  }

  private requireChallenge(challengeId: string): ChallengeRecord {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      throw new ChallengeError("Challenge not found.", 404);
    }
    return challenge;
  }
}

export default new ChallengeService();
