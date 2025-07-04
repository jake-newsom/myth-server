# Viking Vengeance: Phase 4 Testing Guide

This document provides manual testing procedures to validate the implementation of Phase 4: Server-Side Game Logic & Solo Mode API with 4x4 board.

## Prerequisites

- Server running locally or deployed environment
- Access to API testing tool (Postman, cURL, etc.)
- Valid user credentials and JWT token
- Access to database for validation queries (optional)

## Test Credentials

For testing purposes, you can use:

```
Email: test-user@example.com
Password: testpassword123
```

## 1. Database Setup Verification

### 1.1 Verify Games Table Structure

Run the following SQL query:

```sql
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'Games' AND column_name = 'board_layout';
```

**Expected:** Column `board_layout` should exist with default value `'4x4'`.

### 1.2 Verify UserCardInstance Table

```sql
SELECT count(*) FROM information_schema.tables WHERE table_name = 'UserCardInstances';
```

**Expected:** Count should be 1, confirming table exists.

## 2. API Endpoint Testing

### 2.1 Obtain JWT Token

**Request:**

```
POST /api/auth/login
{
  "email": "test-user@example.com",
  "password": "testpassword123"
}
```

**Expected Response:**

```json
{
  "token": "your_jwt_token",
  "user": {
    "id": "user_id",
    "username": "username"
  }
}
```

Save the token for subsequent requests.

### 2.2 Get User's Deck IDs

**Request:**

```
GET /api/decks
Authorization: Bearer your_jwt_token
```

**Expected Response:**

```json
{
  "decks": [
    {
      "deck_id": "deck_id_1",
      "name": "Test Deck 1",
      ...
    }
  ]
}
```

Save a `deck_id` to use for creating a solo game.

## 3. Solo Game Creation Testing

### 3.1 Create Solo Game

**Request:**

```
POST /api/games/solo
Authorization: Bearer your_jwt_token
{
  "deckId": "deck_id_1"
}
```

**Expected Response:**

```json
{
  "game_id": "game_id",
  "game_state": { ... },
  "game_status": "active"
}
```

**Verification Points:**

- Status code should be 201
- Response should include game_id
- game_status should be "active"

Save the `game_id` for subsequent requests.

### 3.2 Get Game State

**Request:**

```
GET /api/games/{game_id}
Authorization: Bearer your_jwt_token
```

**Expected Response:**

```json
{
  "game_id": "game_id",
  "player1_id": "user_id",
  "player2_id": "AI_PLAYER_ID_STATIC_STRING",
  "game_mode": "solo",
  "game_status": "active",
  "board_layout": "4x4",
  "game_state": {
    "board": [...],
    "player1": {...},
    "player2": {...},
    ...
  }
}
```

**Verification Points:**

- Status code should be 200
- `board_layout` should be "4x4"
- `game_state.board` should be a 4x4 array (4 rows, each with 4 elements)
- `game_state.player1.hand` should contain card instance IDs
- `game_state.player1.deck` should contain card instance IDs
- `game_state.player2.hand` should contain AI card instance IDs
- `game_state.player2.deck` should contain AI card instance IDs
- `game_state.initialCardsToDraw` should be 5
- `game_state.maxCardsInHand` should be 5

## 4. Gameplay Testing

### 4.1 Place Card

Select a card from the player's hand to place on the board.

**Request:**

```
POST /api/games/{game_id}/actions
Authorization: Bearer your_jwt_token
{
  "actionType": "placeCard",
  "user_card_instance_id": "card_instance_id",
  "position": {
    "x": 1,
    "y": 1
  }
}
```

**Expected Response:**

```json
{
  "game_id": "game_id",
  "game_state": { ... },
  "game_status": "active"
}
```

**Verification Points:**

- Status code should be 200
- Card should be placed at position [1,1] in board array
- Card at position should have:
  - `user_card_instance_id` matching the played card
  - `owner` matching player1's user_id
  - `currentPower` with top, right, bottom, left values
  - `level` property
- Player's hand should not contain the played card anymore
- Board should show an AI move (one cell owned by AI)
- Game should still be active

### 4.2 Combat Mechanics

Place a card adjacent to an opponent's card where your card's power is higher.

**Request:**

```
POST /api/games/{game_id}/actions
Authorization: Bearer your_jwt_token
{
  "actionType": "placeCard",
  "user_card_instance_id": "card_instance_id",
  "position": {
    "x": 2,
    "y": 1
  }
}
```

