# Free Tier Database Setup Guide

Since you don't have SSH access on Render's free tier, I've created API endpoints that you can call to set up your database. These endpoints allow you to run migrations and seed your database with data through HTTP requests.

## 🚀 No Authentication Required!

The database setup endpoints are **publicly accessible** for initial setup (since you need a database to create users!). Once your database is set up, you should remove or protect these endpoints.

## 🚀 Setup Process

### Step 1: Check Database Status

First, check what state your database is in:

```bash
curl -X GET "https://your-app.onrender.com/api/admin/database-status"
```

**Response will show:**

- Database connectivity status
- Which tables exist/are missing
- Migration status
- Recommendations for next steps

### Step 2: Run Migrations

Create all the database tables and structure:

```bash
curl -X POST "https://your-app.onrender.com/api/admin/migrate" \
  -H "Content-Type: application/json"
```

**This will:**

- Execute all pending database migrations
- Create tables: users, cards, sets, special_abilities, games, decks, etc.
- Set up indexes and constraints
- Provide detailed output of what was done

### Step 3: Seed Database with Initial Data

Populate your database with cards, sets, and abilities:

```bash
curl -X POST "https://your-app.onrender.com/api/admin/seed" \
  -H "Content-Type: application/json"
```

**This will:**

- Execute all queries from `scripts/database-queries.sql`
- Insert sets (Japanese, Norse, Polynesian)
- Insert special abilities (70+ unique abilities)
- Insert cards (80+ cards with proper relationships)
- Handle duplicate data gracefully (won't break if run multiple times)

## 📊 Response Examples

### Successful Migration Response

```json
{
  "status": "success",
  "message": "Database migrations completed successfully",
  "output": "Migrations complete! Applied 1 migration.",
  "warnings": null,
  "timestamp": "2025-01-12T10:30:45.123Z"
}
```

### Successful Seeding Response

```json
{
  "status": "success",
  "message": "Database seeding completed successfully",
  "summary": {
    "totalQueries": 156,
    "successful": 156,
    "failed": 0,
    "duplicatesIgnored": 0
  },
  "timestamp": "2025-01-12T10:31:22.456Z"
}
```

### Database Status Response (Healthy)

```json
{
  "status": "healthy",
  "message": "Database is properly set up",
  "details": {
    "database": {
      "connected": true,
      "responseTime": 45,
      "error": null
    },
    "tables": {
      "exists": [
        "users",
        "cards",
        "sets",
        "special_abilities",
        "games",
        "decks"
      ],
      "missing": [],
      "error": null
    },
    "migrations": {
      "status": "Latest: 0000000000000_baseline.js (2025-01-12T10:30:45.123Z)",
      "error": null
    }
  },
  "recommendations": ["Database appears ready"]
}
```

## 🔒 Security Notice

**IMPORTANT:** These endpoints are currently public to allow initial database setup. Once your database is configured and you have user accounts, you should:

1. **Remove these endpoints** from production, OR
2. **Add authentication back** to protect them
3. **Use environment variables** to enable/disable them

## 🛠️ No Authentication Needed

### 1. Register a User (if not done already)

```bash
curl -X POST "https://your-app.onrender.com/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "email": "admin@yourapp.com",
    "password": "your-secure-password"
  }'
```

### 2. Login to Get Token

```bash
curl -X POST "https://your-app.onrender.com/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-secure-password"
  }'
```

**Response:**

```json
{
  "status": "success",
  "message": "Login successful",
  "user": { ... },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Use the `token` value in subsequent admin requests.

## 🔄 Complete Setup Script

Here's a bash script to do the complete setup:

```bash
#!/bin/bash

# Configuration
API_BASE="https://your-app.onrender.com"

echo "🚀 Setting up database on Render.com free tier..."

# Step 1: Check database status
echo "📊 Checking database status..."
curl -X GET "$API_BASE/api/admin/database-status"

echo -e "\n"

# Step 2: Run migrations
echo -e "\n🗃️ Running database migrations..."
curl -X POST "$API_BASE/api/admin/migrate" \
  -H "Content-Type: application/json"

echo -e "\n"

# Step 3: Seed database
echo -e "\n🌱 Seeding database with initial data..."
curl -X POST "$API_BASE/api/admin/seed" \
  -H "Content-Type: application/json"

echo -e "\n"

# Step 4: Final status check
echo -e "\n✅ Final database status check..."
curl -X GET "$API_BASE/api/admin/database-status"

echo -e "\n\n🎉 Database setup complete!"
```

## 🚨 Error Handling

### Common Issues:

1. **503 Database Connection Failed**: Database not accessible

   - Solution: Check if your DATABASE_URL environment variable is set correctly

2. **404 Database queries file not found**: Missing database-queries.sql

   - Solution: Ensure the file exists in the scripts/ directory

3. **Migration failures**: Schema conflicts or missing dependencies
   - Solution: Check the error output and resolve conflicts manually

### Partial Success Responses:

If seeding returns status `partial_success` (HTTP 207), it means some queries failed but most succeeded. This is often normal due to:

- Duplicate key constraints (data already exists)
- Foreign key constraints (dependency issues)

Check the `errors` array in the response to see what failed and whether it's critical.

## 🔒 Security Notes

- **Never expose admin endpoints publicly** without authentication
- **Use strong passwords** for admin accounts
- **Rotate JWT secrets** regularly in production
- **Monitor admin endpoint usage** for security

## 📚 Additional Commands

### Re-run seeding (safe):

```bash
curl -X POST "https://your-app.onrender.com/api/admin/seed" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Check status anytime:

```bash
curl -X GET "https://your-app.onrender.com/api/admin/database-status" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 📖 API Documentation

Full API documentation with examples is available at:
`https://your-app.onrender.com/docs`

Look for the "Admin" section for detailed endpoint specifications.

---

**✅ That's it!** Your database should now be fully set up with all tables, data, and ready for your application to use.
