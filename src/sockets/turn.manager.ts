import { Namespace } from "socket.io";
import {
  GameNamespaceEvent,
  ServerStartTurnResponse,
} from "../types/socket.types";

interface TurnManagerOptions {
  allowedDurations?: number[]; // seconds
  animationDelay?: number; // milliseconds to wait before starting turn timer
}

/** Default delay for animations before turn timer starts (ms) */
const DEFAULT_ANIMATION_DELAY_MS = 4000;

/**
 * Handles per-game turn timing, strike escalation and timeouts.
 *
 * After a move is processed, there's an automatic delay (default 4s) for
 * animations to play, then the turn timer starts for the next player.
 */
export class TurnManager {
  private readonly io: Namespace;
  private readonly room: string; // socket.io room (e.g., game:123)
  private readonly allowedDurations: number[];
  private readonly animationDelay: number;

  private timeoutHandle: NodeJS.Timeout | null = null;
  private animationDelayHandle: NodeJS.Timeout | null = null;
  private strikes: Map<string, number> = new Map(); // playerId -> strike index
  private currentPlayerId: string;

  constructor(
    io: Namespace,
    room: string,
    currentPlayerId: string,
    private readonly players: string[], // [player1Id, player2Id]
    private readonly onTimeout: (
      timedOutPlayerId: string
    ) => void | Promise<void>,
    options?: TurnManagerOptions
  ) {
    this.io = io;
    this.room = room;
    this.currentPlayerId = currentPlayerId;
    this.allowedDurations = options?.allowedDurations ?? [30, 15, 10, 5];
    this.animationDelay = options?.animationDelay ?? DEFAULT_ANIMATION_DELAY_MS;

    // Initialise strike counters to 0
    players.forEach((p) => this.strikes.set(p, 0));
  }

  /**
   * Start a new turn for the given player.
   * If isFirstTurn is true, the timer starts immediately.
   * Otherwise, there's an automatic animation delay before the timer starts.
   */
  public startTurn(playerId: string, isFirstTurn: boolean = false): void {
    this.clearAllTimers();
    this.currentPlayerId = playerId;

    const strikeIndex = this.strikes.get(playerId) ?? 0;
    const timeAllowed = this.allowedDurations[strikeIndex] ?? 5;

    if (isFirstTurn) {
      // First turn of the game - start immediately
      this.emitStartTurnAndArmTimer(playerId, timeAllowed);
    } else {
      // Delay for animations, then start the turn timer
      this.animationDelayHandle = setTimeout(() => {
        this.animationDelayHandle = null;
        this.emitStartTurnAndArmTimer(playerId, timeAllowed);
      }, this.animationDelay);
    }
  }

  /**
   * Emit server:start_turn and arm the timeout timer.
   */
  private emitStartTurnAndArmTimer(
    playerId: string,
    timeAllowed: number
  ): void {
    // Emit start turn to room
    const payload: ServerStartTurnResponse = {
      currentPlayerId: playerId,
      timeAllowed,
    };
    this.io.to(this.room).emit(GameNamespaceEvent.SERVER_START_TURN, payload);

    // Schedule timeout
    this.timeoutHandle = setTimeout(() => {
      this.handleTimeout(playerId);
    }, timeAllowed * 1000);
  }

  /**
   * Should be invoked whenever the active player successfully performs an action.
   */
  public onPlayerAction(playerId: string): void {
    if (playerId !== this.currentPlayerId) return; // ignore if not active

    // Successful action resets strikes for that player
    this.strikes.set(playerId, 0);
    this.clearAllTimers();
  }

  /**
   * Clean up all timers when game ends.
   */
  public dispose(): void {
    this.clearAllTimers();
  }

  /**
   * Clear both the animation delay timer and the turn timeout timer.
   */
  private clearAllTimers(): void {
    if (this.animationDelayHandle) {
      clearTimeout(this.animationDelayHandle);
      this.animationDelayHandle = null;
    }
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private handleTimeout(playerId: string): void {
    // Increase strike count up to cap
    const currentStrike = this.strikes.get(playerId) ?? 0;
    const nextStrike = Math.min(
      currentStrike + 1,
      this.allowedDurations.length - 1
    );
    this.strikes.set(playerId, nextStrike);

    // Execute external callback (Phase-4 might invoke AI move)
    this.onTimeout(playerId);
  }
}
