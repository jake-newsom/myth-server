# Achievement API Quick Reference

## 🎯 Most Important Endpoint

```typescript
GET / api / achievements / me / progress;
Authorization: Bearer<token>;
```

**Returns:** All achievements with user's progress, completion status, and stats

**Use this for:** Main achievements screen, displaying all user progress

---

## 📋 All Endpoints

### Public Endpoints (No Auth Required)

```bash
GET  /api/achievements                    # Get all achievements
GET  /api/achievements/categories         # Get categories list
GET  /api/achievements/:achievementKey    # Get achievement details
```

### Authenticated Endpoints

```bash
GET  /api/achievements/me/progress        # Get user progress (MAIN)
GET  /api/achievements/me/stats           # Get user statistics
GET  /api/achievements/me/recent          # Get recent completions
POST /api/achievements/:achievementId/claim  # Claim rewards
```

---

## 🔑 Key TypeScript Interfaces

### UserAchievementWithDetails (Main Type)

```typescript
{
  // Progress tracking
  current_progress: number;        // e.g., 5
  progress_percentage: number;     // e.g., 50.0 (means 50%)
  is_completed: boolean;
  is_claimed: boolean;
  can_claim: boolean;              // true = ready to claim
  is_unlocked: boolean;            // false = tier locked

  // Achievement info
  achievement: {
    id: string;
    achievement_key: string;
    title: string;
    description: string;
    category: string;              // "gameplay" | "collection" | ...
    rarity: string;                // "common" | "rare" | ...
    target_value: number;          // e.g., 10 (win 10 games)
    reward_gems: number;
    reward_packs: number;
    reward_fate_coins?: number;
    reward_card_fragments?: number;
    tier_level?: number;           // For tiered achievements
  }
}
```

---

## 🎨 Common UI Patterns

### Achievement Card Component

```typescript
function AchievementCard({ achievement }) {
  const { achievement: details, current_progress, can_claim } = achievement;

  return (
    <div className={`achievement ${can_claim ? "claimable" : ""}`}>
      <h3>{details.title}</h3>
      <p>{details.description}</p>

      {/* Progress Bar */}
      <ProgressBar
        current={current_progress}
        max={details.target_value}
        percentage={achievement.progress_percentage}
      />

      {/* Rewards */}
      <Rewards>
        {details.reward_gems > 0 && <Gem amount={details.reward_gems} />}
        {details.reward_packs > 0 && <Pack amount={details.reward_packs} />}
      </Rewards>

      {/* Claim Button */}
      {can_claim && (
        <button onClick={() => claimAchievement(achievement.achievement_id)}>
          Claim Rewards
        </button>
      )}
    </div>
  );
}
```

### Filter Achievements

```typescript
// By category
const gameplayAchievements = achievements.filter(
  (a) => a.achievement.category === "gameplay"
);

// Claimable only
const claimable = achievements.filter((a) => a.can_claim);

// In progress
const inProgress = achievements.filter(
  (a) => !a.is_completed && a.current_progress > 0
);

// Completed but not claimed
const needsClaim = achievements.filter((a) => a.is_completed && !a.is_claimed);
```

### Sort Achievements

```typescript
// By progress (show closest to completion first)
achievements.sort((a, b) => b.progress_percentage - a.progress_percentage);

// Claimable first, then by progress
achievements.sort((a, b) => {
  if (a.can_claim && !b.can_claim) return -1;
  if (!a.can_claim && b.can_claim) return 1;
  return b.progress_percentage - a.progress_percentage;
});

// By rarity
const rarityOrder = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};
achievements.sort(
  (a, b) =>
    rarityOrder[b.achievement.rarity] - rarityOrder[a.achievement.rarity]
);
```

---

## 💎 Claiming Rewards

### Single Achievement

```typescript
async function claimAchievement(achievementId: string) {
  const response = await fetch(`/api/achievements/${achievementId}/claim`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const result = await response.json();
  // result.totalRewards: { gems, fate_coins, packs, card_fragments }
  // result.updatedCurrencies: { gems, fate_coins, pack_count, ... }

  return result;
}
```

### Claim All Available

```typescript
async function claimAllAchievements(achievements) {
  const claimable = achievements.filter((a) => a.can_claim);

  for (const achievement of claimable) {
    await claimAchievement(achievement.achievement_id);
  }

  // Refresh achievements list
  await refreshAchievements();
}
```

---

## 🔔 Notification Badge

```typescript
// Count claimable achievements
function getClaimableBadgeCount(achievements) {
  return achievements.filter((a) => a.can_claim).length;
}

// Usage
const badgeCount = getClaimableBadgeCount(achievements);
if (badgeCount > 0) {
  showBadge(badgeCount); // Show "3" on achievements icon
}
```

---

## 📊 Statistics Display

```typescript
// Get stats from response
const { stats } = await fetch("/api/achievements/me/progress").then((r) =>
  r.json()
);

// Display overall progress
console.log(`${stats.completed_achievements} / ${stats.total_achievements}`);
console.log(`${stats.completion_percentage}% complete`);

// Display by category
Object.entries(stats.achievements_by_category).forEach(([category, data]) => {
  console.log(`${category}: ${data.completed} / ${data.total}`);
});
```

---

## 🎯 Query Parameters Cheat Sheet

