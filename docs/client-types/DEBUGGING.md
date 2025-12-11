# Debugging Empty Achievement Response

## Issue: `/api/achievements/me/progress` returns empty achievements array

If you're getting this response:

```json
{
  "achievements": [],
  "stats": { "total_achievements": 0, ... }
}
```

## 🔧 Quick Fix (Try This First!)

### If you see: `column a.reward_fate_coins does not exist`

This means you need to run the latest migration:

```bash
npm run migrate up
```

This will add the missing `reward_fate_coins` and `reward_card_fragments` columns to the achievements table.

### For other issues, run diagnostic scripts:

```bash
# 1. Diagnose the issue
node scripts/diagnose-achievements.js

# 2. Fix common visibility issues
node scripts/fix-achievements-visibility.js
```

These scripts will automatically detect and fix most common issues!

---

## Manual Debugging Steps

Follow these steps if the scripts don't resolve the issue:

## Step 1: Verify Achievements Exist in Database

Run this SQL query directly:

```sql
-- Check if achievements exist and are active
SELECT
  id,
  achievement_key,
  title,
  is_active,
  tier_level,
  base_achievement_key
FROM achievements
ORDER BY created_at DESC
LIMIT 10;
```

**Expected Result:** Should return rows with `is_active = true`

**If no rows:** You need to seed achievements into the database first!

**If `is_active = false`:** Update achievements to be active:

```sql
UPDATE achievements SET is_active = true WHERE is_active = false;
```

## Step 2: Check for Tier Locking Issues

The query filters out "locked" tier achievements by default. If you only have tier 2+ achievements without completing tier 1, they'll be hidden.

Check tier distribution:

```sql
-- See achievement tier distribution
SELECT
  tier_level,
  COUNT(*) as count
FROM achievements
WHERE is_active = true
GROUP BY tier_level
ORDER BY tier_level;
```

**Workaround:** Use the `include_locked=true` parameter:

```typescript
GET /api/achievements/me/progress?include_locked=true
```

## Step 3: Test Public Endpoint

Try the public endpoint to see if achievements exist at all:

```typescript
GET / api / achievements;
```

**If this returns achievements:** The issue is with user-specific filtering
**If this is also empty:** Achievements don't exist in the database

## Step 4: Check User Authentication

Verify the user ID is being extracted correctly from the JWT token:

Add logging to the controller:

```typescript
// In achievement.controller.ts - getUserAchievements function
console.log("User ID from token:", userId);
```

## Step 5: Check for SQL Errors

The query might be failing silently. Check server logs for any database errors.

## Quick Fix: Include Locked Tiers

If you have tiered achievements, try:

```typescript
const data = await fetch("/api/achievements/me/progress?include_locked=true", {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
```

## Common Causes & Solutions

### ⭐ Cause 1: Migrations Not Run (MOST COMMON!)

**Symptoms:** `total_achievements: 0` in stats

**Solution:** Run migrations:

```bash
npm run migrate up
```

Or if using node-pg-migrate directly:

```bash
npx node-pg-migrate up
```

### Cause 2: All Achievements Are Tier 2+ (VERY LIKELY!)

**Symptoms:**

- Achievements exist in DB
- Public endpoint `/api/achievements` returns data
- But `/api/achievements/me/progress` returns empty

**Explanation:** The API hides "locked" tiered achievements by default. If all achievements are tier 2+, they're hidden until tier 1 is completed.

**Solution A - Quick Fix (Client-side):**

```typescript
// Add include_locked=true to see all achievements
GET /api/achievements/me/progress?include_locked=true
```

**Solution B - Server Fix:**

```bash
# Run the fix script
node scripts/fix-achievements-visibility.js
```

**Solution C - Manual DB Fix:**

```sql
-- Check if this is the issue
SELECT tier_level, COUNT(*)
FROM achievements
WHERE is_active = true
GROUP BY tier_level;

-- If you see only tier 2+ and want to see them all:
-- Option 1: Change default behavior in the model (advanced)
-- Option 2: Always pass include_locked=true from client
```

### Cause 3: All Achievements Inactive

**Symptoms:** Public endpoint returns empty too

**Solution:**

```sql
UPDATE achievements SET is_active = true;
```

Or run:

```bash
node scripts/fix-achievements-visibility.js
```

### Cause 4: Wrong User ID / Auth Issue

**Symptoms:**

- `/api/achievements` works
- `/api/achievements/me/progress` returns empty or 401

**Solution:**

- Verify JWT token is valid
- Check server logs for authentication errors
- Verify user_id is being extracted correctly
