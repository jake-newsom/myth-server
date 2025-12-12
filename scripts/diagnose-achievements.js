/**
 * Diagnostic script to check achievement system
 * 
 * Run with: node scripts/diagnose-achievements.js
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

async function diagnoseAchievements() {
  console.log('=== Achievement System Diagnosis ===\n');

  try {
    // Step 1: Check if achievements table exists and has data
    console.log('1. Checking achievements table...');
    const achievementCount = await db.query(`
      SELECT COUNT(*) as count FROM achievements;
    `);
    console.log(`   Total achievements in database: ${achievementCount.rows[0].count}`);

    if (achievementCount.rows[0].count === '0') {
      console.log('   ❌ NO ACHIEVEMENTS FOUND! You need to run migrations.');
      console.log('   Run: npm run migrate up');
      return;
    }

    // Step 2: Check active achievements
    console.log('\n2. Checking active achievements...');
    const activeCount = await db.query(`
      SELECT COUNT(*) as count FROM achievements WHERE is_active = true;
    `);
    console.log(`   Active achievements: ${activeCount.rows[0].count}`);

    if (activeCount.rows[0].count === '0') {
      console.log('   ❌ All achievements are inactive!');
      console.log('   Fix with: UPDATE achievements SET is_active = true;');
      return;
    }

    // Step 3: Check tier distribution
    console.log('\n3. Checking tier distribution...');
    const tierDist = await db.query(`
      SELECT 
        tier_level,
        COUNT(*) as count,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_count
      FROM achievements
      GROUP BY tier_level
      ORDER BY tier_level NULLS FIRST;
    `);
    
    console.log('   Tier Level | Total | Active');
    console.log('   -----------|-------|-------');
    tierDist.rows.forEach(row => {
      const tier = row.tier_level === null ? 'NULL (standalone)' : row.tier_level;
      console.log(`   ${tier.toString().padEnd(10)} | ${row.count.toString().padEnd(5)} | ${row.active_count}`);
    });

    // Step 4: Check category distribution
    console.log('\n4. Checking category distribution...');
    const catDist = await db.query(`
      SELECT 
        category,
        COUNT(*) as count,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_count
      FROM achievements
      GROUP BY category
      ORDER BY category;
    `);
    
    console.log('   Category    | Total | Active');
    console.log('   ------------|-------|-------');
    catDist.rows.forEach(row => {
      console.log(`   ${row.category.padEnd(11)} | ${row.count.toString().padEnd(5)} | ${row.active_count}`);
    });

    // Step 5: Show sample achievements
    console.log('\n5. Sample achievements (first 5):');
    const samples = await db.query(`
      SELECT 
        achievement_key,
        title,
        tier_level,
        is_active,
        base_achievement_key
      FROM achievements
      ORDER BY sort_order ASC
      LIMIT 5;
    `);
    
    samples.rows.forEach(row => {
      const active = row.is_active ? '✓' : '✗';
      const tier = row.tier_level ? `T${row.tier_level}` : '--';
      console.log(`   ${active} ${tier} ${row.achievement_key.padEnd(30)} - ${row.title}`);
    });

    // Step 6: Test the actual query that the API uses
    console.log('\n6. Testing API query (for a test user)...');
    console.log('   Creating a test query...');
    
    const testQuery = `
      SELECT COUNT(*) as count
      FROM achievements a
      WHERE a.is_active = true
        AND (a.tier_level IS NULL OR a.tier_level = 1);
    `;
    
    const apiResult = await db.query(testQuery);
    console.log(`   Achievements that would be returned (tier 1 + standalone): ${apiResult.rows[0].count}`);

    if (apiResult.rows[0].count === '0') {
      console.log('   ❌ No tier 1 or standalone achievements found!');
      console.log('   All achievements are tier 2+, which requires completing tier 1 first.');
      console.log('   Solution: Use ?include_locked=true parameter, or add tier 1 achievements.');
    } else {
      console.log('   ✓ Achievements should be visible in the API!');
    }

    // Step 7: Check if user_achievements table has any data
    console.log('\n7. Checking user_achievements table...');
    const userAchievementCount = await db.query(`
      SELECT COUNT(*) as count FROM user_achievements;
    `);
    console.log(`   Total user achievement records: ${userAchievementCount.rows[0].count}`);

    console.log('\n=== Diagnosis Complete ===');
    console.log('\n📝 Summary:');
    console.log(`   • Total achievements: ${achievementCount.rows[0].count}`);
    console.log(`   • Active achievements: ${activeCount.rows[0].count}`);
    console.log(`   • Visible to users: ${apiResult.rows[0].count}`);
    console.log(`   • User progress records: ${userAchievementCount.rows[0].count}`);

    if (apiResult.rows[0].count > 0) {
      console.log('\n✓ Achievement system looks healthy!');
      console.log('\nIf API still returns empty, check:');
      console.log('   1. User authentication (valid JWT token)');
      console.log('   2. Server logs for errors');
      console.log('   3. Try: GET /api/achievements (public endpoint)');
    } else {
      console.log('\n❌ Issue found: No accessible achievements!');
      console.log('\nQuick fix:');
      console.log('   Call API with: ?include_locked=true');
    }

  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
  } finally {
    await db.end();
  }
}

diagnoseAchievements();
