# WebSocket Multiplayer Implementation Plan

## Objective

Build a real-time multiplayer layer (websockets only) that lets two authenticated players battle each other using existing game logic while respecting strict turn timers and graceful fall-backs.

---

## High-Level Flow

1. **Queue** – Players join a matchmaking queue via REST (`POST /matchmaking/join`).
2. **Match Found** – Server pairs two queued players, persists a new `Game` row (status:`active`), decides starter randomly.
3. **Socket Room** – Both clients connect to the **`/game`** namespace (Socket.IO) and join room `game:{gameId}`.
4. **Turn Loop**
   a. Server emits `game:start` containing full `gameState` + `currentTurnPlayerId`.
   b. Server starts a 30 s timer for the active player.
   c. Active player sends `game:action` with payload `{ actionType, user_card_instance_id?, position? }`.
   d. Server validates & processes action via `GameLogic`, emits `game:events` to **both** players `{ events, gameState }`.
   e. Non-active client animates, then emits `client:animations_complete`.
   f. Server flips turn, restarts timer (30 s or reduced see §Timers).
5. **Completion** – Game ends via win condition, surrender, or disconnect/timeouts; server persists results, awards currency/xp, then emits `game:end` to both sockets and leaves room.

---

## Detailed Components

### 1. Socket Setup

- **Namespace**: `/game`. All game-related events live here.
- **Middleware**: Re-use existing `socketAuthMiddleware` for JWT validation → attach `socket.user`.
- **Room Naming**: `game:${gameId}` ensures isolation.
- **Event Contract** (bi-directional):
  - `client:join_game` ➜ `{ gameId }`
  - `server:joined` ➜ `{ gameState, playerNumber }`
  - `server:start_turn` ➜ `{ currentPlayerId, timeAllowed }`
  - `client:action` ➜ `{ actionType, ... }`
  - `server:events` ➜ `{ events[], gameState }`
  - `client:animations_complete` ➜ `{ gameId }`
  - `server:game_end` ➜ `{ result, rewards }`
  - `server:error`

### 2. Matchmaking Re-use

Matchmaking REST already creates a `Games` row & stores `activeMatches`. When a pair is created:

- Generate a **`matchToken`** (JWT) containing `gameId` & `userId`; send back via REST response so each client can pass it when connecting sockets.

### 3. Server Turn Manager

Implement a lightweight **`TurnManager`** per game:

```ts
interface TurnState {
  timeout: NodeJS.Timeout;
  allowedDurations: number[]; // [30, 15, 10, 5]
  strikes: number; // index into allowedDurations
}
```

Responsibilities:

1. Start timer for active player.
2. On `client:action` clear timer.
3. On timeout → call **`AI.move()`** for that player, increment `strikes` (cap at 3), broadcast events, continue.
4. Reset strikes when a player moves within allowed time.

### 4. Event Sequence Example

```
P1 connects → client:join_game
server:joined (gameState, player=1)
P2 connects → server:joined (player=2)
server:start_turn (currentPlayerId=P1, timeAllowed=30)
P1 client → client:action { placeCard, ... }
server:events { events, gameState }
P1 & P2 receive, animate
P2 emits client:animations_complete
server:start_turn (currentPlayerId=P2, timeAllowed=30)
...
```

### 5. Timers & AI Move Logic

- **Timer array**: `[30, 15, 10, 5]` per player.
- On timeout, server calls `GameLogic` + `AiLogic` to generate a valid move.
- Emit `server:events` like normal, but include flag `aiMove:true`.

### 6. Error / Disconnect Handling

- If a socket disconnects mid-game:
  1. Start 15 s grace timer waiting for reconnection.
  2. If not re-connected, treat as **surrender**.
- On explicit `client:surrender` → mark game completed, emit `game:end`.

### 7. Clean-up

- On `game:end`:
  - Persist `completed_at`, `winner_id`.
  - Call reward service.
  - Remove `TurnManager`, clear timers, delete from `activeGames` map.
  - `io.in(room).disconnectSockets(true)` (optional) or instruct clients to disconnect.

### 8. Reconnection Support (App Restart)

When a client unexpectedly disconnects (app closed, network drop):

1. **Immediate Grace Period** – Keep their `socket.id` entry for 15 s. If the same user reconnects within that window using the same `matchToken`, simply re-associate the new socket to the existing room and resume timers (no penalty).
2. **After Grace Period but Before Game End**
   - The server will have already performed an AI move (if turn timed out) or counted a surrender **only if** the grace timer + turn timer both elapsed.
   - A reconnecting client still presents its `matchToken`. If the game status in DB is still `active`, the server admits them back to room `game:{gameId}` and emits `server:reconnect_state` containing full `gameState`, current turn, remaining time, and any penalties applied.
