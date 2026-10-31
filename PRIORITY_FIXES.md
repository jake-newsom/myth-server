# myth-server priority fixes

Audit of 2026-10-17, in priority order. Status is tracked per item.

## 1. AI search blocks the event loop — FIXED
The neural AI search (`src/game-engine/sim/sim.searchAgent.ts`) runs up to its 1,000ms budget (`constants.ts` `NEURAL.TIME_BUDGET_MS`) without ever yielding. Prod is a single Render starter instance, so every AI turn stalls all other players' sockets and HTTP. Fix: yield to the event loop during search (short term); move AI to a `worker_threads` pool (long term).

**Done 2026-10-17:** `simulationContext.maybeYield()` yields via `setImmediate` once search has held the loop for 8ms; called at the top of `SearchAgent.play()` (neural) and `AILookahead.simulateMove()` (legacy). Each AI move still costs ~1s of CPU, but other players are now served every ~8ms instead of waiting it out. 

**Done 2026-10-17 (worker threads):** AI decisions now run off the main thread. `game-engine/ai.worker.ts` hosts an `AILogic`; `game-engine/ai.worker-pool.ts` (`aiWorkerPool.makeAIMove` / `chooseHandTargets`) keeps 1–2 long-lived workers (cores − 1, capped at 2), routes to the least-loaded one, and falls back to inline `AILogic` on crash, 15s timeout or uncloneable state (logged as "AI worker … failed; running inline"). All three call sites switched: PvP turn-timeout (`namespace.game.ts`) and solo `submitAIAction` move + hand-choice (`game.controller.ts`). Works under both ts-node (dev) and `dist/` (prod). Local check on a real game state: main-loop max lag 9ms inline → 2ms in worker, similar move time (~0.6s). `maybeYield` stays for the inline fallback. Each worker loads its own copy of the neural model (~7.5MB content/ai). Not yet measured under prod load.

## 2. Process-global simulation flag + RNG stack — FIXED
`simulation.context.ts` and `simulation.rng.ts` keep "am I simulating" and the seeded RNG in process-wide state. Only correct today because #1 blocks; once search yields, real games running concurrently would drop achievement progress and draw from the AI's seeded RNG. Fix: scope both with `AsyncLocalStorage`. Must land with #1.

**Done 2026-10-17:** both are now `AsyncLocalStorage`-scoped (`simulationScope` depth, `rngScope` frame). `enterSimulation`/`exitSimulation` kept (via `enterWith`) for tests that bracket manually. Regression test `__tests__/simulation.context.isolation.test.ts` (added to `test:ai-v2`) checks that concurrent work sees neither the flag nor the seed. test:ai-v2 31/31, test:abilities 134/134, test:tutorial 3/3.

## 3. Solo game actions have no concurrency control — FIXED (pending deploy)
`submitAction`/`submitAIAction` read-modify-write state, and `updateGameAfterAction` (`game.service.ts`) overwrites unconditionally. A double tap, retry, or race with the AI action can silently lose an update (PvP has an in-memory lock; solo has none). Fix: defaulted `state_version` column + conditional `WHERE state_version = $n`.

**Done 2026-10-30:** migration `1800000000043` adds `games.state_version`. Every `updateGameAfterAction` bumps it; the two HTTP handlers pass the version they read, and a stale write throws 409 `GAME_STATE_CONFLICT` before any rewards run. Socket callers bump without checking, so they still write last-wins but do invalidate in-flight HTTP actions. The loser gets a 409 rather than the current state because a state with no events would skip the winner's animations and has no reward payload. Old clients show the message as a toast. Status-only writers (abort paths) don't bump, so an in-flight action can still overwrite an abort.

## 4. game_state write amplification — PHASE 1 DONE, PHASE 2 PLANNED
Local games average ~58KB of JSON, ~41KB of it `hydrated_card_data_cache`, rewritten every move and echoed back via `RETURNING game_state`. `getActiveGamesForUser` parses full blobs for two fields.

### What the data looks like (local DB, 2026-10-17)
- Latest game: cache 61KB (40 entries), board 29.5KB, everything else <2KB.
- Each cache entry = mutable per-game fields (`current_power`, `owner`, `temporary_effects`, `lockedBy`, modifiers, ~1KB) + `base_card_data` (name, tags, image, `special_ability`, base power). `base_card_data` is ~45% of the cache (214KB of 479KB across 12 games) and never changes after hydration.
- Board cells embed full card objects again, including `base_card_data` (~10KB of the 29.5KB board).
- The client reads `hydrated_card_data_cache` (37 refs: game store, GameView, multiplayerService), so **API/socket responses must keep it unchanged**. Only the stored form may change.
- Return value of `updateGameAfterAction`: 8 socket callers ignore it; `submitAction`/`submitAIAction` (`game.controller.ts:789`, `:1233`) `JSON.parse` the returned `game_state` even though they hold the same state in memory. The only difference is the write-time replacer that strips `sourceCard`.
- No SQL anywhere reads into `game_state` JSON; no admin consumer.

