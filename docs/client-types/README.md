# Achievement API Client Documentation

This directory contains TypeScript types and example implementations for integrating with the Achievement API.

## Files

- **`achievement.types.ts`** - Complete TypeScript interfaces and types
- **`achievement.api.example.ts`** - Example API client implementation with usage examples

## Quick Start

### 1. Copy the Types to Your Project

```bash
# Copy the types file to your client project
cp achievement.types.ts /path/to/your/client/src/types/
```

### 2. Import and Use

```typescript
import {
  UserAchievementWithDetails,
  GetUserAchievementsResponse,
  ClaimAchievementResponse,
} from "./types/achievement.types";
```

## Common Use Cases

### Display All User Achievements

```typescript
// GET /api/achievements/me/progress
const response: GetUserAchievementsResponse = await fetch(
  "/api/achievements/me/progress",
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
).then((r) => r.json());

// Access achievements and stats
const achievements = response.achievements; // UserAchievementWithDetails[]
const stats = response.stats; // AchievementStats
```

### Filter Achievements

```typescript
// Get only unclaimed achievements
const unclaimed = await fetch("/api/achievements/me/progress?unclaimed=true", {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

// Get gameplay achievements only
const gameplay = await fetch(
  "/api/achievements/me/progress?category=gameplay",
  {
    headers: { Authorization: `Bearer ${token}` },
  }
).then((r) => r.json());
```

### Claim Achievement Rewards

```typescript
// POST /api/achievements/:achievementId/claim
const result: ClaimAchievementResponse = await fetch(
  `/api/achievements/${achievementId}/claim`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
).then((r) => r.json());

// Update your UI with the new currency values
const newGems = result.updatedCurrencies.gems;
const newPacks = result.updatedCurrencies.pack_count;
```

### Display Achievement Progress

```typescript
function AchievementCard({
  achievement,
}: {
  achievement: UserAchievementWithDetails;
}) {
  const {
    achievement: details,
    current_progress,
    progress_percentage,
    can_claim,
  } = achievement;

  return (
    <div>
      <h3>{details.title}</h3>
      <p>{details.description}</p>
      <div>
        Progress: {current_progress} / {details.target_value} (
        {progress_percentage}%)
      </div>
      {can_claim && <button>Claim Rewards</button>}
      <div>
        Rewards: {details.reward_gems} gems, {details.reward_packs} packs
      </div>
    </div>
  );
}
```

## Key Data Structures

### UserAchievementWithDetails

This is the most important type - it contains everything you need to display an achievement:

```typescript
interface UserAchievementWithDetails {
  // User progress
  current_progress: number;
  is_completed: boolean;
  is_claimed: boolean;
  can_claim: boolean; // true if completed but not claimed
  progress_percentage: number; // 0-100

  // Achievement details
  achievement: {
    title: string;
    description: string;
    category: string;
    rarity: string;
    target_value: number;
    reward_gems: number;
    reward_packs: number;
    // ... more fields
  };
}
```

### Achievement States

An achievement can be in one of these states:

1. **Locked** - Not unlocked yet (for tiered achievements)

   - `is_unlocked: false`

2. **Available** - Unlocked but no progress

   - `is_unlocked: true`
   - `current_progress: 0`
   - `is_completed: false`

3. **In Progress** - User has made progress

   - `current_progress > 0`
   - `is_completed: false`

4. **Completed (Claimable)** - Ready to claim rewards

   - `is_completed: true`
   - `is_claimed: false`
   - `can_claim: true`

5. **Claimed** - Rewards collected
   - `is_completed: true`
   - `is_claimed: true`
   - `can_claim: false`

## API Endpoints Reference

| Endpoint                        | Method | Auth | Description                         |
| ------------------------------- | ------ | ---- | ----------------------------------- |
| `/api/achievements`             | GET    | No   | Get all achievements (public)       |
| `/api/achievements/me/progress` | GET    | Yes  | Get user's achievement progress     |
| `/api/achievements/me/stats`    | GET    | Yes  | Get user's achievement statistics   |
| `/api/achievements/me/recent`   | GET    | Yes  | Get recently completed achievements |
| `/api/achievements/categories`  | GET    | No   | Get achievement categories          |
| `/api/achievements/:key`        | GET    | No   | Get specific achievement details    |
| `/api/achievements/:id/claim`   | POST   | Yes  | Claim achievement rewards           |

## Query Parameters

### `/api/achievements/me/progress`

- `category` - Filter by category ("gameplay", "collection", "social", "progression", "special", "story_mode")
- `completed` - Show only completed achievements (true/false)
- `unclaimed` - Show only unclaimed achievements (true/false)
- `include_locked` - Include locked tier achievements (true/false)

