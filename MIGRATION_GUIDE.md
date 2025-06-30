# Migration System Guide

## Overview

This project now uses a **consolidated baseline migration system** that's optimized for initial release and production deployment. The migration system has been restructured to:

1. **Baseline Migration**: Single migration that creates the complete initial schema
2. **Separate Data Seeding**: Initial data is now seeded through a separate, safe script
3. **Future Migrations**: New migrations for schema changes after initial release

## File Structure

```
migrations/
├── 0000000000000_baseline.js          # 🆕 Consolidated baseline schema
├── 1747305666855_create-users-table.js # 🗂️ Original migrations (kept for history)
├── 1747305686471_create-special-abilities-table.js
├── ... (other original migrations)
└── 1750980514859_rename-wonder-to-fate.js

scripts/
├── seedInitialData.js                 # 🆕 Safe data seeding script
└── ... (other scripts)
```

## Key Changes Made

### ✅ Production-Safe Improvements

1. **Removed Destructive Migration**: The dangerous `1747361161202_recreate-cards-from-mock-data.js` migration that deleted all data has been replaced
2. **Consolidated Schema**: All table definitions are now in one baseline migration
3. **Safe Data Seeding**: Uses `INSERT ... ON CONFLICT DO NOTHING` for safety
4. **Commit the Untracked Migration**: `1747361161201_add-trigger-moment-enum-values.js` should be committed

### 🆕 New Scripts Available

```bash
# Database Management
npm run migrate:up          # Run all pending migrations
npm run migrate:down        # Rollback last migration
npm run migrate:reset       # Reset all migrations (⚠️ destructive)
npm run seed               # Seed initial data safely
npm run db:fresh           # Full reset + migrate + seed (⚠️ destructive)

# Existing Scripts
npm run migrate            # Show migration status
npm run migrate:create     # Create new migration
```

## Usage Instructions

### For Fresh Installations

```bash
# 1. Set up your database connection
export DATABASE_URL="postgresql://user:password@localhost/mythgame"

# 2. Run the baseline migration
npm run migrate:up

# 3. Seed initial data
npm run seed
```

### For Existing Development Databases

**Option 1: Keep existing data (recommended)**
```bash
# Just run the seeding script to add missing data
npm run seed
```

**Option 2: Fresh start (⚠️ deletes all data)**
```bash
# Complete reset with new system
npm run db:fresh
```

### For Production Deployment

```bash
# 1. Run migrations (safe, won't delete data)
npm run migrate:up

# 2. Seed any missing initial data (safe, uses ON CONFLICT DO NOTHING)
npm run seed
```

## Migration Timeline

### Current Status
- **Baseline Migration**: `0000000000000_baseline.js` - Creates complete initial schema
- **Original Migrations**: Kept for historical reference
- **Future Migrations**: Any new migrations will build on the baseline

### Pre-Release Cleanup Tasks

1. **✅ Commit untracked migration**:
   ```bash
   git add migrations/1747361161201_add-trigger-moment-enum-values.js
   git commit -m "Add trigger moment enum values migration"
   ```

2. **✅ Commit current changes**:
   ```bash
   git add migrations/1750800000000_create-mail-system.js
   git add migrations/1747361161202_recreate-cards-from-mock-data.js
   git commit -m "Update migrations before consolidation"
   ```

3. **✅ Test the new system**:
   ```bash
   # Test fresh installation
   npm run db:fresh
   
   # Verify data was seeded correctly
   # Check your database for cards, abilities, sets
   ```

## Benefits of New System

### 🚀 For Fresh Installations
- **Single Migration**: One baseline migration instead of 20+ individual migrations
- **Faster Setup**: New developers can set up the complete schema in seconds
- **No Historical Baggage**: Clean, optimized schema without migration artifacts

### 🛡️ For Production Safety
- **No Data Loss**: Seeding script never deletes existing data
- **Idempotent Operations**: Can run seeding multiple times safely
- **Rollback Capability**: Proper migration rollback support

### 🔧 For Development
- **Easy Reset**: `npm run db:fresh` for quick clean slate
- **Separated Concerns**: Schema changes vs. data seeding are separate
- **Future-Proof**: New migrations build on solid baseline

## Adding New Migrations

After the initial release, create new migrations normally:

```bash
# Create new migration
npm run migrate:create add-new-feature

# Edit the generated migration file
# Run the migration
npm run migrate:up
```

## Data Seeding

The seeding script (`scripts/seedInitialData.js`) contains:
- **Initial Sets**: Core Set, Expansion Pack 1
- **Special Abilities**: 25+ unique card abilities
- **Cards**: 10 initial cards with proper relationships

### Adding New Seed Data

Edit `scripts/seedInitialData.js` and add to the respective arrays:
- `initialSets` - for new card sets
- `initialAbilities` - for new special abilities  
- `initialCards` - for new cards

The script will automatically handle relationships and avoid duplicates.

## Troubleshooting

### "Migration already exists" Error
If you get conflicts with existing migrations, you may need to:
1. Backup your current database
2. Run `npm run migrate:reset` (⚠️ destructive)
3. Run `npm run migrate:up` to apply baseline
4. Run `npm run seed` to restore data

### Seeding Fails
- Check your database connection
- Verify the baseline migration ran successfully
- Check for any constraint violations in the logs

## Next Steps

1. **Test the new system thoroughly** in your development environment
2. **Update your deployment scripts** to use the new commands
3. **Document any custom data** your team has that needs to be preserved
4. **Plan your production migration strategy** based on your current database state

---

**⚠️ Important**: Always backup your production database before running any migration commands! 