# Viking Vengeance: Server-Side Implementation

## Phase 4: Server-Side Game Logic & Solo Mode API (Local) - REVISED for 4x4 Board

**Objective:** Implement the core server-authoritative game logic engine for a **4x4 board**. Develop and expose API endpoints for players to engage in Solo Mode games against an AI opponent, with the server managing all game state and actions.

**Parent Document:** Viking Vengeance: Server-Side Systems - PRD & Implementation Plan
**Prerequisites:** Phase 3 completed. `lodash` and `uuid` libraries installed. Database `Games` table `board_layout` column default and CHECK constraint updated to '4x4'.
**Version:** 1.1 (Revised for 4x4 board)
**Date:** May 9, 2025

---

### 1. Prerequisites & Tools

- **Phase 3 Completion:** Functional APIs for managing users, cards, and decks.
- **Node.js & npm/yarn:** Installed.
- **Project Folder:** `myth-server` with existing Phase 1-3 code.
- **Dependencies:** Existing dependencies. `lodash` and `uuid` are confirmed installed.
- **API Testing Tool:** Postman, Insomnia, or curl.
- **Database `myth`:** Populated and accessible. **Crucially, the `Games` table schema should reflect `board_layout` as '4x4' by default and its `CHECK` constraint updated accordingly.** (See note above on migration).
- **TypeScript Configuration:** Strict TypeScript mode is enabled in `tsconfig.json` with `"strict": true`.

### 2. Key Concepts & Definitions for This Phase (4x4 Board)

- **Game State (`Games.game_state` JSONB field):**
  - **Structure (MVP - 4x4 board):**
    ```json
    {
      "board": [ // 4x4 grid. Cell: { userCardInstanceId: "uuid", baseCardData: {...}, owner: "player1_id" | "AI_ID", currentPower: {"top":1,...}, level: 1, state: "normal" } or null
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null]
      ],
      "player1": { // Human Player
        "userId": "user_uuid_from_Users_table",
        "hand": ["user_card_instance_uuid_1", "user_card_instance_uuid_2", ...], // IDs of UserCardInstance
        "deck": ["user_card_instance_uuid_remaining_1", ...], // IDs of UserCardInstance
        "score": 0
      },
      "player2": { // AI Opponent
        "userId": "AI_PLAYER_ID_STATIC_STRING",
        "hand": ["ai_user_card_instance_uuid_a", ...],
        "deck": ["ai_user_card_instance_uuid_remaining_a", ...],
        "score": 0
      },
      "currentPlayerId": "user_uuid_from_Users_table",
      "turnNumber": 1,
      "status": "active",
      "maxCardsInHand": 10,
      "initialCardsToDraw": 5,
      "hydratedCardDataCache": { // Optional: Cache for details of instances in play/hands
        "user_card_instance_uuid_1": { "base_card_id": "...", "name": "...", "power": { ... }, "level": 1, ... }
      }
    }
    ```
  - **`baseCardData` in board cells:** Store static properties of the base card for easy access. The cell also stores the `userCardInstanceId` and its specific `level` and `currentPower` (derived from base stats + level).
- **Initial Hand Size:** 5 cards.
- **Max Hand Size:** 5 cards.
- **Card Draw:** At the end of a player's successful card placement and combat resolution, if their hand size is less than max, they draw 1 card if their deck is not empty.
- **Game Over Condition (MVP):** The game ends when the **4x4 board** is completely full (16 cards placed).
- **Winning Condition (MVP):** Player with more cards on the board wins. Equal score is a draw.
- **Currency Award (MVP Solo Win):** 10 units of `in_game_currency`.

### 3. Game Logic Engine Implementation

- **Location:** `myth-server/src/game-engine/`
- **Files:** `game.logic.ts`, `ai.logic.ts`, `ability.registry.ts` (Content of `ability.registry.js` remains the same as previously provided, focus on ability implementations).

#### 3.1. Game Engine Type Definitions