### Phase 1 — stop the round-trips (no schema change, one small PR) — DONE 2026-10-17
`updateGameAfterAction` no longer returns `game_state` from Postgres (returns the parsed JSON it wrote; callers unchanged). `getActiveGamesSummary` reads `current_player_id`/`turn_number` in SQL. Both active-game list queries use `UNION ALL` + `player1_id IS DISTINCT FROM $1` instead of `UNION`, which deduped by comparing whole rows incl. the state blob. `getRawGameRecord` keeps `SELECT *` (callers use most columns). Verified on local DB against the old SQL (incl. a self-vs-self row) and a write/read-back equality check; all suites green.

1. `updateGameAfterAction`: `RETURNING game_id, game_status, winner_id` (drop `game_state`). Add `toPersistedState(state)` (the existing `sourceCard`-stripping stringify) and use its output for both the DB param and, via `JSON.parse`, the two controller responses. Response stays byte-identical.
2. `getActiveGamesForUser`: select `game_state->>'current_player_id'` and `(game_state->>'turn_number')::int` instead of the blob.
3. Audit the remaining `SELECT *` / full-state reads in `game.service.ts` (e.g. `:323`) and select only what each caller uses.
- Verify: response snapshot test for submitAction before/after; `test:ai-v2`, `test:abilities`, `test:mulligan`.
- Saves the ~58KB DB→server transfer and parse per HTTP move; socket moves already ignored it.

### Phase 2 — store immutable card data once (two releases, additive)
Goal: per-move write drops by roughly half (cache `base_card_data` + board `base_card_data`).

**Release A — readers tolerate both forms; still write full state.**
- Migration: `ALTER TABLE games ADD COLUMN card_catalog jsonb NULL` (`{ [instanceId]: base_card_data }`). Nullable, no backfill.
- One funnel for reads, `fromPersistedState(row)` (wrap `parseGameState`): for every cache entry and board card missing `base_card_data`, fill it from `card_catalog`. Rows with embedded data (all old rows) pass through untouched.
- Ship it and let it bake. This guarantees an old instance never meets a stripped row during the release-B rolling deploy.

**Release B — write the stripped form.**
- `toPersistedState`: remove `base_card_data` from cache entries and board cards; collect them into the catalog.
- Write `card_catalog` only when it changed: `card_catalog = COALESCE($n, card_catalog)` with `$n = null` when the instance-id set matches the last write (track key count per game in the room meta / compare against the row read at the start of the action). Mid-game additions (World Breaker spawn, Frigg/ability `cache[id] = target`, draws via `game.logic.ts:1043`) change the set and trigger one catalog write.
- `base_card_data` is only mutated at hydration (`sagaBattle.hydration.ts:214`, before the game starts) — confirm with a grep guard in review before shipping.
- `createGameRecord` / tutorial / saga / draft creation write the catalog at insert.
- Retention (`dataRetention.service.ts`) blanks `game_state`; also null `card_catalog` there.
- Verify: round-trip property test (`fromPersisted(toPersisted(s))` deep-equals `s` minus `sourceCard`) over states generated by the self-play harness (`src/game-engine/sim/`), including spawn/reveal-hand abilities; measure avg `length(game_state::text)` before/after on local games.

### Phase 3 — only if still needed after measuring Phase 2
Board cells duplicate the mutable fields of cache entries too. Deduplicating them (board stores instance ids, rehydrated on read) touches engine code that reads board cards directly — invasive; decide after Phase 2 numbers.

### Notes
- Do Phase 1 together with #3 (`state_version`): both change `updateGameAfterAction` and its callers.
- Old clients are unaffected in every phase: responses are rebuilt to the current shape before `sanitize.ts` runs.

## 5. Process-local state locks prod to one instance — OPEN
Matchmaking queue array, per-game action locks, ranked-draft timers, chat rate-limit buckets, no Socket.IO Redis adapter, ~6 interval/cron schedulers in `app.ts`. Deploys drop in-flight timers; a second instance would double-run schedulers and split matchmaking. Fix: Socket.IO Redis adapter + lock-guarded schedulers (Redis is already a dependency).

## 6. Inconsistent error handling (getting worse) — PATTERN DEFINED, MIGRATING
174 hand-written `res.status(500)` vs 52 `next(err)` (was 153 in Aug). This forces the client's multi-key error-message probing. Fix: `asyncHandler` + typed `HttpError`, migrate as files are touched; keep the `{ error }` body shape for old clients.

**Done 2026-10-17:** pattern in `myth-server/CLAUDE.md` ("HTTP error handling"): `src/api/errors/httpError.ts` (`HttpError` + `badRequest`/`notFound`/`conflict`/… helpers, `.withLegacy()` for old top-level fields), typed `asyncHandler`, errorHandler emits `{ error, message, code, details? }` for `HttpError`. Test: `npm run test:http-errors`. All 746 non-conforming spots (46 files) plus cross-cutting items listed in `ERROR_HANDLING_TODO.md`, to be fixed over time.

