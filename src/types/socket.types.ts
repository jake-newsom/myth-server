/**
 * Type definitions for Socket.IO events and related data
 * These will be maintained in a separate file for future packaging as an NPM module
 */

import { Socket } from "socket.io";
import { GameState, BoardPosition, InGameCard } from "./game.types";

// Socket Authentication Types (consolidated from socket.types.d.ts)
export interface SocketUser {
  user_id: string;
  username: string;
  email?: string | null;
  in_game_currency: number;
}

export interface AuthenticatedSocket extends Socket {
  user: SocketUser;
}

export interface JwtPayload {
  userId: string;
}

// Socket event types
export enum SocketEvent {
  // Client -> Server events
  JOIN_GAME = "game:join",
  LEAVE_GAME = "game:leave",
  GAME_ACTION = "game:action",
  JOIN_MATCHMAKING = "matchmaking:join",
  LEAVE_MATCHMAKING = "matchmaking:leave",
  SEND_CHAT = "chat:send",

  // Server -> Client events
  GAME_JOINED = "game:joined",
  GAME_ERROR = "game:error",
  GAME_STATE_UPDATE = "game:state_update",
  GAME_START = "game:start",
  PLAYER_CONNECTED = "game:player_connected",
  PLAYER_DISCONNECTED = "game:player_disconnected",
  MATCHMAKING_STARTED = "matchmaking:started",
  MATCHMAKING_FOUND = "matchmaking:found",
  MATCHMAKING_CANCELLED = "matchmaking:cancelled",
  CHAT_MESSAGE = "chat:message",
}

// Game namespace ("/game") events adhering to Multiplayer Phase-1 contract
export enum GameNamespaceEvent {
  CLIENT_JOIN_GAME = "client:join_game",
  CLIENT_ACTION = "client:action",
  CLIENT_ANIMATIONS_COMPLETE = "client:animations_complete",
  SERVER_JOINED = "server:joined",
  SERVER_PLAYER_JOINED = "server:player_joined",
  SERVER_ERROR = "server:error",
  SERVER_START_TURN = "server:start_turn",
  SERVER_EVENTS = "server:events",
  SERVER_GAME_END = "server:game_end",
  SERVER_MULLIGAN_START = "server:mulligan_start",
  // Sent only to the chooser when an interactive ability (e.g. Frigg) pauses
  // the move and reveals data they must act on (the opponent's hand).
  SERVER_CHOICE_REQUIRED = "server:choice_required",
}

// Presence namespace ("/presence") events.
// The presence socket is the always-on, per-user connection used while a
// client is logged in. In addition to the players-online count, we
// piggy-back targeted notifications (like matchmaking results) on it
// so the client doesn't have to poll the HTTP API.
export enum PresenceNamespaceEvent {
  SERVER_PLAYER_COUNT = "presence:player_count",
  SERVER_MATCHMAKING_FOUND = "matchmaking:found",
  CHALLENGE_INCOMING = "challenge:incoming",
  CHALLENGE_ACCEPTED = "challenge:accepted",
  CHALLENGE_DECLINED = "challenge:declined",
  CHALLENGE_DECK_SELECTION_REQUIRED = "challenge:deck_selection_required",
  CHALLENGE_DECK_CONFIRMED = "challenge:deck_confirmed",
  CHALLENGE_READY = "challenge:ready",
  CHALLENGE_EXPIRED = "challenge:expired",
  CHALLENGE_CANCELLED = "challenge:cancelled",

  // --- Ranked Draft ---
  // The ban + draft phases happen BEFORE a `games` row exists, so they cannot
  // ride the /game namespace: its auth middleware requires a gameId and
  // authorizes against the games table. /presence is token-only and already
  // has a per-user room, so it is the correct transport.
  DRAFT_CLIENT_SUBMIT_BAN = "draft:ban:submit",
  DRAFT_CLIENT_SUBMIT_PICK = "draft:pick:submit",
  DRAFT_CLIENT_SUBMIT_BLOCK = "draft:block:submit",
  DRAFT_CLIENT_ABANDON = "draft:abandon",
  DRAFT_CLIENT_REJOIN = "draft:rejoin",
  DRAFT_SERVER_STARTED = "draft:started",
  DRAFT_SERVER_STATE = "draft:state",
  // Carries ONLY a boolean. The opponent's banned card id is deliberately not
  // serialized until both bans are recorded — see DRAFT_SERVER_BAN_REVEALED.
  DRAFT_SERVER_BAN_SUBMITTED = "draft:ban:opponent_submitted",
  DRAFT_SERVER_BAN_REVEALED = "draft:ban:revealed",
  DRAFT_SERVER_TURN = "draft:turn",
  DRAFT_SERVER_PICK_MADE = "draft:pick:made",
  // Block phase. Same secrecy rule as bans: the opponent is told only THAT a
  // block landed, and both values are revealed together.
  DRAFT_SERVER_BLOCK_STARTED = "draft:block:started",
  DRAFT_SERVER_BLOCK_SUBMITTED = "draft:block:opponent_submitted",
  DRAFT_SERVER_BLOCK_REVEALED = "draft:block:revealed",
  DRAFT_SERVER_COMPLETED = "draft:completed",
  DRAFT_SERVER_ABORTED = "draft:aborted",
  DRAFT_SERVER_ERROR = "draft:error",
}

