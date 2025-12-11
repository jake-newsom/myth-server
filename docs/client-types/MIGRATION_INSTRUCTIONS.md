# Achievement System Migration Instructions

## Issue Summary

The achievement API is returning empty results because:

1. ❌ Missing database columns: `reward_fate_coins` and `reward_card_fragments`
2. ⚠️ Deprecated column: `reward_gold` (no longer used in game)

## Error Message

```
Error: column a.reward_fate_coins does not exist
```

## Solution: Run Migration

I've created a migration that will:

- ✅ Add `reward_fate_coins` column
- ✅ Add `reward_card_fragments` column
- ✅ Remove `reward_gold` column (deprecated)
- ✅ Update all achievement data to use gems instead of gold

### Step 1: Run the Migration

```bash
npm run migrate up
```

Or if using node-pg-migrate directly:

```bash
npx node-pg-migrate up
```

### Step 2: Restart Your Server

After running the migration, restart your development server:

```bash
npm run dev
```

### Step 3: Test the API

Try the achievement endpoint again:

```bash
GET /api/achievements/me/progress
```

You should now see achievements in the response!

## What Changed

### Migration File: `1765400000000_add-achievement-reward-columns.js`

**Adds:**

- `reward_fate_coins` (integer, default 0)
- `reward_card_fragments` (integer, default 0)

**Removes:**

- `reward_gold` (no longer used in game)

### Updated Migration: `1762700000000_add-new-tiered-achievements.js`

**Changed:**

- Removed `reward_gold` from INSERT statement
- All achievement rewards now use only gems, packs, fate_coins, and card_fragments

## Reward Structure

After migration, achievements will have these reward fields:

```typescript
interface AchievementRewards {
  reward_gems: number; // Primary currency
  reward_packs: number; // Pack rewards
  reward_fate_coins?: number; // Fate coins (optional)
  reward_card_fragments?: number; // Card fragments (optional)
}
```

**Note:** `reward_gold` has been completely removed from the system.

## Verification

After migration, you can verify it worked:

### 1. Check Database Schema

```sql
-- Verify columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'achievements'
  AND column_name LIKE 'reward%';
```

Expected output should show:

- ✅ `reward_gems`
- ✅ `reward_packs`
- ✅ `reward_fate_coins`
- ✅ `reward_card_fragments`
- ❌ `reward_gold` (should NOT appear)

### 2. Test API Endpoint

```bash
# Public endpoint (no auth)
curl http://localhost:3000/api/achievements

# User progress (requires auth token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/achievements/me/progress
```

Both should return achievement data without errors.

### 3. Check Sample Achievement

```sql
SELECT
  achievement_key,
  title,
  reward_gems,
  reward_packs,
  reward_fate_coins,
  reward_card_fragments
FROM achievements
LIMIT 5;
```

## Rollback (If Needed)

If you need to rollback the migration:

```bash
npm run migrate down
```

**Warning:** This will restore `reward_gold` and remove the new columns. You'll need to update your code to use gold again.

## Client Updates (If Needed)

The TypeScript types in `docs/client-types/achievement.types.ts` already include the correct structure:

```typescript
interface Achievement {
  // ... other fields
  reward_gems: number;
  reward_fate_coins?: number;
  reward_packs: number;
  reward_card_fragments?: number;
  // reward_gold is NOT included (removed)
}
```

No client code changes needed if you're using the provided types! ✨

## Common Issues

### Issue: Migration already ran but still getting errors

**Solution:** Make sure you restarted the server after running migrations.

### Issue: "relation 'achievements' does not exist"

**Solution:** You need to run the initial baseline migration first:

```bash
npm run migrate up
```

### Issue: Still seeing `reward_gold` references

**Solution:** Check if you have old achievement records. You may need to:

1. Back up your data
2. Run `npm run migrate down` multiple times to rollback
3. Run `npm run migrate up` to apply all migrations fresh

## Need Help?

If issues persist after migration:

1. Check server logs for detailed error messages
2. Run the diagnostic script: `node scripts/diagnose-achievements.js`
3. Verify database connection in `.env` file
4. Check that all migrations ran: `SELECT * FROM pgmigrations;`

---

✅ After completing these steps, your achievement system should be fully operational!
