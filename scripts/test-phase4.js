/**
 * Viking Vengeance: Phase 4 Testing Script
 *
 * This script tests the implementation of the server-side game logic
 * and Solo Mode API with a 4x4 board as specified in Phase 4.
 *
 * Prerequisites:
 * - Node.js installed
 * - Server running on localhost:3000
 * - A valid JWT token for authentication
 *
 * How to use:
 * 1. Update the configuration in the CONFIG section
 * 2. Run the script: node test-phase4.js
 */

const fetch = require("node-fetch");
const readline = require("readline");

//--------------------------------------------------------------------
// CONFIGURATION
//--------------------------------------------------------------------
const CONFIG = {
  API_URL: "http://localhost:3000/api",
  TOKEN: "your_jwt_token_here", // Replace with a valid token
  DECK_ID: "your_deck_id_here", // Replace with a valid deck ID
};

//--------------------------------------------------------------------
// UTILITY FUNCTIONS
//--------------------------------------------------------------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function prompt(message) {
  return new Promise((resolve) => {
    rl.question(`${message} (Press Enter to continue)`, () => resolve());
  });
}

async function apiRequest(endpoint, method = "GET", body = null) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${CONFIG.TOKEN}`,
  };

  const options = {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };

  try {
    const response = await fetch(`${CONFIG.API_URL}${endpoint}`, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    console.error(`API Request Error: ${error.message}`);
    return { status: 500, error: error.message };
  }
}

function logSection(title) {
  console.log("\n" + "=".repeat(80));
  console.log(`${title}`);
  console.log("=".repeat(80));
}

function logResult(test, passed, details = "") {
  const status = passed ? "✅ PASSED" : "❌ FAILED";
  console.log(`${status}: ${test}`);
  if (details) {
    console.log(`  Details: ${details}`);
  }
}

function validateBoard(board) {
  // Check board size (4x4)
  if (!Array.isArray(board) || board.length !== 4) {
    return {
      valid: false,
      reason: `Board should be an array of length 4, got ${board?.length}`,
    };
  }

  for (let i = 0; i < 4; i++) {
    if (!Array.isArray(board[i]) || board[i].length !== 4) {
      return {
        valid: false,
        reason: `Row ${i} should be an array of length 4, got ${board[i]?.length}`,
      };
    }
  }

  return { valid: true };
}

//--------------------------------------------------------------------
// TEST RUNNERS
//--------------------------------------------------------------------

async function runTests() {
  let gameId;
  let gameState;

  // Start test sequence
  logSection(
    "PHASE 4 TESTING: Server-Side Game Logic & Solo Mode API (4x4 Board)"
  );

  //--------------------------------------------------------------------
  // TEST 1: Create Solo Game
  //--------------------------------------------------------------------
  logSection("TEST 1: Create Solo Game");

  console.log("Creating a new solo game...");
  const createGameResponse = await apiRequest("/games/solo", "POST", {
    deckId: CONFIG.DECK_ID,
  });

  if (createGameResponse.status !== 201) {
    logResult(
      "Create Solo Game",
      false,
      `API returned status ${createGameResponse.status}: ${JSON.stringify(
        createGameResponse.data
      )}`
    );
    return;
  }

  gameId = createGameResponse.data.game_id;
  console.log(`Game created with ID: ${gameId}`);

  // Check if game has correct initial state
  logResult("Create Solo Game", true, `Game created with ID: ${gameId}`);

  //--------------------------------------------------------------------
  // TEST 2: Verify Game State Initialization
  //--------------------------------------------------------------------
  logSection("TEST 2: Verify Game State Initialization");

  console.log("Fetching game state...");
  const getGameResponse = await apiRequest(`/games/${gameId}`, "GET");

  if (getGameResponse.status !== 200) {
    logResult(
      "Get Game State",
      false,
      `API returned status ${getGameResponse.status}: ${JSON.stringify(
        getGameResponse.data
      )}`
    );
    return;
  }

  gameState = JSON.parse(getGameResponse.data.game_state);

  // Test 2.1: Verify 4x4 Board
  const boardValidation = validateBoard(gameState.board);
  logResult(
    "4x4 Board Structure",
    boardValidation.valid,
    boardValidation.reason || "Board has correct 4x4 structure"
  );

  // Test 2.2: Verify Player Hands and Decks
  const player1HasHand =
    Array.isArray(gameState.player1.hand) && gameState.player1.hand.length > 0;
  const player1HasDeck =
    Array.isArray(gameState.player1.deck) && gameState.player1.deck.length > 0;
  const player2HasHand =
    Array.isArray(gameState.player2.hand) && gameState.player2.hand.length > 0;
  const player2HasDeck =
    Array.isArray(gameState.player2.deck) && gameState.player2.deck.length > 0;

  logResult(
    "Player 1 Hand",
    player1HasHand,
    `Hand contains ${gameState.player1.hand.length} cards`
  );
  logResult(
    "Player 1 Deck",
    player1HasDeck,
    `Deck contains ${gameState.player1.deck.length} cards`
  );
  logResult(
    "Player 2/AI Hand",
    player2HasHand,
    `Hand contains ${gameState.player2.hand.length} cards`
  );
  logResult(
    "Player 2/AI Deck",
    player2HasDeck,
    `Deck contains ${gameState.player2.deck.length} cards`
  );

  // Test 2.3: Verify Game Status and Turn
  logResult(
    "Game Status Active",
    gameState.status === "active",
    `Status is ${gameState.status}`
  );
  logResult(
    "Board Layout",
    getGameResponse.data.board_layout === "4x4",
    `Database board_layout field is ${getGameResponse.data.board_layout}`
  );

  // Cache a card from the hand for later use
  const cardToPlay = gameState.player1.hand[0];
  console.log(
    `Selected card ${cardToPlay} from player's hand to play in next test`
  );

  await prompt("Game state initialized correctly");

  //--------------------------------------------------------------------
  // TEST 3: Place a Card
  //--------------------------------------------------------------------
  logSection("TEST 3: Place a Card");

  // Place the card in the center of the board
  const placeCardAction = {
    actionType: "placeCard",
    user_card_instance_id: cardToPlay,
    position: { x: 1, y: 1 },
  };

  console.log(`Placing card ${cardToPlay} at position (1,1)...`);
  const placeCardResponse = await apiRequest(
    `/games/${gameId}/actions`,
    "POST",
    placeCardAction
  );

  if (placeCardResponse.status !== 200) {
    logResult(
      "Place Card",
      false,
      `API returned status ${placeCardResponse.status}: ${JSON.stringify(
        placeCardResponse.data
      )}`
    );
    return;
  }

  // Update game state
  const updatedGameState = JSON.parse(placeCardResponse.data.game_state);

  // Test 3.1: Verify card was placed
  const cardPlaced = updatedGameState.board[1][1] !== null;
  logResult(
    "Card Placement",
    cardPlaced,
    "Card was successfully placed on the board"
  );

  if (cardPlaced) {
    // Test 3.2: Verify card ownership and data
    const placedCard = updatedGameState.board[1][1];
    logResult(
      "Card Owner",
      placedCard.owner === gameState.player1.userId,
      `Owner is ${placedCard.owner}, expected ${gameState.player1.userId}`
    );

    logResult(
      "Card Instance ID",
      placedCard.user_card_instance_id === cardToPlay,
      `Card ID is ${placedCard.user_card_instance_id}, expected ${cardToPlay}`
    );

    // Test 3.3: Verify card has correct power values
    logResult(
      "Card Has Power Values",
      placedCard.currentPower &&
        typeof placedCard.currentPower.top === "number" &&
        typeof placedCard.currentPower.right === "number" &&
        typeof placedCard.currentPower.bottom === "number" &&
        typeof placedCard.currentPower.left === "number",
      `Power values: ${JSON.stringify(placedCard.currentPower)}`
    );

    // Test 3.4: Verify level is included and affects power
    logResult(
      "Card Has Level",
      typeof placedCard.level === "number",
      `Level: ${placedCard.level}`
    );
  }

  // Test 3.5: Verify AI made a move after player's move
  let aiMoved = false;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const cell = updatedGameState.board[y][x];
      if (cell && cell.owner === gameState.player2.userId) {
        aiMoved = true;
        console.log(`AI placed a card at position (${x},${y})`);
        break;
      }
    }
    if (aiMoved) break;
  }

  logResult(
    "AI Made Move",
    aiMoved,
    aiMoved ? "AI placed a card on the board" : "AI did not place a card"
  );

  await prompt("Card placement test completed");

  //--------------------------------------------------------------------
  // TEST 4: Full Game Simulation
  //--------------------------------------------------------------------
  logSection("TEST 4: Game Completion");

  console.log("Simulating game completion by placing all cards...");
  console.log("This test will make multiple API calls to finish the game.");

  // Continue playing cards until the game is complete
  let currentState = updatedGameState;
  let moveCounter = 0;
  const MAX_MOVES = 16; // Maximum possible moves on a 4x4 board

  while (currentState.status === "active" && moveCounter < MAX_MOVES) {
    // Check if it's player's turn and they have cards in hand
    if (
      currentState.currentPlayerId === gameState.player1.userId &&
      currentState.player1.hand.length > 0
    ) {
      // Find an empty position to place a card
      let emptyPosition = null;
      for (let y = 0; y < 4 && !emptyPosition; y++) {
        for (let x = 0; x < 4 && !emptyPosition; x++) {
          if (currentState.board[y][x] === null) {
            emptyPosition = { x, y };
          }
        }
      }

      if (!emptyPosition) {
        break; // No empty positions, game should end
      }

      // Place a card
      const nextCardToPlay = currentState.player1.hand[0];
      const nextMoveAction = {
        actionType: "placeCard",
        user_card_instance_id: nextCardToPlay,
        position: emptyPosition,
      };

      console.log(
        `Move ${moveCounter + 1}: Placing card ${nextCardToPlay} at position (${
          emptyPosition.x
        },${emptyPosition.y})...`
      );
      const moveResponse = await apiRequest(
        `/games/${gameId}/actions`,
        "POST",
        nextMoveAction
      );

      if (moveResponse.status !== 200) {
        console.log(`Move failed: ${JSON.stringify(moveResponse.data)}`);
        break;
      }

      currentState = JSON.parse(moveResponse.data.game_state);
      moveCounter++;
    } else {
      // If it's AI's turn, we need to wait, as AI should have already made its move
      // If there's no valid move, end turn
      const endTurnAction = {
        actionType: "endTurn",
      };

      console.log(
        `Move ${moveCounter + 1}: Ending turn for ${
          currentState.currentPlayerId
        }...`
      );
      const endTurnResponse = await apiRequest(
        `/games/${gameId}/actions`,
        "POST",
        endTurnAction
      );

      if (endTurnResponse.status !== 200) {
        console.log(`End turn failed: ${JSON.stringify(endTurnResponse.data)}`);
        break;
      }

      currentState = JSON.parse(endTurnResponse.data.game_state);
      moveCounter++;
    }

    // Add a small delay to prevent overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Check final game state
  console.log(`Game simulation completed after ${moveCounter} moves.`);
  console.log(`Final game status: ${currentState.status}`);
  console.log(`Player 1 score: ${currentState.player1.score}`);
  console.log(`Player 2 score: ${currentState.player2.score}`);

  // Calculate board fullness
  let filledCells = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (currentState.board[y][x] !== null) {
        filledCells++;
      }
    }
  }

  const boardFullness = `${filledCells}/16 cells filled`;
  const gameCompleted = currentState.status !== "active";

  logResult(
    "Game Completion",
    gameCompleted,
    gameCompleted
      ? `Game ended with status: ${currentState.status}`
      : "Game did not complete"
  );
  logResult(
    "Board Fullness",
    boardFullness,
    `${filledCells} of 16 cells filled (${Math.round(
      (filledCells / 16) * 100
    )}%)`
  );

  if (gameCompleted) {
    // Verify winner determination is correct
    const player1Score = currentState.player1.score;
    const player2Score = currentState.player2.score;

    let expectedWinner = null;
    if (player1Score > player2Score) {
      expectedWinner = "player1_win";
    } else if (player2Score > player1Score) {
      expectedWinner = "player2_win";
    } else {
      expectedWinner = "draw";
    }

    logResult(
      "Winner Determination",
      currentState.status === expectedWinner,
      `Status is ${currentState.status}, expected ${expectedWinner} (P1: ${player1Score}, P2: ${player2Score})`
    );
  }

  // Cleanup
  rl.close();
  console.log("\nPhase 4 testing completed!");
}

// Run all tests
runTests().catch((error) => {
  console.error("Test error:", error);
  rl.close();
});