/** Room grouping both players of one draft session. */
export const draftRoom = (sessionId: string): string => `draft:${sessionId}`;

export type RankedDraftPhase =
  | "ban"
  | "draft"
  | "block"
  | "complete"
  | "aborted";

/**
 * The draft as one player is allowed to see it.
 *
 * `opponentBan` stays null for the whole ban phase — the server does not send
 * the value it is hiding. `opponentBanSubmitted` is what the client renders a
 * card back from.
 */
export interface RankedDraftStatePayload {
  sessionId: string;
  phase: RankedDraftPhase;
  /** This player's own ban, echoed back so a reconnect can render it. */
  myBan: string | null;
  opponentBan: string | null;
  opponentBanSubmitted: boolean;
  myPicks: string[];
  opponentPicks: string[];
  /** Budget spent by this player, and the cap, both in power. */
  budgetSpent: number;
  budgetTotal: number;
  picksMade: number;
  picksTotal: number;
  currentPickerId: string | null;
  isMyTurn: boolean;
  /** Cards left to take in the CURRENT player's turn (picks come in blocks). */
  picksLeftInTurn: number;
  picksPerTurn: number;
  /** Absolute epoch ms, so the client renders its own countdown. */
  deadlineMs: number | null;
  opponentUsername: string;
  /** Card ids removed from the pool: both bans (once revealed) + all picks. */
  unavailableCardIds: string[];
  /** Up to 20 most-recently drafted variants, surfaced first in the grid. */
  recentCardIds: string[];
  /**
   * This player's cosmetic skin choices, as original_variant_id -> chosen
   * variant_id. Only ever contains entries where a skin was actually picked, so
   * a lookup miss means "render the original".
   *
   * Sent so the deck preview can show the art the player chose; the pick itself
   * is still the original printing everywhere else.
   */
  myVariants: Record<string, string>;
  /**
   * The OPPONENT's skin choices, same shape as `myVariants`.
   *
   * Cosmetic only — the pick identity is still the original printing — so
   * revealing it leaks nothing the opponent's picks don't already show. Sent so
   * each client renders the art the other player actually chose.
   */
  opponentVariants: Record<string, string>;
  gameId: string | null;

  /**
   * Block phase. `myBlock` is the card THIS player removed from the opponent's
   * draft, echoed back so a reconnect can render the choice. `blockedFromMe`
   * (the opponent's choice against this player) stays null until BOTH blocks
   * are in — the server does not send the value it is hiding.
   */
  myBlock: string | null;
  blockedFromMe: string | null;
  opponentBlockSubmitted: boolean;

  /**
   * True when THIS viewer drafts first (player1).
   *
   * The order is 1 / 2,2 / … / 1: the first drafter takes a lone opening pick
   * and the second drafter takes a lone closing pick. The client renders that
   * odd slot on the outside edge of each deck row, so this is what tells it
   * which side to put it on.
   */
  iDraftFirst: boolean;
}

export interface RankedDraftBlockRevealedPayload {
  sessionId: string;
  /** The card this player removed from the opponent's deck. */
  myBlock: string | null;
  /** The card the opponent removed from THIS player's deck. */
  blockedFromMe: string | null;
  /** How long the reveal is held before the game begins. */
  revealMs: number;
}

export interface RankedDraftBanRevealedPayload {
  sessionId: string;
  myBan: string | null;
  opponentBan: string | null;
  nextPickerId: string;
  deadlineMs: number;
}

export interface RankedDraftPickMadePayload {
  sessionId: string;
  pickerId: string;
  cardVariantId: string;
  pickIndex: number;
  nextPickerId: string | null;
  deadlineMs: number | null;
  /** True when the server auto-picked because the clock ran out. */
  autoPicked: boolean;
}

