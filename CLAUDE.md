# myth-server

## HTTP error handling — the one pattern

All new and touched HTTP code follows this. Spots not yet migrated are listed in
`ERROR_HANDLING_TODO.md`; when you migrate one, delete its line there.

### Rules
1. **Handlers throw, they don't write error responses.** For an expected failure
   throw an `HttpError` from `src/api/errors/httpError.ts`, using the helpers:
   `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`,
   `tooManyRequests` (or `new HttpError(status, code, message, details?)`).
   Never `res.status(4xx/5xx).json(...)` in a controller.
2. **Unexpected errors: just let them throw.** No `try { } catch { res.status(500) }`.
   The global `errorHandler` (`src/api/middlewares/errorHandler.middleware.ts`)
   logs and returns a 500. Only catch to roll back a transaction, add context,
   or translate into an `HttpError` — then rethrow.
3. **Wrap every async route handler with `asyncHandler`**
   (`src/api/middlewares/express-ts-helper.ts`). We're on Express 4: an async
   throw that isn't wrapped leaves the request hanging. Wrap at the route:
   `router.post("/", protect, asyncHandler(DeckController.createDeck))`.
4. **Services throw `HttpError` (or a domain error the handler translates)**;
   they never touch `res`.
5. **`code` is a stable SCREAMING_SNAKE machine identifier.** Clients may
   branch on it. Never change an existing code; add a new one.

### Response body (produced only by errorHandler)
```json
{ "error": "Reward already claimed", "message": "Reward already claimed",
  "code": "ALREADY_CLAIMED", "details": { "rewardId": "..." } }
```
`error` and `message` hold the same text on purpose: shipped clients read
`message` first (`myth/src/services/apiClient.ts`), and some read `error` as a
string (`towerService.ts`). Both must stay.

### Migrating a legacy spot (release safety — the app is live)
- **Keep the status code exactly.** The client branches on 401/404/409.
- **Keep the message text exactly.** The client matches on substrings, e.g.
  `"already claimed"` (onboarding store), `"Game not found"` (GameView),
  `"Encounter modifier:"` (TowerView). Grep `myth/src` for the message before
  changing a word.
- Legacy bodies were `{ error: "text" }`, `{ error: { message } }`, or
  `{ message }`. The standard body includes both `error` and `message` as
  strings, which every client version reads. Before migrating a spot whose
  legacy body was `{ error: { ... } }`, grep `myth/src` and `myth-tools/admin`
  for reads of `error.message`/`error.code` on that endpoint's response.
- Many legacy bodies carry extra top-level fields that clients may check,
  e.g. `success: false` or `retryAfter`. Keep them with
  `.withLegacy({ success: false })` on the thrown error; the handler spreads
  them at the top level (`error`/`message`/`code` always win). New endpoints
  never use `withLegacy`.
- Test: `npm run test:http-errors`.

### Example
```ts
// routes
router.post("/:id/claim", authMiddleware.protect, asyncHandler(RewardController.claim));

// controller
async claim(req: AuthenticatedRequest, res: Response) {
  const reward = await RewardService.find(req.params.id);
  if (!reward) throw notFound("Reward not found", "REWARD_NOT_FOUND");
  if (reward.claimed) throw conflict("Reward already claimed", "ALREADY_CLAIMED");
  res.json(await RewardService.claim(reward, req.user!.user_id));
}
```