- **Task:** Create TypeScript type definitions for the game engine.
- **Action (`myth-server/src/types/game.types.ts`):**

  ```typescript
  // myth-server/src/types/game.types.ts
  import { Card as BaseCard, SpecialAbility } from "./database.types"; // Assuming BaseCard is from database.types

  /**
   * Type definitions for game engine and related components
   */

  export type BoardPosition = { x: number; y: number };

  export type CardPower = {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  export type CardState = "normal" | "immune" | "buffed" | "debuffed";

  export interface BoardCell {
    user_card_instance_id: string | null; // ID of the specific UserCardInstance on the board
    base_card_id: string | null; // ID of the base card definition
    owner: string | null; // user_id of the player who owns this card on board
    current_power: CardPower | null; // Actual power of the card instance on the board (base + level bonus)
    level: number | null; // Level of the card instance
    card_state: CardState; // Renamed from state
    // Store base card details directly for easy access by abilities/combat without constant lookups
    base_card_data: {
      // Can be null if no card
      name: string;
      rarity: string;
      image_url: string;
      special_ability_id: string | null;
      tags: string[];
      // Base power is used to calculate currentPower with level
      base_power: CardPower;
      // Ability details directly on the cell for easier processing
      ability_name?: string | null;
      ability_description?: string | null;
      ability_triggerMoment?: string | null;
      ability_parameters?: Record<string, any> | null;
    } | null;
    // New properties for tile effects
    tile_status: TileStatus; // New
    player_1_turns_left: number; // New
    player_2_turns_left: number; // New
    animation_label: string | null; // New
  }

  export type GameBoard = Array<Array<BoardCell | null>>;

  // Represents details of a card instance needed during gameplay (hand, deck, board)
  export interface InGameCard {
    user_card_instance_id: string;
    base_card_id: string;
    name: string;
    rarity: string;
    image_url: string;
    currentPower: CardPower; // Derived power based on level
    basePower: CardPower; // Original power from base card definition
    level: number;
    xp: number;
    tags: string[];
    special_ability_id: string | null;
    ability_name?: string | null;
    ability_description?: string | null;
    ability_triggerMoment?: string | null;
    ability_parameters?: Record<string, any> | null;
  }

  export interface Player {
    userId: string;
    hand: string[]; // Array of user_card_instance_id
    deck: string[]; // Array of user_card_instance_id
    score: number;
  }

  export interface GameState {
    board: GameBoard;
    player1: Player;
    player2: Player;
    currentPlayerId: string;
    turnNumber: number;
    status:
      | "pending"
      | "active"
      | "completed"
      | "aborted"
      | "player1_win"
      | "player2_win"
      | "draw";
    maxCardsInHand: number;
    initialCardsToDraw: number;
    winner?: string | null;
    // Cache for quick lookup of hydrated card instance details by user_card_instance_id
    hydratedCardDataCache?: Record<string, InGameCard>;
  }

  export interface GameAction {
    gameId: string;
    actionType: "placeCard" | "endTurn" | "surrender";
    user_card_instance_id?: string; // ID of the UserCardInstance being played
    position?: BoardPosition;
  }

  export interface AbilityEffect {
    type: string;
    value?: number | string;
    duration?: number;
    condition?: string;
    target?: "self" | "opponent" | "all";
  }
  ```

#### 3.2. OpenAPI Specification for Game Endpoints