### `/api/achievements/me/recent`

- `limit` - Number of achievements to return (default: 10, max: 50)

### `/api/achievements`

- `include_inactive` - Include inactive achievements (true/false)

## Achievement Categories

- **gameplay** - Game-related achievements (wins, streaks, etc.)
- **collection** - Card collection achievements
- **social** - Friend-related achievements
- **progression** - XP and leveling achievements
- **special** - Limited-time or special event achievements
- **story_mode** - Story mode specific achievements

## Achievement Rarities

- `common`
- `uncommon`
- `rare`
- `epic`
- `legendary`
- `mythic`

## Tiered Achievements

Some achievements have multiple tiers (e.g., "Win 10 games" → "Win 50 games" → "Win 100 games").

Tiered achievements have:

- `base_achievement_key` - The base identifier (e.g., "pvp_wins")
- `tier_level` - The tier number (1, 2, 3, etc.)
- `is_unlocked` - Whether this tier is unlocked (higher tiers unlock after completing lower ones)

By default, locked tiers are hidden. Use `include_locked=true` to see all tiers.

## Error Handling

All endpoints return standard error responses:

```typescript
interface AchievementErrorResponse {
  success: false;
  error: {
    type: string; // e.g., "AUTH_ERROR", "VALIDATION_ERROR"
    message: string; // Human-readable error message
    suggestion: string; // Suggestion for fixing the error
  };
}
```

Common error types:

- `AUTH_ERROR` - Authentication required or invalid token
- `VALIDATION_ERROR` - Invalid parameters
- `NOT_FOUND_ERROR` - Achievement not found
- `CLAIM_ERROR` - Cannot claim achievement (already claimed or not completed)

## Best Practices

### 1. Load on App Start

```typescript
// Load user achievements when app initializes
await loadUserAchievements();
```

### 2. Show Notifications for Claimable Achievements

```typescript
// Check for claimable achievements and show badge
const claimable = achievements.filter((a) => a.can_claim);
if (claimable.length > 0) {
  showNotificationBadge(claimable.length);
}
```

### 3. Refresh After Key Actions

```typescript
// Refresh achievements after:
// - Completing a game
// - Opening packs
// - Leveling up cards
await refreshAchievements();
```

### 4. Cache Achievement Data

```typescript
// Cache the full achievement list (it doesn't change often)
const allAchievements = await getAllAchievements();
localStorage.setItem("achievements_cache", JSON.stringify(allAchievements));
```

### 5. Optimistic UI Updates

```typescript
// Show claim animation immediately, then update from server
async function claimAchievement(id: string) {
  // Optimistically update UI
  updateUIAsClaimed(id);

  try {
    const result = await claimAchievementAPI(id);
    // Update currencies
    updateCurrencies(result.updatedCurrencies);
  } catch (error) {
    // Revert UI if claim failed
    revertUIUpdate(id);
  }
}
```

## Framework-Specific Examples

### React

```typescript
import { useEffect, useState } from "react";
import { UserAchievementWithDetails } from "./types/achievement.types";

function AchievementsScreen() {
  const [achievements, setAchievements] = useState<
    UserAchievementWithDetails[]
  >([]);

  useEffect(() => {
    loadAchievements();
  }, []);

  async function loadAchievements() {
    const response = await fetch("/api/achievements/me/progress", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    setAchievements(data.achievements);
  }

  return (
    <div>
      {achievements.map((achievement) => (
        <AchievementCard key={achievement.id} achievement={achievement} />
      ))}
    </div>
  );
}
```

### Vue

```typescript
import { ref, onMounted } from "vue";
import type { UserAchievementWithDetails } from "./types/achievement.types";

export default {
  setup() {
    const achievements = ref<UserAchievementWithDetails[]>([]);

    onMounted(async () => {
      const response = await fetch("/api/achievements/me/progress", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      achievements.value = data.achievements;
    });

    return { achievements };
  },
};
```

### Angular

```typescript
import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { GetUserAchievementsResponse } from "./types/achievement.types";

@Injectable({ providedIn: "root" })
export class AchievementService {
  constructor(private http: HttpClient) {}

  getUserAchievements(): Observable<GetUserAchievementsResponse> {
    return this.http.get<GetUserAchievementsResponse>(
      "/api/achievements/me/progress"
    );
  }
}
```

## Support

For questions or issues with the Achievement API:

1. Check the OpenAPI documentation in `/docs/openapi/achievement.openapi.yaml`
2. Review the server-side types in `/src/types/database.types.ts`
3. Contact the backend team

## Version

Last Updated: December 2025
API Version: 1.0.0
