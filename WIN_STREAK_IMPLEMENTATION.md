# Win Streak Bonus Implementation

## Overview
Implemented a win-streak bonus system for online (PvP) games that rewards players with increasing multipliers for consecutive victories.

## System Rules
- **Starting Multiplier**: 1.0x for all players
- **Increment**: +0.1x for each consecutive PvP win
- **Maximum**: 5.0x (capped)
- **Reset Condition**: Any PvP loss resets multiplier to 1.0x
- **Game Mode**: Only applies to PvP (online) games, NOT solo games
- **Reward Application**: Applied to victory and draw rewards, NOT loss rewards

## Implementation Details

### 1. Database Schema Changes
- **Migration**: `1762900000000_add-win-streak-multiplier.js`
- **New Field**: `win_streak_multiplier` (decimal(3,1), default 1.0)
- **Location**: `users` table

### 2. Model Updates
- **File**: `src/models/user.model.ts`
- **New Methods**:
  - `getWinStreakMultiplier(userId)`: Get current multiplier
  - `incrementWinStreakMultiplier(userId)`: Increase by 0.1 (max 5.0)
  - `resetWinStreakMultiplier(userId)`: Reset to 1.0
- **Updated Methods**: All user update queries now include `win_streak_multiplier`

### 3. Type Definitions
- **File**: `src/types/database.types.ts`
- **Updated Interface**: `User` interface now includes `win_streak_multiplier: number`

### 4. Game Rewards Service
- **File**: `src/services/gameRewards.service.ts`
- **Updated Method**: `calculateCurrencyRewards()` now accepts `winStreakMultiplier` parameter
- **Logic**: Multiplier applied to PvP victories and draws only
- **Integration**: `processGameCompletion()` handles win streak tracking automatically

### 5. API Response Updates
- **New Field**: `win_streak_info` in game completion responses
- **Contains**:
  - `multiplier_applied`: The multiplier used for this game's rewards
  - `new_multiplier`: The player's new multiplier after this game
- **Availability**: Only included for PvP games

### 6. OpenAPI Documentation
- **Files Updated**:
  - `docs/openapi/user.openapi.yaml`: Added `win_streak_multiplier` to UserProfile schema
  - `docs/openapi/game.openapi.yaml`: Added `GameCompletionResponse` schema with win streak info

## Reward Calculation Examples

### PvP Victory (2 minutes, 1.5x multiplier)
- Base reward: 10 gems + 3 quick bonus = 13 gems
- With multiplier: floor(13 × 1.5) = 19 gems

### PvP Victory (2 minutes, 5.0x multiplier - Max streak)
- Base reward: 10 gems + 3 quick bonus = 13 gems
- With multiplier: floor(13 × 5.0) = 65 gems

### PvP Draw (1.3x multiplier)
- Base reward: 3 gems
- With multiplier: floor(3 × 1.3) = 3 gems

### PvP Loss (Any multiplier)
- Base reward: 2 gems
- Multiplier: NOT applied = 2 gems
- Streak: Reset to 1.0x

### Solo Victory (Any multiplier)
- Base reward: 5-7 gems (depending on duration)
- Multiplier: NOT applied
- Streak: Unchanged

## Win Streak Progression
```
Game 1 (Win):  1.0x → 1.1x
Game 2 (Win):  1.1x → 1.2x
Game 3 (Win):  1.2x → 1.3x
...
Game 40 (Win): 4.9x → 5.0x (capped)
Game 41 (Win): 5.0x → 5.0x (stays at max)
Game 42 (Loss): 5.0x → 1.0x (reset)
```

## Testing
- **Demo Script**: `scripts/demo-win-streak-bonus.js`
- **Test Suite**: `tests/win-streak-bonus.test.js` (requires Jest setup)
- **Manual Testing**: `scripts/test-win-streak-bonus.js`

## Files Modified
1. `migrations/1762900000000_add-win-streak-multiplier.js` (new)
2. `src/types/database.types.ts`
3. `src/models/user.model.ts`
4. `src/services/gameRewards.service.ts`
5. `docs/openapi/user.openapi.yaml`
6. `docs/openapi/game.openapi.yaml`
7. `scripts/demo-win-streak-bonus.js` (new)
8. `tests/win-streak-bonus.test.js` (new)
9. `scripts/test-win-streak-bonus.js` (new)

## Deployment Notes
1. Run migration: `npm run migrate:up`
2. All existing users will start with 1.0x multiplier
3. System is backward compatible
4. No client-side changes required (bonus is server-side only)

## Future Enhancements
- Achievement integration for win streaks
- Leaderboard display of current win streaks
- Win streak notifications to players
- Seasonal win streak resets
- Different multiplier rates for different game modes


