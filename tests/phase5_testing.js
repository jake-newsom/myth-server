/**
 * Viking Vengeance: Phase 5 Testing Points
 *
 * This script provides manual testing procedures for the WebSocket implementation
 * and matchmaking system. Run each test sequentially and validate the results.
 *
 * Prerequisites:
 * - Node.js installed
 * - npm packages: socket.io-client, axios
 * - Server running on localhost:3000
 * - At least two test user accounts with valid JWT tokens
 * - Each user should have at least one valid deck with 20+ cards
 */

const { io } = require("socket.io-client");
const axios = require("axios");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Configuration
const SERVER_URL = "http://localhost:3000";
const API_URL = `${SERVER_URL}/api`;

// Test users - Replace these with actual test tokens and data
const TEST_USERS = [
  {
    name: "Player1",
    token: "your_jwt_token_for_player1",
    deckId: "player1_deck_id",
  },
  {
    name: "Player2",
    token: "your_jwt_token_for_player2",
    deckId: "player2_deck_id",
  },
];

// Test helpers
function createAuthHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function createSocketClient(token) {
  return io(SERVER_URL, {
    auth: { token },
    transports: ["websocket"],
  });
}

async function promptToContinue() {
  return new Promise((resolve) => {
    rl.question("\nPress Enter to continue...", () => {
      console.log("\n---------------------------------------------------\n");
      resolve();
    });
  });
}

// ----- TEST CASES -----

