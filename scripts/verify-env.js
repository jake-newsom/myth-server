#!/usr/bin/env node
/**
 * Environment Variables Verification Script
 * This script helps verify that all required environment variables are properly set
 * Run this after deployment to ensure your staging environment group is working correctly
 */

require('dotenv').config();

console.log('🔍 Environment Variables Verification');
console.log('=' .repeat(50));

// Define required environment variables
const requiredEnvVars = [
  {
    name: 'NODE_ENV',
    expected: 'production',
    description: 'Runtime environment'
  },
  {
    name: 'DATABASE_URL',
    required: true,
    description: 'PostgreSQL connection string',
    sensitive: true
  },
  {
    name: 'JWT_SECRET',
    required: true,
    description: 'JWT signing secret',
    sensitive: true
  },
  {
    name: 'JWT_EXPIRES_IN',
    expected: '7d',
    description: 'JWT expiration time'
  },
  {
    name: 'BCRYPT_SALT_ROUNDS',
    expected: '12',
    description: 'BCrypt salt rounds'
  },
  {
    name: 'PORT',
    expected: '10000',
    description: 'Server port (Render default)'
  }
];

let allGood = true;
let warnings = [];

console.log('📋 Checking Environment Variables:\n');

requiredEnvVars.forEach((envVar) => {
  const value = process.env[envVar.name];
  const status = value ? '✅' : '❌';
  
  if (!value && envVar.required) {
    allGood = false;
    console.log(`${status} ${envVar.name}: MISSING (${envVar.description})`);
  } else if (!value && envVar.expected) {
    warnings.push(`${envVar.name} not set, will use default value`);
    console.log(`⚠️  ${envVar.name}: NOT SET (${envVar.description}) - will use default`);
  } else if (value && envVar.expected && value !== envVar.expected) {
    warnings.push(`${envVar.name} has unexpected value`);
    console.log(`⚠️  ${envVar.name}: ${envVar.sensitive ? '***REDACTED***' : value} (${envVar.description}) - expected: ${envVar.expected}`);
  } else if (value) {
    console.log(`${status} ${envVar.name}: ${envVar.sensitive ? '***REDACTED***' : value} (${envVar.description})`);
  }
});

// Additional checks
console.log('\n📊 Additional Information:');
console.log(`   Environment: ${process.env.NODE_ENV || 'not set'}`);
console.log(`   Process PID: ${process.pid}`);
console.log(`   Node Version: ${process.version}`);
console.log(`   Platform: ${process.platform}`);
console.log(`   Architecture: ${process.arch}`);

// Database URL parsing (if available)
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    console.log('\n🔗 Database Connection Info:');
    console.log(`   Protocol: ${url.protocol}`);
    console.log(`   Host: ${url.hostname}`);
    console.log(`   Port: ${url.port || '5432'}`);
    console.log(`   Database: ${url.pathname.slice(1)}`);
    console.log(`   Username: ${url.username || 'not specified'}`);
    console.log(`   SSL: ${url.searchParams.get('sslmode') || 'check connection config'}`);
  } catch (error) {
    console.log('\n❌ Database URL parsing failed:', error.message);
    allGood = false;
  }
}

// Environment Group Information
console.log('\n📦 Environment Group Information:');
console.log('   Expected Group: "staging"');
console.log('   Variables from staging group: JWT_SECRET, JWT_EXPIRES_IN, BCRYPT_SALT_ROUNDS');
console.log('   Service-specific variables: NODE_ENV, PORT');
console.log('   Auto-provided variables: DATABASE_URL');

// Summary
console.log('\n' + '='.repeat(50));
if (allGood && warnings.length === 0) {
  console.log('🎉 All environment variables are properly configured!');
} else if (allGood && warnings.length > 0) {
  console.log('✅ All required environment variables are set.');
  console.log(`⚠️  ${warnings.length} warning(s):`);
  warnings.forEach(warning => console.log(`   - ${warning}`));
} else {
  console.log('❌ Some required environment variables are missing!');
  console.log('\n💡 Troubleshooting:');
  console.log('   1. Check that your "staging" environment group is linked to this service');
  console.log('   2. Verify all required variables are set in the staging group');
  console.log('   3. Redeploy the service after making changes');
  console.log('   4. Check Render dashboard for environment variable settings');
}

console.log('\n📚 Quick Actions:');
console.log('   • Test database connection: npm run health:database');
console.log('   • Check all health endpoints: curl https://your-app.onrender.com/api/health/detailed');
console.log('   • View this verification: node scripts/verify-env.js');

process.exit(allGood ? 0 : 1);