- **Task:** Create OpenAPI specification for game-related endpoints.
- **Action (`myth-server/src/openapi/game.openapi.yaml`):**

  ```yaml
  # myth-server/src/openapi/game.openapi.yaml
  openapi: 3.0.0
  info:
    title: Viking Vengeance Game API
    description: API for game creation and gameplay
    version: 1.0.0

  paths:
    /api/games/solo:
      post:
        summary: Create a new solo game against AI
        tags:
          - Game
        security:
          - bearerAuth: []
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                required:
                  - deckId
                properties:
                  deckId:
                    type: string
                    format: uuid
                    description: The ID of the player's deck to use
        responses:
          201:
            description: Game created successfully
            content:
              application/json:
                schema:
                  $ref: "#/components/schemas/Game"
          400:
            description: Invalid request (e.g., deck not found or invalid)
          401:
            description: Unauthorized - Invalid or missing token
          500:
            description: Server error

    /api/games/{gameId}:
      get:
        summary: Get game state
        tags:
          - Game
        security:
          - bearerAuth: []
        parameters:
          - in: path
            name: gameId
            required: true
            schema:
              type: string
              format: uuid
            description: ID of the game to retrieve
        responses:
          200:
            description: Game retrieved successfully
            content:
              application/json:
                schema:
                  $ref: "#/components/schemas/Game"
          404:
            description: Game not found
          401:
            description: Unauthorized - Invalid or missing token
          500:
            description: Server error

    /api/games/{gameId}/actions:
      post:
        summary: Submit a game action
        tags:
          - Game
        security:
          - bearerAuth: []
        parameters:
          - in: path
            name: gameId
            required: true
            schema:
              type: string
              format: uuid
            description: ID of the game to act on
        requestBody:
          required: true
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/GameAction"
        responses:
          200:
            description: Action processed successfully
            content:
              application/json:
                schema:
                  $ref: "#/components/schemas/Game"
          400:
            description: Invalid action
          404:
            description: Game not found
          401:
            description: Unauthorized - Invalid or missing token
          500:
            description: Server error

  components:
    schemas:
      BoardPosition:
        type: object
        properties:
          x:
            type: integer
            minimum: 0
            maximum: 3
          y:
            type: integer
            minimum: 0
            maximum: 3

      CardPower:
        type: object
        properties:
          top:
            type: integer
          right:
            type: integer
          bottom:
            type: integer
          left:
            type: integer

      BoardCell:
        type: object
        properties:
          cardId:
            type: string
            format: uuid
          originalCardData:
            type: object
            properties:
              card_id:
                type: string
                format: uuid
              name:
                type: string
              type:
                type: string
              rarity:
                type: string
              image_url:
                type: string
              special_ability_id:
                type: string
                nullable: true
          owner:
            type: string
          currentPower:
            $ref: "#/components/schemas/CardPower"
          state:
            type: string
            enum: [normal, immune, buffed, debuffed]

      Player:
        type: object
        properties:
          userId:
            type: string
          hand:
            type: array
            items:
              type: string
              format: uuid
          deck:
            type: array
            items:
              type: string
              format: uuid
          score:
            type: integer

      Game:
        type: object
        properties:
          game_id:
            type: string
            format: uuid
          player1_id:
            type: string
          player2_id:
            type: string
          game_mode:
            type: string
            enum: [solo, pvp]
          winner_id:
            type: string
            nullable: true
          game_status:
            type: string
            enum: [pending, active, completed, aborted]
          game_state:
            type: object
            properties:
              board:
                type: array
                items:
                  type: array
                  items:
                    oneOf:
                      - $ref: "#/components/schemas/BoardCell"
                      - type: "null"
              player1:
                $ref: "#/components/schemas/Player"
              player2:
                $ref: "#/components/schemas/Player"
              currentPlayerId:
                type: string
              turnNumber:
                type: integer
              status:
                type: string
                enum: [pending, active, completed, aborted]
          created_at:
            type: string
            format: date-time
          completed_at:
            type: string
            format: date-time
            nullable: true

      GameAction:
        type: object
        required:
          - actionType
        properties:
          actionType:
            type: string
            enum: [placeCard, endTurn, surrender]
          cardId:
            type: string
            format: uuid
          position:
            $ref: "#/components/schemas/BoardPosition"

    securitySchemes:
      bearerAuth:
        type: http
        scheme: bearer
        bearerFormat: JWT
  ```

#### 3.3. Implementation

