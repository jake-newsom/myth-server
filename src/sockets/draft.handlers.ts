import { Socket } from "socket.io";
import { AuthenticatedSocket } from "../types/socket.types";
import { PresenceNamespaceEvent, draftRoom } from "../types/socket.types";
import RankedDraftSessionModel from "../models/rankedDraftSession.model";
import RankedDraft, {
  DraftRuleError,
  RANKED_DRAFT_FLAG,
  isParticipant,
  toStatePayload,
} from "../services/rankedDraft.service";
import Orchestrator from "../services/rankedDraftOrchestrator.service";
import FeatureFlagService from "../services/featureFlag.service";
import { default as UserModel } from "../models/user.model";
import logger from "../utils/logger";

/**
 * Ranked Draft handlers, registered on an existing `/presence` socket.
 *
 * They ride presence rather than `/game` because a draft happens before any
 * `games` row exists, and the game namespace's auth middleware requires a
 * gameId it can authorize against that table. Presence is token-only.
 */

function emitError(socket: Socket, error: unknown, context: string): void {
  if (error instanceof DraftRuleError) {
    socket.emit(PresenceNamespaceEvent.DRAFT_SERVER_ERROR, {
      message: error.message,
    });
    return;
  }
  logger.error(`[draft.handlers] ${context}`, {
    error: error instanceof Error ? error.message : String(error),
  });
  socket.emit(PresenceNamespaceEvent.DRAFT_SERVER_ERROR, {
    message: "Something went wrong with the draft.",
  });
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Loads the session and proves this socket's user belongs to it.
 *
 * Every handler goes through here — the session id arrives from the client, so
 * membership can never be assumed.
 */
async function requireOwnSession(userId: string, sessionId: string) {
  const session = await RankedDraftSessionModel.findById(sessionId);
  if (!session || !isParticipant(session, userId)) {
    throw new DraftRuleError("Draft not found.");
  }
  return session;
}

export function registerDraftHandlers(socket: AuthenticatedSocket): void {
  const userId = socket.user.user_id;

  /** Re-attaches a returning client to its live draft. */
  socket.on(PresenceNamespaceEvent.DRAFT_CLIENT_REJOIN, async () => {
    try {
      if (!(await FeatureFlagService.isEnabled(userId, RANKED_DRAFT_FLAG))) {
        return;
      }
      const found = await RankedDraftSessionModel.findLiveForUser(userId);
      if (!found) return;
      // Heal a stuck turn on reconnect, so a player who backs out and returns
      // is enough to unblock a wedged draft.
      const session = await Orchestrator.reconcileSession(found);
      if (
        session.phase !== "ban" &&
        session.phase !== "draft" &&
        session.phase !== "block"
      ) {
        return;
      }

      socket.join(draftRoom(session.session_id));

      const opponentId =
        session.player1_id === userId ? session.player2_id : session.player1_id;
      const [opponent, recentCardIds] = await Promise.all([
        UserModel.findById(opponentId),
        RankedDraft.getRecentCards(userId),
      ]);
      // Redacted by toStatePayload: an unrevealed opponent ban is never sent,
      // so a reconnect cannot be used to peek at it.
      const payload = await toStatePayload(session, userId, {
        opponentUsername: opponent?.username ?? "Opponent",
        recentCardIds,
      });
      socket.emit(PresenceNamespaceEvent.DRAFT_SERVER_STATE, payload);
    } catch (error) {
      emitError(socket, error, "rejoin failed");
    }
  });

  socket.on(
    PresenceNamespaceEvent.DRAFT_CLIENT_SUBMIT_BAN,
    async (raw: unknown) => {
      try {
        const body = (raw ?? {}) as Record<string, unknown>;
        const sessionId = readString(body.sessionId ?? body.session_id);
        const cardVariantId = readString(
          body.cardVariantId ?? body.card_variant_id
        );
        if (!sessionId || !cardVariantId) {
          throw new DraftRuleError("A card is required to ban.");
        }
        await requireOwnSession(userId, sessionId);
        await Orchestrator.submitBan(sessionId, userId, cardVariantId);
      } catch (error) {
        emitError(socket, error, "submit ban failed");
      }
    }
  );

  socket.on(PresenceNamespaceEvent.DRAFT_CLIENT_ABANDON, async (raw: unknown) => {
    try {
      const body = (raw ?? {}) as Record<string, unknown>;
      const sessionId = readString(body.sessionId ?? body.session_id);
      if (!sessionId) throw new DraftRuleError("A session is required.");
      await requireOwnSession(userId, sessionId);
      await Orchestrator.abandonSession(sessionId, userId);
    } catch (error) {
      emitError(socket, error, "abandon draft failed");
    }
  });

  socket.on(
    PresenceNamespaceEvent.DRAFT_CLIENT_SUBMIT_BLOCK,
    async (raw: unknown) => {
      try {
        const body = (raw ?? {}) as Record<string, unknown>;
        const sessionId = readString(body.sessionId ?? body.session_id);
        const cardVariantId = readString(
          body.cardVariantId ?? body.card_variant_id
        );
        if (!sessionId || !cardVariantId) {
          throw new DraftRuleError("A card is required to block.");
        }
        await requireOwnSession(userId, sessionId);
        await Orchestrator.submitBlock(sessionId, userId, cardVariantId);
      } catch (error) {
        emitError(socket, error, "submit block failed");
      }
    }
  );

  socket.on(
    PresenceNamespaceEvent.DRAFT_CLIENT_SUBMIT_PICK,
    async (raw: unknown) => {
      try {
        const body = (raw ?? {}) as Record<string, unknown>;
        const sessionId = readString(body.sessionId ?? body.session_id);
        const cardVariantId = readString(
          body.cardVariantId ?? body.card_variant_id
        );
        // Optional cosmetic skin. Validated server-side against ownership;
        // an unowned or unknown value falls back to the original printing.
        const chosenVariantId = readString(
          body.chosenVariantId ?? body.chosen_variant_id
        );
        if (!sessionId || !cardVariantId) {
          throw new DraftRuleError("A card is required to pick.");
        }
        await requireOwnSession(userId, sessionId);
        await Orchestrator.submitPick(sessionId, userId, cardVariantId, {
          chosenVariantId,
        });
      } catch (error) {
        emitError(socket, error, "submit pick failed");
      }
    }
  );
}