**Expected Response:** Game state with updated board.

**Verification Points:**

- Adjacent opponent cards with lower power values should be flipped (owner changed)
- Score values should be updated to reflect card ownership
- Game should still be active

### 4.3 Game Completion

Continue placing cards until the board is full (all 16 positions filled).

**Verification Points:**

- Game should end when board is full
- `game_status` should change to "completed"
- `winner_id` should be set based on which player has more cards
- Player with more cards on board should be declared winner
- In solo mode win, player should receive 10 in_game_currency (verify in Users table)

## 5. Edge Cases and Error Handling

### 5.1 Invalid Placement

Try to place a card on an already occupied position.

**Request:**

```
POST /api/games/{game_id}/actions
Authorization: Bearer your_jwt_token
{
  "actionType": "placeCard",
  "user_card_instance_id": "card_instance_id",
  "position": {
    "x": 1,
    "y": 1
  }
}
```

**Expected Response:**

```json
{
  "error": "Invalid board position or position already occupied."
}
```

### 5.2 Not Your Turn

If it's AI's turn, try to make a move.

**Expected Response:**

```json
{
  "error": "Not your turn"
}
```

### 5.3 Card Not In Hand

Try to place a card that's not in your hand.

**Request:**

```
POST /api/games/{game_id}/actions
Authorization: Bearer your_jwt_token
{
  "actionType": "placeCard",
  "user_card_instance_id": "invalid_card_id",
  "position": {
    "x": 0,
    "y": 0
  }
}
```

**Expected Response:**

```json
{
  "error": "Card instance not in hand."
}
```

### 5.4 Surrender

Test the surrender functionality. Surrender should work regardless of whose turn it is.

**Request:**

```
POST /api/games/{game_id}/actions
Authorization: Bearer your_jwt_token
{
  "actionType": "surrender"
}
```

**Expected Response:** Game state with status set to "completed" and winner set to the opponent.

**Verification Points:**

- Game status should be "completed"
- Winner should be the opponent of the surrendering player
- Surrender should work even when it's not the player's turn

### 5.5 Surrender When Not Your Turn

Test that surrender works even when it's not the player's turn.

**Setup:** Create a game and wait for it to be the AI's turn (or opponent's turn in PvP).

**Request:**

```
POST /api/games/{game_id}/actions
Authorization: Bearer your_jwt_token
{
  "actionType": "surrender"
}
```

**Expected Response:** Game state with status set to "completed" and winner set to the opponent.

**Verification Points:**

- Should not return "Not your turn" error
- Game status should be "completed"
- Winner should be the opponent of the surrendering player

## 6. Performance Testing

### 6.1 Multiple Games

Create multiple games in parallel and verify that the system handles them properly.

### 6.2 Fast Moves

Make moves rapidly to test system stability.

## Test Results Tracking

| Test ID | Test Name                    | Status | Notes |
| ------- | ---------------------------- | ------ | ----- |
| 1.1     | Games Table Structure        |        |       |
| 1.2     | UserCardInstance Table       |        |       |
| 2.1     | Obtain JWT Token             |        |       |
| 2.2     | Get User's Deck IDs          |        |       |
| 3.1     | Create Solo Game             |        |       |
| 3.2     | Get Game State               |        |       |
| 4.1     | Place Card                   |        |       |
| 4.2     | Combat Mechanics             |        |       |
| 4.3     | Game Completion              |        |       |
| 5.1     | Invalid Placement            |        |       |
| 5.2     | Not Your Turn                |        |       |
| 5.3     | Card Not In Hand             |        |       |
| 5.4     | Surrender                    |        |       |
| 5.5     | Surrender When Not Your Turn |        |       |
| 6.1     | Multiple Games               |        |       |
| 6.2     | Fast Moves                   |        |       |

## Automated Testing

For automated testing, use the provided script in `scripts/test-phase4.js`. The script requires:

1. Node.js installed
2. Dependencies: `node-fetch` and `readline`
3. Configuration updates in the script:
   - API_URL
   - TOKEN (valid JWT token)
   - DECK_ID (valid deck ID)

Run the script using:

```
node scripts/test-phase4.js
```

The script will test:

1. Game creation
2. Game state initialization
3. Card placement and combat
4. Game completion and winner determination
