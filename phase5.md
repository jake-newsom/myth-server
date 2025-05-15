# Viking Vengeance: Server-Side Implementation

## Phase 5: WebSocket Implementation for PvP (Local)

**Objective:** Implement real-time Player vs. Player (PvP) functionality using WebSockets (Socket.IO). This includes setting up the WebSocket server, authenticating socket connections, managing game rooms, handling real-time game actions and state synchronization, and creating a basic matchmaking system.

**Parent Document:** Viking Vengeance: Server-Side Systems - PRD & Implementation Plan
**Prerequisites:** Phase 4 completed (Server-authoritative game logic for a 4x4 board and Solo Mode API are functional). `lodash` and `uuid` are installed.
**Version:** 1.0
**Date:** May 9, 2025

---

### 1. Prerequisites & Tools

- **Phase 4 Completion:** Functional Solo Mode with server-side game logic.
- **Node.js & npm/yarn:** Installed.
- **Project Folder:** `myth-server` with existing Phase 1-4 code.
- **Core Dependencies:** `express`, `pg`, `dotenv`, `jsonwebtoken`, `bcrypt`, `cors`, `lodash`, `uuid`.
- **API Testing Tool:** Postman, Insomnia, or curl (for matchmaking HTTP endpoints).
- **WebSocket Testing Tool:** A WebSocket client GUI (e.g., Postman now supports WebSockets, or browser developer tools, or a dedicated client like Simple WebSocket Client extension).
- **Database `myth`:** Populated and accessible.
- **TypeScript Configuration:** Strict TypeScript mode is enabled in `tsconfig.json` with `"strict": true`.

### 2. Install Dependencies

- **Task:** Install `socket.io`.
- **Action (Run from `myth-server` directory):**
  ```bash
  npm install socket.io
  npm install -D @types/socket.io
  ```

### 3. Key Tasks & Technical Details

#### 3.1. WebSocket Type Definitions

- **Task:** Create type definitions for WebSocket events and data.
- **Action (`myth-server/src/types/socket.types.ts`):**

  ```typescript
  // myth-server/src/types/socket.types.ts

  /**
   * Type definitions for Socket.IO events and related data
   * These will be maintained in a separate file for future packaging as an NPM module
   */

  import { GameState, BoardPosition, HydratedCardInstance } from "./game.types";

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

  export interface ErrorResponse {
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
  ```

#### 3.2. Socket.IO Server Setup

- **Task:** Integrate Socket.IO with the existing Express HTTP server.
- **Action (Update `myth-server/server.ts`):**

  ```typescript
  // myth-server/server.ts
  require("dotenv").config();
  import * as http from "http";
  import { app } from "./src/app"; // Your Express app
  import { Server } from "socket.io"; // Import Socket.IO Server
  import { initializeSocketManager } from "./src/sockets/socket.manager"; // To be created

  const PORT = process.env.PORT || 3000;
  const httpServer = http.createServer(app); // Use httpServer for Socket.IO

  // Initialize Socket.IO
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:8100", // Adjust for your client URL (Ionic default)
      methods: ["GET", "POST"],
      // credentials: true // If you need to send cookies with socket requests (not typical for token auth)
    },
  });

  initializeSocketManager(io); // Pass the 'io' instance to your socket manager

  httpServer.listen(PORT, () => {
    // Listen on httpServer
    console.log(`Server is running on port ${PORT}`);
    console.log(`Socket.IO initialized and listening.`);
    console.log(`Access at http://localhost:${PORT}`);
  });
  ```

  - **Note:** Add `CLIENT_URL` to your `.env` file (e.g., `CLIENT_URL=http://localhost:8100` for default Ionic dev server).

- **Task:** Create a new directory for socket-related logic.
- **Action (`myth-server/src/sockets/` directory structure):**
  ```
  myth-server/
  ├── src/
  │   ├── sockets/
  │   │   ├── socket.manager.ts       # Main handler for socket connections and events
  │   │   └── socket.auth.middleware.ts # Middleware for authenticating socket connections
  ```

#### 3.3. WebSocket Authentication

