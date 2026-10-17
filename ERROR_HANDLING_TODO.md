# HTTP error-handling migration list

Spots that don't follow the pattern in `CLAUDE.md` → "HTTP error handling".
Fix over time; **delete a line when its spot is migrated**. When migrating,
keep the status code and message text exactly (see CLAUDE.md, release safety).

Generated 2026-10-17 by scanning `src/api/**` and `src/app.ts` for
`res.status(>=400)` / `res.sendStatus(>=400)` / dynamic `res.status(expr)`.
746 spots in 46 files.

## Cross-cutting

- [ ] **errorHandler legacy branches** — `ValidationError`, `AuthenticationError`,
      `AuthorizationError`, `RateLimitError`, `InsufficientResourcesError`,
      `GameNotFoundError`, `DeckNotFoundError`, `DeckAccessError`, `EmptyDeckError`,
      duplicate-key, JSON-parse and DB-connection branches still return the nested
      `{ error: { message, code, type, ... } }` body. Convert each to an `HttpError`
      (same status + message) once consumers are confirmed not to read the nested fields.
- [ ] **Unhandled 500 body** — unknown errors return the nested legacy body too; switch to
      the standard body together with the item above.
- [ ] **Routes not wrapped in `asyncHandler`** — 41 of 41 route files wrap nothing:
      `achievement.routes.ts`, `admin.routes.ts`, `assetPatch.routes.ts`, `auth.routes.ts`, `border.routes.ts`, `card.routes.ts`, `cardBack.routes.ts`, `challenge.routes.ts`, `character.routes.ts`, `chat.routes.ts`, `currency.routes.ts`, `dailyShop.routes.ts`, `dailyTask.routes.ts`, `deck.routes.ts`, `emoji.routes.ts`, `event.routes.ts`, `fatePick.routes.ts`, `featureFlag.routes.ts`, `forge.routes.ts`, `friends.routes.ts`, `game.routes.ts`, `health.routes.ts`, `iap.routes.ts`, `index.ts`, `leaderboard.routes.ts`, `mail.routes.ts`, `maintenance.routes.ts`, `matchmaking.routes.ts`, `onboarding.routes.ts`, `pack.routes.ts`, `powerUp.routes.ts`, `promoCode.routes.ts`, `rankedDraft.routes.ts`, `saga.routes.ts`, `season.routes.ts`, `set.routes.ts`, `tower.routes.ts`, `updater.routes.ts`, `user.routes.ts`, `userCard.routes.ts`, `xp.routes.ts`.
      Wrap each async handler when its controller is migrated.
- [ ] **Errors carrying `statusCode` duck-typed** — controllers that do
      `if (error.statusCode) res.status(error.statusCode)...` (listed below as
      dynamic-status entries) should have their services throw `HttpError` instead.

## By file

### src/api/controllers/achievement.controller.ts (22)

