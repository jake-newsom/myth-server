# Multiplayer Client Implementation Guide

This document describes how PvP multiplayer works via WebSocket, including matchmaking, game flow, turn timing, and reconnection handling.

## Table of Contents
1. [Connection Setup](#connection-setup)
2. [Matchmaking Flow](#matchmaking-flow)
3. [Game Flow](#game-flow)
4. [Turn Timing](#turn-timing)
5. [Events Reference](#events-reference)
6. [Error Handling](#error-handling)
7. [Reconnection](#reconnection)

---

## Connection Setup

### WebSocket Namespace
All game-related WebSocket communication happens on the `/game` namespace.

```typescript
import { io } from "socket.io-client";

const socket = io("https://your-server.com/game", {
  auth: {
    token: "JWT_ACCESS_TOKEN",
    gameId: "UUID_OF_GAME"
  }
});
```

**Required auth parameters:**
- `token`: Valid JWT access token from login
- `gameId`: The game ID returned from matchmaking

---

## Matchmaking Flow

Matchmaking uses REST endpoints, not WebSocket.

### 1. Join Matchmaking Queue

```http
POST /api/matchmaking/join
Authorization: Bearer <token>
Content-Type: application/json

{
  "deckId": "uuid-of-selected-deck"
}
```

**Responses:**

```typescript
// Matched immediately with opponent
{ status: "matched", gameId: "uuid", opponentUsername: "player2" }

// Added to queue, waiting for opponent
{ status: "queued", message: "Added to queue. Waiting for an opponent." }
```

### 2. Poll for Match Status (if queued)

```http
GET /api/matchmaking/status
Authorization: Bearer <token>
```

**Responses:**

```typescript
// Match found
{ status: "matched", gameId: "uuid", opponentUsername: "player2" }

// Still waiting
{ status: "queued", position: 1, queueLength: 1, waitTime: 5000 }

// Not in queue or match
{ status: "none" }
```

### 3. Leave Queue (optional)

```http
POST /api/matchmaking/leave
Authorization: Bearer <token>
```

### 4. Connect to Game via WebSocket

Once you have a `gameId`, connect to the `/game` namespace with that gameId in the auth.

---

## Game Flow

### Step 1: Connect and Join Game

After WebSocket connection, send:

```typescript
socket.emit("client:join_game", { gameId: "uuid" });
```

### Step 2: Receive Join Confirmation

```typescript
socket.on("server:joined", (data) => {
  // data.gameState - sanitized game state (opponent's hand is hidden)
  // data.playerNumber - 1 or 2
});
```

### Step 3: Wait for Both Players

When the other player joins:

```typescript
socket.on("server:player_joined", (data) => {
  // data.userId
  // data.playerNumber
});
```

### Step 4: Receive Turn Start

When both players are connected (and after each move):

```typescript
socket.on("server:start_turn", (data) => {
  // data.currentPlayerId - whose turn it is
  // data.timeAllowed - seconds allowed for this turn (30, 15, 10, or 5)
});
```

### Step 5: Submit Actions

```typescript
// Place a card
socket.emit("client:action", {
  gameId: "uuid",
  actionType: "placeCard",
  user_card_instance_id: "card-instance-uuid",
  position: { x: 0, y: 0 }
});

// End turn (if you can't or don't want to place a card)
socket.emit("client:action", {
  gameId: "uuid",
  actionType: "endTurn"
});

// Surrender
socket.emit("client:action", {
  gameId: "uuid",
  actionType: "surrender"
});
```

### Step 6: Receive Game Events

After any action:

```typescript
socket.on("server:events", (data) => {
  // data.gameState - updated sanitized game state
  // data.events - array of game events (card placed, flips, abilities, etc.)
  // data.aiMove - true if this was an AI-generated move (timeout fallback)
});
```

### Step 7: Game End

```typescript
socket.on("server:game_end", (data) => {
  // data.result.winnerId - winner's user ID (null if draw)
  // data.result.reason - "completed" | "disconnect" | "surrender"
  // data.result.gameState - final game state (on completed)
  
  // data.rewards - reward information for the receiving player
  // data.rewards.gems - gems earned
  // data.rewards.cardXp - array of { card_id, card_name, xp_gained }
  // data.rewards.winStreakInfo - { multiplier_applied, new_multiplier }
});
```

**Reward Structure:**
- **Winner (any ending)**: 10 gems (+ quick win bonus) × win streak multiplier, card XP
- **Loser (normal completion)**: 5 gems, card XP
- **Loser (forfeit/disconnect)**: 0 gems, no card XP

---

## Turn Timing

### How Turn Timing Works

The server manages all turn timing automatically:

1. **First turn**: When both players connect, `server:start_turn` is sent immediately and the timer starts
2. **Subsequent turns**: After a move is processed:
   - Server broadcasts `server:events` with the game state and events
   - Server waits **4 seconds** (animation delay) for clients to play animations
   - Server sends `server:start_turn` to announce the next player's turn
   - Turn timer starts counting down

### Timeline Example

```
Player 1 submits action
    ↓
Server processes action, broadcasts server:events
    ↓
[4 second animation delay]
    ↓
Server sends server:start_turn for Player 2
    ↓
Player 2 has 30 seconds to submit action
```

### Client Timer UI

When you receive `server:start_turn`:
- The `timeAllowed` value tells you how many seconds the player has
- You can start a local countdown timer immediately
- The server's timer is already running, so the UI timer should be accurate

### Strike System (Timeout Penalties)

If a player times out, they receive a "strike" and their next turn has less time:

| Strikes | Time Allowed |
|---------|--------------|
| 0       | 30 seconds   |
| 1       | 15 seconds   |
| 2       | 10 seconds   |
| 3+      | 5 seconds    |

Making a successful move resets strikes to 0.

### Timeout Behavior

If a player times out:
1. Server uses AI to make a move for them (or ends their turn if no valid moves)
2. The `server:events` payload will have `aiMove: true`
3. Player receives a strike (shorter time next turn)

---

## Events Reference

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `client:join_game` | `{ gameId: string }` | Join a game room |
| `client:action` | `{ gameId, actionType, user_card_instance_id?, position? }` | Submit game action |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `server:joined` | `{ gameState, playerNumber }` | Confirmation of joining |
| `server:player_joined` | `{ userId, playerNumber }` | Other player joined |
| `server:start_turn` | `{ currentPlayerId, timeAllowed }` | Turn announcement (timer starts now) |
| `server:events` | `{ gameState, events, aiMove? }` | Game state update |
| `server:game_end` | `{ result: { winnerId, reason, gameState? } }` | Game over |
| `server:error` | `{ message: string }` | Error occurred |

---

## Error Handling

```typescript
socket.on("server:error", (data) => {
  console.error("Game error:", data.message);
  // Common errors:
  // - "gameId is required to join a game"
  // - "Game not found or access denied"
  // - "You must join the game room before submitting actions"
  // - "Game is not active (status: completed)"
  // - "not player's turn"
  // - "card not in player's hand"
});
```

---

## Reconnection

### Automatic Reconnection

If a player disconnects:
1. They have **15 seconds** to reconnect
2. If they reconnect in time, they can continue playing
3. If they don't reconnect, the server surrenders on their behalf

### Reconnection Flow

```typescript
// On reconnect, just join the game again
socket.on("connect", () => {
  if (currentGameId) {
    socket.emit("client:join_game", { gameId: currentGameId });
  }
});

// You'll receive server:joined with current game state
socket.on("server:joined", (data) => {
  // Restore game state from data.gameState
  // Check data.gameState.current_player_id to see whose turn it is
});
```

### Grace Period Behavior

- If you have multiple browser tabs/devices connected, disconnecting one won't trigger the grace timer
- The grace timer only starts when ALL your sockets disconnect from a game
- Reconnecting any socket cancels the grace timer

---

## Example Client Implementation

```typescript
class MultiplayerGameClient {
  private socket: Socket;
  private gameId: string | null = null;
  private turnTimer: number | null = null;
  
  constructor(serverUrl: string, token: string) {
    this.socket = io(`${serverUrl}/game`, {
      auth: { token },
      autoConnect: false
    });
    
    this.setupEventHandlers();
  }
  
  private setupEventHandlers() {
    this.socket.on("server:joined", this.onJoined.bind(this));
    this.socket.on("server:player_joined", this.onPlayerJoined.bind(this));
    this.socket.on("server:start_turn", this.onStartTurn.bind(this));
    this.socket.on("server:events", this.onEvents.bind(this));
    this.socket.on("server:game_end", this.onGameEnd.bind(this));
    this.socket.on("server:error", this.onError.bind(this));
  }
  
  joinGame(gameId: string) {
    this.gameId = gameId;
    this.socket.auth = { ...this.socket.auth, gameId };
    this.socket.connect();
    
    this.socket.on("connect", () => {
      this.socket.emit("client:join_game", { gameId });
    });
  }
  
  private onJoined(data: { gameState: GameState; playerNumber: 1 | 2 }) {
    // Initialize game UI with data.gameState
    console.log(`Joined as player ${data.playerNumber}`);
  }
  
  private onPlayerJoined(data: { userId: string; playerNumber: 1 | 2 }) {
    console.log(`Player ${data.playerNumber} joined`);
  }
  
  private onStartTurn(data: { currentPlayerId: string; timeAllowed: number }) {
    // Update turn indicator
    // Start local countdown timer for UI
    this.startCountdownTimer(data.timeAllowed);
    
    if (data.currentPlayerId === this.myUserId) {
      // It's my turn - enable card selection
    } else {
      // Opponent's turn - disable inputs
    }
  }
  
  private onEvents(data: { gameState: GameState; events: any[]; aiMove?: boolean }) {
    // Update game state
    this.updateGameState(data.gameState);
    
    // Play animations for events
    this.playAnimations(data.events);
    
    if (data.aiMove) {
      console.log("AI made a move due to timeout");
    }
  }
  
  private onGameEnd(data: { result: { winnerId: string | null; reason: string } }) {
    console.log(`Game over! Winner: ${data.result.winnerId}, Reason: ${data.result.reason}`);
    // Show game over screen
  }
  
  private onError(data: { message: string }) {
    console.error("Game error:", data.message);
  }
  
  private startCountdownTimer(seconds: number) {
    // Clear any existing timer
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
    }
    
    let remaining = seconds;
    this.updateTimerUI(remaining);
    
    this.turnTimer = setInterval(() => {
      remaining--;
      this.updateTimerUI(remaining);
      if (remaining <= 0) {
        clearInterval(this.turnTimer!);
      }
    }, 1000);
  }
  
  placeCard(cardInstanceId: string, position: { x: number; y: number }) {
    this.socket.emit("client:action", {
      gameId: this.gameId,
      actionType: "placeCard",
      user_card_instance_id: cardInstanceId,
      position
    });
  }
  
  endTurn() {
    this.socket.emit("client:action", {
      gameId: this.gameId,
      actionType: "endTurn"
    });
  }
  
  surrender() {
    this.socket.emit("client:action", {
      gameId: this.gameId,
      actionType: "surrender"
    });
  }
  
  disconnect() {
    this.socket.disconnect();
  }
}
```

---

## Game State Structure

The `gameState` object received from the server contains:

```typescript
interface GameState {
  board: BoardCell[][];        // 4x4 grid of cells
  player1: Player;             // Player 1 data
  player2: Player;             // Player 2 data
  current_player_id: string;   // Whose turn it is
  turn_number: number;         // Current turn number
  status: "active" | "completed";
  winner: string | null;       // Winner's user ID (null if ongoing or draw)
  hydrated_card_data_cache: Record<string, CardData>; // Card details
}

interface Player {
  user_id: string;
  hand: string[];              // Array of card instance IDs (opponent's is hidden)
  deck: string[];              // Remaining deck (hidden)
  discard_pile: string[];
  score: number;               // Cards owned on board
}

interface BoardCell {
  card: CardData | null;       // Card placed here, or null if empty
  tile_enabled: boolean;
  tile_effect?: TileEffect;
}
```

**Note:** The opponent's hand array will contain `null` values instead of actual card IDs, so you can show the count but not the specific cards.

---

## Animation Events

The `events` array in `server:events` contains game events to animate:

```typescript
// Common event types
interface CardPlacedEvent {
  type: "card_placed";
  card: CardData;
  position: { x: number; y: number };
  playerId: string;
}

interface CardFlippedEvent {
  type: "card_flipped";
  card: CardData;
  position: { x: number; y: number };
  newOwner: string;
  previousOwner: string;
}

interface AbilityTriggeredEvent {
  type: "ability_triggered";
  card: CardData;
  abilityName: string;
  targets: { x: number; y: number }[];
}
```

The client should play these events in order to show the player what happened during the turn.