```typescript
// Show only unclaimed
/api/achievements/me/progress?unclaimed=true

// Show only completed
/api/achievements/me/progress?completed=true

// Filter by category
/api/achievements/me/progress?category=gameplay
/api/achievements/me/progress?category=collection

// Include locked tiers
/api/achievements/me/progress?include_locked=true

// Combine filters
/api/achievements/me/progress?category=gameplay&completed=true

// Recent achievements with limit
/api/achievements/me/recent?limit=5
```

---

## ⚡ Performance Tips

### 1. Cache Full Achievement List

```typescript
// Get public achievement list once (rarely changes)
const allAchievements = await fetch("/api/achievements").then((r) => r.json());
localStorage.setItem("achievements_cache", JSON.stringify(allAchievements));
```

### 2. Only Fetch Progress When Needed

```typescript
// Don't fetch on every screen change
// Fetch on: login, after game completion, manual refresh
```

### 3. Use Query Parameters to Reduce Payload

```typescript
// Instead of fetching all and filtering client-side
// ❌ Bad
const all = await getAchievements();
const gameplay = all.filter((a) => a.achievement.category === "gameplay");

// ✅ Good
const gameplay = await getAchievements({ category: "gameplay" });
```

---

## 🎨 Color Coding by Rarity

```typescript
const rarityColors = {
  common: "#808080", // Gray
  uncommon: "#00ff00", // Green
  rare: "#0070dd", // Blue
  epic: "#a335ee", // Purple
  legendary: "#ff8000", // Orange
  mythic: "#e6cc80", // Gold
};

function getRarityColor(rarity: string) {
  return rarityColors[rarity] || "#ffffff";
}
```

---

## 🔍 Achievement States Helper

```typescript
function getAchievementState(achievement) {
  if (!achievement.is_unlocked) return "LOCKED";
  if (achievement.is_claimed) return "CLAIMED";
  if (achievement.can_claim) return "CLAIMABLE";
  if (achievement.current_progress > 0) return "IN_PROGRESS";
  return "NOT_STARTED";
}

// Usage
const state = getAchievementState(achievement);

switch (state) {
  case "LOCKED":
    // Show locked icon, gray out
    break;
  case "CLAIMABLE":
    // Highlight, show claim button, maybe animate
    break;
  case "IN_PROGRESS":
    // Show progress bar
    break;
  case "CLAIMED":
    // Show checkmark, muted colors
    break;
}
```

---

## 🚨 Error Handling

```typescript
async function safeClaimAchievement(achievementId: string) {
  try {
    const result = await claimAchievement(achievementId);
    showSuccessToast("Achievement claimed!");
    return result;
  } catch (error) {
    if (error.message.includes("already claimed")) {
      showErrorToast("Achievement already claimed");
    } else if (error.message.includes("not completed")) {
      showErrorToast("Achievement not completed yet");
    } else {
      showErrorToast("Failed to claim achievement");
    }
    throw error;
  }
}
```

---

## 📱 Typical Screen Flows

### Main Achievement Screen

```typescript
1. Load achievements with stats
   GET /api/achievements/me/progress

2. Display with filters (category tabs)
   - All, Gameplay, Collection, Social, etc.

3. Show claimable count badge

4. Allow claiming from list
   POST /api/achievements/:id/claim
```

### Post-Game Popup

```typescript
1. Get recent achievements
   GET /api/achievements/me/recent?limit=3

2. Show "New Achievement!" popup if any

3. Allow immediate claim

4. Update main screen count
```

### Notification Center

```typescript
1. Get unclaimed achievements
   GET /api/achievements/me/progress?unclaimed=true

2. Show as notification items

3. "Claim All" button
```

---

## 📦 Complete Example API Call

```typescript
// Full example with error handling and loading states
async function loadUserAchievements() {
  setLoading(true);

  try {
    const response = await fetch("/api/achievements/me/progress", {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    setAchievements(data.achievements);
    setStats(data.stats);

    // Count claimable for badge
    const claimableCount = data.achievements.filter((a) => a.can_claim).length;
    setClaimableBadge(claimableCount);
  } catch (error) {
    console.error("Failed to load achievements:", error);
    showError("Could not load achievements");
  } finally {
    setLoading(false);
  }
}
```

---

## 🎁 Reward Display Helper

```typescript
function formatRewards(achievement) {
  const rewards = [];

  if (achievement.reward_gems > 0) {
    rewards.push(`${achievement.reward_gems} 💎 Gems`);
  }
  if (achievement.reward_packs > 0) {
    rewards.push(`${achievement.reward_packs} 📦 Packs`);
  }
  if (achievement.reward_fate_coins > 0) {
    rewards.push(`${achievement.reward_fate_coins} 🪙 Fate Coins`);
  }
  if (achievement.reward_card_fragments > 0) {
    rewards.push(`${achievement.reward_card_fragments} ✨ Fragments`);
  }

  return rewards.join(", ");
}
```

---

## 🔗 Base URLs

```typescript
// Development
const API_BASE = "http://localhost:3000/api";

// Production
const API_BASE = "https://your-server.com/api";

// All achievement endpoints start with:
`${API_BASE}/achievements`;
```

---

## ⚙️ Categories

```typescript
type AchievementCategory =
  | "gameplay" // Games, wins, streaks
  | "collection" // Card collecting
  | "social" // Friends, challenges
  | "progression" // Leveling, XP
  | "special" // Events, limited time
  | "story_mode"; // Story battles
```

---

## 🏆 That's It!

Copy `achievement.types.ts` to your project and start building!
