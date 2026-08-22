import db from "../config/db.config";
import RankedDraftSessionModel, {
  RankedDraftSession,
} from "../models/rankedDraftSession.model";
import {
  RANKED_DRAFT_CONFIG,
  RARITY_POWER_COST,
} from "../config/constants";
import { RankedDraftStatePayload } from "../types/socket.types";
import logger from "../utils/logger";

/**
 * Rules and lifecycle for a Ranked Draft session.
 *
 * Everything here is server-authoritative. The client renders a budget and a
 * pool, but it is advisory: every ban and every pick is re-validated here
 * against the session row, because a client is free to lie.
 */

export const RANKED_DRAFT_FLAG = "ranked-draft-pvp";
export const RANKED_DRAFT_REWARDS_FLAG = "ranked-draft-rewards";

export class DraftRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftRuleError";
  }
}

/** Strip "+" upgrade suffixes, matching the client's getBaseRarity. */
export function baseRarity(rarity: string): string {
  return (rarity || "").replace(/\+/g, "").toLowerCase();
}

/**
 * Power cost of a card in the draft budget.
 *
 * Unlike the shared unranked helper, an UNKNOWN rarity throws here rather than
 * defaulting to 0. In the deck editor a 0 is a harmless display quirk; in the
 * draft it would mean a whole rarity tier is free, silently defeating the power
 * cap. The catalog currently tops out at legendary+++, but a future tier
 * (Mythic) must fail loudly the first time someone drafts one rather than
 * quietly breaking the format.
 */
export function cardPowerCost(rarity: string | undefined): number {
  if (!rarity) {
    throw new DraftRuleError("Card is missing a rarity and cannot be drafted.");
  }
  const cost = RARITY_POWER_COST[baseRarity(rarity)];
  if (cost === undefined) {
    throw new DraftRuleError(
      `Unknown rarity "${rarity}" has no draft power cost. Add it to RARITY_POWER_COST before allowing it in the draft pool.`
    );
  }
  return cost;
}

/** Total picks across both players in a completed draft. */
export const TOTAL_PICKS = RANKED_DRAFT_CONFIG.PICKS * 2;

/**
 * Draft order: 1, then blocks of 2, then 1.
 *
 * With PICKS = 11 and PICKS_PER_TURN = 2 the sequence is
 *
 *   P1 | P2 P2 | P1 P1 | P2 P2 | ... | P1 P1 | P2
 *   1    2  3    4  5    6  7          20 21   22
 *
 * i.e. `1221122112211221122112`. P1 opens with a single pick and P2 closes with
 * a single pick; everything between is the familiar 2-card block.
 *
 * This is a snake at the seams rather than a plain block alternation. The
 * opening single is what pays for first-pick advantage: P1 gets the very best
 * card in the pool but then watches P2 take two in a row, so the raw
 * card-quality edge is handed straight back. The closing single keeps the
 * totals equal — without it P2 would end a card short.
 *
 * Both counts land on exactly PICKS, which resolveCurrentPicker relies on.
 */
export function pickerForIndex(
  pickIndex: number,
  player1Id: string,
  player2Id: string
): string {
  // The opening pick is P1's alone.
  if (pickIndex === 0) return player1Id;
  // After it, 2-card blocks alternate starting with P2. Shifting by the opening
  // pick is what makes the tail land as a single P2 pick rather than a pair.
  const block = Math.floor(
    (pickIndex - 1) / RANKED_DRAFT_CONFIG.PICKS_PER_TURN
  );
  return block % 2 === 0 ? player2Id : player1Id;
}

/**
 * Whose turn it is, derived from what each player ACTUALLY holds.
 *
 * This supersedes pickerForIndex as the authority. Deriving the turn purely
 * from a global counter assumes a perfect block cadence forever; if the two
 * ever drift — a timeout firing against a stale read, a retry, any race — the
 * counter can hand the turn to a player who is already full, and
 * validatePick's "you have already drafted a full deck" makes that a permanent
 * deadlock with no way out for either side. (Observed: index 19 pointing at a
 * player holding 10/10 while their opponent was owed one.)
 *
 * Rules, in order:
 *   1. A player who already has PICKS cards can never be on turn.
 *   2. Otherwise follow the intended block cadence.
 *   3. If the cadence points at a full player, give the turn to whoever is
 *      still owed cards — self-healing rather than stuck.
 *
 * Returns null only when BOTH players are full, which means the draft is done.
 */