- **Task:** Implement middleware to authenticate socket connections using JWTs.
- **Action (`myth-server/src/sockets/socket.auth.middleware.ts`):**

  ```typescript
  // myth-server/src/sockets/socket.auth.middleware.ts
  import * as jwt from "jsonwebtoken";
  import { Socket } from "socket.io";
  import { ExtendedError } from "socket.io/dist/namespace";
  import { config } from "../config";
  import { UserModel } from "../models/user.model";

  // Define authenticated socket interface with user property
  export interface AuthenticatedSocket extends Socket {
    user: {
      user_id: string;
      username: string;
      email: string;
      in_game_currency: number;
    };
  }

  export const socketAuthMiddleware = async (
    socket: Socket,
    next: (err?: ExtendedError) => void
  ) => {
    // Client should send token in socket.handshake.auth object during connection
    // Example client-side: const socket = io({ auth: { token: "your_jwt_token" } });
    const token = socket.handshake.auth.token;

    if (!token) {
      console.log("Socket Auth: No token provided.");
      return next(new Error("Authentication error: No token provided."));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      const user = await UserModel.findById(decoded.userId);

      if (!user) {
        console.log(`Socket Auth: User ${decoded.userId} not found.`);
        return next(new Error("Authentication error: User not found."));
      }

      (socket as AuthenticatedSocket).user = user; // Attach user object to the socket instance
      next();
    } catch (error) {
      console.error("Socket Auth Error:", error.message);
      return next(new Error("Authentication error: Invalid token."));
    }
  };
  ```

#### 3.4. Game Room Management & PvP Game State

- **Concept:** Each active PvP game will have its own "room" in Socket.IO, identified by the `game_id`. Players in a game join this room to receive game-specific events.
- **Game State for PvP:** The `gameState` structure from Phase 4 is largely reusable.
  - `player1.userId` and `player2.userId` will both be actual user UUIDs from the `Users` table.
  - The server will need to determine which connected socket corresponds to `player1` and which to `player2` within a game instance.

#### 3.5. Socket Event Design & Implementation (`socket.manager.ts`)