3. **Token Validation** – The `matchToken` (JWT) encodes `gameId`, `userId`, and an expiration (e.g., 2 h). A reconnect attempt must:
   - Be signed correctly.
   - Reference an `active` game row.
   - Match the `userId` for that game.
4. **Timer Adjustment** – When a player reconnects during their own turn, the remaining time continues counting from server-side reference (no reset). The timer value is included in `server:reconnect_state` so the UI can display correct countdown.
5. **Multiple Tabs / Devices** – If a second socket authenticates with the same `userId` for that game, the previous socket is force-disconnected to prevent duplicate control.
6. **Final State** – If the game has already concluded (`completed`, `surrendered`, etc.), the server emits `server:game_end` immediately upon reconnection and advises the client to return to main menu.

_Add this logic to TurnManager & Socket namespace to ensure seamless resume experience._

---

## Implementation Phases

| Phase | Tasks                                                                     | PR Targets |
| ----- | ------------------------------------------------------------------------- | ---------- |
| 1     | Create `sockets/namespace.game.ts` with auth & room join logic            | 1          |
| 2     | Build `TurnManager` utility and integrate timers                          | 2          |
| 3     | Hook existing `GameLogic.placeCard / endTurn` into socket handlers        | 3          |
| 4     | Add AI fallback using `ai.logic.ts`                                       | 4          |
| 5     | Implement disconnect & surrender paths                                    | 5          |
| 6     | Client SDK updates & thorough testing (manual + Jest w/ socket.io-client) | 6          |

---

## OpenAPI & Docs

- No REST changes besides existing matchmaking.
- Document socket events in `/docs/websocket-events.md` (to be created).

---

## Risks / Mitigations

1. **Long-running timers memory leak** – ensure cleanup on game end.
2. **Cheating (multiple sockets)** – track `userId ➜ socketId`; reject duplicates.
3. **Race conditions** – Gate all state mutations through single TurnManager.

---

## Next Steps

1. Approve this plan.
2. Create initial scaffolding PR (Phase 1) focusing on namespace, authentication, and room join.

## Socket Payload Reference

| Direction       | Event                        | Payload Shape                                                                                                                                | Notes                                                                             |
| --------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Client → Server | `client:join_game`           | `{ gameId: string }`                                                                                                                         | Sent immediately after socket connects.                                           |
| Server → Client | `server:joined`              | `{ gameState: GameState, playerNumber: 1 \| 2 }`                                                                                             | Confirms join.                                                                    |
| Server → Client | `server:start_turn`          | `{ currentPlayerId: string, timeAllowed: number }`                                                                                           | Emitted at start of every turn. `timeAllowed` already accounts for strikes.       |
| Client → Server | `client:action`              | `{ gameId: string, actionType: "placeCard" \| "endTurn" \| "surrender", user_card_instance_id?: string, position?: { x:number, y:number } }` | `placeCard` requires `user_card_instance_id` and `position`.                      |
| Server → Client | `server:events`              | `{ events: BaseGameEvent[], gameState: GameState, aiMove?: boolean }`                                                                        | `aiMove` is **only** present when the server performed the action due to timeout. |
| Client → Server | `client:animations_complete` | `{ gameId: string }`                                                                                                                         | Sent once client has finished animating the last batch of events.                 |
| Server ↔ Client | `server:error`               | `{ message: string }`                                                                                                                        | Generic error channel.                                                            |
| Server → Client | `server:game_end`            | `{ result: { winnerId: string \| null, reason: "completed" \| "surrender" \| "disconnect" }, rewards?: any }`                                | `rewards` structure will match REST reward endpoints.                             |

### GameState & BaseGameEvent

These are identical to the shapes returned by existing REST endpoints (`/game/:id`) and reused verbatim. No separate socket-specific typing needed.

---

## Reconnection / Grace-Period Cheatsheet

1. **Immediate Disconnect** – The server keeps the playerʼs session alive for **15 s**.
2. **Reconnect within 15 s** – Client re-emits `client:join_game` with the same `gameId` & `matchToken`. Server cancels the grace timer and resumes the turn (timer keeps counting server-side).
3. **No Reconnect after 15 s** – The server treats this as a surrender:
   - Marks game `completed`, sets `winnerId` to opponent.
   - Emits `server:game_end` with `reason: "disconnect"`.
4. **Multiple Tabs/Devices** – First socket stays authoritative. A second socket with same `userId` forces the old one to disconnect (client should handle reconnection flow).

These additions should give the client all the explicit shapes & edge-case rules required for implementation. 🚀
