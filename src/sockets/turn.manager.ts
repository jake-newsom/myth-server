import { Namespace } from "socket.io";
import {
  GameNamespaceEvent,
  ServerStartTurnResponse,
} from "../types/socket.types";

interface TurnManagerOptions {
  allowedDurations?: number[]; // seconds
}

/**
 * Handles per-game turn timing, strike escalation and timeouts.
 *
 * Phase-2 scope: timer tracking & timeout callback (AI integration later).
 */
export class TurnManager {
  private readonly io: Namespace;
  private readonly room: string; // socket.io room (e.g., game:123)
  private readonly allowedDurations: number[];

  private timeoutHandle: NodeJS.Timeout | null = null;
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

    // Initialise strike counters to 0
    players.forEach((p) => this.strikes.set(p, 0));
  }

  /**
   * Begin the timer for the provided player and emit server:start_turn.
   */
  public startTurn(playerId: string): void {
    this.clearTimer();
    this.currentPlayerId = playerId;

    const strikeIndex = this.strikes.get(playerId) ?? 0;
    const timeAllowed = this.allowedDurations[strikeIndex] ?? 5; // fallback

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
    this.clearTimer();
  }

  /**
   * Clean up timers when game ends.
   */
  public dispose(): void {
    this.clearTimer();
  }

  /**
   * Internal helpers
   */
  private clearTimer(): void {
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
