import db from "../config/db.config";
import { GameState } from "../types/game.types"; // Assuming GameState is defined here
import { GameStatus } from "../game-engine/game.logic";

// Define types for game records and responses
export interface GameRecord {
  game_id: string;
  player1_id: string;
  player2_id: string;
  player1_deck_id: string;
  player2_deck_id: string;
  game_mode: string;
  game_status: GameStatus; // Use enum instead of string
  board_layout: string;
  game_state: GameState; // Stored as JSONB, parsed to GameState object
  created_at: Date;
  completed_at?: Date | null;
  winner_id?: string | null;
  player1_username?: string;
  player2_username?: string;
}

export interface SanitizedGame extends Omit<GameRecord, "game_state"> {
  game_state: GameState; // Ensure it's the parsed object
}

export interface CreateGameResponse {
  game_id: string;
  game_state: GameState; // This will be a string initially from DB, to be parsed
  game_status: GameStatus; // Use enum instead of string
}

export interface UpdatedGameResponse {
  game_id: string;
  game_state: GameState; // This will be a string initially from DB, to be parsed
  game_status: GameStatus;
  winner_id: string | null;
}

export class GameNotFoundError extends Error {
  constructor(message: string = "Game not found or access denied") {
    super(message);
    this.name = "GameNotFoundError";
  }
}

// AI_PLAYER_ID will be used in queries, ensure it's accessible.
// Import it if it's in a central constants file, or pass as a parameter.
// For now, hardcoding as per the context of its previous use, or assuming it's globally available/imported.
// It's better to import from a constants file or the controller if exported from there.
import { AI_PLAYER_ID } from "../api/controllers/game.controller";

class GameService {
  /**
   * Creates a new game record in the database.
   */
  async createGameRecord(
    player1Id: string,
    player2Id: string,
    player1DeckId: string,
    player2DeckId: string,
    gameMode: "solo" | "pvp", // Or your specific game modes
    initialGameState: GameState
  ): Promise<CreateGameResponse> {
    const query = `
      INSERT INTO "games" (player1_id, player2_id, player1_deck_id, player2_deck_id, game_mode, game_status, board_layout, game_state, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING game_id, game_state, game_status;
    `;
    const values = [
      player1Id,
      player2Id,
      player1DeckId,
      player2DeckId,
      gameMode,
      GameStatus.ACTIVE, // Initial status
      "4x4", // Assuming '4x4' as default or pass as param if variable
      JSON.stringify(initialGameState),
    ];
    const { rows } = await db.query(query, values);
    if (rows.length === 0) {
      throw new Error("Failed to create game record."); // Or a more specific error
    }
    // game_state from DB is JSON string. The caller (controller) will parse it.
    return rows[0] as CreateGameResponse;
  }

  private parseGameState(gameStateString: string | GameState): GameState {
    if (typeof gameStateString === "string") {
      const parsedState = JSON.parse(gameStateString) as GameState;

      // Transform board representation to match expected format
      if (parsedState.board) {
        // For each row in the board
        for (let y = 0; y < parsedState.board.length; y++) {
          for (let x = 0; x < parsedState.board[y].length; x++) {
            const cell = parsedState.board[y][x];
            // If the cell is not null but has no card or the card has no user_card_instance_id,
            // replace it with null to match expected API schema
            if (
              cell &&
              (!cell.card ||
                (cell.card.user_card_instance_id === null &&
                  cell.card.base_card_id === null &&
                  cell.card.owner === null))
            ) {
              parsedState.board[y][x] = {
                card: null,
                tile_status: "normal",
                turns_left: 0,
                animation_label: null,
              };
            }
          }
        }
      }

      return parsedState;
    }
    return gameStateString;
  }

  /**
   * Fetches a game by ID, ensuring the user is a participant.
   * Returns null if not found or access denied.
   */
  async findGameForUser(
    gameId: string,
    userId: string
  ): Promise<SanitizedGame | null> {
    const query = `
      SELECT g.*,
             p1.username as player1_username,
             CASE WHEN g.player2_id = $3 THEN 'AI Opponent' 
                  WHEN p2.username IS NULL THEN 'Unknown Opponent' 
                  ELSE p2.username 
             END as player2_username
      FROM "games" g
      LEFT JOIN "users" p1 ON g.player1_id = p1.user_id
      LEFT JOIN "users" p2 ON g.player2_id = p2.user_id AND g.player2_id != $3
      WHERE g.game_id = $1 AND (g.player1_id = $2 OR g.player2_id = $2);
    `;
    const { rows } = await db.query(query, [gameId, userId, AI_PLAYER_ID]);
    if (rows.length === 0) {
      return null;
    }
    const game = rows[0];
    return {
      ...game,
      game_state: this.parseGameState(game.game_state),
    } as SanitizedGame;
  }

  /**
   * Fetches a game by ID for an admin user (no player restrictions).
   * Returns null if not found.
   */
  async findGameForAdmin(gameId: string): Promise<SanitizedGame | null> {
    const query = `
      SELECT g.*,
             p1.username as player1_username,
             CASE WHEN g.player2_id = $2 THEN 'AI Opponent' 
                  WHEN p2.username IS NULL THEN 'Unknown Opponent' 
                  ELSE p2.username 
             END as player2_username
      FROM "games" g
      LEFT JOIN "users" p1 ON g.player1_id = p1.user_id
      LEFT JOIN "users" p2 ON g.player2_id = p2.user_id AND g.player2_id != $2
      WHERE g.game_id = $1;
    `;
    const { rows } = await db.query(query, [gameId, AI_PLAYER_ID]);
    if (rows.length === 0) {
      return null;
    }
    const game = rows[0];
    return {
      ...game,
      game_state: this.parseGameState(game.game_state),
    } as SanitizedGame;
  }

  /**
   * Fetches a raw game record by ID, primarily for internal use within submitAction.
   * Parses game_state into an object.
   */
  async getRawGameRecord(
    gameId: string,
    userId: string
  ): Promise<GameRecord | null> {
    const query = `
        SELECT * FROM "games" 
        WHERE game_id = $1 AND (player1_id = $2 OR player2_id = $2);
      `;
    const { rows } = await db.query(query, [gameId, userId]);
    if (rows.length === 0) {
      return null;
    }
    const game = rows[0];
    return {
      ...game,
      game_state: this.parseGameState(game.game_state),
    } as GameRecord;
  }

  /**
   * Updates the game state, status, winner, and completion time.
   */
  async updateGameAfterAction(
    gameId: string,
    updatedGameState: GameState,
    newGameStatus: GameStatus, // Using GameStatus enum
    winnerId: string | null
  ): Promise<UpdatedGameResponse> {
    const query = `
      UPDATE "games"
      SET game_state = $1,
          game_status = $2::game_status, -- Cast to game_status type
          winner_id = $3,
          completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE NULL END
      WHERE game_id = $4
      RETURNING game_id, game_state, game_status, winner_id;
    `;
    const values = [
      JSON.stringify(updatedGameState),
      newGameStatus,
      winnerId,
      gameId,
    ];
    const { rows } = await db.query(query, values);
    if (rows.length === 0) {
      throw new Error("Failed to update game."); // Or GameNotFoundError
    }
    // game_state from DB is JSON string. The caller (controller) will parse it.
    return rows[0] as UpdatedGameResponse;
  }
}

export default new GameService();