export function resolveCurrentPicker(
  player1Id: string,
  player2Id: string,
  player1PickCount: number,
  player2PickCount: number
): string | null {
  const max = RANKED_DRAFT_CONFIG.PICKS;
  const p1Full = player1PickCount >= max;
  const p2Full = player2PickCount >= max;

  if (p1Full && p2Full) return null;
  if (p1Full) return player2Id;
  if (p2Full) return player1Id;

  // Both still owed cards: follow the intended cadence.
  const intended = pickerForIndex(
    player1PickCount + player2PickCount,
    player1Id,
    player2Id
  );
  return intended;
}

/** True when the draft has all the picks it needs. */
export function isDraftComplete(
  player1PickCount: number,
  player2PickCount: number
): boolean {
  return (
    player1PickCount >= RANKED_DRAFT_CONFIG.PICKS &&
    player2PickCount >= RANKED_DRAFT_CONFIG.PICKS
  );
}

/**
 * How many picks remain in the current player's turn.
 *
 * Drives the "pick 2 of 2" affordance and the shared turn clock: a turn is not
 * over until its block is filled.
 *
 * Must follow the same 1 / 2,2,… / 1 shape as pickerForIndex — the opening and
 * closing turns are single picks, so a flat modulo would claim two are owed and
 * the turn would never resolve.
 */
export function picksLeftInTurn(pickIndex: number): number {
  const per = RANKED_DRAFT_CONFIG.PICKS_PER_TURN;
  const total = TOTAL_PICKS;

  // Opening turn: a single pick.
  if (pickIndex === 0) return 1;
  // Closing turn: the final pick stands alone.
  if (pickIndex >= total - 1) return 1;

  const used = (pickIndex - 1) % per;
  const left = per - used;
  // Never promise more picks than the draft has left (guards the seam into the
  // closing single).
  return Math.min(left, total - pickIndex);
}

/** True when this pick ends the current player's turn. */
export function isLastPickOfTurn(pickIndex: number): boolean {
  return picksLeftInTurn(pickIndex) === 1;
}


/** Cost of a set of picks, by card_variant_id. */
export async function budgetSpentFor(
  cardVariantIds: string[]
): Promise<number> {
  if (cardVariantIds.length === 0) return 0;
  const { rows } = await db.query(
    `SELECT rarity FROM card_variants WHERE card_variant_id = ANY($1::uuid[])`,
    [cardVariantIds]
  );
  return rows.reduce(
    (total: number, r: { rarity: string }) => total + cardPowerCost(r.rarity),
    0
  );
}

function picksOf(session: RankedDraftSession, userId: string): string[] {
  return session.player1_id === userId
    ? session.player1_picks
    : session.player2_picks;
}

function opponentOf(session: RankedDraftSession, userId: string): string {
  return session.player1_id === userId
    ? session.player2_id
    : session.player1_id;
}

export function isParticipant(
  session: RankedDraftSession,
  userId: string
): boolean {
  return session.player1_id === userId || session.player2_id === userId;
}

/** Both bans are in, so the pool and the reveal are settled. */
export function bansComplete(session: RankedDraftSession): boolean {
  return !!session.player1_ban && !!session.player2_ban;
}

/**
 * Cards nobody may draft: both bans plus everything already taken.
 *
 * Bans are only included once BOTH are in. During the ban phase the opponent's
 * ban is not part of any payload, so it cannot leak through this list either.
 */
export function unavailableCardIds(session: RankedDraftSession): string[] {
  const taken = [...session.player1_picks, ...session.player2_picks];
  if (!bansComplete(session)) return taken;
  return [session.player1_ban!, session.player2_ban!, ...taken];
}

/**
 * Projects a session into what ONE player is allowed to see.
 *
 * The opponent's ban is omitted entirely until both are submitted — the value
 * is never serialized to a socket that must not see it yet, rather than being
 * sent and hidden by the client.
 */