- [ ] L16 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L43 `500` `json({ success: false, error: { type: "ACHIEVEMENTS_ERROR", message: "Failed to fetch a...`
- [ ] L64 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L76 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Character ID is req...`
- [ ] L95 `500` `json({ success: false, error: { type: "ACHIEVEMENTS_ERROR", message: "Failed to fetch c...`
- [ ] L109 `500` `json({ success: false, error: { type: "ACHIEVEMENTS_ERROR", message: "Failed to fetch c...`
- [ ] L131 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L145 `500` `json({ success: false, error: { type: "ACHIEVEMENTS_ERROR", message: "Failed to fetch c...`
- [ ] L158 `500` `json({ success: false, error: { type: "ACHIEVEMENTS_ERROR", message: "Failed to fetch c...`
- [ ] L180 `500` `json({ success: false, error: { type: "CATEGORIES_ERROR", message: "Failed to fetch ach...`
- [ ] L201 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L214 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Achievement ID is r...`
- [ ] L229 `400` `json(result)`
- [ ] L236 `500` `json({ success: false, error: { type: "CLAIM_ERROR", message: "Failed to claim achievem...`
- [ ] L257 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L277 `500` `json({ success: false, error: { type: "RECENT_ERROR", message: "Failed to fetch recent ...`
- [ ] L298 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L315 `500` `json({ success: false, error: { type: "STATS_ERROR", message: "Failed to fetch achievem...`
- [ ] L341 `500` `json({ success: false, error: { type: "ALL_ACHIEVEMENTS_ERROR", message: "Failed to fet...`
- [ ] L360 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Achievement key is ...`
- [ ] L375 `404` `json({ success: false, error: { type: "NOT_FOUND_ERROR", message: "Achievement not foun...`
- [ ] L390 `500` `json({ success: false, error: { type: "DETAILS_ERROR", message: "Failed to fetch achiev...`

### src/api/controllers/admin.controller.ts (72)

- [ ] L63 `400` `json({ status: "error", message: "userId and quantity are required", })`
- [ ] L70 `400` `json({ status: "error", message: "Quantity must be greater than 0", })`
- [ ] L79 `404` `json({ status: "error", message: "User not found", })`
- [ ] L108 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L125 `400` `json({ status: "error", message: "userId and quantity are required", })`
- [ ] L132 `400` `json({ status: "error", message: "Quantity cannot be negative", })`
- [ ] L141 `404` `json({ status: "error", message: "User not found", })`
- [ ] L171 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L187 `400` `json({ status: "error", message: "User ID is required", })`
- [ ] L196 `404` `json({ status: "error", message: "User not found", })`
- [ ] L215 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L267 `400` `json({ status: "error", message: result.message, timestamp: new Date().toISOString(), })`
- [ ] L279 `500` `json({ status: "error", message: "Internal server error during AI fate pick generation"...`
- [ ] L329 `500` `json({ status: "error", message: result.message, error: result.error, timestamp: new Da...`
- [ ] L342 `500` `json({ status: "error", message: "Internal server error during daily rewards distributi...`
- [ ] L373 `400` `json({ status: "error", message: '${key} is required', })`
- [ ] L382 `400` `json({ status: "error", message: result.error || "Failed to create achievement", })`
- [ ] L401 `500` `json({ status: "error", message: "Failed to create achievement" })`
- [ ] L414 `400` `json({ status: "error", message: "achievementId is required", })`
- [ ] L428 `status` `json({ status: "error", message: result.error || "Failed to update achievement", })`
- [ ] L446 `500` `json({ status: "error", message: "Failed to update achievement" })`
- [ ] L460 `400` `json({ status: "error", message: "achievementId is required", })`
- [ ] L471 `status` `json({ status: "error", message: result.error || "Failed to deactivate achievement", })`
- [ ] L489 `500` `json({ status: "error", message: "Failed to deactivate achievement" })`
- [ ] L513 `500` `json({ status: "error", message: "Failed to list borders" })`
- [ ] L537 `400` `json({ status: "error", message: "name is required" })`
- [ ] L542 `400` `json({ status: "error", message: "image_url is required" })`
- [ ] L549 `400` `json({ status: "error", message: minVersion.error })`
- [ ] L556 `400` `json({ status: "error", message: maxEq.error })`
- [ ] L585 `500` `json({ status: "error", message: "Failed to create border" })`
- [ ] L600 `400` `json({ status: "error", message: "borderId is required" })`
- [ ] L609 `400` `json({ status: "error", message: minVersion.error })`
- [ ] L618 `400` `json({ status: "error", message: maxEq.error })`
- [ ] L626 `404` `json({ status: "error", message: "Border not found" })`
- [ ] L643 `500` `json({ status: "error", message: "Failed to update border" })`
- [ ] L658 `400` `json({ status: "error", message: "borderId is required" })`
- [ ] L664 `404` `json({ status: "error", message: "Border not found" })`
- [ ] L681 `500` `json({ status: "error", message: "Failed to deactivate border" })`
- [ ] L697 `400` `json({ status: "error", message: "userId and borderId are required", })`
- [ ] L705 `404` `json({ status: "error", message: "User not found" })`
- [ ] L729 `500` `json({ status: "error", message: "Failed to grant border" })`
- [ ] L745 `400` `json({ status: "error", message: "userId and borderId are required", })`
- [ ] L770 `500` `json({ status: "error", message: "Failed to revoke border" })`
- [ ] L789 `500` `json({ status: "error", message: "Failed to list card backs" })`
- [ ] L800 `400` `json({ status: "error", message: "code_key is required" })`
- [ ] L805 `400` `json({ status: "error", message: "name is required" })`
- [ ] L810 `400` `json({ status: "error", message: "image_url is required" })`
- [ ] L817 `400` `json({ status: "error", message: minVersion.error })`
- [ ] L838 `500` `json({ status: "error", message: "Failed to create card back" })`
- [ ] L848 `400` `json({ status: "error", message: "backId is required" })`
- [ ] L856 `400` `json({ status: "error", message: minVersion.error })`
- [ ] L864 `404` `json({ status: "error", message: "Card back not found" })`
- [ ] L875 `500` `json({ status: "error", message: "Failed to update card back" })`
- [ ] L885 `400` `json({ status: "error", message: "backId is required" })`
- [ ] L891 `404` `json({ status: "error", message: "Card back not found" })`
- [ ] L902 `500` `json({ status: "error", message: "Failed to deactivate card back" })`
- [ ] L912 `400` `json({ status: "error", message: "userId and backId are required", })`
- [ ] L919 `404` `json({ status: "error", message: "User not found" })`
- [ ] L934 `500` `json({ status: "error", message: "Failed to grant card back" })`
- [ ] L944 `400` `json({ status: "error", message: "userId and backId are required", })`
- [ ] L960 `500` `json({ status: "error", message: "Failed to revoke card back" })`
- [ ] L994 `500` `json({ status: "error", message: "Failed to clear cards cache" })`
- [ ] L1013 `400` `json({ status: "error", message: "userId is required" })`
- [ ] L1020 `404` `json({ status: "error", message: "User not found" })`
- [ ] L1028 `403` `json({ status: "error", message: "Admin accounts cannot be banned.", })`
- [ ] L1059 `500` `json({ status: "error", message: "Failed to ban user" })`
- [ ] L1071 `400` `json({ status: "error", message: "userId is required" })`
- [ ] L1078 `404` `json({ status: "error", message: "User not found" })`
- [ ] L1099 `500` `json({ status: "error", message: "Failed to unban user" })`
- [ ] L1118 `500` `json({ status: "error", message: "Failed to list banned users" })`
- [ ] L1129 `400` `json({ status: "error", message: "Search term must be at least 2 characters", })`
- [ ] L1142 `500` `json({ status: "error", message: "Failed to search users" })`

### src/api/controllers/auth.controller.ts (50)

- [ ] L106 `403` `json({ error: { code: "ACCOUNT_BANNED", message: user.banned_reason || "This account ha...`
- [ ] L125 `400` `json({ error: { message: "Username and password are required." }, })`
- [ ] L131 `400` `json({ error: { message: 'Username must be ${USER_LIMITS.MAX_USERNAME_LENGTH} character...`
- [ ] L148 `400` `json({ error: { message: "That username isn't available. Please choose a different one....`
- [ ] L157 `400` `json({ error: { message: "Password must be at least 6 characters long." }, })`
- [ ] L165 `409` `json({ error: { message: "Username already taken." }, })`
- [ ] L229 `400` `json({ error: { message: "Username and password are required." }, })`
- [ ] L237 `401` `json({ error: { message: "Invalid username or password." }, })`
- [ ] L244 `500` `json({ error: { message: "User data corrupted. Please contact support." }, })`
- [ ] L255 `401` `json({ error: { message: "Invalid username or password." }, })`
- [ ] L313 `400` `json({ error: { message: "Refresh token is required." }, })`
- [ ] L321 `401` `json({ error: { message: "Invalid or expired refresh token." }, })`
- [ ] L355 `401` `json({ error: { message: "Not authenticated." }, })`
- [ ] L378 `401` `json({ error: { message: "Not authenticated." }, })`
- [ ] L401 `401` `json({ error: { message: "Not authenticated." }, })`
- [ ] L432 `400` `json({ error: { message: "Facebook access token is required." }, })`
- [ ] L441 `401` `json({ error: { message: "Invalid Facebook access token." }, })`
- [ ] L495 `409` `json({ error: { message: "An account with this email already exists. Please log in with...`
- [ ] L588 `400` `json({ error: { message: "Missing signed_request parameter." }, })`
- [ ] L640 `400` `json({ error: { message: "Missing signed_request parameter." }, })`
- [ ] L713 `400` `json({ error: { message: "Missing required parameters: fb_id and ts" }, })`
- [ ] L743 `500` `json({ error: { message: "Failed to check deletion status." }, })`
- [ ] L758 `401` `json({ error: { message: "Not authenticated." }, })`
- [ ] L765 `400` `json({ error: { message: "Facebook access token is required." }, })`
- [ ] L774 `401` `json({ error: { message: "Invalid Facebook access token." }, })`
- [ ] L787 `409` `json({ error: { message: "This Facebook account is already linked to another user.", co...`
- [ ] L797 `409` `json({ error: { message: "Your account already has a Facebook account linked.", code: "...`
- [ ] L858 `401` `json({ error: { message: "Not authenticated." }, })`
- [ ] L865 `400` `json({ error: { message: "No Facebook account is currently linked." }, })`
- [ ] L873 `400` `json({ error: { message: "Cannot unlink Facebook account as it's your primary authentic...`
- [ ] L932 `400` `json({ error: { message: "Apple identity token is required." }, })`
- [ ] L941 `401` `json({ error: { message: "Invalid Apple identity token." }, })`
- [ ] L1072 `401` `json({ error: { message: "Not authenticated." }, })`
- [ ] L1079 `400` `json({ error: { message: "Apple identity token is required." }, })`
- [ ] L1088 `401` `json({ error: { message: "Invalid Apple identity token." }, })`
- [ ] L1096 `409` `json({ error: { message: "This Apple account is already linked to another user.", code:...`
- [ ] L1106 `409` `json({ error: { message: "Your account already has an Apple account linked.", code: "AP...`
- [ ] L1167 `401` `json({ error: { message: "Not authenticated." }, })`
- [ ] L1174 `400` `json({ error: { message: "No Apple account is currently linked." }, })`
- [ ] L1182 `400` `json({ error: { message: "Cannot unlink Apple account as it's your primary authenticati...`
- [ ] L1241 `400` `json({ error: { message: "Google ID token is required." }, })`
- [ ] L1250 `401` `json({ error: { message: "Invalid Google ID token." }, })`
- [ ] L1374 `401` `json({ error: { message: "Not authenticated." }, })`
- [ ] L1381 `400` `json({ error: { message: "Google ID token is required." }, })`
- [ ] L1390 `401` `json({ error: { message: "Invalid Google ID token." }, })`
- [ ] L1403 `409` `json({ error: { message: "This Google account is already linked to another user.", code...`
- [ ] L1413 `409` `json({ error: { message: "Your account already has a Google account linked.", code: "GO...`
- [ ] L1474 `401` `json({ error: { message: "Not authenticated." }, })`
- [ ] L1481 `400` `json({ error: { message: "No Google account is currently linked." }, })`
- [ ] L1489 `400` `json({ error: { message: "Cannot unlink Google account as it's your primary authenticat...`

### src/api/controllers/border.controller.ts (3)

- [ ] L34 `500` `json({ message: "Failed to fetch borders" })`
- [ ] L48 `401` `json({ message: "Unauthorized" })`
- [ ] L58 `500` `json({ message: "Failed to fetch owned borders" })`

### src/api/controllers/card.controller.ts (6)

- [ ] L45 `400` `json({ error: { message: "Invalid page value. Must be a positive integer.", }, })`
- [ ] L55 `400` `json({ error: { message: "Invalid limit value. Must be a non-negative integer. Use 0 fo...`
- [ ] L67 `400` `json({ error: { message: "Invalid rarity value. Must be one of: " + validRarities.join(...`
- [ ] L88 `400` `json({ error: { message: "Invalid format for ids parameter. Expected comma-separated li...`
- [ ] L200 `400` `json({ error: { message: "Card ID is required." }, })`
- [ ] L212 `404` `json({ error: { message: "Card not found." }, })`

### src/api/controllers/cardBack.controller.ts (3)

- [ ] L20 `500` `json({ message: "Failed to fetch card backs" })`
- [ ] L28 `401` `json({ message: "Unauthorized" })`
- [ ] L38 `500` `json({ message: "Failed to fetch owned card backs" })`

### src/api/controllers/challenge.controller.ts (8)

- [ ] L48 `401` `json({ error: { message: "Authentication required." }, })`
- [ ] L83 `500` `json({ error: { message: "Failed to load online players." }, })`
- [ ] L107 `400` `json({ error: { message: "opponentId is required." }, })`
- [ ] L119 `404` `json({ error: { message: "User not found." }, })`
- [ ] L151 `400` `json({ error: { message: "challengeId is required." }, })`
- [ ] L188 `400` `json({ error: { message: "challengeId and deckId are required." }, })`
- [ ] L352 `error.statusCode` `json({ error: { message: error.message }, })`
- [ ] L359 `500` `json({ error: { message: fallbackMessage }, })`

### src/api/controllers/character.controller.ts (5)

- [ ] L16 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L30 `401` `json({ message: "Unauthorized" })`
- [ ] L35 `400` `json({ message: "characterId is required" })`
- [ ] L44 `status` `json({ message: result.error })`
- [ ] L50 `500` `json({ status: "error", message: "Internal server error", })`

### src/api/controllers/chat.controller.ts (8)

- [ ] L17 `401` `json({ error: { message: "Authentication required." } })`
- [ ] L29 `error.statusCode` `json({ error: { message: error.message, code: error.code }, })`
- [ ] L40 `500` `json({ error: { message: "Internal server error." } })`
- [ ] L64 `400` `json({ error: { message: "profanityFilterEnabled must be a boolean." }, })`
- [ ] L97 `400` `json({ error: { message: "userId is required." } })`
- [ ] L130 `400` `json({ error: { message: "messageId is required." } })`
- [ ] L207 `400` `json({ error: { message: "userId is required." } })`
- [ ] L211 `400` `json({ error: { message: "durationMinutes must be a non-negative number." }, })`

### src/api/controllers/currency.controller.ts (9)

- [ ] L15 `401` `json({ error: "User not authenticated" })`
- [ ] L24 `404` `json({ error: "User not found" })`
- [ ] L44 `500` `json({ error: "Failed to fetch currencies" })`
- [ ] L54 `401` `json({ error: "User not authenticated" })`
- [ ] L59 `400` `json({ error: "Invalid quantity - must be a positive integer", })`
- [ ] L65 `400` `json({ error: "Invalid currency_type - must be 'gems'", })`
- [ ] L86 `400` `json({ error: 'Insufficient gems. Need ${totalCost}.', required: totalCost, })`
- [ ] L120 `500` `json({ error: "Failed to purchase packs" })`
- [ ] L129 `500` `json({ error: "Failed to fetch pack prices" })`

### src/api/controllers/dailyShop.controller.ts (21)

- [ ] L17 `401` `json({ status: "error", message: "User not authenticated", })`
- [ ] L56 `500` `json({ status: "error", message: "Failed to fetch daily shop", error: error instanceof ...`
- [ ] L72 `401` `json({ status: "error", message: "User not authenticated", })`
- [ ] L81 `400` `json({ status: "error", message: "offering_id is required", })`
- [ ] L92 `400` `json({ status: "error", message: "quantity must be a positive integer", })`
- [ ] L105 `400` `json({ status: "error", message: result.message, timestamp: new Date().toISOString(), })`
- [ ] L129 `500` `json({ status: "error", message: "Failed to process purchase", error: error instanceof ...`
- [ ] L145 `401` `json({ status: "error", message: "User not authenticated", })`
- [ ] L153 `400` `json({ status: "error", message: "shop_tab is required", })`
- [ ] L162 `400` `json({ status: "error", message: result.message, timestamp: new Date().toISOString(), })`
- [ ] L183 `500` `json({ status: "error", message: "Failed to reset shop", timestamp: new Date().toISOStr...`
- [ ] L205 `500` `json({ status: "error", message: "Failed to fetch shop configuration", error: error ins...`
- [ ] L230 `400` `json({ status: "error", message: "item_type is required", })`
- [ ] L244 `400` `json({ status: "error", message: "Invalid item_type", })`
- [ ] L266 `404` `json({ status: "error", message: "Shop configuration not found or no changes made", })`
- [ ] L280 `500` `json({ status: "error", message: "Failed to update shop configuration", error: error in...`
- [ ] L307 `500` `json({ status: "error", message: "Failed to refresh shop offerings", error: error insta...`
- [ ] L335 `500` `json({ status: "error", message: "Failed to fetch shop statistics", error: error instan...`
- [ ] L358 `500` `json({ status: "error", message: "Failed to fetch rotation states", error: error instan...`
- [ ] L375 `400` `json({ status: "error", message: "user_id is required", })`
- [ ] L402 `500` `json({ status: "error", message: "Failed to reset user limits", error: error instanceof...`

### src/api/controllers/dailyTask.controller.ts (6)

- [ ] L12 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L18 `500` `json({ success: false, error: "Failed to get daily task status" })`
- [ ] L28 `500` `json({ success: false, error: "Internal server error", })`
- [ ] L42 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L48 `400` `json(result)`
- [ ] L55 `500` `json({ success: false, error: "Internal server error", })`

### src/api/controllers/deck.controller.ts (8)

- [ ] L84 `400` `json({ error: { message: "Deck name and user_card_instance_ids are required.", }, })`
- [ ] L95 `400` `json({ error: { message: 'You have reached the maximum limit of ${USER_LIMITS.MAX_DECKS...`
- [ ] L126 `error.statusCode` `json({ error: { message: error.message } })`
- [ ] L161 `400` `json({ error: { message: "Either name or user_card_instance_ids must be provided.", }, })`
- [ ] L193 `404` `json({ error: { message: "Deck not found or not owned by user." }, })`
- [ ] L202 `error.statusCode` `json({ error: { message: error.message } })`
- [ ] L235 `404` `json({ error: { message: "Deck not found or not owned by user." }, })`
- [ ] L244 `error.statusCode` `json({ error: { message: error.message } })`

### src/api/controllers/emoji.controller.ts (9)

- [ ] L11 `401` `json({ message: "Unauthorized" })`
- [ ] L16 `500` `json({ message: "Failed to fetch emojis" })`
- [ ] L23 `401` `json({ message: "Unauthorized" })`
- [ ] L26 `400` `json({ message: "Nothing to update" })`
- [ ] L32 `400` `json({ message: "hide_opponent_emojis must be a boolean" })`
- [ ] L46 `400` `json({ message: error.message })`
- [ ] L49 `500` `json({ message: "Failed to update emojis" })`
- [ ] L57 `400` `json({ message: "userId and emojiId are required" })`
- [ ] L64 `500` `json({ message: "Failed to grant emoji" })`

### src/api/controllers/event.controller.ts (24)

- [ ] L24 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L36 `500` `json({ success: false, error: "Internal server error" })`
- [ ] L48 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L57 `404` `json({ success: false, error: "Event not found" })`
- [ ] L67 `500` `json({ success: false, error: "Internal server error" })`
- [ ] L79 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L88 `404` `json({ success: false, error: "Event not found" })`
- [ ] L104 `500` `json({ success: false, error: "Internal server error" })`
- [ ] L116 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L129 `400` `json({ success: false, error: result.error })`
- [ ] L136 `500` `json({ success: false, error: "Internal server error" })`
- [ ] L153 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L162 `404` `json({ success: false, error: "No login sequence" })`
- [ ] L175 `500` `json({ success: false, error: "Internal server error" })`
- [ ] L187 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L196 `404` `json({ success: false, error: "No login sequence" })`
- [ ] L210 `400` `json({ success: false, error: result.error })`
- [ ] L222 `500` `json({ success: false, error: "Internal server error" })`
- [ ] L234 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L243 `404` `json({ success: false, error: "Event not found" })`
- [ ] L258 `500` `json({ success: false, error: "Internal server error" })`
- [ ] L270 `401` `json({ success: false, error: "Unauthorized" })`
- [ ] L279 `400` `json({ success: false, error: result.error })`
- [ ] L290 `500` `json({ success: false, error: "Internal server error" })`

### src/api/controllers/fatePick.controller.ts (21)

- [ ] L22 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L42 `400` `json({ success: false, error: { type: "fate_pick_ERROR", message: result.error, suggest...`
- [ ] L59 `500` `json({ success: false, error: { type: "SERVER_ERROR", message: "Failed to retrieve wond...`
- [ ] L80 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L92 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Wonder pick ID is r...`
- [ ] L106 `statusCode` `json({ success: false, error: { type: statusCode === 404 ? "NOT_FOUND" : "fate_pick_ERR...`
- [ ] L125 `500` `json({ success: false, error: { type: "SERVER_ERROR", message: "Failed to retrieve wond...`
- [ ] L146 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L158 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Wonder pick ID is r...`
- [ ] L185 `statusCode` `json({ success: false, error: { type: errorType, message: result.error, suggestion: err...`
- [ ] L204 `500` `json({ success: false, error: { type: "SERVER_ERROR", message: "Failed to participate i...`
- [ ] L225 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L239 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Wonder pick ID is r...`
- [ ] L254 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Selected position m...`
- [ ] L282 `statusCode` `json({ success: false, error: { type: errorType, message: result.error, suggestion: err...`
- [ ] L303 `500` `json({ success: false, error: { type: "SERVER_ERROR", message: "Failed to select card p...`
- [ ] L324 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L344 `400` `json({ success: false, error: { type: "fate_pick_ERROR", message: result.error, suggest...`
- [ ] L361 `500` `json({ success: false, error: { type: "SERVER_ERROR", message: "Failed to retrieve part...`
- [ ] L380 `400` `json({ success: false, error: { type: "fate_pick_ERROR", message: result.error, suggest...`
- [ ] L395 `500` `json({ success: false, error: { type: "SERVER_ERROR", message: "Failed to retrieve wond...`

### src/api/controllers/featureFlag.controller.ts (22)

- [ ] L25 `401` `json({ message: "Unauthorized" })`
- [ ] L54 `500` `json({ message: "Failed to list feature flags" })`
- [ ] L64 `400` `json({ message: keyErrors[0], errors: keyErrors })`
- [ ] L70 `400` `json({ message: "'enabled_globally' must be a boolean." })`
- [ ] L83 `409` `json({ message: "A feature flag with that key already exists." })`
- [ ] L92 `500` `json({ message: "Failed to create feature flag" })`
- [ ] L102 `404` `json({ message: "Feature flag not found." })`
- [ ] L115 `500` `json({ message: "Failed to fetch feature flag" })`
- [ ] L128 `400` `json({ message: "'enabled_globally' must be a boolean." })`
- [ ] L138 `404` `json({ message: "Feature flag not found." })`
- [ ] L147 `500` `json({ message: "Failed to update feature flag" })`
- [ ] L157 `404` `json({ message: "Feature flag not found." })`
- [ ] L166 `500` `json({ message: "Failed to delete feature flag" })`
- [ ] L182 `400` `json({ message: "'enabled' must be a boolean." })`
- [ ] L189 `404` `json({ message: "Feature flag not found." })`
- [ ] L201 `404` `json({ message: "User not found." })`
- [ ] L211 `500` `json({ message: "Failed to set override" })`
- [ ] L224 `404` `json({ message: "Override not found." })`
- [ ] L236 `500` `json({ message: "Failed to remove override" })`
- [ ] L252 `500` `json({ message: "Failed to list overrides" })`
- [ ] L262 `400` `json({ message: "A 'key' query parameter is required." })`
- [ ] L275 `500` `json({ message: "Failed to evaluate flag" })`

### src/api/controllers/forge.controller.ts (15)

- [ ] L25 `401` `json({ status: "error", message: "User not authenticated" })`
- [ ] L31 `403` `json({ status: "error", message: "The Forge is not available." })`
- [ ] L58 `500` `json({ status: "error", message: "Failed to load the Forge" })`
- [ ] L69 `401` `json({ status: "error", message: "User not authenticated" })`
- [ ] L75 `403` `json({ status: "error", message: "The Forge is not available." })`
- [ ] L88 `500` `json({ status: "error", message: "Failed to save your Forge draft" })`
- [ ] L99 `401` `json({ status: "error", message: "User not authenticated" })`
- [ ] L107 `500` `json({ status: "error", message: "Failed to clear your Forge draft" })`
- [ ] L124 `401` `json({ status: "error", message: "User not authenticated" })`
- [ ] L130 `403` `json({ status: "error", message: "Reforging is not available." })`
- [ ] L139 `result.success ? 200 : 400` `json({ status: result.success ? "success" : "error", message: result.message, data: res...`
- [ ] L145 `500` `json({ status: "error", message: "Reforging failed" })`
- [ ] L156 `401` `json({ status: "error", message: "User not authenticated" })`
- [ ] L171 `result.success ? 200 : 400` `json({ status: result.success ? "success" : "error", message: result.message, data: res...`
- [ ] L177 `500` `json({ status: "error", message: "Forging failed" })`

### src/api/controllers/friendChallenge.controller.ts (4)

- [ ] L24 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Friend ID is requir...`
- [ ] L42 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Deck ID is required...`
- [ ] L80 `status` `json({ success: false, error: { type: result.error || "UNKNOWN_ERROR", message: result....`
- [ ] L94 `500` `json({ success: false, error: { type: "INTERNAL_ERROR", message: "Failed to challenge f...`

### src/api/controllers/friends.controller.ts (17)

- [ ] L28 `500` `json({ success: false, error: { type: "INTERNAL_ERROR", message: "Failed to get friends...`
- [ ] L59 `500` `json({ success: false, error: { type: "INTERNAL_ERROR", message: "Failed to get friend ...`
- [ ] L89 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Either username or ...`
- [ ] L133 `status` `json({ success: false, error: { type: result.error || "UNKNOWN_ERROR", message: result....`
- [ ] L147 `500` `json({ success: false, error: { type: "INTERNAL_ERROR", message: "Failed to send friend...`
- [ ] L175 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Friendship ID is re...`
- [ ] L212 `status` `json({ success: false, error: { type: result.error || "UNKNOWN_ERROR", message: result....`
- [ ] L226 `500` `json({ success: false, error: { type: "INTERNAL_ERROR", message: "Failed to accept frie...`
- [ ] L254 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Friendship ID is re...`
- [ ] L291 `status` `json({ success: false, error: { type: result.error || "UNKNOWN_ERROR", message: result....`
- [ ] L305 `500` `json({ success: false, error: { type: "INTERNAL_ERROR", message: "Failed to reject frie...`
- [ ] L333 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Friendship ID is re...`
- [ ] L363 `status` `json({ success: false, error: { type: result.error || "UNKNOWN_ERROR", message: result....`
- [ ] L377 `500` `json({ success: false, error: { type: "INTERNAL_ERROR", message: "Failed to remove frie...`
- [ ] L416 `500` `json({ success: false, error: { type: "INTERNAL_ERROR", message: "Failed to search user...`
- [ ] L443 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "User ID is required...`
- [ ] L466 `500` `json({ success: false, error: { type: "INTERNAL_ERROR", message: "Failed to check frien...`

### src/api/controllers/game.controller.ts (43)

- [ ] L95 `401` `json({ error: "Unauthorized" })`
- [ ] L100 `409` `json({ error: "You have a pending challenge. Cancel it before starting another game.", })`
- [ ] L108 `409` `json({ error: QUEUE_CONFLICT_MESSAGE, code: QUEUE_CONFLICT_CODE, })`
- [ ] L123 `400` `json({ error: "Deck ID is required" })`
- [ ] L145 `400` `json({ error: message })`
- [ ] L154 `400` `json({ error: budgetError.message })`
- [ ] L170 `500` `json({ error: "No AI decks available" })`
- [ ] L268 `403` `json({ error: "Event is not available" })`
- [ ] L339 `400` `json({ error: (error as Error).message })`
- [ ] L341 `500` `json({ error: "Server error creating game" })`
- [ ] L358 `401` `json({ error: "Unauthorized" })`
- [ ] L388 `500` `json({ error: "Server error creating tutorial game" })`
- [ ] L411 `401` `json({ error: "Unauthorized" })`
- [ ] L422 `500` `json({ error: "Failed to fetch active game" })`
- [ ] L431 `401` `json({ error: "Unauthorized" })`
- [ ] L445 `404` `json({ error: "Game not found or access denied" })`
- [ ] L476 `500` `json({ error: "Server error fetching game" })`
- [ ] L488 `401` `json({ error: "Unauthorized" })`
- [ ] L497 `400` `json({ error: "Action type is required" })`
- [ ] L509 `404` `json({ error: "Game not found or access denied" })`
- [ ] L543 `400` `json({ error: "Game is in mulligan phase" })`
- [ ] L553 `400` `json({ error: "Waiting for an ability choice to resolve" })`
- [ ] L562 `400` `json({ error: "card id and position are required for placeCard action", })`
- [ ] L583 `400` `json({ error: "Not your turn" })`
- [ ] L606 `400` `json({ error: "Not your turn" })`
- [ ] L620 `400` `json({ error: "Mulligan phase has ended" })`
- [ ] L626 `400` `json({ error: 'replaced_card_instance_ids must be an array of at most ${MAX_MULLIGAN_RE...`
- [ ] L647 `400` `json({ error: "No pending choice to resolve" })`
- [ ] L651 `400` `json({ error: "Not your choice to make" })`
- [ ] L661 `400` `json({ error: "Invalid chosen_card_ids" })`
- [ ] L675 `400` `json({ error: "Invalid action type" })`
- [ ] L855 `404` `json({ error: (error as Error).message })`
- [ ] L868 `400` `json({ error: error.message })`
- [ ] L870 `500` `json({ error: "Server error processing action" })`
- [ ] L883 `401` `json({ error: "Unauthorized" })`
- [ ] L896 `404` `json({ error: "Game not found or access denied" })`
- [ ] L902 `400` `json({ error: "AI actions are only for solo games" })`
- [ ] L931 `400` `json({ error: "Not AI's turn" })`
- [ ] L937 `400` `json({ error: "Game is in mulligan phase" })`
- [ ] L943 `400` `json({ error: "Game is not active" })`
- [ ] L1298 `404` `json({ error: (error as Error).message })`
- [ ] L1305 `400` `json({ error: error.message })`
- [ ] L1307 `500` `json({ error: "Server error processing AI action" })`

### src/api/controllers/iap.controller.ts (3)

- [ ] L15 `503` sendStatus
- [ ] L18 `401` `end()`
- [ ] L21 `400` `end()`

### src/api/controllers/leaderboard.controller.ts (17)

- [ ] L30 `500` `json({ success: false, error: { type: "LEADERBOARD_ERROR", message: "Failed to fetch le...`
- [ ] L56 `500` `json({ success: false, error: { type: "RANK_LADDER_ERROR", message: "Failed to fetch ra...`
- [ ] L81 `500` `json({ success: false, error: { type: "STATS_ERROR", message: "Failed to fetch leaderbo...`
- [ ] L102 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L123 `404` `json({ success: false, error: { type: "RANKING_NOT_FOUND", message: "You haven't played...`
- [ ] L133 `500` `json({ success: false, error: { type: "RANKING_ERROR", message: "Failed to fetch user r...`
- [ ] L154 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L172 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Invalid seasons par...`
- [ ] L191 `500` `json({ success: false, error: { type: "HISTORY_ERROR", message: "Failed to fetch rank h...`
- [ ] L212 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L241 `404` `json({ success: false, error: { type: "USER_NOT_RANKED", message: "You don't have a ran...`
- [ ] L252 `500` `json({ success: false, error: { type: "CONTEXTUAL_LEADERBOARD_ERROR", message: "Failed ...`
- [ ] L271 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "User identifier req...`
- [ ] L316 `404` `json({ success: false, error: { type: "USER_NOT_FOUND", message: "User not found or no ...`
- [ ] L326 `500` `json({ success: false, error: { type: "PUBLIC_RANKING_ERROR", message: "Failed to fetch...`
- [ ] L347 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L370 `500` `json({ success: false, error: { type: "INITIALIZATION_ERROR", message: "Failed to initi...`

### src/api/controllers/mail.controller.ts (42)

- [ ] L12 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L54 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Invalid sort field"...`
- [ ] L66 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Invalid sort order"...`
- [ ] L96 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to fetch mail", su...`
- [ ] L114 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L127 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Mail ID is required...`
- [ ] L146 `statusCode` `json({ success: false, error: { type: "MAIL_ERROR", message: result.error, suggestion: ...`
- [ ] L159 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to fetch mail", su...`
- [ ] L177 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L190 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Mail ID is required...`
- [ ] L209 `statusCode` `json({ success: false, error: { type: "MAIL_ERROR", message: result.error, suggestion: ...`
- [ ] L222 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to delete mail", s...`
- [ ] L244 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L257 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: result.error, suggestion: ...`
- [ ] L270 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to delete mail", s...`
- [ ] L288 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L301 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Mail ID is required...`
- [ ] L314 `400` `json({ success: false, error: { type: "MAIL_ERROR", message: result.error, suggestion: ...`
- [ ] L327 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to mark mail as re...`
- [ ] L348 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L361 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Mail IDs must be an...`
- [ ] L372 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Too many mail IDs",...`
- [ ] L387 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to mark mail as re...`
- [ ] L408 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L423 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to mark all mail a...`
- [ ] L444 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L457 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Mail ID is required...`
- [ ] L478 `statusCode` `json({ success: false, error: { type: "CLAIM_ERROR", message: result.error, suggestion:...`
- [ ] L491 `500` `json({ success: false, error: { type: "CLAIM_ERROR", message: "Failed to claim rewards"...`
- [ ] L512 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L527 `500` `json({ success: false, error: { type: "CLAIM_ERROR", message: "Failed to claim all rewa...`
- [ ] L548 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L563 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to fetch mail stat...`
- [ ] L584 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L604 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to fetch recent ma...`
- [ ] L625 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L640 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to fetch mail coun...`
- [ ] L662 `401` `json({ success: false, error: { type: "AUTH_ERROR", message: "Authentication required",...`
- [ ] L674 `403` `json({ success: false, error: { type: "AUTHORIZATION_ERROR", message: "Admin access req...`
- [ ] L687 `400` `json({ success: false, error: { type: "VALIDATION_ERROR", message: "Target user ID, sub...`
- [ ] L706 `400` `json({ success: false, error: { type: "MAIL_ERROR", message: result.error, suggestion: ...`
- [ ] L719 `500` `json({ success: false, error: { type: "MAIL_ERROR", message: "Failed to send notificati...`

### src/api/controllers/maintenance.controller.ts (14)

- [ ] L61 `500` `json({ message: "Failed to list maintenance windows" })`
- [ ] L77 `400` `json({ message: startErr })`
- [ ] L79 `400` `json({ message: endErr })`
- [ ] L82 `400` `json({ message: "ends_at must be after starts_at" })`
- [ ] L88 `400` `json({ message: "message must be a string" })`
- [ ] L105 `500` `json({ message: "Failed to create maintenance window" })`
- [ ] L117 `400` `json({ message: startErr })`
- [ ] L119 `400` `json({ message: endErr })`
- [ ] L128 `404` `json({ message: "Maintenance window not found" })`
- [ ] L137 `500` `json({ message: "Failed to update maintenance window" })`
- [ ] L150 `404` `json({ message: "Maintenance window not found" })`
- [ ] L159 `500` `json({ message: "Failed to end maintenance window" })`
- [ ] L171 `404` `json({ message: "Maintenance window not found" })`
- [ ] L180 `500` `json({ message: "Failed to delete maintenance window" })`

### src/api/controllers/matchmaking.controller.ts (14)

- [ ] L90 `409` `json({ error: { message: "You have a pending challenge. Cancel it before starting anoth...`
- [ ] L99 `400` `json({ error: { message: "deckId is required to join matchmaking." }, })`
- [ ] L106 `429` `json({ error: { message: "Matchmaking request already in progress. Please wait." }, })`
- [ ] L119 `400` `json({ error: { message: "Selected deck could not be found." }, })`
- [ ] L132 `400` `json({ error: { message }, })`
- [ ] L142 `400` `json({ error: { message: budgetError.message }, })`
- [ ] L192 `409` `json({ error: { message: "You already have an active game in progress.", code: "ACTIVE_...`
- [ ] L204 `409` `json({ error: { message: "You are already in the ranked queue.", code: "IN_OTHER_QUEUE"...`
- [ ] L266 `400` `json({ error: { message: "Already in queue or an active match." }, })`
- [ ] L279 `500` `json({ error: { message: "Error processing matchmaking queue." }, })`
- [ ] L307 `400` `json({ error: { message: createError.message }, })`
- [ ] L424 `500` `json({ error: { message: "Error retrieving queue status." }, })`
- [ ] L473 `400` `json({ error: { message: "Already matched with an opponent. Cannot leave queue.", }, })`
- [ ] L480 `400` `json({ error: { message: "You are not in the matchmaking queue." }, })`

### src/api/controllers/onboarding.controller.ts (2)

- [ ] L17 `401` `json({ message: "Unauthorized" })`
- [ ] L32 `500` `json({ message: "Failed to fetch onboarding status" })`

### src/api/controllers/pack.controller.ts (21)

- [ ] L26 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L48 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L61 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L74 `400` `json({ status: "error", message: "Pack name and slug are required", })`
- [ ] L82 `409` `json({ status: "error", message: 'A pack with slug "${slug}" already exists', })`
- [ ] L101 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L120 `404` `json({ status: "error", message: "Pack not found" })`
- [ ] L128 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L145 `400` `json({ status: "error", message: "card_variant_ids must be an array", })`
- [ ] L153 `404` `json({ status: "error", message: "Pack not found" })`
- [ ] L165 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L177 `404` `json({ status: "error", message: "Pack not found" })`
- [ ] L184 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L200 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L217 `401` `json({ status: "error", message: "User not authenticated", })`
- [ ] L229 `400` `json({ status: "error", message: "Pack ID is required", })`
- [ ] L243 `400` `json({ status: "error", message: result.message || "Not enough resources to purchase pa...`
- [ ] L258 `400` `json({ status: "error", message: error.message, })`
- [ ] L263 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L275 `401` `json({ status: "error", message: "User not authenticated", })`
- [ ] L288 `500` `json({ status: "error", message: "Internal server error", })`

### src/api/controllers/powerUp.controller.ts (11)

- [ ] L22 `400` `json({ status: "error", message: "cardId parameter is required", })`
- [ ] L54 `401` `json({ success: false, error: { message: "User not authenticated." }, })`
- [ ] L66 `400` `json({ success: false, error: { message: "user_card_instance_id is required" }, })`
- [ ] L74 `400` `json({ success: false, error: { message: "power_up_data is required" }, })`
- [ ] L89 `400` `json({ success: false, error: { message: "power_up_data must contain numeric values for...`
- [ ] L129 `statusCode` `json({ success: false, error: { message: result.message }, details: result.error, })`
- [ ] L155 `401` `json({ success: false, error: { message: "User not authenticated." }, })`
- [ ] L165 `400` `json({ success: false, error: { message: "userCardInstanceId parameter is required" }, })`
- [ ] L179 `404` `json({ success: false, error: { message: "Card not found or not owned by user" }, })`
- [ ] L234 `401` `json({ success: false, error: { message: "User not authenticated." }, })`
- [ ] L244 `400` `json({ success: false, error: { message: "userCardInstanceId parameter is required" }, })`

### src/api/controllers/promoCode.controller.ts (25)

- [ ] L31 `401` `json({ message: "Unauthorized" })`
- [ ] L36 `400` `json({ message: "A promo code is required." })`
- [ ] L42 `STATUS_BY_REASON[result.reason]` `json({ message: result.message, reason: result.reason, })`
- [ ] L55 `500` `json({ message: "Failed to redeem promo code" })`
- [ ] L63 `401` `json({ message: "Unauthorized" })`
- [ ] L68 `400` `json({ message: "A promo code is required." })`
- [ ] L73 `404` `json({ message: result.message, reason: result.reason })`
- [ ] L85 `500` `json({ message: "Failed to look up promo code" })`
- [ ] L105 `500` `json({ message: "Failed to list promo codes" })`
- [ ] L113 `404` `json({ message: "Promo code not found" })`
- [ ] L122 `500` `json({ message: "Failed to fetch promo code" })`
- [ ] L132 `400` `json({ message: "'code' is required." })`
- [ ] L139 `400` `json({ message: "'max_claims' must be a positive integer or null." })`
- [ ] L146 `400` `json({ message: "Invalid rewards.", errors: rewardErrors })`
- [ ] L164 `409` `json({ message: "A promo code with that code already exists." })`
- [ ] L173 `500` `json({ message: "Failed to create promo code" })`
- [ ] L184 `400` `json({ message: "Invalid rewards.", errors: rewardErrors })`
- [ ] L194 `400` `json({ message: "'max_claims' must be a positive integer or null." })`
- [ ] L201 `404` `json({ message: "Promo code not found" })`
- [ ] L206 `409` `json({ message: "A promo code with that code already exists." })`
- [ ] L212 `409` `json({ message: "'max_claims' cannot be lower than the number of claims already made.", })`
- [ ] L222 `500` `json({ message: "Failed to update promo code" })`
- [ ] L230 `404` `json({ message: "Promo code not found" })`
- [ ] L239 `500` `json({ message: "Failed to delete promo code" })`
- [ ] L259 `500` `json({ message: "Failed to list redemptions" })`

### src/api/controllers/rankedDraft.controller.ts (11)

- [ ] L39 `404` `json({ error: { message: "Not found." } })`
- [ ] L53 `409` `json({ error: { message: "You are already in the unranked queue.", code: "IN_OTHER_QUEU...`
- [ ] L64 `409` `json({ error: { message: "You already have a draft in progress.", code: "DRAFT_IN_PROGR...`
- [ ] L90 `409` `json({ error: { message: "You already have a ranked game in progress.", code: "ACTIVE_G...`
- [ ] L104 `429` `json({ error: { message: 'You have used all ${usage.limit} ranked battles for today. Mo...`
- [ ] L144 `left ? 200 : 400` `json( left ? { status: "left_queue" } : { error: { message: "You are not in the ranked ...`
- [ ] L171 `409` `json({ error: { message: "Keep waiting a little longer for an opponent.", code: "BOT_OF...`
- [ ] L187 `400` `json({ error: { message: "You are not in the ranked queue.", code: "NOT_QUEUED", }, })`
- [ ] L273 `404` `json({ error: { message: "No active draft." } })`
- [ ] L290 `404` `json({ error: { message: "No active draft." } })`
- [ ] L321 `400` `json({ error: { message: "cardVariantId is required." } })`

### src/api/controllers/saga.controller.ts (47)

- [ ] L45 `err.statusCode` `json({ status: "error", message: err.message })`
- [ ] L57 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L72 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L89 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L97 `400` `json({ status: "error", message: "bench_saga_card_id and deck_saga_card_id are required...`
- [ ] L119 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L123 `409` `json({ status: "error", message: QUEUE_CONFLICT_MESSAGE, code: QUEUE_CONFLICT_CODE, })`
- [ ] L133 `400` `json({ status: "error", message: "season_id is required" })`
- [ ] L216 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L231 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L248 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L262 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L277 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L295 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L309 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L324 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L338 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L356 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L370 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L388 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L406 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L421 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L426 `400` `json({ status: "error", message: "season_id is required" })`
- [ ] L440 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L457 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L462 `400` `json({ status: "error", message: "base_card_id is required" })`
- [ ] L480 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L497 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L502 `400` `json({ status: "error", message: "base_card_id is required" })`
- [ ] L520 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L535 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L549 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L554 `400` `json({ status: "error", message: "node_id is required" })`
- [ ] L572 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L576 `409` `json({ status: "error", message: QUEUE_CONFLICT_MESSAGE, code: QUEUE_CONFLICT_CODE, })`
- [ ] L586 `400` `json({ status: "error", message: "node_id is required" })`
- [ ] L605 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L620 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L628 `400` `json({ status: "error", message: "season_id and item_id are required", })`
- [ ] L645 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L650 `400` `json({ status: "error", message: "season_id is required" })`
- [ ] L664 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L681 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L699 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L717 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L731 `401` `json({ status: "error", message: "Not authenticated" })`
- [ ] L736 `400` `json({ status: "error", message: "node_id is required" })`

### src/api/controllers/season.controller.ts (24)

- [ ] L16 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L30 `401` `json({ status: "error", message: "Authentication required", })`
- [ ] L40 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L54 `401` `json({ status: "error", message: "Authentication required", })`
- [ ] L62 `400` `json({ status: "error", message: "set_id is required", })`
- [ ] L87 `statusCode` `json({ status: "error", message: errorMessage, })`
- [ ] L94 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L110 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L126 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L140 `400` `json({ status: "error", message: "set_id query parameter is required", })`
- [ ] L163 `statusCode` `json({ status: "error", message, })`
- [ ] L170 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L192 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L206 `401` `json({ status: "error", message: "Authentication required", })`
- [ ] L216 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L230 `401` `json({ status: "error", message: "Authentication required", })`
- [ ] L240 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L256 `500` `json({ status: "error", message: "Internal server error" })`
- [ ] L271 `500` `json({ status: "error", message: "Internal server error" })`
- [ ] L287 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L302 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L318 `400` `json({ status: "error", message: "seasonId is required", })`
- [ ] L325 `400` `json({ status: "error", message: "start_at and end_at are required", })`
- [ ] L344 `statusCode` `json({ status: "error", message, })`

### src/api/controllers/set.controller.ts (18)

- [ ] L13 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L27 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L39 `400` `json({ status: "error", message: "Set ID is required", })`
- [ ] L48 `404` `json({ status: "error", message: "Set not found", })`
- [ ] L63 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L75 `400` `json({ status: "error", message: "Set name is required", })`
- [ ] L84 `400` `json({ status: "error", message: "A set with this name already exists", })`
- [ ] L104 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L117 `400` `json({ status: "error", message: "Set ID is required", })`
- [ ] L126 `404` `json({ status: "error", message: "Set not found", })`
- [ ] L135 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L148 `400` `json({ status: "error", message: "Set ID is required", })`
- [ ] L155 `400` `json({ status: "error", message: "is_released must be a boolean value", })`
- [ ] L164 `404` `json({ status: "error", message: "Set not found", })`
- [ ] L177 `500` `json({ status: "error", message: "Internal server error", })`
- [ ] L189 `400` `json({ status: "error", message: "Set ID is required", })`
- [ ] L198 `404` `json({ status: "error", message: "Set not found", })`
- [ ] L207 `500` `json({ status: "error", message: "Internal server error", })`

### src/api/controllers/tower.controller.ts (20)

- [ ] L30 `401` `json({ error: "User not authenticated", })`
- [ ] L44 `500` `json({ error: error instanceof Error ? error.message : "Failed to get tower progress", })`
- [ ] L63 `401` `json({ error: "User not authenticated", })`
- [ ] L78 `500` `json({ error: error instanceof Error ? error.message : "Failed to get tower floors", })`
- [ ] L97 `400` `json({ error: "Invalid floor number", })`
- [ ] L111 `500` `json({ error: error instanceof Error ? error.message : "Failed to get rewards preview", })`
- [ ] L132 `401` `json({ error: "User not authenticated", })`
- [ ] L139 `409` `json({ error: "You have a pending challenge. Cancel it before starting another game.", })`
- [ ] L147 `409` `json({ error: QUEUE_CONFLICT_MESSAGE, code: QUEUE_CONFLICT_CODE, })`
- [ ] L157 `400` `json({ error: "player_deck_id is required", })`
- [ ] L180 `400` `json({ error: error.message, modifier_violations: error.violations, })`
- [ ] L199 `400` `json({ error: error.message, })`
- [ ] L205 `500` `json({ error: error instanceof Error ? error.message : "Failed to start tower game", })`
- [ ] L226 `400` `json({ error: "Invalid floor number", })`
- [ ] L241 `404` `json({ error: "Floor not found", })`
- [ ] L259 `500` `json({ error: error instanceof Error ? error.message : "Failed to get tower floor", })`
- [ ] L281 `500` `json({ error: error instanceof Error ? error.message : "Failed to get tower leaderboard...`
- [ ] L303 `401` `json({ error: "User not authenticated", })`
- [ ] L312 `400` `json({ error: "floor_number and game_id are required", })`
- [ ] L333 `500` `json({ error: error instanceof Error ? error.message : "Failed to process tower complet...`

### src/api/controllers/user.controller.ts (33)

- [ ] L81 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L103 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L120 `error.status` `json({ error: { message: error.message } })`
- [ ] L141 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L151 `404` `json({ error: { message: "User not found." } })`
- [ ] L187 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L221 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L252 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L283 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L292 `404` `json({ error: { message: "Deck not found or not owned by user." }, })`
- [ ] L325 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L346 `500` `json({ error: { message: "Failed to fetch active games", details: error instanceof Erro...`
- [ ] L369 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L397 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L408 `400` `json({ error: { message: error.message }, })`
- [ ] L431 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L444 `400` `json({ error: { message: "At least one field (username, email, or password) must be pro...`
- [ ] L455 `400` `json({ error: { message: "New password must be at least 6 characters long.", }, })`
- [ ] L466 `400` `json({ error: { message: 'Username must be ${USER_LIMITS.MAX_USERNAME_LENGTH} character...`
- [ ] L485 `400` `json({ error: { message: "That username isn't available. Please choose a different one....`
- [ ] L501 `409` `json({ error: { message: "Username already taken.", code: "USERNAME_ALREADY_EXISTS", }, })`
- [ ] L516 `400` `json({ error: { message: "Invalid email format.", }, })`
- [ ] L529 `409` `json({ error: { message: "Email already in use.", code: "EMAIL_ALREADY_EXISTS", }, })`
- [ ] L559 `500` `json({ error: { message: "Failed to update account details.", }, })`
- [ ] L598 `401` `json({ status: "error", message: "User not authenticated.", timestamp: new Date().toISO...`
- [ ] L614 `403` `json({ status: "error", message: "You can only reset your own account.", timestamp: new...`
- [ ] L629 `404` `json({ status: "error", message: "User not found", timestamp: new Date().toISOString(), })`
- [ ] L793 `500` `json({ status: "error", message: "Internal server error during account reset", error: e...`
- [ ] L814 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L820 `400` `json({ error: { message: 'tutorial_id must be one of: ${validIds.join(", ")}', }, })`
- [ ] L850 `401` `json({ error: { message: "User not authenticated." } })`
- [ ] L885 `401` `json({ error: { message: "User not authenticated." }, })`
- [ ] L1014 `500` `json({ error: { message: "Failed to delete account.", details: error instanceof Error ?...`

### src/api/controllers/userCard.controller.ts (18)

- [ ] L17 `401` `json({ message: "Unauthorized" })`
- [ ] L62 `500` `json({ message: "Failed to fetch user cards" })`
- [ ] L73 `401` `json({ message: "Unauthorized" })`
- [ ] L80 `400` `json({ message: "userCardInstanceId is required" })`
- [ ] L84 `400` `json({ message: "is_locked is required and must be a boolean", })`
- [ ] L96 `404` `json({ message: "Card not found or does not belong to user", })`
- [ ] L109 `500` `json({ message: "Failed to update card lock state" })`
- [ ] L128 `401` `json({ message: "Unauthorized" })`
- [ ] L135 `400` `json({ message: "userCardInstanceId is required" })`
- [ ] L138 `400` `json({ message: "border_id is required and must be a string or null", })`
- [ ] L155 `status` `json({ message: result.error })`
- [ ] L168 `500` `json({ message: "Failed to set card border" })`
- [ ] L187 `401` `json({ message: "Unauthorized" })`
- [ ] L192 `400` `json({ message: "border_id is required and must be a string" })`
- [ ] L199 `400` `json({ message: result.error })`
- [ ] L212 `500` `json({ message: "Failed to equip border" })`
- [ ] L228 `401` `json({ message: "Unauthorized" })`
- [ ] L238 `500` `json({ message: "Failed to unequip borders" })`

### src/api/controllers/xp.controller.ts (25)

- [ ] L11 `401` `json({ error: "User not authenticated" })`
- [ ] L18 `500` `json({ error: "Failed to fetch XP pools" })`
- [ ] L28 `401` `json({ error: "User not authenticated" })`
- [ ] L33 `404` `json({ error: "XP pool not found" })`
- [ ] L39 `500` `json({ error: "Failed to fetch XP pool" })`
- [ ] L49 `401` `json({ error: "User not authenticated" })`
- [ ] L54 `400` `json({ error: "Missing required fields: source_card_id, target_card_id", })`
- [ ] L61 `400` `json({ error: "Cannot transfer XP to the same card", })`
- [ ] L78 `400` `json({ error: result.message })`
- [ ] L82 `500` `json({ error: "Failed to transfer XP" })`
- [ ] L92 `401` `json({ error: "User not authenticated" })`
- [ ] L96 `400` `json({ error: "Missing or invalid card_ids array", })`
- [ ] L115 `400` `json({ error: 'Cannot sacrifice cards that are part of one of your decks (${deckNames})...`
- [ ] L128 `400` `json({ error: result.message })`
- [ ] L132 `500` `json({ error: "Failed to sacrifice cards" })`
- [ ] L141 `401` `json({ error: "User not authenticated" })`
- [ ] L152 `400` `json({ error: result.message })`
- [ ] L156 `500` `json({ error: "Failed to sacrifice extra cards" })`
- [ ] L166 `401` `json({ error: "User not authenticated" })`
- [ ] L175 `400` `json({ error: "Missing or invalid target_card_id or xp_amount (must be positive integer...`
- [ ] L193 `400` `json({ error: result.message })`
- [ ] L197 `500` `json({ error: "Failed to apply XP" })`
- [ ] L208 `401` `json({ error: "User not authenticated" })`
- [ ] L223 `500` `json({ error: "Failed to fetch XP transfer history" })`
- [ ] L250 `500` `json({ error: "Failed to fetch level configuration" })`

### src/api/middlewares/adminAuth.middleware.ts (2)

- [ ] L16 `401` `json({ error: { message: "Authentication required.", statusCode: 401, }, })`
- [ ] L32 `403` `json({ error: { message: "Admin access required.", statusCode: 403, }, })`

### src/api/middlewares/auth.middleware.ts (5)

- [ ] L24 `401` `json({ error: { message: "Authentication failed. Token not provided.", statusCode: 401,...`
- [ ] L37 `401` `json({ error: { message: "Authentication failed. Token not provided.", statusCode: 401,...`
- [ ] L51 `401` `json({ error: { message: "Authentication failed. Invalid or expired token.", statusCode...`
- [ ] L65 `401` `json({ error: { message: "Authentication failed. User not found.", statusCode: 401, }, })`
- [ ] L79 `403` `json({ error: { // 'code' lets the client show a real "account suspended" screen // ins...`

### src/api/middlewares/maintenance.middleware.ts (1)

- [ ] L40 `MAINTENANCE_STATUS` `json({ error: status.message ?? "The servers are down for maintenance. Please try again...`

### src/api/middlewares/refreshAuth.middleware.ts (2)

- [ ] L23 `400` `json({ error: { message: "Refresh token is required.", statusCode: 400, }, })`
- [ ] L36 `401` `json({ error: { message: "Invalid or expired refresh token.", statusCode: 401, }, })`

### src/api/routes/health.routes.ts (2)

- [ ] L47 `503` `json({ status: "not ready", message: "Database tables not properly initialized", timest...`
- [ ] L54 `503` `json({ status: "not ready", message: "Database not accessible", error: error instanceof...`

### src/api/routes/iap.routes.ts (7)

- [ ] L18 `400` sendStatus
- [ ] L32 `400` sendStatus
- [ ] L37 `404` sendStatus
- [ ] L49 `400` sendStatus
- [ ] L56 `404` sendStatus
- [ ] L61 `400` sendStatus
- [ ] L66 `404` sendStatus

### src/api/routes/index.ts (1)

- [ ] L97 `404` `json({ status: "error", message: "Endpoint not found", })`

### src/app.ts (5)

- [ ] L188 `500` `send("Error loading page")`
- [ ] L233 `500` `send("Error loading privacy policy")`
- [ ] L245 `500` `send("Error loading terms of service")`
- [ ] L257 `500` `send("Error loading delete account instructions")`
- [ ] L266 `404` `json({ error: { message: "Resource not found on this server." } })`