- **Task:** Implement the game logic in TypeScript with strict typing, using `UserCardInstance` and their leveled stats.
- **Action (`myth-server/src/game-engine/game.logic.ts` - Apply TypeScript typing and logic changes):**

  ```typescript
  // myth-server/src/game-engine/game.logic.ts
  import CardModel from "../models/card.model"; // To fetch UserCardInstance details
  import { AbilityRegistry } from "./ability.registry";
  import {
    GameState,
    BoardPosition,
    CardPower,
    BoardCell,
    Player,
    InGameCard,
  } from "../types/game.types";
  import {
    Card as BaseCard,
    UserCardInstance,
    SpecialAbility,
  } from "../types/database.types"; // DB Types
  import * as _ from "lodash";
  import db from "../config/db.config"; // For direct DB access if necessary for hydration

  const BOARD_SIZE = 4;

  export class GameLogic {
    // Helper to fetch and cache details for a UserCardInstance
    static async hydrateCardInstance(
      instanceId: string,
      userIdToVerifyOwnership?: string
    ): Promise<InGameCard | null> {
      // In a real app, this might hit a cache first, then DB
      // For now, directly query necessary details joining Cards, UserCardInstances, SpecialAbilities
      const query = `
        SELECT 
          uci.user_card_instance_id, uci.level, uci.xp, 
          c.card_id as base_card_id, c.name, c.rarity, c.image_url, 
          c.power_top as base_power_top, c.power_right as base_power_right, 
          c.power_bottom as base_power_bottom, c.power_left as base_power_left, 
          c.tags, c.special_ability_id,
          sa.name as ability_name, sa.description as ability_description, 
          sa.trigger_moment as ability_trigger, sa.parameters as ability_parameters
        FROM "UserCardInstances" uci
        JOIN "Cards" c ON uci.card_id = c.card_id
        LEFT JOIN "SpecialAbilities" sa ON c.special_ability_id = sa.ability_id
        WHERE uci.user_card_instance_id = $1 ${
          userIdToVerifyOwnership ? "AND uci.user_id = $2" : ""
        };
      `;
      const params = userIdToVerifyOwnership
        ? [instanceId, userIdToVerifyOwnership]
        : [instanceId];
      const { rows } = await db.query(query, params);
      if (rows.length === 0) return null;

      const row = rows[0];
      const levelBonus = row.level - 1; // Example: +1 power per stat for each level above 1
      const basePower: CardPower = {
        top: row.base_power_top,
        right: row.base_power_right,
        bottom: row.base_power_bottom,
        left: row.base_power_left,
      };
      const currentPower: CardPower = {
        top: basePower.top + levelBonus,
        right: basePower.right + levelBonus,
        bottom: basePower.bottom + levelBonus,
        left: basePower.left + levelBonus,
      };

      return {
        user_card_instance_id: row.user_card_instance_id,
        base_card_id: row.base_card_id,
        name: row.name,
        rarity: row.rarity,
        image_url: row.image_url,
        currentPower: currentPower,
        basePower: basePower,
        level: row.level,
        xp: row.xp,
        tags: row.tags,
        special_ability_id: row.special_ability_id,
        ability_name: row.ability_name,
        ability_description: row.ability_description,
        ability_triggerMoment: row.ability_trigger,
        ability_parameters: row.ability_parameters,
      };
    }

    static async initializeGame(
      player1UserCardInstanceIds: string[], // Array of UserCardInstance IDs
      player2UserCardInstanceIds: string[], // Array of UserCardInstance IDs for AI or P2
      player1UserId: string,
      player2UserId = "AI_PLAYER_ID_STATIC_STRING"
    ): Promise<GameState> {
      const shuffleDeck = (deck: string[]): string[] => _.shuffle(deck);
      const p1DeckShuffled = shuffleDeck([...player1UserCardInstanceIds]);
      const p2DeckShuffled = shuffleDeck([...player2UserCardInstanceIds]);
      const initialHandSize = 5;

      const board = Array(BOARD_SIZE)
        .fill(null)
        .map(() => Array(BOARD_SIZE).fill(null));
      const hydratedCardDataCache: Record<string, InGameCard> = {};

      // Hydrate initial hands and cache them
      const p1HandInstanceIds = p1DeckShuffled.slice(0, initialHandSize);
      for (const id of p1HandInstanceIds) {
        if (!hydratedCardDataCache[id]) {
          const cardData = await this.hydrateCardInstance(id, player1UserId);
          if (cardData) hydratedCardDataCache[id] = cardData;
        }
      }
      const p2HandInstanceIds = p2DeckShuffled.slice(0, initialHandSize);
      for (const id of p2HandInstanceIds) {
        if (!hydratedCardDataCache[id]) {
          // For AI, we don't verify ownership with userId, or AI has its own instances
          const cardData = await this.hydrateCardInstance(
            id,
            player2UserId.startsWith("AI_") ? undefined : player2UserId
          );
          if (cardData) hydratedCardDataCache[id] = cardData;
        }
      }

      const player1: Player = {
        userId: player1UserId,
        hand: p1HandInstanceIds,
        deck: p1DeckShuffled.slice(initialHandSize),
        score: 0,
      };

      const player2: Player = {
        userId: player2UserId,
        hand: p2HandInstanceIds,
        deck: p2DeckShuffled.slice(initialHandSize),
        score: 0,
      };

      return {
        board,
        player1,
        player2,
        currentPlayerId: player1UserId,
        turnNumber: 1,
        status: "active",
        maxCardsInHand: 5,
        initialCardsToDraw: initialHandSize,
        hydratedCardDataCache,
      };
    }

    static async placeCard(
      currentGameState: GameState,
      playerId: string,
      userCardInstanceId: string, // Now expects the ID of the UserCardInstance
      position: BoardPosition
    ): Promise<GameState> {
      let newState = _.cloneDeep(currentGameState);
      const player =
        newState.player1.userId === playerId
          ? newState.player1
          : newState.player2;
      const opponent =
        newState.player1.userId === playerId
          ? newState.player2
          : newState.player1;

      // ... (validation: is it player's turn, is position valid and empty)
      if (newState.currentPlayerId !== playerId)
        throw new Error("Not player's turn.");
      if (
        position.x < 0 ||
        position.x >= BOARD_SIZE ||
        position.y < 0 ||
        position.y >= BOARD_SIZE ||
        newState.board[position.y][position.x] !== null
      ) {
        throw new Error("Invalid board position or position already occupied.");
      }

      const cardIndexInHand = player.hand.indexOf(userCardInstanceId);
      if (cardIndexInHand === -1) throw new Error("Card instance not in hand.");

      // Get hydrated card data (from cache or fetch)
      let playedCardData = newState.hydratedCardDataCache?.[userCardInstanceId];
      if (!playedCardData) {
        playedCardData = await this.hydrateCardInstance(
          userCardInstanceId,
          playerId
        );
        if (!playedCardData)
          throw new Error(
            `Could not retrieve details for card instance ${userCardInstanceId}`
          );
        if (newState.hydratedCardDataCache)
          newState.hydratedCardDataCache[userCardInstanceId] = playedCardData;
      }

      // Place card on board
      const newBoardCell: BoardCell = {
        user_card_instance_id: playedCardData.user_card_instance_id,
        base_card_id: playedCardData.base_card_id,
        owner: playerId,
        current_power: playedCardData.currentPower, // Use the instance's current (leveled) power
        level: playedCardData.level,
        card_state: "normal", // Renamed from state
        base_card_data: {
          name: playedCardData.name,
          rarity: playedCardData.rarity,
          image_url: playedCardData.image_url,
          special_ability_id: playedCardData.special_ability_id,
          tags: playedCardData.tags,
          base_power: playedCardData.basePower,
          ability_name: playedCardData.ability_name,
          ability_description: playedCardData.ability_description,
          ability_triggerMoment: playedCardData.ability_triggerMoment,
          ability_parameters: playedCardData.ability_parameters,
        },
        // New fields initialized
        tile_status: "normal",
        player_1_turns_left: 0,
        player_2_turns_left: 0,
        animation_label: null,
      };
      newState.board[position.y][position.x] = newBoardCell;
      player.hand.splice(cardIndexInHand, 1);

      // TODO: Trigger OnPlace abilities using newBoardCell and playedCardData
      // newState = AbilityRegistry.executeAbility('OnPlace', newState, position, playerId);

      // Combat resolution (uses newBoardCell.currentPower)
      // ... (combat logic remains similar but uses currentPower from BoardCell)
      const directions = [
        { dx: 0, dy: -1, from: "bottom", to: "top" }, // Card above
        { dx: 1, dy: 0, from: "left", to: "right" }, // Card to the right
        { dx: 0, dy: 1, from: "top", to: "bottom" }, // Card below
        { dx: -1, dy: 0, from: "right", to: "left" }, // Card to the left
      ];

      for (const dir of directions) {
        const nx = position.x + dir.dx;
        const ny = position.y + dir.dy;

        if (
          nx >= 0 &&
          nx < BOARD_SIZE &&
          ny >= 0 &&
          ny < BOARD_SIZE &&
          newState.board[ny][nx]
        ) {
          const adjacentCell = newState.board[ny][nx]!;
          if (adjacentCell.owner !== playerId) {
            // Opponent's card
            const placedCardPower = (newBoardCell.current_power as any)[
              dir.from
            ];
            const adjacentCardPower = (adjacentCell.current_power as any)[
              dir.to
            ];

            if (placedCardPower > adjacentCardPower) {
              adjacentCell.owner = playerId; // Flip card
              // TODO: Trigger OnFlip (for the flipped card) and OnFlipped (for other cards observing)
              // newState = AbilityRegistry.executeAbility('OnFlip', newState, {x: nx, y: ny}, playerId);
            }
          }
        }
      }

      // Update scores
      newState.player1.score = 0;
      newState.player2.score = 0;
      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          if (newState.board[y][x]) {
            if (newState.board[y][x]!.owner === newState.player1.userId)
              newState.player1.score++;
            else if (newState.board[y][x]!.owner === newState.player2.userId)
              newState.player2.score++;
          }
        }
      }

      // Draw card if hand < max and deck has cards
      if (
        player.hand.length < newState.maxCardsInHand &&
        player.deck.length > 0
      ) {
        const drawnInstanceId = player.deck.shift()!;
        player.hand.push(drawnInstanceId);
        // Hydrate and cache the newly drawn card if not already in cache
        if (!newState.hydratedCardDataCache?.[drawnInstanceId]) {
          const cardData = await this.hydrateCardInstance(
            drawnInstanceId,
            playerId
          );
          if (cardData && newState.hydratedCardDataCache)
            newState.hydratedCardDataCache[drawnInstanceId] = cardData;
        }
      }

      // Check game over (board full)
      let boardFull = true;
      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          if (newState.board[y][x] === null) {
            boardFull = false;
            break;
          }
        }
        if (!boardFull) break;
      }

      if (boardFull) {
        newState.status =
          newState.player1.score > newState.player2.score
            ? "player1_win"
            : newState.player2.score > newState.player1.score
            ? "player2_win"
            : "draw";
        newState.winner =
          newState.status === "player1_win"
            ? newState.player1.userId
            : newState.status === "player2_win"
            ? newState.player2.userId
            : null;
      } else {
        newState.currentPlayerId = opponent.userId; // Switch turn
        newState.turnNumber++;
      }

      return newState;
    }
    // ... other methods like endTurn, surrender, etc.
  }
  ```