- **Task:** Define and handle client-server communication for PvP games, using `UserCardInstance`.
- **Action (`myth-server/src/sockets/socket.manager.ts`):**

  ```typescript
  // myth-server/src/sockets/socket.manager.ts
  const socketAuthMiddleware = require("./socket.auth.middleware");
  const GameLogic = require("../game-engine/game.logic");
  // const AILogic = require('../game-engine/ai.logic'); // Not directly used for PvP actions by humans
  const db = require("../config/db.config");
  const UserModel = require("../models/user.model");

  // In-memory store for active games and player sockets (can be moved to Redis for scalability)
  // const activeGames = new Map(); // Key: gameId, Value: { gameState, player1SocketId, player2SocketId }

  function initializeSocketManager(io) {
    io.use(socketAuthMiddleware); // Apply auth middleware to all incoming connections

    io.on("connection", (socket) => {
      console.log(
        `User connected: ${socket.user.username} (Socket ID: ${socket.id})`
      );

      // Event: Player wants to join a specific game room (after matchmaking)
      socket.on("game:join", async (data) => {
        const { gameId } = data;
        if (!gameId) {
          socket.emit("game:error", { message: "gameId is required to join." });
          return;
        }

        try {
          const gameResult = await db.query(
            'SELECT * FROM "Games" WHERE game_id = $1 AND game_mode = $2 AND game_status = $3;',
            [gameId, "pvp", "active"]
          ); // Or 'pending' if waiting for 2nd player
          if (gameResult.rows.length === 0) {
            socket.emit("game:error", {
              message: "Game not found or not a valid PvP game.",
            });
            return;
          }
          const game = gameResult.rows[0];

          // Check if user is part of this game
          if (
            socket.user.user_id !== game.player1_id &&
            socket.user.user_id !== game.player2_id
          ) {
            socket.emit("game:error", {
              message: "You are not part of this game.",
            });
            return;
          }

          socket.join(gameId); // Player joins the Socket.IO room for this game
          console.log(
            `User ${socket.user.username} joined game room: ${gameId}`
          );

          // Store socket ID with player role (optional, if needed for direct targeting beyond rooms)
          // if (!activeGames.has(gameId)) activeGames.set(gameId, { gameState: game.game_state });
          // const gameData = activeGames.get(gameId);
          // if (socket.user.user_id === game.player1_id) gameData.player1SocketId = socket.id;
          // else gameData.player2SocketId = socket.id;

          // Notify player they've joined successfully
          socket.emit("game:joined", {
            gameId,
            gameState: game.game_state,
            message: `Successfully joined game ${gameId}`,
          });

          // Check if both players are now connected to the room (if this logic is needed)
          const room = io.sockets.adapter.rooms.get(gameId);
          if (room && room.size === 2) {
            // Assuming 2 players for PvP
            io.to(gameId).emit("game:start", {
              gameId,
              gameState: game.game_state,
              message: "Both players connected. Game starts!",
            });
          } else if (room) {
            io.to(gameId).emit("game:player_connected", {
              userId: socket.user.user_id,
              username: socket.user.username,
              playerCount: room.size,
            });
          }
        } catch (error) {
          console.error(`Error joining game ${gameId}:`, error);
          socket.emit("game:error", { message: "Error joining game." });
        }
      });

      // Event: Player submits an action for a game
      socket.on("game:action", async (data) => {
        const { gameId, actionType, user_card_instance_id, position } = data;
        const userId = socket.user.user_id;

        if (!gameId || !actionType) {
          socket.emit("game:error", {
            message: "gameId and actionType are required.",
          });
          return;
        }

        try {
          const gameResult = await db.query(
            'SELECT * FROM "Games" WHERE game_id = $1;',
            [gameId]
          );
          if (gameResult.rows.length === 0) {
            socket.emit("game:error", { message: "Game not found." });
            return;
          }
          let currentGame = gameResult.rows[0];
          let currentGameState = currentGame.game_state;

          if (currentGame.game_status !== "active") {
            socket.emit("game:error", {
              message: `Game is already over: ${currentGame.game_status}`,
            });
            return;
          }
          if (currentGameState.currentPlayerId !== userId) {
            socket.emit("game:error", { message: "Not your turn." });
            return;
          }

          let nextGameState;
          if (actionType === "placeCard") {
            if (!user_card_instance_id || position === undefined) {
              socket.emit("game:error", {
                message: "user_card_instance_id and position are required.",
              });
              return;
            }
            nextGameState = await GameLogic.placeCard(
              currentGameState,
              userId,
              user_card_instance_id,
              position
            );
          } else if (actionType === "endTurn") {
            // If explicit end turn is allowed
            nextGameState = GameLogic.endTurn(currentGameState, userId);
          } else {
            socket.emit("game:error", { message: "Invalid actionType." });
            return;
          }

          // Update DB
          const updateQuery = `
            UPDATE "Games" SET game_state = $1, game_status = $2, current_turn_player_id = $3, completed_at = $4, winner_id = $5
            WHERE game_id = $6 RETURNING game_id, game_state, game_status, current_turn_player_id, winner_id;`; // Added more returning fields

          let completedAt = null;
          let winnerIdDb = null; // Use a different variable name to avoid conflict with function scope
          let currencyAwardedTo = null;

          if (nextGameState.status !== "active") {
            completedAt = "NOW()";
            if (nextGameState.status === "player1_win")
              winnerIdDb = nextGameState.player1.userId;
            else if (nextGameState.status === "player2_win")
              winnerIdDb = nextGameState.player2.userId;

            if (winnerIdDb) {
              // If there's a winner, award currency
              const currencyAward = 10;
              await UserModel.updateCurrency(winnerIdDb, currencyAward);
              currencyAwardedTo = winnerIdDb;
              console.log(
                `Awarded ${currencyAward} currency to user ${winnerIdDb} for winning PvP game ${gameId}`
              );
            }
          }

          const updateValues = [
            JSON.stringify(nextGameState),
            nextGameState.status,
            nextGameState.currentPlayerId,
            completedAt,
            winnerIdDb,
            gameId,
          ];
          const updatedGameResult = await db.query(updateQuery, updateValues);
          const updatedGameData = updatedGameResult.rows[0];

          // Broadcast updated state to all players in the room
          io.to(gameId).emit("game:state_update", {
            gameState: updatedGameData.game_state,
            gameStatus: updatedGameData.game_status,
            currentPlayerId: updatedGameData.current_turn_player_id,
          });

          if (updatedGameData.game_status !== "active") {
            io.to(gameId).emit("game:over", {
              gameStatus: updatedGameData.game_status,
              winnerId: updatedGameData.winner_id,
              finalGameState: updatedGameData.game_state,
              currencyAwardedTo: currencyAwardedTo,
            });
            // Optionally, make sockets leave the room or clean up activeGames map
            // io.socketsLeave(gameId);
            // activeGames.delete(gameId);
          }
        } catch (error) {
          console.error(`Error processing game action for ${gameId}:`, error);
          // Send specific error message if it's a known game logic error
          if (
            error.message.includes("Not player's turn") ||
            error.message.includes("Card not in hand") ||
            error.message.includes("Invalid board position")
          ) {
            socket.emit("game:error", { message: error.message });
          } else {
            socket.emit("game:error", {
              message: "Error processing game action.",
            });
          }
        }
      });

      socket.on("disconnect", () => {
        console.log(
          `User disconnected: ${
            socket.user ? socket.user.username : "Unknown"
          } (Socket ID: ${socket.id})`
        );
        // Handle disconnections:
        // - If player was in an active game, opponent might win by forfeit.
        // - Remove socket from any activeGames tracking.
        // - Notify other player in the room if applicable.
        // This requires more complex state management of which socket is in which game.
      });
    });
  }

  module.exports = initializeSocketManager;
  ```

