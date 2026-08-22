import { Namespace } from "socket.io";
import db from "../config/db.config";
import RankedDraftSessionModel, {
  RankedDraftSession,
} from "../models/rankedDraftSession.model";
import RankedDraft, {
  DraftRuleError,
  chooseAutoPick,
  resolveOwnedVariant,
  resolveCurrentPicker,
  isDraftComplete,
  pickerForIndex,
  toStatePayload,
  TOTAL_PICKS,
  validateBan,
  validatePick,
  validateBlock,
  blocksComplete,
  chooseAutoBlock,
} from "./rankedDraft.service";
import { buildDraftGameState } from "./draftBattle.service";
import {
  RANKED_DRAFT_CONFIG,
  RANKED_DRAFT_GAME_MAX_AGE_MINUTES,
} from "../config/constants";
import {
  PresenceNamespaceEvent,
  RankedDraftAbortedPayload,
  RankedDraftBanRevealedPayload,
  RankedDraftBlockRevealedPayload,
  RankedDraftCompletedPayload,
  RankedDraftPickMadePayload,
  draftRoom,
} from "../types/socket.types";
import { userRoom } from "../sockets/namespace.presence";
import { default as UserModel } from "../models/user.model";
import logger from "../utils/logger";

/**
 * Drives a draft session forward: phase transitions, the turn clock, and the
 * hand-off into a real game.
 *
 * The database row is the source of truth so a restart can recover; the timers
 * here are just a convenience that fires the same transitions the sweeper would
 * eventually fire from `deadline_at`.
 */

let presenceNs: Namespace | null = null;

/** Injected from namespace.presence, mirroring chatService.setPresenceNamespace. */
export function setPresenceNamespace(ns: Namespace): void {
  presenceNs = ns;
}

/** sessionId -> pending phase timer. */
const timers = new Map<string, NodeJS.Timeout>();

function clearTimer(sessionId: string): void {
  const t = timers.get(sessionId);
  if (t) {
    clearTimeout(t);
    timers.delete(sessionId);
  }
}