export async function toStatePayload(
  session: RankedDraftSession,
  viewerId: string,
  extras: { opponentUsername: string; recentCardIds: string[] }
): Promise<RankedDraftStatePayload> {
  const isP1 = session.player1_id === viewerId;
  const myBan = isP1 ? session.player1_ban : session.player2_ban;
  const oppBan = isP1 ? session.player2_ban : session.player1_ban;
  const revealed = bansComplete(session);
  const myPicks = picksOf(session, viewerId);

  // "My block" is the one I made against my opponent; "blocked from me" is the
  // one they made against my deck. Held back until both are in, same as bans.
  const myBlock = isP1 ? session.player1_block : session.player2_block;
  const theirBlock = isP1 ? session.player2_block : session.player1_block;
  const blocksRevealed = blocksComplete(session);

  return {
    sessionId: session.session_id,
    phase: session.phase,
    myBan: myBan ?? null,
    opponentBan: revealed ? (oppBan ?? null) : null,
    opponentBanSubmitted: !!oppBan,
    myPicks,
    opponentPicks: picksOf(session, opponentOf(session, viewerId)),
    budgetSpent: await budgetSpentFor(myPicks),
    budgetTotal: RANKED_DRAFT_CONFIG.POWER_BUDGET,
    picksMade: myPicks.length,
    picksTotal: RANKED_DRAFT_CONFIG.PICKS,
    currentPickerId: session.current_picker_id,
    isMyTurn: session.current_picker_id === viewerId,
    picksLeftInTurn: picksLeftInTurn(session.pick_index),
    picksPerTurn: RANKED_DRAFT_CONFIG.PICKS_PER_TURN,
    deadlineMs: session.deadline_at ? session.deadline_at.getTime() : null,
    opponentUsername: extras.opponentUsername,
    unavailableCardIds: unavailableCardIds(session),
    recentCardIds: extras.recentCardIds,
    myVariants: (isP1 ? session.player1_variants : session.player2_variants) ?? {},
    iDraftFirst: isP1,
    myBlock: myBlock ?? null,
    blockedFromMe: blocksRevealed ? (theirBlock ?? null) : null,
    opponentBlockSubmitted: !!theirBlock,
    gameId: session.game_id,
  };
}

/**
 * The draftable pool is ORIGINAL printings only (no +/++/+++ variants).
 *
 * Two reasons this is the right shape:
 *  - Variants are cosmetic. Listing four Amaterasus that play identically is
 *    noise in a 20-second pick, and it quadrupled the grid (290 entries down
 *    to 90).
 *  - It keeps the format collection-independent: you draft a CHARACTER, then
 *    separately choose which of your owned skins to wear (see
 *    resolveOwnedVariant).
 */
export const ORIGINAL_RARITY_SQL = `cv.rarity !~ '\\+'`;

/**
 * Resolves a drafted pick to the variant that will actually be played.
 *
 * The pick is always an original printing. If the player owns a fancier
 * variant of the same character and asks for it, we honour it — but ONLY as
 * cosmetics: drafted cards are level 1 with no power-ups regardless, and the
 * power values come from the character, not the variant. So this can never buy
 * a stat advantage, which is what keeps the mode collection-independent.
 *
 * Falls back to the original whenever the request is unowned or bogus, rather
 * than failing the pick — a cosmetic preference must never block a draft.
 */
export async function resolveOwnedVariant(
  userId: string,
  originalVariantId: string,
  requestedVariantId: string | null | undefined
): Promise<string> {
  if (!requestedVariantId || requestedVariantId === originalVariantId) {
    return originalVariantId;
  }
  const { rows } = await db.query(
    `
      SELECT 1
      FROM card_variants requested
      JOIN card_variants original
        ON original.character_id = requested.character_id
      JOIN user_owned_cards uoc
        ON uoc.card_variant_id = requested.card_variant_id
       AND uoc.user_id = $1
      WHERE requested.card_variant_id = $2
        AND original.card_variant_id = $3
      LIMIT 1
    `,
    [userId, requestedVariantId, originalVariantId]
  );
  return rows.length > 0 ? requestedVariantId : originalVariantId;
}

