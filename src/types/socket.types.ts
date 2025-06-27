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
  email: string;
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

// Payload types for socket events
export interface JoinGamePayload {
  gameId: string;
}

export interface GameActionPayload {
  gameId: string;
  actionType: "placeCard" | "endTurn" | "surrender";
  user_card_instance_id?: string;
  position?: BoardPosition;
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