#### 3.6. Basic Matchmaking API (HTTP Endpoints)

- **Task:** Create simple HTTP endpoints for players to join a queue and be matched.
- **Concept (In-Memory Queue for MVP):**
  - A simple array on the server to hold `userId`s waiting for a match.
  - When a player joins, if someone is waiting, pair them, create a `Game` DB entry, and notify both (client will poll for match status).
- **Controller (`myth-server/src/api/controllers/matchmaking.controller.ts` - NEW):**

  ```typescript
  // myth-server/src/api/controllers/matchmaking.controller.ts
  const db = require("../../config/db.config");
  const DeckModel = require("../../models/deck.model");
  const GameLogic = require("../../game-engine/game.logic"); // For initializeGame
  const { v4: uuidv4 } = require("uuid"); // For generating game IDs if needed, though DB does it

  // In-memory queue (can be replaced by Redis or a DB table for persistence)
  const matchmakingQueue = []; // Stores { userId, deckId, res (for long polling if implemented) }
  const activeMatches = new Map(); // Stores gameId by userId if they are matched

  const MatchmakingController = {
    async joinQueue(req, res, next) {
      try {
        const userId = req.user.user_id;
        const { deckId } = req.body;

        if (!deckId) {
          return res.status(400).json({
            error: { message: "deckId is required to join matchmaking." },
          });
        }
        // Validate deck ownership and validity (simplified here, assume valid)
        const playerDeck = await DeckModel.findByIdAndUserIdWithCards(
          deckId,
          userId
        );
        if (!playerDeck || playerDeck.cards.length < 10) {
          // Min deck size
          return res.status(400).json({
            error: { message: "Invalid or incomplete deck selected." },
          });
        }

        // Prevent joining if already in queue or an active match
        if (
          matchmakingQueue.find((p) => p.userId === userId) ||
          activeMatches.has(userId)
        ) {
          // If already matched, return existing gameId
          if (activeMatches.has(userId)) {
            return res
              .status(200)
              .json({ status: "matched", gameId: activeMatches.get(userId) });
          }
          return res.status(400).json({
            error: { message: "Already in queue or an active match." },
          });
        }

        if (matchmakingQueue.length > 0) {
          const opponent = matchmakingQueue.shift(); // Get first player from queue
          if (opponent.userId === userId) {
            // Shouldn't happen if check above works, but as a safeguard
            matchmakingQueue.push(opponent); // Put back if it's the same user
            return res
              .status(202)
              .json({ status: "queued", message: "Waiting for an opponent." });
          }

          // --- Create Game ---
          const player1Deck = await DeckModel.findByIdAndUserIdWithCards(
            userId,
            userId
          ); // Current player's deck
          const player2Deck = await DeckModel.findByIdAndUserIdWithCards(
            opponent.deckId,
            opponent.userId
          ); // Opponent's deck

          const p1DeckCardIds = player1Deck.cards.reduce((acc, card) => {
            for (let i = 0; i < card.quantity; i++) acc.push(card.card_id);
            return acc;
          }, []);
          const p2DeckCardIds = player2Deck.cards.reduce((acc, card) => {
            for (let i = 0; i < card.quantity; i++) acc.push(card.card_id);
            return acc;
          }, []);

          // Randomly assign P1/P2 or fixed (joining player is P1, queued player is P2)
          const p1UserIdForGame = userId;
          const p2UserIdForGame = opponent.userId;

          const initialGameState = await GameLogic.initializeGame(
            p1DeckCardIds,
            p2DeckCardIds,
            p1UserIdForGame,
            p2UserIdForGame
          );
          initialGameState.currentPlayerId = p1UserIdForGame; // Player who initiated match often goes first

          const gameQuery = `
            INSERT INTO "Games" (player1_id, player2_id, player1_deck_id, player2_deck_id, game_mode, game_status, board_layout, current_turn_player_id, game_state, created_at, started_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            RETURNING game_id;
          `;
          const gameValues = [
            p1UserIdForGame,
            p2UserIdForGame,
            deckId,
            opponent.deckId,
            "pvp",
            "active", // Start as active
            "4x4",
            initialGameState.currentPlayerId,
            JSON.stringify(initialGameState),
          ];
          const gameResult = await db.query(gameQuery, gameValues);
          const newGameId = gameResult.rows[0].game_id;

          activeMatches.set(userId, newGameId);
          activeMatches.set(opponent.userId, newGameId);

          // For polling: Opponent's client will pick this up on their next /status call.
          // If using long polling, would resolve opponent.res here.

          res.status(200).json({
            status: "matched",
            gameId: newGameId,
            opponentUsername:
              "OpponentUsername" /* TODO: Fetch opponent username */,
          });
        } else {
          matchmakingQueue.push({ userId, deckId });
          res.status(202).json({
            status: "queued",
            message: "Added to queue. Waiting for an opponent.",
          });
        }
      } catch (error) {
        next(error);
      }
    },

    async getMatchStatus(req, res, next) {
      try {
        const userId = req.user.user_id;
        if (activeMatches.has(userId)) {
          const gameId = activeMatches.get(userId);
          // Optional: Fetch opponent details to return
          const gameDetails = await db.query(
            'SELECT player1_id, player2_id FROM "Games" WHERE game_id = $1',
            [gameId]
          );
          let opponentUsername = "Opponent";
          if (gameDetails.rows.length > 0) {
            const opponentId =
              gameDetails.rows[0].player1_id === userId
                ? gameDetails.rows[0].player2_id
                : gameDetails.rows[0].player1_id;
            const opponentUser = await UserModel.findById(opponentId);
            if (opponentUser) opponentUsername = opponentUser.username;
          }

          res.status(200).json({
            status: "matched",
            gameId: gameId,
            opponentUsername: opponentUsername,
          });
          // Consider removing from activeMatches once client confirms game entry or after a timeout
          // For robust cleanup, activeMatches should be cleared when games end or players disconnect.
        } else if (matchmakingQueue.find((p) => p.userId === userId)) {
          res.status(200).json({
            status: "queued",
            message: "Still in queue. Waiting for an opponent.",
          });
        } else {
          res.status(200).json({
            status: "idle",
            message: "Not in queue or any active match.",
          });
        }
      } catch (error) {
        next(error);
      }
    },

    async leaveQueue(req, res, next) {
      try {
        const userId = req.user.user_id;
        const index = matchmakingQueue.findIndex((p) => p.userId === userId);
        if (index > -1) {
          matchmakingQueue.splice(index, 1);
          res.status(200).json({
            status: "left_queue",
            message: "Removed from matchmaking queue.",
          });
        } else {
          res.status(400).json({
            error: { message: "You are not in the matchmaking queue." },
          });
        }
      } catch (error) {
        next(error);
      }
    },
    // TODO: Add a mechanism to clear users from activeMatches when their game ends or they disconnect.
    // This could be an internal function called from game:over or disconnect handlers.
    clearActiveMatch(userId) {
      if (activeMatches.has(userId)) {
        activeMatches.delete(userId);
        console.log(`User ${userId} cleared from activeMatches.`);
      }
    },
  };
  module.exports = MatchmakingController;
  // Make sure to export clearActiveMatch if you intend to use it from socket.manager.ts
  // e.g., module.exports = { MatchmakingController, clearActiveMatchFromController: MatchmakingController.clearActiveMatch };
  ```

- **Routes (`myth-server/src/api/routes/matchmaking.routes.ts` - NEW):**

  ```typescript
  // myth-server/src/api/routes/matchmaking.routes.ts
  const express = require("express");
  const MatchmakingController = require("../controllers/matchmaking.controller");
  const { protect } = require("../middlewares/auth.middleware");

  const router = express.Router();
  router.use(protect);

  router.post("/join", MatchmakingController.joinQueue);
  router.get("/status", MatchmakingController.getMatchStatus);
  router.post("/leave", MatchmakingController.leaveQueue);

  module.exports = router;
  ```

- **Action (Update `myth-server/src/api/routes/index.ts`):**

  ```typescript
  // myth-server/src/api/routes/index.ts
  // ... other imports
  const matchmakingRoutes = require("./matchmaking.routes"); // NEW

  // ...
  router.use("/matchmaking", matchmakingRoutes); // Mount matchmaking routes
  // ...
  ```

#### 3.7. OpenAPI Specification for Matchmaking API

- **Task:** Create an OpenAPI specification for the HTTP matchmaking endpoints.
- **Action (`myth-server/src/openapi/matchmaking.openapi.yaml`):**

  ```yaml
  # myth-server/src/openapi/matchmaking.openapi.yaml
  openapi: 3.0.0
  info:
    title: Viking Vengeance Matchmaking API
    description: API for matchmaking and PvP game setup
    version: 1.0.0

  paths:
    /api/matchmaking/status:
      get:
        summary: Get current matchmaking status for the user
        tags:
          - Matchmaking
        security:
          - bearerAuth: []
        responses:
          200:
            description: Matchmaking status retrieved successfully
            content:
              application/json:
                schema:
                  $ref: "#/components/schemas/MatchmakingStatus"
          401:
            description: Unauthorized - Invalid or missing token
          500:
            description: Server error

    /api/matchmaking/casual:
      post:
        summary: Create a matchmaking request for casual mode
        tags:
          - Matchmaking
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
            description: Matchmaking request created successfully
            content:
              application/json:
                schema:
                  $ref: "#/components/schemas/MatchmakingRequest"
          400:
            description: Invalid request (e.g., deck not found or invalid)
          401:
            description: Unauthorized - Invalid or missing token
          500:
            description: Server error

    /api/matchmaking/cancel:
      post:
        summary: Cancel current matchmaking request
        tags:
          - Matchmaking
        security:
          - bearerAuth: []
        responses:
          200:
            description: Matchmaking request cancelled successfully
          401:
            description: Unauthorized - Invalid or missing token
          404:
            description: No active matchmaking request found
          500:
            description: Server error

  components:
    schemas:
      MatchmakingStatus:
        type: object
        properties:
          inQueue:
            type: boolean
          queueType:
            type: string
            enum: [casual, ranked]
            nullable: true
          queuedAt:
            type: string
            format: date-time
            nullable: true
          estimatedWaitTime:
            type: integer
            nullable: true

      MatchmakingRequest:
        type: object
        properties:
          requestId:
            type: string
            format: uuid
          userId:
            type: string
            format: uuid
          deckId:
            type: string
            format: uuid
          mode:
            type: string
            enum: [casual, ranked]
          status:
            type: string
            enum: [pending, matched, cancelled]
          createdAt:
            type: string
            format: date-time

    securitySchemes:
      bearerAuth:
        type: http
        scheme: bearer
        bearerFormat: JWT
  ```

---

### 4. Testing Points for Phase 5

- [ ] **Socket Server:** Server starts, Socket.IO initializes without errors.
- [ ] **WebSocket Authentication:**
  - [ ] Client connection without a token (or invalid token) is rejected.
  - [ ] Client connection with a valid JWT (sent via `socket.handshake.auth.token`) is accepted, and `socket.user` is populated.
- [ ] **Matchmaking API:**
  - [ ] `POST /api/matchmaking/join`:
    - [ ] Player 1 joins (with a valid deckId of 20 card instances), status `queued`.
    - [ ] Player 2 joins, status `matched` for Player 2. New `Game` record created in DB with `game_mode='pvp'`, `status='pending'` initially. Both `player1_id`, `player2_id` populated. `initialGameState` uses the `user_card_instance_ids` from selected decks.
    - [ ] Player 1's next `GET /api/matchmaking/status` shows `matched` with the same `gameId`.
    - [ ] Cannot join if already in queue or matched.
  - [ ] `GET /api/matchmaking/status`: Returns correct status (`idle`, `queued`, `matched` with `gameId`).
  - [ ] `POST /api/matchmaking/leave`: Removes player from queue.
- [ ] **Game Room Joining (`socket.on('game:join')`):**
  - [ ] Authenticated players can join the game room specified by `gameId` obtained from matchmaking.
  - [ ] `game:joined` event received by the joining client.
  - [ ] If both players join, `game:start` (or similar) is broadcast to the room.
  - [ ] Non-participants cannot join the room or receive game events for that room.
- [ ] **Real-Time Game Actions (`socket.on('game:action')`):**
  - [ ] Player A (whose turn it is) sends `game:action` with `user_card_instance_id`.
  - [ ] Server processes the action using `GameLogic` with the specific card instance's (leveled) stats.
  - [ ] `Games` table in DB is updated with new `gameState` and `currentPlayerId`.
  - [ ] Both Player A and Player B receive `game:state_update` with the new `gameState`.
  - [ ] Invalid actions (not turn, invalid move) result in `game:error` to the sender, no state change broadcast.
- [ ] **Game Flow & Synchronization:**
  - [ ] Turns correctly alternate between players.
  - [ ] Card placements, combat, ability effects are accurately reflected for both players in real-time.
  - [ ] Scores update correctly for both players.
- [ ] **Game Over (PvP):**
  - [ ] When board is full, game status changes, winner is determined.
  - [ ] Both players receive `game:over` event with final status and winner.
  - [ ] Winning player's currency is updated.
- [ ] **Surrender (`socket.on('game:surrender')`):**
  - [ ] Player surrendering causes the other player to win.
  - [ ] `game:over` event broadcast with correct winner and surrender info.
  - [ ] Currency awarded to the winner.
- [ ] **Disconnection Handling (Basic):**
  - [ ] (Manual Test) If one player disconnects, consider how this is handled (e.g., does the game end? Does opponent win by forfeit? This needs more robust logic beyond MVP but basic logging/observation is a start).

---

### 5. Next Steps

Once Phase 5 is completed and tested, the server-side implementation for Viking Vengeance will be fully functional for both solo and PvP gameplay. The next steps would involve integrating this server with the front-end applications and preparing for production deployment, scaling, and further feature development.

**Important Development Standards:**

1. **Strict TypeScript:** All socket.io code must use strict TypeScript with proper typing to ensure type safety.
2. **Type Definitions:** Continue to maintain all shared type definitions in separate type files within the `src/types` directory.
3. **OpenAPI Documentation:** All HTTP endpoints related to matchmaking and WebSocket integration must be documented with OpenAPI specifications.
4. **Socket Event Documentation:** Document all socket event types, payloads, and their purposes in both code comments and in a separate documentation file.
