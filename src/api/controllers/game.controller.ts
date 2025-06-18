import { Request, Response } from "express";
import { GameLogic, GameStatus } from "../../game-engine/game.logic";
import { AILogic } from "../../game-engine/ai.logic";
import { AbilityRegistry } from "../../game-engine/ability.registry";
import { GameState, BoardPosition, GameAction } from "../../types/game.types";
import * as _ from "lodash";

// Import Services
import DeckService, {
  DeckNotFoundError,
  DeckAccessError,
  EmptyDeckError,
} from "../../services/deck.service";
import GameService, {
  GameNotFoundError,
  CreateGameResponse,
  UpdatedGameResponse,
  SanitizedGame,
  GameRecord,
} from "../../services/game.service";
import UserService from "../../services/user.service";
import { BaseGameEvent } from "../../game-engine/game-events";
import { canPlaceOnTile } from "../../game-engine/game.utils";

// Initialize ability registry
AbilityRegistry.initialize();

// Define a constant UUID for the AI player and EXPORT it
export const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

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
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { deckId, aiDeckId: requestedAiDeckId } = req.body;
      if (!deckId) {
        res.status(400).json({ error: "Deck ID is required" });
        return;
      }

      // 1. Validate user's deck and get card instances
      await DeckService.validateUserDeck(deckId, userId); // Throws on error
      const playerCardInstanceIds = await DeckService.getDeckCardInstances(
        deckId
      );

      if (playerCardInstanceIds.length === 0) {
        // DeckService.getDeckCardInstances doesn't throw EmptyDeckError by default
        // as per plan, to match original behavior of checking length here.
        res.status(400).json({ error: "Deck is empty" });
        return;
      }

      // 2. Determine and prepare AI deck
      let aiDeckIdToUse = requestedAiDeckId;
      if (!aiDeckIdToUse) {
        aiDeckIdToUse = await DeckService.getRandomAIDeckId();
        if (!aiDeckIdToUse) {
          res.status(500).json({ error: "No AI decks available" });
          return;
        }
      } else {
        await DeckService.validateAIDeck(aiDeckIdToUse); // Throws on error
      }

      let aiCardInstanceIds = await DeckService.getDeckCardInstances(
        aiDeckIdToUse
      );
      if (aiCardInstanceIds.length === 0) {
        // Fallback to creating AI card copies
        aiCardInstanceIds = await DeckService.createAICardCopies(
          playerCardInstanceIds
        );
      }

      // 3. Initialize game state
      const initialGameState = await GameLogic.initializeGame(
        playerCardInstanceIds,
        aiCardInstanceIds,
        userId
      );

      // Randomly choose starting player
      const startingPlayerId = Math.random() < 0.5 ? userId : AI_PLAYER_ID;
      initialGameState.current_player_id = startingPlayerId;

      // If AI starts, make its move
      let finalGameState = initialGameState;
      let events: BaseGameEvent[] = [];
      if (startingPlayerId === AI_PLAYER_ID) {
        const ai = new AILogic();
        const aiMove = await ai.makeAIMove(initialGameState);
        if (aiMove) {
          const placeCardResult = await GameLogic.placeCard(
            initialGameState,
            AI_PLAYER_ID,
            aiMove.user_card_instance_id,
            aiMove.position
          );
          finalGameState = placeCardResult.state;
          events.push(...placeCardResult.events);
        } else {
          // AI has no valid moves, end turn
          const endTurnResult = await GameLogic.endTurn(
            initialGameState,
            AI_PLAYER_ID
          );
          finalGameState = endTurnResult.state;
          events.push(...endTurnResult.events);
        }
      }

      // 4. Create game record in database
      const createdGameResponse: CreateGameResponse =
        await GameService.createGameRecord(
          userId,
          AI_PLAYER_ID,
          deckId,
          aiDeckIdToUse,
          "solo",
          finalGameState
        );

      // game_state from createGameRecord (via DB) is a JSON string. Parse it.
      const gameStateObject =
        typeof createdGameResponse.game_state === "string"
          ? JSON.parse(createdGameResponse.game_state)
          : createdGameResponse.game_state;

      res.status(201).json({
        game_id: createdGameResponse.game_id,
        game_state: gameStateObject,
        game_status: createdGameResponse.game_status,
        ai_deck_id: aiDeckIdToUse,
        current_user_id: userId,
        events,
      });
    } catch (error) {
      console.error("Error creating solo game:", error);
      if (
        error instanceof DeckNotFoundError ||
        error instanceof DeckAccessError ||
        error instanceof EmptyDeckError
      ) {
        // Use specific status codes based on error type if desired, e.g., 404 for DeckNotFoundError
        res.status(400).json({ error: (error as Error).message });
      } else {
        res.status(500).json({ error: "Server error creating game" });
      }
    }
  }

  /**
   * Get game state by ID
   */
  async getGame(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { gameId } = req.params;
      let game: SanitizedGame | null = null;

      if (req.user?.role === "admin") {
        game = await GameService.findGameForAdmin(gameId);
      } else {
        game = await GameService.findGameForUser(gameId, userId);
      }

      if (!game) {
        res.status(404).json({ error: "Game not found or access denied" });
        return;
      }

      // Format response to match startSoloGame structure
      res.status(200).json({
        game_id: game.game_id,
        game_state: game.game_state,
        game_status: game.game_status,
        ai_deck_id: game.game_mode === "solo" ? game.player2_deck_id : null,
        current_user_id: userId,
        events: [], // Initialize with empty events array since this is just a get request
      });
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
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { gameId } = req.params;
      const action: GameAction = req.body;

      // Validate the action has required fields
      if (!action.action_type) {
        res.status(400).json({ error: "Action type is required" });
        return;
      }

      // Fetch current game (raw record needed for player IDs for win conditions)
      // GameService.getRawGameRecord returns game_state as an object
      const gameRecord: GameRecord | null = await GameService.getRawGameRecord(
        gameId,
        userId
      );

      if (!gameRecord) {
        res.status(404).json({ error: "Game not found or access denied" });
        return;
      }

      const currentGameState: GameState = gameRecord.game_state; // Already an object

      // Validate that it's the player's turn
      if (currentGameState.current_player_id !== userId) {
        res.status(400).json({ error: "Not your turn" });
        return;
      }

      // Process the action based on action_type
      let updatedGameState: GameState = _.cloneDeep(currentGameState); // Start with a copy for modifications by GameLogic
      let events: BaseGameEvent[] = [];

      switch (action.action_type) {
        case "placeCard":
          if (!action.user_card_instance_id || !action.position) {
            res.status(400).json({
              error: "Card ID and position are required for placeCard action",
            });
            return;
          }

          if (!canPlaceOnTile(currentGameState, action.position)) {
            res.status(400).json({
              error: "Cannot place card on this tile",
            });
            return;
          }

          // GameLogic methods should ideally return a new state object rather than mutating
          const placeCardResult = await GameLogic.placeCard(
            currentGameState, // Pass original for validation within GameLogic
            userId,
            action.user_card_instance_id,
            action.position
          );
          updatedGameState = placeCardResult.state;
          events.push(...placeCardResult.events);
          break;

        case "endTurn":
          const endTurnResult = await GameLogic.endTurn(
            currentGameState,
            userId
          );
          updatedGameState = endTurnResult.state;
          events.push(...endTurnResult.events);
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
        gameRecord.game_mode === "solo" &&
        updatedGameState.status === GameStatus.ACTIVE &&
        updatedGameState.current_player_id === AI_PLAYER_ID
      ) {
        const ai = new AILogic();
        const aiMove = await ai.makeAIMove(_.cloneDeep(updatedGameState));
        if (aiMove) {
          const placeCardResult = await GameLogic.placeCard(
            updatedGameState,
            AI_PLAYER_ID,
            aiMove.user_card_instance_id,
            aiMove.position
          );
          updatedGameState = placeCardResult.state;
          events.push(...placeCardResult.events);
        } else {
          const endTurnResult = await GameLogic.endTurn(
            updatedGameState,
            AI_PLAYER_ID
          );
          updatedGameState = endTurnResult.state;
          events.push(...endTurnResult.events);
        }
      }

      // Process game completion if the status indicates game over
      let winner_id_for_db: string | null = updatedGameState.winner || null;
      let new_game_status_for_db: GameStatus = updatedGameState.status;

      // Award currency to the player for winning solo mode
      if (
        new_game_status_for_db === GameStatus.COMPLETED &&
        winner_id_for_db === userId &&
        gameRecord.game_mode === "solo"
      ) {
        await UserService.awardCurrency(userId, 10);
      }

      // Update game in database using GameService
      const updatedGameResponse: UpdatedGameResponse =
        await GameService.updateGameAfterAction(
          gameId,
          updatedGameState, // This is the fully updated state object
          new_game_status_for_db,
          winner_id_for_db
        );

      // game_state from updateGameAfterAction (via DB) is a JSON string. Parse it.
      const finalGameStateObject =
        typeof updatedGameResponse.game_state === "string"
          ? JSON.parse(updatedGameResponse.game_state)
          : updatedGameResponse.game_state;

      res.status(200).json({
        game_id: updatedGameResponse.game_id,
        game_state: finalGameStateObject,
        game_status: updatedGameResponse.game_status,
        winner_id: updatedGameResponse.winner_id,
        events,
      });
    } catch (error) {
      console.error("Error processing game action:", error);
      // Provide more specific error messages for client validation issues
      if (error instanceof GameNotFoundError) {
        res.status(404).json({ error: (error as Error).message });
      } else if (
        error instanceof Error &&
        (error.message === "Not your turn" ||
          error.message.includes(
            "required for placeCard action"
          ) /* specific validation messages from controller */ ||
          error.message === "Invalid action type" ||
          (error.message &&
            error.message.startsWith(
              "Card with ID"
            ))) /* Example for errors from GameLogic if they become Error instances */
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Server error processing action" });
      }
    }
  }
}

export default new GameController();
