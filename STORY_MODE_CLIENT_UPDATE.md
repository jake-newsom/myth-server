# Story Mode Game Completion - Client Update Guide

## Overview

Story mode completion is now automatically integrated into the game completion response. **You no longer need to make a separate POST request to `/api/story-modes/complete`** for story mode games that complete through the normal game flow.

## Changes to Game Completion Response

When a story mode game completes, the game completion response (from `POST /api/games/:gameId/ai-action` or similar endpoints) now includes additional fields:

### New Response Structure

```typescript
{
  game_id: string;
  game_state: GameState;
  game_status: "completed";
  winner_id: string | null;
  events: BaseGameEvent[];
  
  // Existing game completion fields
  game_result: {
    winner: string | null;
    is_draw: boolean;
    game_duration_seconds: number;
    cards_played: number;
    // ... other game result fields
  };
  
  rewards: {
    currency: {
      gold: number;        // ⚠️ NOW INCLUDES STORY MODE REWARDS
      gems: number;         // ⚠️ NOW INCLUDES STORY MODE REWARDS
      fate_coins: number;   // ⚠️ NOW INCLUDES STORY MODE REWARDS
    };
    card_xp_rewards: XpReward[]; // Game rewards only (story mode doesn't add XP)
  };
  
  updated_currencies: {
    gold: number;
    gems: number;
    fate_coins: number;
    total_xp: number;
  };
  
  // ⭐ NEW: Story mode completion data (only present for story mode games)
  story_mode_completion?: {
    is_first_win: boolean;
    new_progress: {
      progress_id: string;
      user_id: string;
      story_id: string;
      times_completed: number;
      total_attempts: number;
      created_at: string;
      updated_at: string;
    };
    unlocked_stories: string[]; // Array of story_id values that were unlocked
    campaign_updated: true;     // Always true - flag to refresh campaign data
  };
}
```

## Key Changes

### 1. Merged Rewards
- **Story mode currency rewards are automatically merged** into `rewards.currency`
- The `gold`, `gems`, and `fate_coins` values now include both:
  - Base game rewards (from gameplay)
  - Story mode completion rewards (bonus rewards for completing the story)
- **No separate API call needed** - rewards are already included

### 2. Story Mode Completion Object
- **Only present for story mode games** (check if `story_mode_completion` exists)
- Contains:
  - `is_first_win`: Whether this was the player's first win on this story
  - `new_progress`: Updated progress tracking for this story
  - `unlocked_stories`: List of story IDs that became available after this completion
  - `campaign_updated`: Always `true` - indicates you should refresh campaign data

### 3. Campaign Refresh Flag
- When `story_mode_completion.campaign_updated === true`, you should:
  1. **Refresh the campaign/story mode list** by calling `GET /api/story-modes` (or your equivalent endpoint)
  2. **Update UI** to reflect:
     - New unlock states
     - Updated progress indicators
     - Newly available stories

## Migration Steps

### Before (Old Flow)
```typescript
// 1. Game completes
const gameResponse = await submitAIAction(gameId, action);

// 2. Check if story mode game
if (isStoryModeGame(gameId)) {
  // 3. Make separate call to process story completion
  const storyCompletion = await fetch('/api/story-modes/complete', {
    method: 'POST',
    body: JSON.stringify({
      story_id: storyId,
      game_result: gameResponse.game_result,
      completion_time_seconds: gameResponse.game_result.game_duration_seconds
    })
  });
  
  // 4. Handle story rewards separately
  handleStoryRewards(storyCompletion.rewards_earned);
  
  // 5. Refresh campaign if needed
  if (storyCompletion.unlocked_stories.length > 0) {
    refreshCampaign();
  }
}
```

### After (New Flow)
```typescript
// 1. Game completes
const gameResponse = await submitAIAction(gameId, action);

// 2. Check if story mode completion data exists
if (gameResponse.story_mode_completion) {
  // 3. Story rewards are already merged into gameResponse.rewards.currency
  // No separate API call needed!
  
  // 4. Handle story mode completion UI
  showStoryCompletionModal({
    isFirstWin: gameResponse.story_mode_completion.is_first_win,
    rewards: gameResponse.rewards, // Already includes story rewards
    unlockedStories: gameResponse.story_mode_completion.unlocked_stories
  });
  
  // 5. Refresh campaign data
  if (gameResponse.story_mode_completion.campaign_updated) {
    await refreshCampaign();
  }
}
```

## TypeScript Type Definitions

Add these types to your client codebase:

```typescript
interface StoryModeCompletion {
  is_first_win: boolean;
  new_progress: {
    progress_id: string;
    user_id: string;
    story_id: string;
    times_completed: number;
    total_attempts: number;
    created_at: string;
    updated_at: string;
  };
  unlocked_stories: string[];
  campaign_updated: true;
}

interface GameCompletionResponse {
  // ... existing game completion fields ...
  story_mode_completion?: StoryModeCompletion;
}
```

## Important Notes

1. **Backward Compatibility**: The `/api/story-modes/complete` endpoint still exists but is no longer needed for story mode games that complete through normal gameplay.

2. **Non-Story Mode Games**: Regular solo/PvP games will NOT have `story_mode_completion` in the response - this field is optional and only present for story mode games.

3. **Reward Display**: When showing rewards to the player, you can display the merged `rewards.currency` values directly - they already include story mode bonuses.

4. **Campaign Refresh**: Always check `campaign_updated` and refresh campaign data when it's `true` to ensure UI stays in sync.

5. **Error Handling**: If story mode completion processing fails on the server, the game completion response will still succeed, but `story_mode_completion` will be absent. Handle this gracefully.

## Example: Complete Handler

```typescript
async function handleGameCompletion(gameResponse: GameCompletionResponse) {
  // Show game completion UI with rewards
  showRewardsModal({
    currency: gameResponse.rewards.currency,
    cardXp: gameResponse.rewards.card_xp_rewards
  });
  
  // Handle story mode completion if present
  if (gameResponse.story_mode_completion) {
    const { is_first_win, unlocked_stories, campaign_updated } = 
      gameResponse.story_mode_completion;
    
    // Show story-specific completion UI
    if (is_first_win) {
      showFirstWinCelebration();
    }
    
    // Show unlocked stories notification
    if (unlocked_stories.length > 0) {
      showUnlockedStoriesNotification(unlocked_stories);
    }
    
    // Refresh campaign data
    if (campaign_updated) {
      await refreshCampaignData();
    }
  }
}
```

## Questions?

If you need clarification on any of these changes, please reach out to the backend team.