async function runTests() {
  console.log("=== VIKING VENGEANCE: PHASE 5 TESTING ===\n");

  // 1. Socket Server Test
  console.log("TEST 1: Socket Server Initialization");
  console.log(
    "Description: Verify the server starts and Socket.IO initializes without errors"
  );
  console.log(
    'Expected: Server log should show "Socket.IO initialized and listening"'
  );
  console.log("Action: Check server logs");
  await promptToContinue();

  // 2. WebSocket Authentication Tests
  console.log("TEST 2: WebSocket Authentication");

  console.log("2.1: Connection without a token");
  console.log("Description: Try connecting to Socket.IO without a token");
  console.log("Expected: Connection should be rejected");

  try {
    const unauthSocket = io(SERVER_URL, {
      transports: ["websocket"],
    });

    unauthSocket.on("connect_error", (error) => {
      console.log("✅ Passed: Connection rejected with error:", error.message);
      unauthSocket.close();
    });

    // Give time for connection attempt
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    console.log("Error during test:", error.message);
  }

  console.log("\n2.2: Connection with a valid token");
  console.log("Description: Connect to Socket.IO with a valid JWT token");
  console.log("Expected: Connection should be accepted");

  try {
    const authSocket = createSocketClient(TEST_USERS[0].token);

    authSocket.on("connect", () => {
      console.log("✅ Passed: Successfully connected with a valid token");
      authSocket.close();
    });

    authSocket.on("connect_error", (error) => {
      console.log("❌ Failed: Connection with token rejected:", error.message);
    });

    // Give time for connection attempt
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    console.log("Error during test:", error.message);
  }

  await promptToContinue();

  // 3. Matchmaking API Tests
  console.log("TEST 3: Matchmaking API");

  // 3.1: Join Matchmaking
  console.log("3.1: POST /api/matchmaking/join");
  console.log("Description: Player 1 joins the matchmaking queue");
  console.log('Expected: Status "queued" returned');

  let gameId;

  try {
    const joinResponse = await axios.post(
      `${API_URL}/matchmaking/join`,
      { deckId: TEST_USERS[0].deckId },
      { headers: createAuthHeader(TEST_USERS[0].token) }
    );

    console.log("Response:", joinResponse.data);
    console.log("Status Code:", joinResponse.status);

    if (joinResponse.status === 202 && joinResponse.data.status === "queued") {
      console.log("✅ Passed: Successfully joined queue");
    } else if (
      joinResponse.status === 200 &&
      joinResponse.data.status === "matched"
    ) {
      console.log("✅ Passed: Immediately matched with another player");
      gameId = joinResponse.data.gameId;
    } else {
      console.log("❓ Unexpected response");
    }
  } catch (error) {
    console.log("❌ Failed:", error.response?.data || error.message);
  }

  // 3.2: Check Matchmaking Status
  console.log("\n3.2: GET /api/matchmaking/status");
  console.log("Description: Check Player 1 matchmaking status");
  console.log('Expected: Status should show "queued" or "matched"');

  try {
    const statusResponse = await axios.get(`${API_URL}/matchmaking/status`, {
      headers: createAuthHeader(TEST_USERS[0].token),
    });

    console.log("Response:", statusResponse.data);

    if (["queued", "matched"].includes(statusResponse.data.status)) {
      console.log("✅ Passed: Status correctly returned");
      if (statusResponse.data.status === "matched") {
        gameId = statusResponse.data.gameId;
      }
    } else {
      console.log("❌ Failed: Unexpected status");
    }
  } catch (error) {
    console.log("❌ Failed:", error.response?.data || error.message);
  }

  // 3.3: Player 2 joins matchmaking
  console.log("\n3.3: Player 2 joins matchmaking");
  console.log("Description: Second player joins the queue");
  console.log("Expected: Both players should get matched");

  try {
    const p2JoinResponse = await axios.post(
      `${API_URL}/matchmaking/join`,
      { deckId: TEST_USERS[1].deckId },
      { headers: createAuthHeader(TEST_USERS[1].token) }
    );

    console.log("Response:", p2JoinResponse.data);

    if (
      p2JoinResponse.status === 200 &&
      p2JoinResponse.data.status === "matched"
    ) {
      console.log("✅ Passed: Player 2 matched with Player 1");
      if (!gameId) {
        gameId = p2JoinResponse.data.gameId;
      }
    } else {
      console.log("❓ Unexpected response");
    }

    // Check Player 1 status to see if they got matched
    if (!gameId) {
      const p1StatusResponse = await axios.get(
        `${API_URL}/matchmaking/status`,
        { headers: createAuthHeader(TEST_USERS[0].token) }
      );

      console.log("Player 1 Status Response:", p1StatusResponse.data);

      if (p1StatusResponse.data.status === "matched") {
        gameId = p1StatusResponse.data.gameId;
        console.log("✅ Passed: Player 1 is now matched");
      }
    }
  } catch (error) {
    console.log("❌ Failed:", error.response?.data || error.message);
  }

  // 3.4: Leave Matchmaking
  console.log("\n3.4: POST /api/matchmaking/leave");
  console.log(
    "Description: Try to leave matchmaking after already being matched"
  );
  console.log("Expected: Should return an error since already matched");

  try {
    const leaveResponse = await axios.post(
      `${API_URL}/matchmaking/leave`,
      {},
      { headers: createAuthHeader(TEST_USERS[0].token) }
    );

    console.log("Response:", leaveResponse.data);
    console.log(
      "❓ Unexpected success - Should have failed since already matched"
    );
  } catch (error) {
    if (error.response?.status === 400) {
      console.log("✅ Passed: Cannot leave queue after being matched");
      console.log("Error Message:", error.response.data.error.message);
    } else {
      console.log("❌ Failed with unexpected error:", error.message);
    }
  }

  await promptToContinue();

  // 4. Game Room Joining Tests
  console.log("TEST 4: Game Room Joining");
  console.log("Description: Players join their matched game room");

  if (!gameId) {
    console.log("❌ Cannot continue testing - No gameId available");
    return;
  }

  console.log(`Game ID for testing: ${gameId}`);

  // Create socket connections for both players
  const player1Socket = createSocketClient(TEST_USERS[0].token);
  const player2Socket = createSocketClient(TEST_USERS[1].token);

  // Set up event listeners for Player 1
  player1Socket.on("connect", () => {
    console.log("Player 1 socket connected");
  });

  player1Socket.on("game:joined", (data) => {
    console.log("✅ Player 1 joined game room:", data);
  });

  player1Socket.on("game:start", (data) => {
    console.log("✅ Game started event received by Player 1:", data);
  });

  player1Socket.on("game:error", (error) => {
    console.log("❌ Player 1 received error:", error);
  });

  player1Socket.on("game:player_connected", (data) => {
    console.log("✅ Player 1 received player connected event:", data);
  });

  // Set up event listeners for Player 2
  player2Socket.on("connect", () => {
    console.log("Player 2 socket connected");
  });

  player2Socket.on("game:joined", (data) => {
    console.log("✅ Player 2 joined game room:", data);
  });

  player2Socket.on("game:start", (data) => {
    console.log("✅ Game started event received by Player 2:", data);
  });

  player2Socket.on("game:error", (error) => {
    console.log("❌ Player 2 received error:", error);
  });

  // Join game rooms
  console.log("4.1: Player 1 joins game room");
  player1Socket.emit("game:join", { gameId });

  // Wait a bit before Player 2 joins
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n4.2: Player 2 joins game room");
  player2Socket.emit("game:join", { gameId });

  // Wait for events to process
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log("\n4.3: Try to join a game room as a non-participant");
  console.log(
    "Description: Try to join a game room where the user is not a participant"
  );
  console.log("Expected: Should receive a game:error event");

  // Create a third socket for a user not in the game
  if (TEST_USERS.length > 2) {
    const nonParticipantSocket = createSocketClient(TEST_USERS[2].token);

    nonParticipantSocket.on("connect", () => {
      console.log("Non-participant socket connected");
      nonParticipantSocket.emit("game:join", { gameId });
    });

    nonParticipantSocket.on("game:error", (error) => {
      console.log("✅ Non-participant correctly rejected:", error);
      nonParticipantSocket.close();
    });

    nonParticipantSocket.on("game:joined", (data) => {
      console.log("❌ Non-participant erroneously joined the game:", data);
      nonParticipantSocket.close();
    });

    // Wait for events to process
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } else {
    console.log("Skipping non-participant test - need a third test user");
  }

  await promptToContinue();

  // 5. Real-Time Game Actions Tests
  console.log("TEST 5: Real-Time Game Actions");
  console.log("Description: Test game actions between the two players");

  // Determine who goes first based on the game state
  let gameState;
  let player1Turn = false;
  let player2Turn = false;

  // Set up game state update handlers
  player1Socket.on("game:state_update", (data) => {
    console.log("Player 1 received state update");
    gameState = data.gameState;
    player1Turn = gameState.currentPlayerId === TEST_USERS[0].token;
    player2Turn = !player1Turn;
    console.log(`Current Player: ${player1Turn ? "Player 1" : "Player 2"}`);
  });

  player2Socket.on("game:state_update", (data) => {
    console.log("Player 2 received state update");
  });

  // Wait a moment to ensure game state is available
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n5.1: Try to make a move when it is not your turn");
  console.log(
    "Description: Player attempts to place a card when it is not their turn"
  );
  console.log("Expected: Should receive a game:error event");

  // Determine which player should NOT go first based on game state
  const wrongPlayerSocket = player1Turn ? player2Socket : player1Socket;
  const wrongPlayerIdx = player1Turn ? 1 : 0;

  wrongPlayerSocket.on("game:error", (error) => {
    console.log(
      `✅ Player ${
        wrongPlayerIdx + 1
      } correctly received error when trying to play out of turn:`,
      error
    );
  });

  // Try invalid move with wrong player
  wrongPlayerSocket.emit("game:action", {
    gameId,
    actionType: "placeCard",
    user_card_instance_id: "some_card_id",
    position: { x: 0, y: 0 },
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n5.2: Make a valid move with the correct player");
  console.log("Description: Player whose turn it is makes a valid move");
  console.log(
    "Expected: Move should succeed and state should update for both players"
  );

  // This part would require actual card IDs from the game state
  // For a real test, you would need to:
  // 1. Extract a valid card ID from the current player's hand
  // 2. Find a valid empty position on the board
  // 3. Make the move

  console.log(
    "Note: To complete this test, manually extract valid card ID and position from the game state"
  );
  console.log(
    "Simulating with placeholder values - this will likely fail but demonstrates the testing approach"
  );

  const correctPlayerSocket = player1Turn ? player1Socket : player2Socket;
  const correctPlayerIdx = player1Turn ? 0 : 1;

  correctPlayerSocket.emit("game:action", {
    gameId,
    actionType: "placeCard",
    user_card_instance_id: "actual_card_id_needed",
    position: { x: 0, y: 0 },
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n5.3: Test surrender functionality");
  console.log("Description: One player surrenders the game");
  console.log("Expected: Game should end with the other player as winner");

  // Set up game over handler
  player1Socket.on("game:over", (data) => {
    console.log("✅ Player 1 received game over event:", data);
  });

  player2Socket.on("game:over", (data) => {
    console.log("✅ Player 2 received game over event:", data);
  });

  // Player 1 surrenders
  player1Socket.emit("game:action", {
    gameId,
    actionType: "surrender",
  });

  // Wait for game over events
  await new Promise((resolve) => setTimeout(resolve, 3000));

  await promptToContinue();

  // 6. Disconnection Handling Test
  console.log("TEST 6: Disconnection Handling");
  console.log("Description: Test what happens when a player disconnects");
  console.log(
    "Expected: Other player should receive disconnection notification"
  );

  // Make sure we have a new game for this test
  console.log(
    "Note: For a complete test, start a new game before running this part"
  );

  // Set up disconnection handler for Player 2
  player2Socket.on("game:player_disconnected", (data) => {
    console.log("✅ Player 2 received disconnection event:", data);
  });

  // Disconnect Player 1
  console.log("Disconnecting Player 1...");
  player1Socket.close();

  // Wait for disconnection event
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Clean up remaining connections
  player2Socket.close();

  console.log("\n=== TESTING COMPLETE ===");
  console.log(
    "Note: Some tests may have been simulated or skipped due to needing actual game data"
  );
  console.log("Review the results and manually verify any incomplete tests");

  rl.close();
}

// Run the tests
runTests().catch((error) => {
  console.error("Error running tests:", error);
  rl.close();
});
