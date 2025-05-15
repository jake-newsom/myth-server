import { Request, Response } from "express";
import db from "../../config/db.config";
import { GameLogic } from "../../game-engine/game.logic";
import { AILogic } from "../../game-engine/ai.logic";
import { AbilityRegistry } from "../../game-engine/ability.registry";
import { GameState, BoardPosition, GameAction } from "../../types/game.types";
import * as _ from "lodash";

// Initialize ability registry
AbilityRegistry.initialize();

class GameController {
  constructor() {
    // Bind methods to ensure 'this' is correct
    this.startSoloGame = this.startSoloGame.bind(this);
    this.getGame = this.getGame.bind(this);
    this.submitAction = this.submitAction.bind(this);
  }

  /**
   * Start a new solo game against AI
   */
  async startSoloGame(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { deckId } = req.body;
      if (!deckId) {
        res.status(400).json({ error: "Deck ID is required" });
        return;
      }

      // 1. Validate that deck exists and belongs to the user
      const deckQuery = `
        SELECT * FROM "Decks" 
        WHERE deck_id = $1 AND user_id = $2;
      `;
      const { rows: deckRows } = await db.query(deckQuery, [deckId, userId]);

      if (deckRows.length === 0) {
        res
          .status(404)
          .json({ error: "Deck not found or does not belong to the user" });
        return;
      }

      // 2. Get user's card instances from the deck
      const userCardInstancesQuery = `
        SELECT user_card_instance_id FROM "DeckCards" 
        WHERE deck_id = $1;
      `;
      const { rows: cardInstanceRows } = await db.query(
        userCardInstancesQuery,
        [deckId]
      );

      if (cardInstanceRows.length === 0) {
        res.status(400).json({ error: "Deck is empty" });
        return;
      }

      const playerCardInstanceIds = cardInstanceRows.map(
        (row) => row.user_card_instance_id
      );

      // 3. Generate AI deck with cards of similar level
      // For simplicity in MVP, we'll use same cards but owned by AI
      // In a real implementation, we'd select appropriate AI cards from a pool
      const aiCardInstancesQuery = `
        SELECT uci.user_card_instance_id 
        FROM "UserCardInstances" uci
        JOIN "Cards" c ON uci.card_id = c.card_id
        WHERE uci.user_id = 'AI_PLAYER_ID_STATIC_STRING' 
        LIMIT $1;
      `;
      const { rows: aiCardRows } = await db.query(aiCardInstancesQuery, [
        playerCardInstanceIds.length,
      ]);

      let aiCardInstanceIds: string[];

      if (aiCardRows.length >= playerCardInstanceIds.length) {
        // If AI has enough cards, use those
        aiCardInstanceIds = aiCardRows.map((row) => row.user_card_instance_id);
      } else {
        // For development/testing purposes: Create copies of player cards but owned by AI
        // In production, this should be replaced with proper AI card selection logic
        aiCardInstanceIds = await this.createAICardCopies(
          playerCardInstanceIds
        );
      }

      // 4. Initialize game state
      const initialGameState = await GameLogic.initializeGame(
        playerCardInstanceIds,
        aiCardInstanceIds,
        userId
      );

      // 5. Create game record in database
      const gameQuery = `
        INSERT INTO "Games" (player1_id, player2_id, player1_deck_id, game_mode, game_status, board_layout, current_turn_player_id, game_state, created_at, started_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING game_id, game_state, game_status;
      `;
      const gameValues = [
        userId,
        "AI_PLAYER_ID_STATIC_STRING",
        deckId,
        "solo",
        "active",
        "4x4", // Ensure this is '4x4' as required
        initialGameState.currentPlayerId,
        JSON.stringify(initialGameState),
      ];

      const { rows: gameRows } = await db.query(gameQuery, gameValues);

      if (gameRows.length === 0) {
        res.status(500).json({ error: "Failed to create game" });
        return;
      }

      const createdGame = {
        game_id: gameRows[0].game_id,
        game_state: gameRows[0].game_state,
        game_status: gameRows[0].game_status,
      };

      res.status(201).json(createdGame);
    } catch (error) {
      console.error("Error creating solo game:", error);
      res.status(500).json({ error: "Server error creating game" });
    }
  }

  /**
   * Get game state by ID
   */
  async getGame(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { gameId } = req.params;

      // Fetch game data
      const gameQuery = `
        SELECT g.*, 
               p1.username as player1_username,
               CASE WHEN p2.username IS NULL THEN 'AI Opponent' ELSE p2.username END as player2_username
        FROM "Games" g
        LEFT JOIN "Users" p1 ON g.player1_id = p1.user_id
        LEFT JOIN "Users" p2 ON g.player2_id = p2.user_id
        WHERE g.game_id = $1 AND (g.player1_id = $2 OR g.player2_id = $2 OR $2 = 'ADMIN_USER_ID');
      `;
      const { rows: gameRows } = await db.query(gameQuery, [gameId, userId]);

      if (gameRows.length === 0) {
        res.status(404).json({ error: "Game not found or access denied" });
        return;
      }

      const game = gameRows[0];

      // Prepare response (sanitize data if needed)
      // For example, for a PvP game, we might need to hide opponent's hand
      const sanitizedGame = {
        game_id: game.game_id,
        player1_id: game.player1_id,
        player1_username: game.player1_username,
        player2_id: game.player2_id,
        player2_username: game.player2_username,
        game_mode: game.game_mode,
        game_status: game.game_status,
        board_layout: game.board_layout,
        created_at: game.created_at,
        started_at: game.started_at,
        completed_at: game.completed_at,
        winner_id: game.winner_id,
        current_turn_player_id: game.current_turn_player_id,
        game_state: game.game_state,
      };

      res.status(200).json(sanitizedGame);
    } catch (error) {
      console.error("Error fetching game:", error);
      res.status(500).json({ error: "Server error fetching game" });
    }
  }

  /**
   * Submit a game action
   */
  async submitAction(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { gameId } = req.params;
      const action: GameAction = req.body;

      // Validate the action has required fields
      if (!action.actionType) {
        res.status(400).json({ error: "Action type is required" });
        return;
      }

      // Fetch current game state
      const gameQuery = `
        SELECT * FROM "Games" 
        WHERE game_id = $1 AND (player1_id = $2 OR player2_id = $2);
      `;
      const { rows: gameRows } = await db.query(gameQuery, [gameId, userId]);

      if (gameRows.length === 0) {
        res.status(404).json({ error: "Game not found or access denied" });
        return;
      }

      const game = gameRows[0];

      // Parse game state
      const currentGameState: GameState = game.game_state;

      // Validate that it's the player's turn
      if (currentGameState.currentPlayerId !== userId) {
        res.status(400).json({ error: "Not your turn" });
        return;
      }

      // Process the action based on actionType
      let updatedGameState: GameState;

      switch (action.actionType) {
        case "placeCard":
          if (!action.user_card_instance_id || !action.position) {
            res.status(400).json({
              error: "Card ID and position are required for placeCard action",
            });
            return;
          }

          const position: BoardPosition = action.position;
          updatedGameState = await GameLogic.placeCard(
            currentGameState,
            userId,
            action.user_card_instance_id,
            position
          );
          break;

        case "endTurn":
          updatedGameState = await GameLogic.endTurn(currentGameState, userId);
          break;

        case "surrender":
          updatedGameState = await GameLogic.surrender(
            currentGameState,
            userId
          );
          break;

        default:
          res.status(400).json({ error: "Invalid action type" });
          return;
      }

      // If it's now AI's turn in solo mode and game is active, make AI move
      if (
        game.game_mode === "solo" &&
        updatedGameState.status === "active" &&
        updatedGameState.currentPlayerId === "AI_PLAYER_ID_STATIC_STRING"
      ) {
        const ai = new AILogic();
        const aiMove = await ai.makeAIMove(updatedGameState);

        if (aiMove) {
          updatedGameState = await GameLogic.placeCard(
            updatedGameState,
            "AI_PLAYER_ID_STATIC_STRING",
            aiMove.user_card_instance_id,
            aiMove.position
          );
        } else {
          // AI has no valid moves, end turn
          updatedGameState = await GameLogic.endTurn(
            updatedGameState,
            "AI_PLAYER_ID_STATIC_STRING"
          );
        }
      }

      // Process game completion if the status indicates game over
      let winner_id = null;
      let game_status = game.game_status;

      if (
        updatedGameState.status === "player1_win" ||
        updatedGameState.status === "player2_win" ||
        updatedGameState.status === "draw"
      ) {
        game_status = "completed";

        if (updatedGameState.status === "player1_win") {
          winner_id = game.player1_id;

          // Award currency to the player for winning solo mode
          if (game.game_mode === "solo" && game.player1_id === userId) {
            await this.awardCurrencyForWin(userId, 10); // Award 10 currency units for solo win
          }
        } else if (updatedGameState.status === "player2_win") {
          winner_id = game.player2_id;
        }
      }

      // Update game in database
      const updateQuery = `
        UPDATE "Games"
        SET game_state = $1,
            game_status = $2,
            current_turn_player_id = $3,
            winner_id = $4,
            completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE NULL END
        WHERE game_id = $5
        RETURNING game_id, game_state, game_status, winner_id;
      `;
      const updateValues = [
        JSON.stringify(updatedGameState),
        game_status,
        updatedGameState.currentPlayerId,
        winner_id,
        gameId,
      ];

      const { rows: updatedRows } = await db.query(updateQuery, updateValues);

      if (updatedRows.length === 0) {
        res.status(500).json({ error: "Failed to update game" });
        return;
      }

      const updatedGame = {
        game_id: updatedRows[0].game_id,
        game_state: updatedRows[0].game_state,
        game_status: updatedRows[0].game_status,
        winner_id: updatedRows[0].winner_id,
      };

      res.status(200).json(updatedGame);
    } catch (error) {
      console.error("Error processing game action:", error);

      // Provide more specific error messages for client validation issues
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Server error processing action" });
      }
    }
  }

  /**
   * Helper method to create AI card copies for testing
   */
  private async createAICardCopies(
    playerCardInstanceIds: string[]
  ): Promise<string[]> {
    const aiCardInstanceIds: string[] = [];

    const AI_USER_ID = "AI_PLAYER_ID_STATIC_STRING";

    // For each player card, create an AI copy with the same card ID
    for (const playerInstanceId of playerCardInstanceIds) {
      // Get the base card ID from the player's card instance
      const cardQuery = `
        SELECT card_id, level FROM "UserCardInstances" 
        WHERE user_card_instance_id = $1;
      `;
      const { rows } = await db.query(cardQuery, [playerInstanceId]);

      if (rows.length > 0) {
        const baseCardId = rows[0].card_id;
        const level = rows[0].level;

        // Create a card instance for the AI with the same base card
        const insertQuery = `
          INSERT INTO "UserCardInstances" (user_id, card_id, level, xp, created_at)
          VALUES ($1, $2, $3, 0, NOW())
          RETURNING user_card_instance_id;
        `;
        const { rows: insertRows } = await db.query(insertQuery, [
          AI_USER_ID,
          baseCardId,
          level,
        ]);

        if (insertRows.length > 0) {
          aiCardInstanceIds.push(insertRows[0].user_card_instance_id);
        }
      }
    }

    return aiCardInstanceIds;
  }

  /**
   * Award currency to player for winning
   */
  private async awardCurrencyForWin(
    userId: string,
    amount: number
  ): Promise<void> {
    const updateQuery = `
      UPDATE "Users"
      SET in_game_currency = in_game_currency + $1
      WHERE user_id = $2;
    `;
    await db.query(updateQuery, [amount, userId]);
  }
}

export default new GameController();