/**
 * Variants of a drafted character that this player owns, for the skin picker.
 *
 * Returns the original first (always available to everyone), then any owned
 * upgrades. Purely cosmetic — see resolveOwnedVariant.
 */
export async function getOwnedVariantsForPick(
  userId: string,
  originalVariantId: string
): Promise<
  { cardVariantId: string; rarity: string; imageUrl: string; owned: boolean }[]
> {
  const { rows } = await db.query(
    `
      SELECT cv.card_variant_id, cv.rarity, cv.image_url,
             (uoc.user_card_instance_id IS NOT NULL) AS owned
      FROM card_variants original
      JOIN card_variants cv ON cv.character_id = original.character_id
      LEFT JOIN LATERAL (
        SELECT user_card_instance_id
        FROM user_owned_cards
        WHERE user_id = $1 AND card_variant_id = cv.card_variant_id
        LIMIT 1
      ) uoc ON TRUE
      WHERE original.card_variant_id = $2
      ORDER BY length(cv.rarity) ASC, cv.rarity ASC
    `,
    [userId, originalVariantId]
  );
  return rows
    .filter(
      (r: { card_variant_id: string; owned: boolean }) =>
        r.owned || r.card_variant_id === originalVariantId
    )
    .map((r: any) => ({
      cardVariantId: r.card_variant_id,
      rarity: r.rarity,
      imageUrl: r.image_url,
      owned: !!r.owned,
    }));
}

/** Validates a ban against the catalog and the session's phase. */
/** True once BOTH players have chosen a card to block. */
export function blocksComplete(session: RankedDraftSession): boolean {
  return !!session.player1_block && !!session.player2_block;
}

/**
 * A block must name a card in the OPPONENT's draft.
 *
 * Blocking your own card would be nonsense, and blocking something neither
 * player drafted would silently no-op at deck-build time — both are rejected
 * loudly here rather than discovered later.
 */
export async function validateBlock(
  session: RankedDraftSession,
  userId: string,
  cardVariantId: string
): Promise<void> {
  if (!isParticipant(session, userId)) {
    throw new DraftRuleError("You are not part of this draft.");
  }
  if (session.phase !== "block") {
    throw new DraftRuleError("The block phase is not open.");
  }
  const existing =
    session.player1_id === userId
      ? session.player1_block
      : session.player2_block;
  if (existing) {
    throw new DraftRuleError("You have already blocked a card.");
  }
  const opponentPicks = picksOf(session, opponentOf(session, userId));
  if (!opponentPicks.includes(cardVariantId)) {
    throw new DraftRuleError("You can only block a card your opponent drafted.");
  }
}

export async function validateBan(
  session: RankedDraftSession,
  userId: string,
  cardVariantId: string
): Promise<void> {
  if (!isParticipant(session, userId)) {
    throw new DraftRuleError("You are not part of this draft.");
  }
  if (session.phase !== "ban") {
    throw new DraftRuleError("The ban phase is over.");
  }
  const existing =
    session.player1_id === userId ? session.player1_ban : session.player2_ban;
  if (existing) {
    throw new DraftRuleError("You have already banned a card.");
  }
  const { rows } = await db.query(
    `SELECT 1 FROM card_variants cv
     WHERE cv.card_variant_id = $1 AND ${ORIGINAL_RARITY_SQL}`,
    [cardVariantId]
  );
  if (rows.length === 0) {
    // Bans are on the original printing, matching the draftable pool.
    throw new DraftRuleError("That card cannot be banned.");
  }
}

/**
 * Validates a pick: right phase, right player, still available, affordable.
 *
 * The budget check accounts for picks still owed — a player must never be able
 * to spend so much that they cannot legally fill the rest of their deck. Every
 * remaining pick can cost 0 (commons are free), so the requirement is simply
 * that this pick fits in what's left.
 */
