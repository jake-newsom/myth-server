// myth-server/src/sockets/socket.manager.js
const { socketAuthMiddleware } = require("./socket.auth.middleware");
const { setupGameNamespace } = require("./namespace.game");
const db = require("../config/db.config").default; // Access the database
const GameLogic = require("../game-engine/game.logic").GameLogic; // Import GameLogic class for game actions
const UserModel = require("../models/user.model").default; // Import UserModel for updating currency

/**
 * In-memory store for active games and player sockets
 * In a production environment, this should use Redis or similar for persistence across server instances
 * @type {Map<string, {gameState: Object, player1SocketId?: string, player2SocketId?: string}>}
 */
const activeGames = new Map();

/**
 * In-memory mapping of user IDs to their current socket IDs
 * @type {Map<string, string>}
 */
const userSocketMap = new Map();

/**
 * Initialize Socket.IO and set up event handlers
 * @param {import('socket.io').Server} io - The Socket.IO server instance
 */
function initializeSocketManager(io) {
  io.use(socketAuthMiddleware); // Apply auth middleware to all incoming connections

  // Initialize the namespaced multiplayer layer
  setupGameNamespace(io);

  io.on("connection", (socket) => {
    // At this point, socket has been authenticated and has socket.user
    const userId = socket.user.user_id;
    const username = socket.user.username;

    console.log(
      `User connected: ${username} (ID: ${userId}, Socket ID: ${socket.id})`
    );

    // Map this user's ID to their socket ID
    userSocketMap.set(userId, socket.id);

    // Event: Join a specific game room
    socket.on("game:join", async (data) => {
      const { gameId } = data;
      if (!gameId) {
        socket.emit("game:error", {
          message: "gameId is required to join a game.",
        });
        return;
      }

      try {
        // Fetch game from database
        const gameResult = await db.query(
          'SELECT * FROM "games" WHERE game_id = $1',
          [gameId]
        );

        if (gameResult.rows.length === 0) {
          socket.emit("game:error", { message: "Game not found." });
          return;
        }

        const game = gameResult.rows[0];

        // Check if user is part of this game
        if (game.player1_id !== userId && game.player2_id !== userId) {
          socket.emit("game:error", {
            message: "You are not a participant in this game.",
          });
          return;
        }

        // Join the Socket.IO room for this game
        socket.join(gameId);
        console.log(`User ${username} (${userId}) joined game room: ${gameId}`);

        // Track which player this socket belongs to in our active games map
        if (!activeGames.has(gameId)) {
          // Initialize the game state tracking if it doesn't exist
          activeGames.set(gameId, {
            gameState: game.game_state,
            startedAt: new Date(),
          });
        }

        const gameData = activeGames.get(gameId);

        // Store the socket ID for the appropriate player
        if (userId === game.player1_id) {
          gameData.player1SocketId = socket.id;
        } else {
          gameData.player2SocketId = socket.id;
        }

        // Notify player they've joined
        const playerNumber = game.player1_id === userId ? 1 : 2;
        socket.emit("game:joined", {
          gameId,
          gameState: game.game_state,
          playerNumber,
          message: `Successfully joined game ${gameId}`,
        });

        // Check if both players are now connected
        const room = io.sockets.adapter.rooms.get(gameId);
        if (room && room.size === 2) {
          // Both players are connected, send start event
          io.to(gameId).emit("game:start", {
            gameId,
            gameState: game.game_state,
            message: "Both players connected. Game is ready!",
          });
        } else {
          // Notify that one player is waiting
          io.to(gameId).emit("game:player_connected", {
            userId,
            username,
            playerCount: room ? room.size : 1,
          });
        }
      } catch (error) {
        console.error(`Error joining game ${gameId}:`, error);
        socket.emit("game:error", {
          message: "Server error while joining game.",
        });
      }
    });

    // Event: Player submits an action for a game
    socket.on("game:action", async (data) => {
      const { gameId, actionType, user_card_instance_id, position } = data;

      if (!gameId || !actionType) {
        socket.emit("game:error", {
          message: "gameId and actionType are required.",
        });
        return;
      }

      try {
        // Fetch current game state from database
        const gameResult = await db.query(
          'SELECT * FROM "games" WHERE game_id = $1;',
          [gameId]
        );

        if (gameResult.rows.length === 0) {
          socket.emit("game:error", { message: "Game not found." });
          return;
        }

        const currentGame = gameResult.rows[0];
        const currentGameState = currentGame.game_state;

        // Check if game is still active
        if (currentGame.game_status !== "active") {
          socket.emit("game:error", {
            message: `Game is already over: ${currentGame.game_status}`,
          });
          return;
        }

        // Check if it's player's turn
        if (currentGameState.current_player_id !== userId) {
          socket.emit("game:error", { message: "Not your turn." });
          return;
        }

        let nextGameState;

        // Process the action based on action type
        if (actionType === "placeCard") {
          // Validate required parameters for placing a card
          if (!user_card_instance_id || position === undefined) {
            socket.emit("game:error", {
              message:
                "user_card_instance_id and position are required for placing a card.",
            });
            return;
          }

          try {
            // Use GameLogic to process the move
            const result = await GameLogic.placeCard(
              currentGameState,
              userId,
              user_card_instance_id,
              position
            );
            nextGameState = result.state;
          } catch (err) {
            // Handle game logic errors (invalid moves, etc.)
            socket.emit("game:error", { message: err.message });
            return;
          }
        } else if (actionType === "endTurn") {
          // Explicit end turn action
          try {
            const result = await GameLogic.endTurn(currentGameState, userId);
            nextGameState = result.state;
          } catch (err) {
            socket.emit("game:error", { message: err.message });
            return;
          }
        } else if (actionType === "surrender") {
          // Handle player surrender
          const winningPlayerId =
            currentGameState.player1.user_id === userId
              ? currentGameState.player2.user_id
              : currentGameState.player1.user_id;

          nextGameState = { ...currentGameState };
          nextGameState.status = "completed";
          nextGameState.winner = winningPlayerId;
        } else {
          socket.emit("game:error", { message: "Invalid actionType." });
          return;
        }

        // Update game in database
        const updateQuery = `
          UPDATE "games" 
          SET game_state = $1,
              game_status = $2,
              completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END,
              winner_id = $3
          WHERE game_id = $4 
          RETURNING game_id, game_state, game_status, winner_id;`;

        let completedAt = null;
        let winnerIdDb = null;
        let currencyAwardedTo = null;

        // Handle game over and winner rewards
        if (nextGameState.status === "completed") {
          completedAt = "NOW()";
          winnerIdDb = nextGameState.winner;

          // Award currency to winner
          if (winnerIdDb) {
            const currencyAward = 10; // Configure amount as needed
            await UserModel.updateCurrency(winnerIdDb, currencyAward);
            currencyAwardedTo = winnerIdDb;
            console.log(
              `Awarded ${currencyAward} currency to user ${winnerIdDb} for winning PvP game ${gameId}`
            );
          }
        }

        const updateValues = [
          JSON.stringify(nextGameState),
          nextGameState.status === "active" ? "active" : nextGameState.status,
          winnerIdDb,
          gameId,
        ];

        const updatedGameResult = await db.query(updateQuery, updateValues);
        const updatedGameData = updatedGameResult.rows[0];

        // Update in-memory state
        if (activeGames.has(gameId)) {
          const gameData = activeGames.get(gameId);
          gameData.gameState = updatedGameData.game_state;
        }

        // Broadcast updated state to all players in the room
        io.to(gameId).emit("game:state_update", {
          gameState: updatedGameData.game_state,
          gameStatus: updatedGameData.game_status,
          currentPlayerId: nextGameState.current_player_id,
        });

        // If game is over, send game over event
        if (updatedGameData.game_status !== "active") {
          io.to(gameId).emit("game:over", {
            gameStatus: updatedGameData.game_status,
            winnerId: updatedGameData.winner_id,
            finalGameState: updatedGameData.game_state,
            currencyAwardedTo: currencyAwardedTo,
            currencyAmount: currencyAwardedTo ? 10 : 0, // Match the award amount above
          });

          // After game over, we could clean up the game room, but we'll keep it for chat
        }
      } catch (error) {
        console.error(`Error processing game action for ${gameId}:`, error);
        socket.emit("game:error", {
          message: "Server error while processing game action.",
        });
      }
    });

    // Event: Send chat message in a game room
    socket.on("chat:send", (data) => {
      const { gameId, message } = data;
      if (!gameId || !message) {
        socket.emit("game:error", {
          message: "gameId and message are required for chat.",
        });
        return;
      }

      // Validate the user is in this game room
      const room = io.sockets.adapter.rooms.get(gameId);
      if (!room || !room.has(socket.id)) {
        socket.emit("game:error", {
          message: "You must join the game room before sending messages.",
        });
        return;
      }

      // Broadcast the chat message to all players in the room
      io.to(gameId).emit("chat:message", {
        gameId,
        userId,
        username,
        message,
        timestamp: new Date().toISOString(),
      });
    });

    // Event: Leave a game room
    socket.on("game:leave", (data) => {
      const { gameId } = data;
      if (!gameId) {
        socket.emit("game:error", {
          message: "gameId is required to leave a game.",
        });
        return;
      }

      socket.leave(gameId);
      console.log(`User ${username} (${userId}) left game room: ${gameId}`);

      // Update active games tracking
      if (activeGames.has(gameId)) {
        const gameData = activeGames.get(gameId);
        if (gameData.player1SocketId === socket.id) {
          gameData.player1SocketId = undefined;
        } else if (gameData.player2SocketId === socket.id) {
          gameData.player2SocketId = undefined;
        }

        // If no players are in the room, consider cleaning up
        if (!gameData.player1SocketId && !gameData.player2SocketId) {
          // Maybe wait a bit before actually deleting in case of reconnects
          setTimeout(() => {
            if (activeGames.has(gameId)) {
              const currentData = activeGames.get(gameId);
              if (
                !currentData.player1SocketId &&
                !currentData.player2SocketId
              ) {
                activeGames.delete(gameId);
                console.log(`Cleaned up inactive game: ${gameId}`);
              }
            }
          }, 60000); // 1 minute grace period
        }
      }

      // Notify others in the room
      io.to(gameId).emit("game:player_disconnected", {
        userId,
        username,
        playerCount: io.sockets.adapter.rooms.get(gameId)?.size || 0,
      });
    });

    socket.on("disconnect", () => {
      console.log(
        `User disconnected: ${username} (ID: ${userId}, Socket ID: ${socket.id})`
      );

      // Remove from user socket mapping
      userSocketMap.delete(userId);

      // Find any games this user was part of and update their status
      for (const [gameId, gameData] of activeGames.entries()) {
        if (
          gameData.player1SocketId === socket.id ||
          gameData.player2SocketId === socket.id
        ) {
          // Mark this player as disconnected
          if (gameData.player1SocketId === socket.id) {
            gameData.player1SocketId = undefined;
          } else if (gameData.player2SocketId === socket.id) {
            gameData.player2SocketId = undefined;
          }

          // Notify others in the room
          io.to(gameId).emit("game:player_disconnected", {
            userId,
            username,
            playerCount: io.sockets.adapter.rooms.get(gameId)?.size || 0,
          });

          // If no players are in the room, consider cleaning up
          if (!gameData.player1SocketId && !gameData.player2SocketId) {
            // Maybe wait a bit before actually deleting in case of reconnects
            setTimeout(() => {
              if (activeGames.has(gameId)) {
                const currentData = activeGames.get(gameId);
                if (
                  !currentData.player1SocketId &&
                  !currentData.player2SocketId
                ) {
                  activeGames.delete(gameId);
                  console.log(`Cleaned up inactive game: ${gameId}`);
                }
              }
            }, 60000); // 1 minute grace period
          }
        }
      }
    });
  });

  console.log("Socket manager initialized with game room management");
}

module.exports = initializeSocketManager;
