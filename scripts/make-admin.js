#!/usr/bin/env node

/**
 * Make User Admin Script
 * 
 * Usage: node scripts/make-admin.js <email_or_username>
 * 
 * This script promotes a user to admin role.
 * Example:
 *   node scripts/make-admin.js admin@example.com
 *   node scripts/make-admin.js adminuser
 */

const db = require('../src/config/db.config').default;

async function makeAdmin() {
  const identifier = process.argv[2];

  if (!identifier) {
    console.error('❌ Error: Please provide an email or username');
    console.log('Usage: node scripts/make-admin.js <email_or_username>');
    process.exit(1);
  }

  try {
    console.log(`🔍 Looking for user: ${identifier}`);

    // Try to find user by email or username
    const query = `
      SELECT user_id, username, email, role 
      FROM users 
      WHERE email = $1 OR username = $1
    `;

    const result = await db.query(query, [identifier]);

    if (result.rows.length === 0) {
      console.error(`❌ Error: User not found with email or username: ${identifier}`);
      process.exit(1);
    }

    const user = result.rows[0];

    // Check if already admin
    if (user.role === 'admin') {
      console.log(`ℹ️  User ${user.username} (${user.email}) is already an admin`);
      process.exit(0);
    }

    console.log(`📝 User found:`);
    console.log(`   Username: ${user.username}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Current Role: ${user.role}`);
    console.log('');

    // Update user to admin
    const updateQuery = `
      UPDATE users 
      SET role = 'admin' 
      WHERE user_id = $1 
      RETURNING user_id, username, email, role
    `;

    const updateResult = await db.query(updateQuery, [user.user_id]);
    const updatedUser = updateResult.rows[0];

    console.log(`✅ Success! User ${updatedUser.username} is now an admin`);
    console.log(`   User ID: ${updatedUser.user_id}`);
    console.log(`   New Role: ${updatedUser.role}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error making user admin:', error.message);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Operation cancelled');
  process.exit(130);
});

// Run the script
makeAdmin();
