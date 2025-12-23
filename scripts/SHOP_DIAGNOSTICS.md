# Daily Shop Diagnostic Scripts

This document explains how to diagnose and fix issues with the daily shop system, specifically when legendary/epic cards are not appearing.

## Quick Fix

If you just want to quickly fix the issue and generate today's offerings:

```bash
node scripts/fix-shop-offerings.js
```

## Diagnostic Scripts

### 1. `check-and-fix-shop.js` (Recommended)

**Best for: Quick diagnosis and automatic fix**

This script checks the shop system and attempts to fix issues automatically.

```bash
node scripts/check-and-fix-shop.js
```

**What it checks:**
- Shop configuration status (active/inactive)
- Card availability by mythology and rarity
- Current shop offerings
- Historical offerings (last 3 days)
- Automatically attempts to generate missing offerings

**Use this when:** You want a quick overview and automatic fix attempt.

---

### 2. `diagnose-shop-issue.js`

**Best for: Detailed investigation**

This script provides a comprehensive diagnostic report without making any changes.

```bash
node scripts/diagnose-shop-issue.js
```

**What it reports:**
1. Shop configuration details
2. Card database statistics by mythology and rarity
3. Current shop offerings
4. Historical offerings (last 5 days)
5. Rotation states
6. Detailed recommendations

**Use this when:** You want to understand exactly what's wrong before making changes.

---

### 3. `fix-shop-offerings.js`

**Best for: Manual generation**

This script manually generates shop offerings for today or a specific date.

```bash
# Generate for today
node scripts/fix-shop-offerings.js

# Generate for a specific date
node scripts/fix-shop-offerings.js 2025-12-22
```

**Use this when:** You know the issue and just need to regenerate offerings.

---

## Common Issues and Solutions

### Issue 1: Shop configurations are inactive

**Symptoms:**
- No legendary/epic cards in shop
- Diagnostic shows "INACTIVE" configurations

**Solution:**
Connect to your production database and run:

```sql
UPDATE daily_shop_config SET is_active = true WHERE item_type = 'legendary_card';
UPDATE daily_shop_config SET is_active = true WHERE item_type = 'epic_card';
```

Then regenerate offerings:
```bash
node scripts/fix-shop-offerings.js
```

---

### Issue 2: Missing cards in database

**Symptoms:**
- Diagnostic shows 0 cards for some mythologies
- Warnings like "No legendary cards found for norse mythology"

**Solution:**
1. Check that cards exist in the database with proper rarity
2. Verify cards have mythology tags: `'norse'`, `'japanese'`, or `'polynesian'`
3. Example query to check:

```sql
SELECT 
  rarity, 
  tags, 
  COUNT(*) 
FROM cards 
WHERE rarity IN ('legendary', 'epic')
GROUP BY rarity, tags;
```

If cards are missing tags, update them:
```sql
UPDATE cards 
SET tags = array_append(tags, 'norse') 
WHERE card_id = 'some-card-id' 
AND NOT ('norse' = ANY(tags));
```

---

### Issue 3: Cron job not running

**Symptoms:**
- No offerings generated for multiple days
- Server logs show no midnight UTC tasks

**Solution:**
1. Check if the server restarted recently
2. Verify the cron scheduler started:
   - Look for: "🎁 Daily Rewards and Shop Service started successfully" in logs
3. Check server timezone is UTC
4. Manually generate offerings for missed days:

```bash
node scripts/fix-shop-offerings.js 2025-12-20
node scripts/fix-shop-offerings.js 2025-12-21
node scripts/fix-shop-offerings.js 2025-12-22
```

---

### Issue 4: Silent errors during generation

**Symptoms:**
- Cron job runs but no offerings created
- No obvious errors in logs

**Solution:**
1. Check server logs around midnight UTC (00:00)
2. Look for errors in the `generateMythologyCards` function
3. Run diagnostic script to see detailed error messages:

```bash
node scripts/diagnose-shop-issue.js
```

---

## Production Deployment

### To run on production server:

1. SSH into your production server
2. Navigate to the project directory
3. Ensure environment variables are set (DATABASE_URL, etc.)
4. Run the diagnostic:

```bash
cd /path/to/myth-server
node scripts/check-and-fix-shop.js
```

### To check production database directly:

```bash
# Connect to production database
psql $DATABASE_URL

# Check shop configuration
SELECT item_type, is_active, price, currency 
FROM daily_shop_config 
ORDER BY item_type;

# Check today's offerings
SELECT shop_date, item_type, COUNT(*) 
FROM daily_shop_offerings 
WHERE shop_date = CURRENT_DATE 
GROUP BY shop_date, item_type;

# Check last 5 days
SELECT shop_date, item_type, COUNT(*) 
FROM daily_shop_offerings 
WHERE shop_date >= CURRENT_DATE - INTERVAL '5 days'
GROUP BY shop_date, item_type 
ORDER BY shop_date DESC, item_type;
```

---

## Monitoring

To prevent this issue in the future, consider:

1. **Set up monitoring alerts** for when shop offerings are not generated
2. **Add health check endpoint** that verifies today's offerings exist
3. **Log aggregation** to catch silent errors
4. **Daily verification script** that runs after the cron job

Example health check query:
```sql
SELECT COUNT(*) as offering_count
FROM daily_shop_offerings
WHERE shop_date = CURRENT_DATE
  AND item_type IN ('legendary_card', 'epic_card');
```

Should return at least 6 (3 legendary + 3 epic).

---

## Understanding the Shop System

### How it works:

1. **Cron job** runs at midnight UTC (00:00) daily
2. **generateDailyOfferings()** is called
3. For legendary/epic cards:
   - Fetches cards for each mythology (norse, japanese, polynesian)
   - Uses rotation system to cycle through available cards
   - Creates 3 legendary and 3 epic offerings (one per mythology)
4. Offerings are stored in `daily_shop_offerings` table

### Key tables:

- `daily_shop_config` - Configuration for each item type
- `daily_shop_offerings` - Today's available items
- `daily_shop_rotations` - Tracks which card to show next for each mythology
- `daily_shop_purchases` - User purchase history

---

## Need Help?

If these scripts don't resolve your issue:

1. Run the diagnostic script and save the output
2. Check server logs around midnight UTC
3. Verify database connectivity
4. Check if any database migrations are pending
5. Ensure the server has been running continuously (not restarting frequently)