## 7. Game engine writes achievement progress directly — ENGINE DECOUPLED (pending deploy), MAPS OPEN
Ability code calls `AchievementService.triggerAchievementEvent` from ~18 sites mid-resolution; `achievement.service.ts` is 2,565 lines with ~25 module-level per-match Maps (lost on restart, cleaned by key-prefix scans). Fix: engine only emits events; achievements consume the move's event list after the state is saved.

**Done 2026-10-30:** engine sites call `emitAchievementEvent` (`game-engine/achievement.events.ts`) and no longer import the service. HTTP action, socket action, turn-timeout and disconnect-surrender paths open a per-move buffer with `beginAchievementMove()`; `updateGameAfterAction` flushes it only after a successful save, so rejected, conflicted or failed moves credit nothing. An event emitted with no open buffer dispatches immediately, as before. **Still open:** the module-level per-match Maps (lost on restart); Daily tasks now use the same post-save buffer. Season souls don't track during moves either: since 2026-10-30 they're awarded at game end, one per card owned on the board, none for a surrendering player.

## 8. 28 of 66 test files run by no npm script — DONE
Includes per-pantheon achievement tests, saga map tests, gold reward-service test. `npm test` just prints an error. Fix: one `node --test` glob as `npm test`, plus CI.

**Done 2026-10-17:** `npm test` → `tests/run.js` runs every `*.test.ts/js` under `src/` and `tests/` (new files auto-included; `npm test -- <substring>` filters). 61 files / 532 tests pass. Fixed `tests/utils/clientVersion.test.ts` (asserted 1.0.9 supports mulligan; min has always been 1.0.10). 6 files quarantined in the runner with reasons: 3 Jest-format files (Jest not installed), norse/polynesian achievement tests (hit real DB with fake ids; Pele/Maui assertion also fails), IAP suite (temp schema built from migration 014 only; also fails under `test:iap`). **CI added 2026-10-30:** `.github/workflows/test.yml` runs typecheck and `npm test` on pushes to main and on PRs, with no database. **Found while adding it:** migrations can't replay onto an empty database (`1772700000000` fails on a missing `card_borders` row), so a rebuild from scratch needs a dump.

## 9. Game action dispatch duplicated 3× — OPEN
`submitAction` and `submitAIAction` (~400 lines each) plus `namespace.game.ts`. 62 services/controllers (9 controllers) import `config/db` directly. Fix: one `GameActionService` shared by HTTP and sockets (home for the #3 version check).

## 10. Duplicate indexes on hot tables — DONE (pending deploy)
Local DB: `games` has two indexes each on `player1_id`, `player2_id`, `game_status`; `user_owned_cards` two on `user_id`. Fix: confirm in prod, then `DROP INDEX CONCURRENTLY` in its own release.

**Done 2026-10-17:** `migrations/1800000000040_drop-duplicate-indexes.js` drops 28 redundant indexes (8 identical plain pairs, 1 duplicated unique index, 19 plain indexes shadowed by a unique one on users, user_sessions, games, user_owned_cards, deck_cards, …). Non-transactional `DROP INDEX CONCURRENTLY`, each guarded by a catalog check that an equivalent valid index remains; `down()` recreates them concurrently. Local: 357 → 329 indexes, down/up round-trip verified, no invalid indexes. Ship in its own release; prod not inspected (guards make it safe either way).

## 11. Dev and prod start differently — OPEN
`server.js` (prod) and `app.ts` (dev) each set up Socket.IO, CORS, `listen` — already caused an `io` wiring bug. `socket.manager.js` is still CommonJS. Fix: one `src/bootstrap/` entry used by both.

## 12. No config validation at startup — FIXED (pending deploy), SSL OPEN
`config/index.ts` boots with `JWT_SECRET` etc. undefined; DB SSL uses `rejectUnauthorized: false`. Fix: startup check that fails fast.

**Done 2026-10-30:** `src/config/validateConfig.ts` runs first thing in `app.ts` (both dev and prod load it) and throws listing every problem by name, never by value. Requires `DATABASE_URL` and a 32+ character `JWT_SECRET`; if set, `BCRYPT_SALT_ROUNDS`, `PORT` and `REDIS_PORT` must be positive integers. Missing Redis only warns in production. **Still open:** `rejectUnauthorized: false`, which needs its own test against the prod certificate. The earlier note about a second `DATABASE_URL` was wrong: that line is `DATABASE_URL_PROD`, so there's nothing to delete.

## Low priority
Tracked one-off files at repo root (`test-simplified-packs.js`, `unlock-stories-local.sql`, `specialAbilitiesLogic.json`, `redoc-static.html`) — move to `scripts/` or delete.