export async function validatePick(
  session: RankedDraftSession,
  userId: string,
  cardVariantId: string
): Promise<{ cost: number }> {
  if (!isParticipant(session, userId)) {
    throw new DraftRuleError("You are not part of this draft.");
  }
  if (session.phase !== "draft") {
    throw new DraftRuleError("The draft is not in progress.");
  }
  if (session.current_picker_id !== userId) {
    throw new DraftRuleError("It is not your turn to pick.");
  }

  const myPicks = picksOf(session, userId);
  if (myPicks.length >= RANKED_DRAFT_CONFIG.PICKS) {
    throw new DraftRuleError("You have already drafted a full deck.");
  }
  if (unavailableCardIds(session).includes(cardVariantId)) {
    throw new DraftRuleError("That card is banned or already drafted.");
  }

  const { rows } = await db.query(
    `SELECT cv.rarity FROM card_variants cv
     WHERE cv.card_variant_id = $1 AND ${ORIGINAL_RARITY_SQL}`,
    [cardVariantId]
  );
  if (rows.length === 0) {
    // Only original printings are draftable; a variant is chosen afterwards
    // as a skin (resolveOwnedVariant) and never enters the pool itself.
    throw new DraftRuleError("That card is not in the draft pool.");
  }

  const cost = cardPowerCost(rows[0].rarity);
  const spent = await budgetSpentFor(myPicks);
  if (spent + cost > RANKED_DRAFT_CONFIG.POWER_BUDGET) {
    throw new DraftRuleError(
      `That pick costs ${cost} power; you have ${RANKED_DRAFT_CONFIG.POWER_BUDGET - spent} left.`
    );
  }
  return { cost };
}

/**
 * The card the server drafts on a player's behalf when their clock expires.
 *
 * Highest power among cards they can still afford, so a timeout never produces
 * an illegal state and never hands them something useless. Ties break on
 * card_variant_id for determinism.
 */
/**
 * The block the server makes for a player who ran out of time.
 *
 * Takes the opponent's strongest remaining card, mirroring chooseAutoPick's
 * "best available" rule so a timeout is a reasonable move rather than a
 * throwaway. Returns null only if the opponent somehow drafted nothing, which
 * cannot happen once the draft is complete.
 */
export async function chooseAutoBlock(
  session: RankedDraftSession,
  userId: string
): Promise<string | null> {
  const opponentPicks = picksOf(session, opponentOf(session, userId));
  if (opponentPicks.length === 0) return null;

  const { rows } = await db.query(
    `
      SELECT cv.card_variant_id
      FROM card_variants cv
      JOIN characters ch ON cv.character_id = ch.character_id
      WHERE cv.card_variant_id = ANY($1::uuid[])
      ORDER BY (
        (ch.base_power->>'top')::int + (ch.base_power->>'right')::int +
        (ch.base_power->>'bottom')::int + (ch.base_power->>'left')::int
      ) DESC, cv.card_variant_id ASC
      LIMIT 1
    `,
    [opponentPicks]
  );
  return rows[0]?.card_variant_id ?? opponentPicks[0];
}

export async function chooseAutoPick(
  session: RankedDraftSession,
  userId: string
): Promise<string | null> {
  const myPicks = picksOf(session, userId);
  const spent = await budgetSpentFor(myPicks);
  const remaining = RANKED_DRAFT_CONFIG.POWER_BUDGET - spent;
  const excluded = unavailableCardIds(session);

  const affordableRarities = Object.keys(RARITY_POWER_COST).filter(
    (r) => RARITY_POWER_COST[r] <= remaining
  );

  const { rows } = await db.query(
    `
      SELECT cv.card_variant_id
      FROM card_variants cv
      JOIN characters ch ON cv.character_id = ch.character_id
      WHERE NOT (cv.card_variant_id = ANY($1::uuid[]))
        AND ${ORIGINAL_RARITY_SQL}
        AND lower(replace(cv.rarity, '+', '')) = ANY($2::text[])
      ORDER BY (
        (ch.base_power->>'top')::int + (ch.base_power->>'right')::int +
        (ch.base_power->>'bottom')::int + (ch.base_power->>'left')::int
      ) DESC, cv.card_variant_id ASC
      LIMIT 1
    `,
    [excluded.length ? excluded : ["00000000-0000-0000-0000-000000000000"], affordableRarities]
  );

  return rows[0]?.card_variant_id ?? null;
}