#### 3.4. `ai.logic.ts` - AI Opponent Logic (Updates for Card Instances)

- **Task:** Update AI to use `UserCardInstance` data and their leveled stats.
- **Action (`myth-server/src/game-engine/ai.logic.ts` - Key Changes Highlighted):**

  ```typescript
  // myth-server/src/game-engine/ai.logic.ts
  import { GameLogic } from "./game.logic";
  import { GameState, BoardPosition, InGameCard } from "../types/game.types";
  import * as _ from "lodash";

  const BOARD_SIZE = 4;

  export class AILogic {
    // Evaluate move needs to use the currentPower of the hydrated card instance
    evaluateMove(
      gameState: GameState,
      cardToPlay: InGameCard,
      position: BoardPosition,
      aiPlayerId: string
    ): number {
      let score = 0;
      const tempBoard = _.cloneDeep(gameState.board);

      // Simulate placement with the card instance's actual power and level
      tempBoard[position.y][position.x] = {
        user_card_instance_id: cardToPlay.user_card_instance_id,
        base_card_id: cardToPlay.base_card_id,
        owner: aiPlayerId,
        current_power: cardToPlay.currentPower,
        level: cardToPlay.level,
        card_state: "normal",
        base_card_data: {
          // Populate baseCardData for the simulated cell
          name: cardToPlay.name,
          rarity: cardToPlay.rarity,
          image_url: cardToPlay.image_url,
          special_ability_id: cardToPlay.special_ability_id,
          tags: cardToPlay.tags,
          base_power: cardToPlay.basePower,
          ability_name: cardToPlay.ability_name,
          ability_description: cardToPlay.ability_description,
          ability_triggerMoment: cardToPlay.ability_triggerMoment,
          ability_parameters: cardToPlay.ability_parameters,
        },
      };

      let potentialFlips = 0;
      const directions = [
        /* ... as before ... */
      ];

      for (const dir of directions) {
        const nx = position.x + dir.dx;
        const ny = position.y + dir.dy;
        if (
          nx >= 0 &&
          nx < BOARD_SIZE &&
          ny >= 0 &&
          ny < BOARD_SIZE &&
          tempBoard[ny][nx] !== null
        ) {
          const adjacentCell = tempBoard[ny][nx]!;
          if (adjacentCell.owner !== aiPlayerId) {
            const placedCardPower = (cardToPlay.currentPower as any)[dir.from];
            const adjacentCardPower = (adjacentCell.current_power as any)[
              dir.to
            ];
            if (placedCardPower > adjacentCardPower) {
              potentialFlips++;
            }
          }
        }
      }
      score += potentialFlips * 100;
      // Add sum of card's current power stats to score
      score +=
        cardToPlay.currentPower.top +
        cardToPlay.currentPower.right +
        cardToPlay.currentPower.bottom +
        cardToPlay.currentPower.left;

      // Positional bonus (remains the same)
      // ...
      return score;
    }

    async makeAIMove(
      currentGameState: GameState,
      aiDifficulty = "medium"
    ): Promise<{
      actionType: string;
      user_card_instance_id: string;
      position: BoardPosition;
    } | null> {
      const aiPlayer = currentGameState.player1.userId.startsWith("AI_")
        ? currentGameState.player1
        : currentGameState.player2;
      if (aiPlayer.hand.length === 0) return null;

      let possibleMoves = [];
      for (const instanceIdInHand of aiPlayer.hand) {
        // Get hydrated card data for AI (from cache or fetch - AI doesn't need userId verification for its own cards)
        let cardData =
          currentGameState.hydratedCardDataCache?.[instanceIdInHand];
        if (!cardData)
          cardData = await GameLogic.hydrateCardInstance(instanceIdInHand);

        if (!cardData) continue;

        for (let y = 0; y < BOARD_SIZE; y++) {
          for (let x = 0; x < BOARD_SIZE; x++) {
            if (currentGameState.board[y][x] === null) {
              const moveScore = this.evaluateMove(
                _.cloneDeep(currentGameState),
                cardData,
                { x, y },
                aiPlayer.userId
              );
              possibleMoves.push({
                user_card_instance_id: instanceIdInHand,
                position: { x, y },
                score: moveScore,
              });
            }
          }
        }
      }

      if (possibleMoves.length === 0) return null;
      possibleMoves.sort((a, b) => b.score - a.score);
      const topN = Math.min(
        possibleMoves.length,
        aiDifficulty === "hard" ? 1 : aiDifficulty === "medium" ? 3 : 5
      );
      const chosenMove = possibleMoves[Math.floor(Math.random() * topN)];

      return {
        actionType: "placeCard",
        user_card_instance_id: chosenMove.user_card_instance_id,
        position: chosenMove.position,
      };
    }
  }
  ```