export interface RankedDraftCompletedPayload {
  sessionId: string;
  gameId: string;
}

export interface RankedDraftAbortedPayload {
  sessionId: string;
  reason: string;
  /**
   * True for the player who quit, false for the one who was left. Absent on
   * system aborts (a phase that could not be resolved), which belong to
   * neither player.
   */
  abandonedByMe?: boolean;
  /**
   * True when the abandon was scored as a played game (loss for the quitter,
   * win for the opponent). Absent/false on a system abort, which is nobody's
   * fault and costs nobody rating.
   */
  rated?: boolean;
}

export interface PresencePlayerCountPayload {
  count: number;
}

export interface MatchmakingFoundPayload {
  gameId: string;
  opponentUsername: string;
}

export interface ChallengeIncomingPayload {
  challengeId: string;
  challengerId: string;
  challengerUsername: string;
  expiresAt: number;
}

export interface ChallengeAcceptedPayload {
  challengeId: string;
  opponentId: string;
  opponentUsername: string;
}

export interface ChallengeDeclinedPayload {
  challengeId: string;
}

export interface ChallengeDeckSelectionRequiredPayload {
  challengeId: string;
}

export interface ChallengeDeckConfirmedPayload {
  challengeId: string;
  userId: string;
}

export interface ChallengeReadyPayload {
  challengeId: string;
  gameId: string;
}

export interface ChallengeExpiredPayload {
  challengeId: string;
}

export interface ChallengeCancelledPayload {
  challengeId: string;
  cancelledBy: string;
}

// Payload types for socket events
export interface JoinGamePayload {
  gameId: string;
}

export interface GameActionPayload {
  gameId: string;
  actionType:
    | "placeCard"
    | "endTurn"
    | "surrender"
    | "forcePass"
    | "mulligan"
    | "handChoice";
  user_card_instance_id?: string;
  position?: BoardPosition;
  // Player-chosen target for abilities that require selecting a board card
  // (e.g. urashima_time_shift, tawara_piercing_shot). Validated server-side.
  targetPosition?: BoardPosition;
  replaced_card_instance_ids?: string[];
  // Chosen enemy hand card(s) for an interactive reveal-hand choice (actionType
  // "handChoice"). Validated against the active pending_choice server-side.
  chosen_card_ids?: string[];
}

/**
 * Payload for SERVER_CHOICE_REQUIRED — sent only to the chooser. Carries the
 * fully hydrated cards they may pick from (the opponent's revealed hand), the
 * prompt copy + how many to pick, and the source card context so the client can
 * anchor the prompt UI. Generic across abilities that reveal-hand-and-select.
 */
export interface ServerChoiceRequiredPayload {
  gameId: string;
  type: "reveal_hand_select";
  sourceCardId: string;
  sourcePosition: BoardPosition;
  cards: InGameCard[];
  selectCount: number;
  promptTitle: string;
  promptText: string;
}

export interface ServerMulliganStartPayload {
  deadline_ms: number;
  duration_seconds: number;
}

export interface MatchmakingJoinPayload {
  deckId: string;
  mode?: "casual" | "ranked";
}

export interface ChatMessagePayload {
  gameId: string;
  message: string;
}

export interface GameJoinedResponse {
  gameId: string;
  gameState: GameState;
  message: string;
}

export interface SocketErrorResponse {
  message: string;
  code?: string;
}

export interface GameStartResponse {
  gameId: string;
  gameState: GameState;
  message: string;
}

export interface PlayerConnectionResponse {
  userId: string;
  username: string;
  playerCount: number;
}

export interface ChatMessageResponse {
  gameId: string;
  userId: string;
  username: string;
  message: string;
  timestamp: string;
}

// Response sent only to the joining client once they have successfully joined the room
export interface ServerJoinedResponse {
  gameState: GameState;
  /** 1 if the connecting user is player1, otherwise 2 */
  playerNumber: 1 | 2;
  /** The opponent's display name */
  opponentUsername: string;
}

// Broadcast when the *other* player joins after you (optional for Phase-1)
export interface ServerPlayerJoined {
  userId: string;
  playerNumber: 1 | 2;
}

export interface ServerStartTurnResponse {
  currentPlayerId: string;
  timeAllowed: number; // seconds
}

export interface ServerEventsPayload {
  events: any[]; // use BaseGameEvent but avoid direct import dependency here
  gameState: GameState;
  aiMove?: boolean;
}

export interface ServerGameEndPayload {
  result: {
    winnerId: string | null;
    reason: "surrender" | "disconnect" | "completed";
  };
  rewards?: any; // placeholder for reward data structure
}