/** Records the 20 most recent drafted cards for a user. Never throws. */
export async function recordRecentCards(
  userId: string,
  cardVariantIds: string[],
  executor: typeof db = db
): Promise<void> {
  if (cardVariantIds.length === 0) return;
  try {
    await executor.query(
      `INSERT INTO user_ranked_draft_recent_cards (user_id, card_variant_id, used_at)
       SELECT $1, unnest($2::uuid[]), NOW()
       ON CONFLICT (user_id, card_variant_id) DO UPDATE SET used_at = EXCLUDED.used_at`,
      [userId, cardVariantIds]
    );
    // Trim to the newest N.
    await executor.query(
      `DELETE FROM user_ranked_draft_recent_cards
       WHERE user_id = $1
         AND card_variant_id NOT IN (
           SELECT card_variant_id FROM user_ranked_draft_recent_cards
           WHERE user_id = $1 ORDER BY used_at DESC LIMIT $2
         )`,
      [userId, RANKED_DRAFT_CONFIG.RECENT_CARDS_LIMIT]
    );
  } catch (error) {
    // A convenience feature must never fail a completed draft.
    logger.error("[rankedDraft] Failed to record recent cards", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getRecentCards(userId: string): Promise<string[]> {
  try {
    const { rows } = await db.query(
      `SELECT card_variant_id FROM user_ranked_draft_recent_cards
       WHERE user_id = $1 ORDER BY used_at DESC LIMIT $2`,
      [userId, RANKED_DRAFT_CONFIG.RECENT_CARDS_LIMIT]
    );
    return rows.map((r: { card_variant_id: string }) => r.card_variant_id);
  } catch {
    return [];
  }
}

/**
 * Ranked battles this user has started since 00:00 UTC.
 *
 * Counts `games` rows rather than a dedicated counter table: the row is already
 * written for every battle, `created_at` is indexed, and deriving the number
 * means it can never drift out of sync with reality (a counter can, and then
 * needs a repair script). Costs one indexed count per queue join, which is a
 * user-initiated action, not a hot path.
 *
 * Includes games in EVERY status — a forfeit, an abort and a win all consumed
 * an attempt. Excluding losses or rage-quits would make the cap trivially
 * farmable by abandoning drafts.
 */
export async function countBattlesToday(userId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM "games"
      WHERE game_mode = 'ranked_draft'
        AND (player1_id = $1 OR player2_id = $1)
        AND created_at >= date_trunc('day', now() AT TIME ZONE 'utc')`,
    [userId]
  );
  return rows[0]?.count ?? 0;
}

export interface DailyBattleUsage {
  /** Battles started since the last reset. */
  used: number;
  /** The cap in force. */
  limit: number;
  /** Battles left. 0 means the queue is closed until reset. */
  remaining: number;
  /** Next 00:00 UTC, ISO-8601, so the client can say when it reopens. */
  resetsAt: string;
}

/** Start of the next UTC day — the moment the allowance resets. */
export function nextDailyResetAt(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );
}

/**
 * This user's allowance right now.
 *
 * Not separately flag-gated: the whole mode is behind `ranked-draft-pvp` and
 * unreleased, so the cap ships as part of it rather than as a switch over
 * existing behaviour.
 */
export async function getDailyBattleUsage(
  userId: string
): Promise<DailyBattleUsage> {
  const limit = RANKED_DRAFT_CONFIG.DAILY_BATTLE_LIMIT;
  const used = await countBattlesToday(userId);
  return {
    used,
    limit,
    // Clamped: a limit lowered after the fact must not report a negative.
    remaining: Math.max(0, limit - used),
    resetsAt: nextDailyResetAt().toISOString(),
  };
}

export default {
  RANKED_DRAFT_FLAG,
  countBattlesToday,
  getDailyBattleUsage,
  nextDailyResetAt,
  RANKED_DRAFT_REWARDS_FLAG,
  pickerForIndex,
  budgetSpentFor,
  validateBan,
  validatePick,
  validateBlock,
  blocksComplete,
  chooseAutoBlock,
  chooseAutoPick,
  toStatePayload,
  unavailableCardIds,
  bansComplete,
  isParticipant,
  recordRecentCards,
  getRecentCards,
  resolveOwnedVariant,
  getOwnedVariantsForPick,
  resolveCurrentPicker,
  isDraftComplete,
  picksLeftInTurn,
  isLastPickOfTurn,
  TOTAL_PICKS,
};