#### 3.5. Solo Game API Endpoints

    * _(Controller and Route file contents (`game.controller.js`, `game.routes.js`) remain largely the same as previously provided in the last Phase 4 response. The key is that they call the updated `GameLogic` and `AILogic` which now operate on a 4x4 board.)_
    * **Crucial Check in `game.controller.js` for `startSoloGame`**: Ensure the `board_layout` in the `Games` table insertion uses '4x4'.
        ```javascript
        // In GameController.startSoloGame
        // ...
          const gameQuery = `
            INSERT INTO "Games" (player1_id, player2_id, player1_deck_id, game_mode, game_status, board_layout, current_turn_player_id, game_state, created_at, started_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING game_id, game_state, status AS game_db_status;
          `;
          const gameValues = [
            userId, null, deckId, 'solo', 'active',
            '4x4', // Ensure this is '4x4'
            initialGameState.currentPlayerId, JSON.stringify(initialGameState)
          ];
        // ...
        ```

---

### 4. Testing Points for Phase 4 (with Card Instances & 4x4 Board)

- [ ] **Database Setup:** `Games.board_layout` column correctly defaults to '4x4'. `UserCardInstance` table exists and is populated correctly.
- [ ] **`POST /api/games/solo`**: (Endpoint name changed from `/start`)
  - [ ] Game initializes with a 4x4 board in `gameState`.
  - [ ] Player and AI hands/decks in `gameState` contain `user_card_instance_id`s.
  - [ ] `hydratedCardDataCache` in `gameState` is populated for initial hands.
  - [ ] `Games` table entry reflects `board_layout='4x4'` and correct initial `gameState` with instance IDs.
- [ ] **`POST /api/games/{gameId}/actions` (actionType: `placeCard`)**: (Payload now uses `user_card_instance_id`)
  - [ ] Player can place cards (instances) on all valid 4x4 positions.
  - [ ] Combat logic correctly uses the `current_power` of the placed `UserCardInstance` (derived from base stats + level).
  - [ ] AI makes moves using `UserCardInstance` data and their leveled stats.
  - [ ] Board cells correctly store `user_card_instance_id`, `level`, and `current_power`.
- [ ] **Game Over Logic (4x4)**:
  - [ ] Game correctly ends when all 16 cells of the 4x4 board are full.
  - [ ] Winner determined correctly based on card count on the 4x4 board.
- **All other testing points from the previous Phase 4 response remain relevant but should be tested in the context of the 4x4 board.** (Special abilities, AI behavior, currency awards, error handling, etc.)

---

### 5. Next Steps

Upon successful completion of Phase 4, the project will have a functional server-authoritative game logic engine and a complete Solo Mode API. The next phase (Phase 5) will focus on implementing real-time PvP using WebSockets.

**Important Development Standards:**

1. **Strict TypeScript:** All game engine code must use strict TypeScript with proper typing (including `InGameCard`, updated `BoardCell`, `Player` types) to ensure type safety.
2. **Type Definitions:** Continue to maintain all shared type definitions in the separate `src/types` directory for future packaging.
3. **OpenAPI Documentation:** All REST API endpoints related to game functionality must be documented in OpenAPI specifications.
4. **Code Documentation:** Use JSDoc comments to document all game logic functions, classes, and interfaces.
