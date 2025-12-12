/**
 * Fix Achievement Visibility Issues
 * 
 * This script fixes common issues that cause achievements to not appear:
 * 1. Activates all inactive achievements
 * 2. Shows what tier 1 achievements exist
 * 
 * Run with: node scripts/fix-achievements-visibility.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL?.includes("render.com") ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const db = {
  query: (text, params) => pool.query(text, params),
  end: () => pool.end()
};

async function fixAchievementVisibility() {
  console.log('=== Fixing Achievement Visibility ===\n');

  try {
    // Step 1: Activate all achievements
    console.log('1. Activating all achievements...');
    const activateResult = await db.query(`
      UPDATE achievements 
      SET is_active = true 
      WHERE is_active = false
      RETURNING achievement_key, title;
    `);
    
    if (activateResult.rows.length > 0) {
      console.log(`   ✓ Activated ${activateResult.rows.length} achievements:`);
      activateResult.rows.forEach(row => {
        console.log(`     - ${row.achievement_key}: ${row.title}`);
      });
    } else {
      console.log('   ✓ All achievements already active!');
    }

    // Step 2: Check tier 1 achievements
    console.log('\n2. Checking tier 1 achievements...');
    const tier1Result = await db.query(`
      SELECT 
        achievement_key,
        title,
        category,
        target_value,
        base_achievement_key
      FROM achievements
      WHERE (tier_level = 1 OR tier_level IS NULL)
        AND is_active = true
      ORDER BY sort_order;
    `);

    if (tier1Result.rows.length > 0) {
      console.log(`   ✓ Found ${tier1Result.rows.length} tier 1/standalone achievements:`);
      tier1Result.rows.forEach(row => {
        const tier = row.tier_level ? 'T1' : 'Standalone';
        console.log(`     [${tier}] ${row.achievement_key.padEnd(30)} - ${row.title}`);
      });
    } else {
      console.log('   ⚠ No tier 1 or standalone achievements found!');
      console.log('   This means all achievements require completing a previous tier.');
      console.log('   Users will need to use ?include_locked=true to see them.');
    }

    // Step 3: Verify the fix
    console.log('\n3. Verifying fix...');
    const verifyResult = await db.query(`
      SELECT COUNT(*) as visible_count
      FROM achievements
      WHERE is_active = true
        AND (tier_level IS NULL OR tier_level = 1);
    `);

    const visibleCount = parseInt(verifyResult.rows[0].visible_count);
    console.log(`   Achievements now visible to new users: ${visibleCount}`);

    if (visibleCount > 0) {
      console.log('\n✅ SUCCESS! Achievements should now appear in the API.');
      console.log('\nTest with:');
      console.log('   GET /api/achievements');
      console.log('   GET /api/achievements/me/progress');
    } else {
      console.log('\n⚠ PARTIAL FIX: Achievements are active but all are locked tiers.');
      console.log('\nOptions:');
      console.log('   1. Use ?include_locked=true in API calls');
      console.log('   2. Or add standalone/tier 1 achievements to the database');
    }

    // Step 4: Show base achievement keys for reference
    console.log('\n4. Available base achievement series:');
    const baseKeys = await db.query(`
      SELECT DISTINCT base_achievement_key, COUNT(*) as tier_count
      FROM achievements
      WHERE base_achievement_key IS NOT NULL
        AND is_active = true
      GROUP BY base_achievement_key
      ORDER BY base_achievement_key;
    `);

    if (baseKeys.rows.length > 0) {
      baseKeys.rows.forEach(row => {
        console.log(`   - ${row.base_achievement_key} (${row.tier_count} tiers)`);
      });
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await db.end();
  }
}

fixAchievementVisibility();
