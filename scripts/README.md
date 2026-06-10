# Server Management Scripts

This directory contains utility scripts for managing the Myth game server.

## Admin User Management

### make-admin.js

Promotes a user to admin role.

**Usage:**

```bash
node scripts/make-admin.js <email_or_username>
```

**Examples:**

```bash
# By email
node scripts/make-admin.js admin@example.com

# By username
node scripts/make-admin.js adminuser
```

**Output:**

- ✅ Success message with user details
- ❌ Error if user not found
- ℹ️ Info if user is already an admin

---

### list-admins.js

Lists all users with admin role.

**Usage:**

```bash
node scripts/list-admins.js
```

**Output:**
Shows all admin users with:

- Username
- User ID
- Email
- Created date
- Last login date

---

## Database Setup Scripts

### database-queries.sql

Contains all seed data for:

- Card sets
- Cards
- Special abilities
- Story mode content

**Usage:**

```bash
psql $DATABASE_URL -f scripts/database-queries.sql
```

---

### seed-ragnarok-saga-enemy-decks.js

Creates the 14 Sagas Season 1 (Ragnarök) enemy AI decks from the Norse deck
definitions doc (10 unique cards × 2 copies each). Optionally updates
`saga_seasons` for `ragnarok_s1`.

**Usage:**

```bash
cd myth-server
node scripts/seed-ragnarok-saga-enemy-decks.js
node scripts/seed-ragnarok-saga-enemy-decks.js --replace --update-season
# or
npm run seed:saga-ragnarok -- --replace --update-season
```

Requires `DATABASE_URL` in `.env` and Norse cards in the catalog. The boss
deck slot **Ragnarök (Season Card)** uses **Surtr** until that season card exists.

---

### setup-default-shop-config.js

Sets up default daily shop configuration.

**Usage:**

```bash
node scripts/setup-default-shop-config.js
```

---

## Daily Shop Diagnostics

### Daily Shop Issues

If legendary/epic cards are not appearing in the daily shop, use these diagnostic scripts:

**Quick fix:**
```bash
node scripts/check-and-fix-shop.js
```

**Detailed diagnostics:**
```bash
node scripts/diagnose-shop-issue.js
```

**Manual generation:**
```bash
node scripts/fix-shop-offerings.js
```

📖 **See [SHOP_DIAGNOSTICS.md](./SHOP_DIAGNOSTICS.md) for complete troubleshooting guide**

---

## Security Notes

🔒 **All scripts require direct server access**

These scripts should only be run:

- Via SSH on the production server
- In a local development environment
- By authorized administrators

They are **NOT** exposed via API endpoints for security reasons.

---

## First-Time Setup

After deploying the server:

1. **Run migrations:**

   ```bash
   npx node-pg-migrate -m ./migrations up
   ```

2. **Seed the database:**

   ```bash
   psql $DATABASE_URL -f scripts/database-queries.sql
   ```

3. **Create first admin user:**

   ```bash
   # First create a regular user via the app
   # Then promote them to admin:
   node scripts/make-admin.js your-email@example.com
   ```

4. **Verify admin was created:**
   ```bash
   node scripts/list-admins.js
   ```

---

## Troubleshooting

### "User not found" error

Make sure the user exists in the database first. Users must be created through:

- The registration API endpoint
- Direct database insertion

### "Role column does not exist" error

Run the role migration:

```bash
npx node-pg-migrate -m ./migrations up
```

### Database connection errors

Check your environment variables:

```bash
echo $DATABASE_URL
# or
cat .env | grep DATABASE_URL
```

---

## Additional Resources

- [Database Migrations Guide](../migrations/README.md)
- [Security Fixes Documentation](../SECURITY_FIXES.md)
- [API Documentation](../docs/openapi/)
