import { Request, Response } from "express";
import { GameLogic, GameStatus } from "../../game-engine/game.logic";
import { AILogic } from "../../game-engine/ai.logic";
// import { AbilityRegistry } from "../../game-engine/ability.registry";
import { GameState, GameAction } from "../../types/game.types";
import * as validators from "../../game-engine/game.validators";
import { hydrateGameStateCards } from "../../game-engine/game.utils";
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
import GameRewardsService, {
  GameCompletionResult,
} from "../../services/gameRewards.service";
import TowerService from "../../services/tower.service";
import { BaseGameEvent } from "../../game-engine/game-events";
import { sanitizeGameStateForPlayer } from "../../utils/sanitize";

// Initialize ability registry
// AbilityRegistry.initialize();

// Define a constant UUID for the AI player and EXPORT it
export const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

class GameController {
  constructor() {
    // Bind methods to ensure 'this' is correct
    this.startSoloGame = this.startSoloGame.bind(this);
    this.getGame = this.getGame.bind(this);
    this.submitAction = this.submitAction.bind(this);
    this.submitAIAction = this.submitAIAction.bind(this);
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

      // 4. Attach deck effects based on mythology composition
      const [playerDeckEffect, aiDeckEffect, opponentMythology] =
        await Promise.all([
          DeckService.getDeckEffect(deckId),
          DeckService.getDeckEffect(aiDeckIdToUse),
          DeckService.getDeckDominantMythology(aiDeckIdToUse),
        ]);

      if (playerDeckEffect) {
        initialGameState.player1.deck_effect = playerDeckEffect;
        initialGameState.player1.deck_effect_state = { last_triggered_round: 0 };
      }
      if (aiDeckEffect) {
        initialGameState.player2.deck_effect = aiDeckEffect;
        initialGameState.player2.deck_effect_state = { last_triggered_round: 0 };
      }

      // Set the final game state (no automatic AI moves)
      let finalGameState = initialGameState;
      let events: BaseGameEvent[] = [];

      // 5. Create game record in database
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
        opponent_mythology: opponentMythology,
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

      // Hydrate any missing cards in the game state before sanitizing
      await hydrateGameStateCards(game.game_state);

      // Get opponent mythology for solo games (for theming)
      let opponentMythology: string | null = null;
      if (game.game_mode === "solo" && game.player2_deck_id) {
        opponentMythology = await DeckService.getDeckDominantMythology(
          game.player2_deck_id
        );
      }

      // Format response to match startSoloGame structure
      res.status(200).json({
        game_id: game.game_id,
        game_state: sanitizeGameStateForPlayer(game.game_state, userId),
        game_status: game.game_status,
        ai_deck_id: game.game_mode === "solo" ? game.player2_deck_id : null,
        opponent_mythology: opponentMythology,
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

      // Process the action based on action_type
      let updatedGameState: GameState = _.cloneDeep(currentGameState); // Start with a copy for modifications by GameLogic
      let events: BaseGameEvent[] = [];

      switch (action.action_type) {
        case "placeCard":
          if (!action.user_card_instance_id || !action.position) {
            res.status(400).json({
              error: "card id and position are required for placeCard action",
            });
            return;
          }

          const placeCardResult = await GameLogic.placeCard(
            currentGameState,
            userId,
            action.user_card_instance_id,
            action.position
          );

          updatedGameState = placeCardResult.state;
          events.push(...placeCardResult.events);
          break;

        case "endTurn":
          // Validate that it's the player's turn for endTurn action
          if (currentGameState.current_player_id !== userId) {
            res.status(400).json({ error: "Not your turn" });
            return;
          }

          const endTurnResult = await GameLogic.endTurn(
            currentGameState,
            userId
          );
          updatedGameState = endTurnResult.state;
          events.push(...endTurnResult.events);
          break;

        case "surrender":
          // Surrender is allowed regardless of whose turn it is
          updatedGameState = await GameLogic.surrender(
            currentGameState,
            userId
          );
          break;

        default:
          res.status(400).json({ error: "Invalid action type" });
          return;
      }

      // Hydrate any missing cards that were drawn during ability execution
      // This must happen before saving to database so the cache is persisted
      await hydrateGameStateCards(updatedGameState);

      // Process game completion if the status indicates game over
      let winner_id_for_db: string | null = updatedGameState.winner || null;
      let new_game_status_for_db: GameStatus = updatedGameState.status;
      let gameCompletionResult: GameCompletionResult | null = null;
      let towerCompletion: any = null;

      // Process comprehensive rewards if game is completed
      if (new_game_status_for_db === GameStatus.COMPLETED) {
        try {
          // Optimization: Start floor number lookup and game rewards in parallel
          // Floor number lookup is independent and can run alongside rewards processing
          const [gameRewardsResult, floorNumber] = await Promise.all([
            GameRewardsService.processGameCompletion(
              userId,
              updatedGameState,
              gameRecord.game_mode as "solo" | "pvp",
              new Date(gameRecord.created_at), // Game start time
              gameRecord.player1_id,
              gameRecord.player2_id,
              gameRecord.player1_deck_id,
              gameId, // Pass gameId for leaderboard updates
              false, // isForfeit
              gameRecord.game_mode === "solo" ? gameRecord.player2_deck_id : undefined // AI deck ID for rare card drops
            ),
            GameService.getGameFloorNumber(gameId),
          ]);

          gameCompletionResult = gameRewardsResult;

          // Process tower completion if this is a tower game
          // This runs after we know the floor number and game result
          if (floorNumber !== null && gameCompletionResult) {
            try {
              const won = winner_id_for_db === userId;
              towerCompletion = await TowerService.processTowerCompletion(
                userId,
                floorNumber,
                won,
                gameId
              );
            } catch (error) {
              console.error("Error processing tower completion:", error);
              // Don't fail the entire response if tower processing fails
            }
          }
        } catch (error) {
          console.error("Error processing game completion rewards:", error);
          // Fallback to legacy currency award for solo wins
          if (winner_id_for_db === userId && gameRecord.game_mode === "solo") {
            await UserService.awardCurrency(userId, 10);
          }
        }
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

      // Enhanced response with game completion rewards
      const response: any = {
        game_id: updatedGameResponse.game_id,
        game_state: finalGameStateObject,
        game_status: updatedGameResponse.game_status,
        winner_id: updatedGameResponse.winner_id,
        events,
      };

      // Add reward data if game completed
      if (gameCompletionResult) {
        response.game_result = gameCompletionResult.game_result;
        response.rewards = gameCompletionResult.rewards;
        response.updated_currencies = gameCompletionResult.updated_currencies;

        // Merge tower rewards if this was a tower game
        if (towerCompletion && towerCompletion.won) {
          // Add tower rewards to the existing rewards
          if (towerCompletion.rewards_earned) {
            // Merge gems (tower rewards include gems)
            if (towerCompletion.rewards_earned.reward_gems) {
              response.rewards.currency.gems =
                (response.rewards.currency.gems || 0) +
                towerCompletion.rewards_earned.reward_gems;
            }
            // Note: tower packs and card fragments are handled by tower service
          }

          // Add tower completion info
          response.tower_completion = {
            floor_number: towerCompletion.floor_number,
            new_floor: towerCompletion.new_floor,
            rewards_earned: towerCompletion.rewards_earned,
            cards_awarded: towerCompletion.cards_awarded,
            generation_triggered: towerCompletion.generation_triggered,
          };
        }
      }

      res.status(200).json(response);
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

  /**
   * Submit an AI action (for solo games)
   */
  async submitAIAction(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { gameId } = req.params;

      // Fetch current game (raw record needed for validation)
      const gameRecord: GameRecord | null = await GameService.getRawGameRecord(
        gameId,
        userId
      );

      if (!gameRecord) {
        res.status(404).json({ error: "Game not found or access denied" });
        return;
      }

      // Validate this is a solo game
      if (gameRecord.game_mode !== "solo") {
        res.status(400).json({ error: "AI actions are only for solo games" });
        return;
      }

      const currentGameState: GameState = gameRecord.game_state;

      // Validate that it's the AI's turn
      if (currentGameState.current_player_id !== AI_PLAYER_ID) {
        res.status(400).json({ error: "Not AI's turn" });
        return;
      }

      // Validate game is still active
      if (currentGameState.status !== GameStatus.ACTIVE) {
        res.status(400).json({ error: "Game is not active" });
        return;
      }

      let updatedGameState: GameState = _.cloneDeep(currentGameState);
      let events: BaseGameEvent[] = [];

      // Make AI move
      const ai = new AILogic();
      const aiMove = await ai.makeAIMove(_.cloneDeep(currentGameState));

      if (aiMove) {
        const placeCardResult = await GameLogic.placeCard(
          currentGameState,
          AI_PLAYER_ID,
          aiMove.user_card_instance_id,
          aiMove.position
        );
        updatedGameState = placeCardResult.state;
        events.push(...placeCardResult.events);
      } else {
        // AI has no valid moves, end turn
        const endTurnResult = await GameLogic.endTurn(
          currentGameState,
          AI_PLAYER_ID
        );
        updatedGameState = endTurnResult.state;
        events.push(...endTurnResult.events);

        // Draw a card for the AI if needed after ending turn
        const aiPlayer = validators.getPlayer(updatedGameState, AI_PLAYER_ID);

        if (
          validators.shouldDrawCard(
            aiPlayer,
            updatedGameState.max_cards_in_hand
          )
        ) {
          const drawCardResult = await GameLogic.drawCard(
            updatedGameState,
            AI_PLAYER_ID
          );
          updatedGameState = drawCardResult.state;
          events.push(...drawCardResult.events);
        }
      }

      // Hydrate any missing cards that were drawn during ability execution
      // This must happen before saving to database so the cache is persisted
      await hydrateGameStateCards(updatedGameState);

      // Process game completion if the status indicates game over
      let winner_id_for_db: string | null = updatedGameState.winner || null;
      let new_game_status_for_db: GameStatus = updatedGameState.status;
      let gameCompletionResult: GameCompletionResult | null = null;
      let towerCompletionAI: any = null;

      // Process comprehensive rewards if game is completed
      if (new_game_status_for_db === GameStatus.COMPLETED) {
        try {
          // Optimization: Start floor number lookup and game rewards in parallel
          // Floor number lookup is independent and can run alongside rewards processing
          const [gameRewardsResult, floorNumberAI] = await Promise.all([
            GameRewardsService.processGameCompletion(
              userId,
              updatedGameState,
              gameRecord.game_mode as "solo" | "pvp",
              new Date(gameRecord.created_at), // Game start time
              gameRecord.player1_id,
              gameRecord.player2_id,
              gameRecord.player1_deck_id,
              gameId, // Pass gameId for leaderboard updates
              false, // isForfeit
              gameRecord.game_mode === "solo" ? gameRecord.player2_deck_id : undefined // AI deck ID for rare card drops
            ),
            GameService.getGameFloorNumber(gameId),
          ]);

          gameCompletionResult = gameRewardsResult;

          // Process tower completion if this is a tower game
          // This runs after we know the floor number and game result
          if (floorNumberAI !== null && gameCompletionResult) {
            try {
              const wonAI = winner_id_for_db === userId;
              towerCompletionAI = await TowerService.processTowerCompletion(
                userId,
                floorNumberAI,
                wonAI,
                gameId
              );
            } catch (error) {
              console.error("Error processing tower completion:", error);
              // Don't fail the entire response if tower processing fails
            }
          }
        } catch (error) {
          console.error("Error processing game completion rewards:", error);
          // Fallback to legacy currency award for solo wins
          if (winner_id_for_db === userId && gameRecord.game_mode === "solo") {
            await UserService.awardCurrency(userId, 10);
          }
        }
      }

      // Update game in database using GameService
      const updatedGameResponse: UpdatedGameResponse =
        await GameService.updateGameAfterAction(
          gameId,
          updatedGameState,
          new_game_status_for_db,
          winner_id_for_db
        );

      // game_state from updateGameAfterAction (via DB) is a JSON string. Parse it.
      const finalGameStateObject =
        typeof updatedGameResponse.game_state === "string"
          ? JSON.parse(updatedGameResponse.game_state)
          : updatedGameResponse.game_state;

      // Enhanced response with game completion rewards
      const response: any = {
        game_id: updatedGameResponse.game_id,
        game_state: finalGameStateObject,
        game_status: updatedGameResponse.game_status,
        winner_id: updatedGameResponse.winner_id,
        events,
      };

      // Add reward data if game completed
      if (gameCompletionResult) {
        response.game_result = gameCompletionResult.game_result;
        response.rewards = gameCompletionResult.rewards;
        response.updated_currencies = gameCompletionResult.updated_currencies;

        // Merge tower rewards if this was a tower game
        if (towerCompletionAI && towerCompletionAI.won) {
          // Add tower rewards to the existing rewards
          if (towerCompletionAI.rewards_earned) {
            // Merge gems (tower rewards include gems)
            if (towerCompletionAI.rewards_earned.reward_gems) {
              response.rewards.currency.gems =
                (response.rewards.currency.gems || 0) +
                towerCompletionAI.rewards_earned.reward_gems;
            }
            // Note: tower packs and card fragments are handled by tower service
          }

          // Add tower completion info
          response.tower_completion = {
            floor_number: towerCompletionAI.floor_number,
            new_floor: towerCompletionAI.new_floor,
            rewards_earned: towerCompletionAI.rewards_earned,
            cards_awarded: towerCompletionAI.cards_awarded,
            generation_triggered: towerCompletionAI.generation_triggered,
          };
        }
      }

      res.status(200).json(response);
    } catch (error) {
      console.error("Error processing AI action:", error);
      if (error instanceof GameNotFoundError) {
        res.status(404).json({ error: (error as Error).message });
      } else if (
        error instanceof Error &&
        (error.message === "Not AI's turn" ||
          error.message === "AI actions are only for solo games" ||
          error.message === "Game is not active")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Server error processing AI action" });
      }
    }
  }
}

export default new GameController();
