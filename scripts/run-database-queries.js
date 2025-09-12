#!/usr/bin/env node
/**
 * Manual Database Query Runner for Render.com Production
 * This script allows you to manually run all queries from database-queries.sql
 * against your Render database after the structure has been prepared.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load environment variables
require('dotenv').config();

// Create readline interface for user interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to prompt user for confirmation
function promptUser(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Database connection configuration
const getDatabaseConfig = () => {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set.');
    console.log('Please set your DATABASE_URL before running this script.');
    console.log('Example: export DATABASE_URL="postgresql://username:password@host:port/database"');
    process.exit(1);
  }

  return {
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  };
};

// Function to read and parse SQL file
function readSQLFile() {
  const sqlFilePath = path.join(__dirname, 'database-queries.sql');
  
  if (!fs.existsSync(sqlFilePath)) {
    console.error('❌ database-queries.sql file not found at:', sqlFilePath);
    process.exit(1);
  }
  
  const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
  
  // Split queries by semicolon and filter out empty queries and comments
  const queries = sqlContent
    .split(';')
    .map(query => query.trim())
    .filter(query => query.length > 0 && !query.startsWith('--') && !query.startsWith('/*'));
  
  return queries;
}

// Function to execute queries in batches
async function executeQueries(pool, queries, batchSize = 10) {
  console.log(`\n📊 Total queries to execute: ${queries.length}`);
  
  let successCount = 0;
  let errorCount = 0;
  const errors = [];
  
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    console.log(`\n🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(queries.length / batchSize)} (queries ${i + 1}-${Math.min(i + batchSize, queries.length)})`);
    
    for (let j = 0; j < batch.length; j++) {
      const query = batch[j];
      const queryNumber = i + j + 1;
      
      try {
        // Add semicolon back for execution
        await pool.query(query + ';');
        successCount++;
        process.stdout.write(`✅ Query ${queryNumber} executed successfully\r`);
      } catch (error) {
        errorCount++;
        const errorInfo = {
          queryNumber,
          query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
          error: error.message
        };
        errors.push(errorInfo);
        process.stdout.write(`❌ Query ${queryNumber} failed: ${error.message}\r`);
      }
    }
    
    // Small delay between batches to not overwhelm the database
    if (i + batchSize < queries.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return { successCount, errorCount, errors };
}

// Function to display connection info (without sensitive data)
function displayConnectionInfo(config) {
  const url = new URL(config.connectionString);
  console.log('\n🔗 Database Connection Info:');
  console.log(`   Host: ${url.hostname}`);
  console.log(`   Port: ${url.port || '5432'}`);
  console.log(`   Database: ${url.pathname.slice(1)}`);
  console.log(`   User: ${url.username}`);
  console.log(`   SSL: ${config.ssl ? 'Enabled' : 'Disabled'}`);
}

// Main execution function
async function main() {
  console.log('🚀 Database Query Runner for Render.com Production');
  console.log('=' .repeat(60));
  
  try {
    // Get database configuration
    const dbConfig = getDatabaseConfig();
    displayConnectionInfo(dbConfig);
    
    // Read SQL queries
    console.log('\n📖 Reading database-queries.sql...');
    const queries = readSQLFile();
    console.log(`✅ Found ${queries.length} queries to execute`);
    
    // Show first few queries as preview
    console.log('\n📋 Preview of first few queries:');
    queries.slice(0, 3).forEach((query, index) => {
      const preview = query.substring(0, 80) + (query.length > 80 ? '...' : '');
      console.log(`   ${index + 1}. ${preview}`);
    });
    
    if (queries.length > 3) {
      console.log(`   ... and ${queries.length - 3} more queries`);
    }
    
    // Confirm execution
    console.log('\n⚠️  WARNING: This will execute all queries against your production database!');
    const confirm = await promptUser('Do you want to proceed? (yes/no): ');
    
    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
      console.log('❌ Operation cancelled by user.');
      rl.close();
      return;
    }
    
    // Create database connection
    console.log('\n🔌 Connecting to database...');
    const pool = new Pool(dbConfig);
    
    // Test connection
    try {
      await pool.query('SELECT NOW()');
      console.log('✅ Database connection successful');
    } catch (error) {
      console.error('❌ Failed to connect to database:', error.message);
      process.exit(1);
    }
    
    // Execute queries
    console.log('\n🔄 Starting query execution...');
    const startTime = Date.now();
    
    const result = await executeQueries(pool, queries);
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    // Display results
    console.log('\n' + '='.repeat(60));
    console.log('📊 Execution Summary:');
    console.log(`   ✅ Successful queries: ${result.successCount}`);
    console.log(`   ❌ Failed queries: ${result.errorCount}`);
    console.log(`   ⏱️  Total duration: ${duration} seconds`);
    
    if (result.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      result.errors.forEach(error => {
        console.log(`   Query ${error.queryNumber}: ${error.error}`);
        console.log(`   SQL: ${error.query}`);
        console.log('');
      });
    }
    
    if (result.errorCount === 0) {
      console.log('\n🎉 All queries executed successfully!');
    } else {
      console.log(`\n⚠️  ${result.errorCount} queries failed. Check the errors above.`);
    }
    
    // Close connections
    await pool.end();
    rl.close();
    
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    rl.close();
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Process interrupted by user');
  rl.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️  Process terminated');
  rl.close();
  process.exit(0);
});

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main, executeQueries, readSQLFile };