function scheduleTimer(sessionId: string, deadline: Date): void {
  clearTimer(sessionId);
  const delay = Math.max(0, deadline.getTime() - Date.now());
  const timer = setTimeout(() => {
    timers.delete(sessionId);
    onDeadlineExpired(sessionId).catch((error) => {
      logger.error("[rankedDraft] deadline handler failed", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, delay);
  // Never hold the process open for a draft clock.
  if (typeof timer.unref === "function") timer.unref();
  timers.set(sessionId, timer);
}

function emitToUser(userId: string, event: string, payload: unknown): void {
  presenceNs?.to(userRoom(userId)).emit(event, payload);
}

function emitToBoth(
  session: RankedDraftSession,
  event: string,
  payload: unknown
): void {
  emitToUser(session.player1_id, event, payload);
  emitToUser(session.player2_id, event, payload);
}

/**
 * Repairs a session whose stored turn no longer matches its picks.
 *
 * A draft that points at a full player can never advance — every pick is
 * rejected and the clock just runs out forever. Rather than requiring a
 * manual fix, any read of a live session corrects the turn (or completes the
 * draft) so an already-stuck session heals itself the moment either client
 * reconnects.
 *
 * Returns the session as it should now be.
 */
export async function reconcileSession(
  session: RankedDraftSession
): Promise<RankedDraftSession> {
  // A block phase with both choices in but no game yet (e.g. the reveal hold
  // was lost to a restart) must still finish, or the session strands.
  if (session.phase === "block") {
    if (blocksComplete(session)) {
      await completeDraft(session);
      return (
        (await RankedDraftSessionModel.findById(session.session_id)) ?? session
      );
    }
    return session;
  }
  if (session.phase !== "draft") return session;

  const p1 = session.player1_picks.length;
  const p2 = session.player2_picks.length;

  if (isDraftComplete(p1, p2)) {
    logger.warn("[rankedDraft] advancing a full draft that was left unfinished", {
      sessionId: session.session_id,
      p1,
      p2,
    });
    await beginBlockPhase(session);
    return (await RankedDraftSessionModel.findById(session.session_id)) ?? session;
  }

  const correct = resolveCurrentPicker(
    session.player1_id,
    session.player2_id,
    p1,
    p2
  );
  if (!correct || correct === session.current_picker_id) return session;

  logger.warn("[rankedDraft] repairing a stuck turn", {
    sessionId: session.session_id,
    storedPicker: session.current_picker_id,
    correctPicker: correct,
    p1,
    p2,
  });

  const deadline = new Date(Date.now() + RANKED_DRAFT_CONFIG.PICK_MS);
  const repaired = await RankedDraftSessionModel.beginDraftPhase(
    session.session_id,
    correct,
    deadline
  );
  scheduleTimer(session.session_id, deadline);
  return repaired;
}

/** Sends each player their own redacted view of the session. */
export async function pushStateToBoth(
  session: RankedDraftSession
): Promise<void> {
  for (const viewerId of [session.player1_id, session.player2_id]) {
    const opponentId =
      viewerId === session.player1_id ? session.player2_id : session.player1_id;
    const [opponent, recentCardIds] = await Promise.all([
      UserModel.findById(opponentId),
      RankedDraft.getRecentCards(viewerId),
    ]);
    const payload = await toStatePayload(session, viewerId, {
      opponentUsername: opponent?.username ?? "Opponent",
      recentCardIds,
    });
    emitToUser(viewerId, PresenceNamespaceEvent.DRAFT_SERVER_STATE, payload);
  }
}

/** Creates a session for a freshly matched pair and starts the ban clock. */
export async function startSession(
  player1Id: string,
  player2Id: string
): Promise<RankedDraftSession> {
  const deadline = new Date(Date.now() + RANKED_DRAFT_CONFIG.BAN_MS);
  const session = await RankedDraftSessionModel.create(
    player1Id,
    player2Id,
    deadline
  );

  emitToBoth(session, PresenceNamespaceEvent.DRAFT_SERVER_STARTED, {
    sessionId: session.session_id,
  });
  await pushStateToBoth(session);
  scheduleTimer(session.session_id, deadline);

  logger.info("[rankedDraft] session started", {
    sessionId: session.session_id,
    player1Id,
    player2Id,
  });
  return session;
}

/**
 * Records a ban.
 *
 * The opponent is told only THAT a ban landed. The card id itself stays on the
 * server until both bans exist, at which point both are revealed together.
 */
export async function submitBan(
  sessionId: string,
  userId: string,
  cardVariantId: string
): Promise<void> {
  const client = await db.getClient();
  let updated: RankedDraftSession;
  try {
    await client.query("BEGIN");
    await RankedDraftSessionModel.lock(sessionId, client);
    const session = await RankedDraftSessionModel.findById(sessionId, client);
    if (!session) throw new DraftRuleError("Draft not found.");

    await validateBan(session, userId, cardVariantId);
    updated = await RankedDraftSessionModel.setBan(
      sessionId,
      session.player1_id === userId,
      cardVariantId,
      client
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const opponentId =
    updated.player1_id === userId ? updated.player2_id : updated.player1_id;

  if (!RankedDraft.bansComplete(updated)) {
    // Boolean only — the value is deliberately not on the wire yet.
    emitToUser(opponentId, PresenceNamespaceEvent.DRAFT_SERVER_BAN_SUBMITTED, {
      sessionId,
      opponentSubmitted: true,
    });
    await pushStateToBoth(updated);
    return;
  }

  await revealBansAndBeginDraft(updated);
}

/** Both bans are in: reveal them together and open the draft. */
async function revealBansAndBeginDraft(
  session: RankedDraftSession
): Promise<void> {
  const firstPicker = resolveCurrentPicker(
    session.player1_id,
    session.player2_id,
    session.player1_picks.length,
    session.player2_picks.length
  )!;
  const deadline = new Date(Date.now() + RANKED_DRAFT_CONFIG.PICK_MS);
  const updated = await RankedDraftSessionModel.beginDraftPhase(
    session.session_id,
    firstPicker,
    deadline
  );

  for (const viewerId of [updated.player1_id, updated.player2_id]) {
    const isP1 = viewerId === updated.player1_id;
    const payload: RankedDraftBanRevealedPayload = {
      sessionId: updated.session_id,
      myBan: isP1 ? updated.player1_ban : updated.player2_ban,
      opponentBan: isP1 ? updated.player2_ban : updated.player1_ban,
      nextPickerId: firstPicker,
      deadlineMs: deadline.getTime(),
    };
    emitToUser(
      viewerId,
      PresenceNamespaceEvent.DRAFT_SERVER_BAN_REVEALED,
      payload
    );
  }

  await pushStateToBoth(updated);
  scheduleTimer(updated.session_id, deadline);
}

/** Records a pick and advances the turn, completing the draft on the last one. */
export async function submitPick(
  sessionId: string,
  userId: string,
  cardVariantId: string,
  options: { autoPicked?: boolean; chosenVariantId?: string | null } = {}
): Promise<void> {
  const client = await db.getClient();
  let updated: RankedDraftSession;
  try {
    await client.query("BEGIN");
    await RankedDraftSessionModel.lock(sessionId, client);
    const session = await RankedDraftSessionModel.findById(sessionId, client);
    if (!session) throw new DraftRuleError("Draft not found.");

    await validatePick(session, userId, cardVariantId);

    // A cosmetic skin is honoured only if the player actually owns it;
    // anything else silently falls back to the original printing so a bad
    // preference can never block the pick.
    const chosenVariantId = options.chosenVariantId
      ? await resolveOwnedVariant(userId, cardVariantId, options.chosenVariantId)
      : null;

    // Derive the next turn from what each player will HOLD after this pick,
    // not from the running index. See resolveCurrentPicker: an index-derived
    // turn can point at a player who is already full, which deadlocks the
    // draft permanently.
    const p1Count =
      session.player1_picks.length + (session.player1_id === userId ? 1 : 0);
    const p2Count =
      session.player2_picks.length + (session.player2_id === userId ? 1 : 0);

    const isComplete = isDraftComplete(p1Count, p2Count);
    const nextPicker = isComplete
      ? null
      : resolveCurrentPicker(
          session.player1_id,
          session.player2_id,
          p1Count,
          p2Count
        );

    // One clock per TURN, not per pick.
    //
    // The deadline is only re-armed when the turn actually changes hands. A
    // player taking the first card of a two-card block keeps the SAME deadline
    // for the second, so the whole block shares one window — otherwise picking
    // fast would be punished (each pick reset the clock, handing a two-card
    // turn twice the thinking time of a one-card turn).
    const turnPasses = nextPicker !== null && nextPicker !== userId;
    const nextDeadline = isComplete
      ? null
      : turnPasses
        ? new Date(Date.now() + RANKED_DRAFT_CONFIG.PICK_MS)
        : session.deadline_at;

    updated = await RankedDraftSessionModel.appendPick(
      sessionId,
      session.player1_id === userId,
      cardVariantId,
      nextPicker,
      nextDeadline,
      client,
      chosenVariantId === cardVariantId ? null : chosenVariantId
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const payload: RankedDraftPickMadePayload = {
    sessionId,
    pickerId: userId,
    cardVariantId,
    pickIndex: updated.pick_index - 1,
    nextPickerId: updated.current_picker_id,
    deadlineMs: updated.deadline_at ? updated.deadline_at.getTime() : null,
    autoPicked: options.autoPicked ?? false,
  };
  emitToBoth(updated, PresenceNamespaceEvent.DRAFT_SERVER_PICK_MADE, payload);
  await pushStateToBoth(updated);

  if (
    isDraftComplete(
      updated.player1_picks.length,
      updated.player2_picks.length
    )
  ) {
    clearTimer(sessionId);
    await beginBlockPhase(updated);
    return;
  }
  if (updated.deadline_at) scheduleTimer(sessionId, updated.deadline_at);
}

/**
 * Draft is full: open the simultaneous block phase.
 *
 * Both players choose at once (there is no turn), so the clock is a single
 * shared deadline rather than a per-turn one.
 */
async function beginBlockPhase(session: RankedDraftSession): Promise<void> {
  const deadline = new Date(Date.now() + RANKED_DRAFT_CONFIG.BLOCK_MS);
  const updated = await RankedDraftSessionModel.beginBlockPhase(
    session.session_id,
    deadline
  );

  emitToBoth(updated, PresenceNamespaceEvent.DRAFT_SERVER_BLOCK_STARTED, {
    sessionId: updated.session_id,
    deadlineMs: deadline.getTime(),
  });
  await pushStateToBoth(updated);
  scheduleTimer(updated.session_id, deadline);

  logger.info("[rankedDraft] block phase opened", {
    sessionId: updated.session_id,
  });
}

/**
 * Records a block.
 *
 * Like bans, the opponent learns only THAT a block landed; the card itself is
 * withheld until both are in, so neither player can react to the other.
 */
export async function submitBlock(
  sessionId: string,
  userId: string,
  cardVariantId: string
): Promise<void> {
  const client = await db.getClient();
  let updated: RankedDraftSession;
  try {
    await client.query("BEGIN");
    await RankedDraftSessionModel.lock(sessionId, client);
    const session = await RankedDraftSessionModel.findById(sessionId, client);
    if (!session) throw new DraftRuleError("Draft not found.");

    await validateBlock(session, userId, cardVariantId);
    updated = await RankedDraftSessionModel.setBlock(
      sessionId,
      session.player1_id === userId,
      cardVariantId,
      client
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (!blocksComplete(updated)) {
    const opponentId =
      updated.player1_id === userId ? updated.player2_id : updated.player1_id;
    // Boolean only — the value is deliberately not on the wire yet.
    emitToUser(opponentId, PresenceNamespaceEvent.DRAFT_SERVER_BLOCK_SUBMITTED, {
      sessionId,
      opponentSubmitted: true,
    });
    await pushStateToBoth(updated);
    return;
  }

  clearTimer(sessionId);
  await revealBlocksAndStartGame(updated);
}

/**
 * Both blocks are in: reveal them together, hold, then start the game.
 *
 * The hold is what makes the reveal readable — dropping straight into the game
 * would show each player their blocked card for a single frame.
 */
async function revealBlocksAndStartGame(
  session: RankedDraftSession
): Promise<void> {
  for (const viewerId of [session.player1_id, session.player2_id]) {
    const isP1 = viewerId === session.player1_id;
    const payload: RankedDraftBlockRevealedPayload = {
      sessionId: session.session_id,
      myBlock: isP1 ? session.player1_block : session.player2_block,
      blockedFromMe: isP1 ? session.player2_block : session.player1_block,
      revealMs: RANKED_DRAFT_CONFIG.BLOCK_REVEAL_MS,
    };
    emitToUser(
      viewerId,
      PresenceNamespaceEvent.DRAFT_SERVER_BLOCK_REVEALED,
      payload
    );
  }
  await pushStateToBoth(session);

  logger.info("[rankedDraft] blocks revealed, holding before game", {
    sessionId: session.session_id,
    holdMs: RANKED_DRAFT_CONFIG.BLOCK_REVEAL_MS,
  });

  // The hold is server-side so both clients enter the game together regardless
  // of when each rendered the reveal. completeDraft is idempotent-ish via the
  // phase check inside it, and the sweeper is a backstop if this never fires.
  const timer = setTimeout(() => {
    timers.delete(session.session_id);
    (async () => {
      const latest = await RankedDraftSessionModel.findById(session.session_id);
      if (!latest || latest.phase !== "block") return;
      await completeDraft(latest);
    })().catch((error) => {
      logger.error("[rankedDraft] post-reveal game start failed", {
        sessionId: session.session_id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, RANKED_DRAFT_CONFIG.BLOCK_REVEAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  timers.set(session.session_id, timer);
}

/** Builds the game from the finished draft and hands both players to it. */
async function completeDraft(session: RankedDraftSession): Promise<void> {
  // Skins are applied here: each drafted original is swapped for the owned
  // variant the player chose, if any. Power is unaffected (level 1, no
  // power-ups, stats come from the character), so this is purely visual.
  const applySkins = (picks: string[], skins: Record<string, string>) =>
    picks.map((originalId) => skins?.[originalId] ?? originalId);

  /**
   * Drop the card the OPPONENT blocked.
   *
   * player1_block is player1's choice against player2, so it is removed from
   * player2's picks (and vice versa). Removes ONE instance: a draft cannot
   * contain duplicates today, but matching once keeps this correct if that ever
   * changes. Applied before skins so the block matches on canonical identity.
   */
  const applyBlock = (picks: string[], blocked: string | null) => {
    if (!blocked) return picks;
    const at = picks.indexOf(blocked);
    if (at === -1) return picks;
    return [...picks.slice(0, at), ...picks.slice(at + 1)];
  };

  const p1Kept = applyBlock(session.player1_picks, session.player2_block);
  const p2Kept = applyBlock(session.player2_picks, session.player1_block);

  const { gameState } = await buildDraftGameState(
    session.player1_id,
    applySkins(p1Kept, session.player1_variants),
    session.player2_id,
    applySkins(p2Kept, session.player2_variants)
  );

  const client = await db.getClient();
  let gameId: string;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO "games"
         (player1_id, player2_id, player1_deck_id, player2_deck_id,
          game_mode, game_status, board_layout, game_state, created_at)
       VALUES ($1, $2, NULL, NULL, 'ranked_draft', $3, '4x4', $4, NOW())
       RETURNING game_id`,
      [
        session.player1_id,
        session.player2_id,
        gameState.status,
        JSON.stringify(gameState),
      ]
    );
    gameId = rows[0].game_id;

    await RankedDraftSessionModel.complete(session.session_id, gameId, client);

    // Recency is written once, here, so an abandoned draft leaves no trace.
    await RankedDraft.recordRecentCards(
      session.player1_id,
      session.player1_picks,
      client as never
    );
    await RankedDraft.recordRecentCards(
      session.player2_id,
      session.player2_picks,
      client as never
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const payload: RankedDraftCompletedPayload = {
    sessionId: session.session_id,
    gameId,
  };
  emitToBoth(session, PresenceNamespaceEvent.DRAFT_SERVER_COMPLETED, payload);

  logger.info("[rankedDraft] draft complete, game created", {
    sessionId: session.session_id,
    gameId,
  });
}

/**
 * A player quits the draft.
 *
 * Deliberately records NO result: the abandoner has no legal deck yet (they may
 * hold 3 of 11 cards), and `game_results.game_id` is NOT NULL with a FK to
 * `games`, so a rated forfeit would mean fabricating a game row with no state.
 * Ending cleanly also removes any incentive to farm losses off a quit.
 *
 * Each side is told who quit so the messaging can differ.
 */
export async function abandonSession(
  sessionId: string,
  userId: string
): Promise<void> {
  const session = await RankedDraftSessionModel.findById(sessionId);
  if (!session) throw new DraftRuleError("Draft not found.");
  if (!RankedDraft.isParticipant(session, userId)) {
    throw new DraftRuleError("You are not part of this draft.");
  }

  clearTimer(sessionId);
  const aborted = await RankedDraftSessionModel.abort(sessionId);
  // Already finished or aborted: nothing to do, and no message to send.
  if (!aborted) return;

  const opponentId =
    aborted.player1_id === userId ? aborted.player2_id : aborted.player1_id;

  emitToUser(userId, PresenceNamespaceEvent.DRAFT_SERVER_ABORTED, {
    sessionId,
    reason: "You left the draft.",
    abandonedByMe: true,
  });
  emitToUser(opponentId, PresenceNamespaceEvent.DRAFT_SERVER_ABORTED, {
    sessionId,
    reason: "Your opponent left the draft.",
    abandonedByMe: false,
  });

  logger.info("[rankedDraft] session abandoned", { sessionId, userId });
}

export async function abortSession(
  sessionId: string,
  reason: string
): Promise<void> {
  clearTimer(sessionId);
  const aborted = await RankedDraftSessionModel.abort(sessionId);
  if (!aborted) return;
  const payload: RankedDraftAbortedPayload = { sessionId, reason };
  emitToBoth(aborted, PresenceNamespaceEvent.DRAFT_SERVER_ABORTED, payload);
  logger.info("[rankedDraft] session aborted", { sessionId, reason });
}

/**
 * The clock ran out.
 *
 * Ban timeout: a player who never banned simply forfeits their ban (the draft
 * still proceeds), because the format survives fine with fewer bans but not
 * with a stalled session.
 * Pick timeout: auto-pick, so the deck always ends up legal and complete.
 */
export async function onDeadlineExpired(sessionId: string): Promise<void> {
  const session = await RankedDraftSessionModel.findById(sessionId);
  if (!session) return;
  if (
    session.phase !== "ban" &&
    session.phase !== "draft" &&
    session.phase !== "block"
  ) {
    return;
  }
  if (session.deadline_at && session.deadline_at.getTime() > Date.now()) {
    // Rescheduled since this timer was armed.
    scheduleTimer(sessionId, session.deadline_at);
    return;
  }

  if (session.phase === "ban") {
    // Fill any missing ban with a deterministic no-op-ish choice so the phase
    // can close; a player who didn't act loses the strategic value of banning.
    let current = session;
    for (const [userId, existing] of [
      [current.player1_id, current.player1_ban],
      [current.player2_id, current.player2_ban],
    ] as const) {
      if (existing) continue;
      const auto = await chooseAutoPick(current, userId);
      if (!auto) continue;
      current = await RankedDraftSessionModel.setBan(
        current.session_id,
        current.player1_id === userId,
        auto
      );
    }
    if (RankedDraft.bansComplete(current)) {
      await revealBansAndBeginDraft(current);
    } else {
      await abortSession(sessionId, "Ban phase could not be resolved.");
    }
    return;
  }

  if (session.phase === "block") {
    // Fill any missing block with the opponent's strongest card, then reveal.
    // Both players choose simultaneously, so either or both may be missing.
    let current = session;
    for (const userId of [current.player1_id, current.player2_id]) {
      const existing =
        current.player1_id === userId
          ? current.player1_block
          : current.player2_block;
      if (existing) continue;
      const auto = await chooseAutoBlock(current, userId);
      if (!auto) continue;
      current = await RankedDraftSessionModel.setBlock(
        current.session_id,
        current.player1_id === userId,
        auto
      );
    }
    if (blocksComplete(current)) {
      await revealBlocksAndStartGame(current);
    } else {
      // Nothing legal to block on either side should be impossible once the
      // draft is full; completing without a block is better than stranding it.
      await completeDraft(current);
    }
    return;
  }

  const pickerId = session.current_picker_id;
  if (!pickerId) return;
  // Guard: never auto-pick for someone who is already full — submitPick would
  // reject it and the session would sit here forever.
  const pickerCount =
    session.player1_id === pickerId
      ? session.player1_picks.length
      : session.player2_picks.length;
  if (pickerCount >= RANKED_DRAFT_CONFIG.PICKS) {
    await reconcileSession(session);
    return;
  }
  // The clock covers the whole turn, so a timeout must fill EVERY pick still
  // owed in this block — not just one. Stopping after a single card would leave
  // the turn open with an already-expired deadline, and the next sweep would
  // have to fire again for each remaining card.
  //
  // Re-read between iterations: submitPick advances the turn, so the loop must
  // see the updated session to know when the block (or the draft) is done.
  const owed = RankedDraft.picksLeftInTurn(session.pick_index);
  for (let i = 0; i < owed; i++) {
    const current = await RankedDraftSessionModel.findById(sessionId);
    if (!current || current.phase !== "draft") return;
    // The turn moved on (or the draft ended) — nothing further is owed here.
    if (current.current_picker_id !== pickerId) return;

    const auto = await chooseAutoPick(current, pickerId);
    if (!auto) {
      await abortSession(sessionId, "No legal card remained to auto-pick.");
      return;
    }
    await submitPick(sessionId, pickerId, auto, { autoPicked: true });
  }
}

/**
 * Resolves any session whose deadline passed while the process was down.
 *
 * Timers are in-process, so a restart would otherwise strand every live draft.
 */
export async function sweepExpiredSessions(): Promise<number> {
  const expired = await RankedDraftSessionModel.findExpired();
  for (const session of expired) {
    try {
      // Repair before acting: a session whose turn points at a full player
      // would otherwise fail its auto-pick forever and never expire out.
      const fixed = await reconcileSession(session);
      if (
        fixed.phase !== "draft" &&
        fixed.phase !== "ban" &&
        fixed.phase !== "block"
      ) {
        continue;
      }
      await onDeadlineExpired(session.session_id);
    } catch (error) {
      logger.error("[rankedDraft] sweep failed for session", {
        sessionId: session.session_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return expired.length;
}

/**
 * Aborts ranked_draft games that are far past any possible legitimate runtime.
 *
 * The queue guard in rankedDraft.controller blocks a second draft while an
 * `active`/`mulligan` ranked_draft game exists. That guard is correct, but
 * nothing ever ended a game whose turn clock stopped advancing, so a single
 * stalled game locked the player out of the mode permanently. Bounded by
 * RANKED_DRAFT_GAME_MAX_AGE_MINUTES rather than a turn deadline because `games`
 * has no updated_at column — only created_at.
 *
 * Uses 'aborted': the game_status enum has no 'cancelled' value.
 */
export async function reapStaleRankedGames(): Promise<number> {
  try {
    const { rows } = await db.query(
      `UPDATE "games"
          SET game_status = 'aborted', completed_at = NOW()
        WHERE game_mode = 'ranked_draft'
          AND game_status IN ('pending', 'active', 'mulligan')
          AND created_at < NOW() - ($1 || ' minutes')::interval
        RETURNING game_id`,
      [String(RANKED_DRAFT_GAME_MAX_AGE_MINUTES)]
    );
    if (rows.length > 0) {
      logger.warn("[rankedDraft] aborted stale ranked games", {
        count: rows.length,
        maxAgeMinutes: RANKED_DRAFT_GAME_MAX_AGE_MINUTES,
      });
    }
    return rows.length;
  } catch (error) {
    logger.error("[rankedDraft] stale game reap failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export default {
  setPresenceNamespace,
  startSession,
  submitBan,
  submitPick,
  submitBlock,
  abandonSession,
  abortSession,
  pushStateToBoth,
  reconcileSession,
  sweepExpiredSessions,
  reapStaleRankedGames,
  onDeadlineExpired,
};
