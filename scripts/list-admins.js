#!/usr/bin/env node

/**
 * List Admin Users Script
 * 
 * Usage: node scripts/list-admins.js
 * 
 * This script lists all users with admin role.
 */

const db = require('../src/config/db.config').default;

async function listAdmins() {
  try {
    console.log('🔍 Fetching admin users...\n');

    const query = `
      SELECT user_id, username, email, created_at, last_login
      FROM users 
      WHERE role = 'admin'
      ORDER BY created_at DESC
    `;

    const result = await db.query(query);

    if (result.rows.length === 0) {
      console.log('ℹ️  No admin users found');
      console.log('💡 To create an admin, run:');
      console.log('   node scripts/make-admin.js <email_or_username>');
      process.exit(0);
    }

    console.log(`✅ Found ${result.rows.length} admin user(s):\n`);

    result.rows.forEach((admin, index) => {
      console.log(`${index + 1}. ${admin.username}`);
      console.log(`   User ID: ${admin.user_id}`);
      console.log(`   Email: ${admin.email}`);
      console.log(`   Created: ${admin.created_at}`);
      console.log(`   Last Login: ${admin.last_login}`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error listing admins:', error.message);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Operation cancelled');
  process.exit(130);
});

// Run the script
listAdmins();
