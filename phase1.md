# Myth: Server-Side Implementation

## Phase 1: Database Schema & Initial Setup (Local) - REVISED

**Objective:** Define and create the core PostgreSQL database schema locally. Populate static card and ability data in the `myth` database.

**Parent Document:** Myth: Server-Side Systems - PRD & Implementation Plan
**Version:** 1.1 (Revised for user's setup)
**Date:** May 8, 2025

---

### 1. Prerequisites & Tools

- **Local PostgreSQL Installation:** PostgreSQL (Version 12+ recommended) is installed and running on your development machine.
  - _Status:_ User confirmed installed.
- **Database `myth`:** A PostgreSQL database named `myth` has been created, and the default `postgres` user has access.
  - _Status:_ User confirmed created.
- **Database Client:** Any SQL client for interacting with PostgreSQL (e.g., `psql` CLI, pgAdmin, DBeaver).
  - _Action:_ Ensure your chosen DB client is configured to connect to the `myth` database as the `postgres` user.
- **Node.js & npm/yarn:** Node.js (LTS version) and your preferred package manager are installed.
  - _Status:_ Assumed installed for previous steps.
- **Project Setup:**
  - Project folder: `myth-server` created.
  - Dependencies installed: `pg`, `dotenv`, `node-pg-migrate`.
  - Folders created: `migrations`, `scripts`.
  - _Status:_ User confirmed setup.
- **Text Editor/IDE:** VS Code or any preferred code editor.
- **TypeScript Configuration:** Ensure TypeScript is configured with strict mode enabled in `tsconfig.json`.
  - _Action:_ Confirm `"strict": true` is set in the `tsconfig.json` compilerOptions.

### 2. Key Tasks & Technical Details

#### 2.1. Configure Database Connection & Migration Tool

- **Task:** Configure environment variables for database connection in `.env` file within the `myth-server` directory.
- **Action (`myth-server/.env` file content):**
  ```env
  # .env
  DATABASE_URL=postgres://postgres@localhost:5432/myth
  # If your local 'postgres' user has a password, include it:
  # DATABASE_URL=postgres://postgres:yourpassword@localhost:5432/myth
  ```
  - **Note:** Ensure this `.env` file is added to your `.gitignore` file to prevent committing credentials.
- **Task:** Configure `node-pg-migrate` in `package.json`.
- **Action (Update `myth-server/package.json`):**
  ```json
  // package.json
  {
    "name": "myth-server",
    "version": "1.0.0",
    "description": "Server for Myth (Myth) card game",
    "main": "server.js", // Or your main entry file, to be created in Phase 2
    "scripts": {
      "migrate": "node-pg-migrate -m ./migrations -j ts", // -j ts if using TypeScript for migrations, else remove
      "migrate:create": "node-pg-migrate -m ./migrations -j ts create", // Adjust if not using TS
      "seed": "node scripts/seedDatabase.js" // Added seed script command
      // ... other scripts like "start", "dev" will be added later
    },
    "dependencies": {
      "dotenv": "^16.x.x", // Use actual installed version
      "pg": "^8.x.x" // Use actual installed version
    },
    "devDependencies": {
      "node-pg-migrate": "^6.x.x" // Use actual installed version
    }
  }
  ```
  - **Important:** The `-m ./migrations` flag explicitly tells `node-pg-migrate` where your migrations are.
  - **TypeScript Note:** If you plan to write migrations or seed scripts in TypeScript, you'll need `ts-node` and `typescript` as dev dependencies and adjust the scripts accordingly (e.g., `migrate: "ts-node node_modules/.bin/node-pg-migrate -m ./migrations"`). For simplicity, this plan will assume JavaScript for migrations and seed scripts unless you specify otherwise. If using JS, remove `-j ts`.

#### 2.2. Write Initial Migration Scripts (in `myth-server/migrations/`)

- **Task:** Create migration files for each table using the `node-pg-migrate` create command. These files will be placed in your `myth-server/migrations/` directory.
- **Action (Run from `myth-server` directory):**
  ```bash
  npm run migrate:create create_users_table
  npm run migrate:create create_special_abilities_table
  npm run migrate:create create_cards_table
  npm run migrate:create create_user_owned_cards_table
  npm run migrate:create create_decks_table
  npm run migrate:create create_deck_cards_table
  npm run migrate:create create_games_table
  ```
- **Task:** Implement the SQL DDL (Data Definition Language) within each generated migration file. Each migration file will have an `up` function (to apply the migration) and a `down` function (to revert it). The content of these files is identical to the "Migration 1" through "Migration 7" provided in the previous response (starting with `exports.up = pgm => { ... };`).
  - _Action:_ Copy the JavaScript code for each migration (Users, SpecialAbilities, Cards, etc.) into the corresponding newly generated files in your `migrations` folder.

#### 2.3. Apply Migrations

- **Task:** Run the migration tool to create the schema in your local `myth` database.
- **Action (Run from `myth-server` directory):**
  ```bash
  npm run migrate up
  ```
- **Verification:** Use your DB client to connect to the `myth` database as the `postgres` user. Verify all tables, columns, constraints, and indexes are created as expected.

#### 2.4. Create Data Seeding Script (in `myth-server/scripts/`)

- **Task:** Create a `game-data.js` file within `myth-server/scripts/` to hold your card and ability definitions.
- **Action (`myth-server/scripts/game-data.js`):**

  ```javascript
  // myth-server/scripts/game-data.js
  const SPECIAL_ABILITIES_DATA = [
    // (As provided in previous response, e.g., gungnir_strike, shield_wall)
    {
      id: "gungnir_strike",
      name: "Gungnir Strike",
      description:
        "OnPlace: If opponent has more cards, gain +2 power in all directions.",
      triggerMoment: "OnPlace",
      parameters: {
        condition: "opponent_more_cards",
        effect: "buff_all",
        value: 2,
      },
    },
    {
      id: "shield_wall",
      name: "Shield Wall",
      description: "This card cannot be flipped for 1 turn after placement.",
      triggerMoment: "OnPlace",
      parameters: { effect: "temporary_immunity", duration: 1 },
    },
    // ... Add ALL your special abilities here
  ];

  const CARDS_DATA = [
    // (As provided in previous response, e.g., odin, freya)
    {
      id_placeholder: "odin",
      name: "Odin",
      rarity: "legendary",
      imageUrl: "assets/cards/odin.png",
      power: { top: 8, right: 5, bottom: 3, left: 9 },
      specialAbilityId: "gungnir_strike",
      tags: ["aesir", "leader", "god"],
    },
    {
      id_placeholder: "freya",
      name: "Freya",
      rarity: "epic",
      imageUrl: "assets/cards/freya.png",
      power: { top: 6, right: 6, bottom: 4, left: 7 },
      specialAbilityId: null,
      tags: ["vanir", "magic", "god"],
    },
    // ... Add ALL your cards here. Note: 'id_placeholder' is just for reference from your original TS structure; the DB card_id is a UUID.
  ];
  module.exports = { CARDS_DATA, SPECIAL_ABILITIES_DATA };
  ```

- **Task:** Create the Node.js seeding script `myth-server/scripts/seedDatabase.js`.
- **Action (`myth-server/scripts/seedDatabase.js`):**

  - The content of this script is identical to the `seedDatabase.js` provided in the previous response.
  - **Key update within the script:**
    ```javascript
    // At the top of scripts/seedDatabase.js
    require("dotenv").config({ path: "../.env" }); // Ensure this path is correct relative to where script is run FROM.
    // If running `node scripts/seedDatabase.js` from `myth-server`, then:
    // require('dotenv').config({ path: './.env' }); // or simply require('dotenv').config(); if .env is in root
    ```
    A common practice is to have `dotenv.config()` at the very start of your application or script entry points. If you run `node scripts/seedDatabase.js` from the `myth-server` root, `require('dotenv').config();` should work if `.env` is also in the root.
    The script should look like this:

  ```javascript
  // myth-server/scripts/seedDatabase.js
  require("dotenv").config(); // Assuming .env is in the root (myth-server)
  const { Pool } = require("pg");
  const { CARDS_DATA, SPECIAL_ABILITIES_DATA } = require("./game-data");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // ... (rest of the seedSpecialAbilities and seedCards functions as previously defined) ...

  async function main() {
    console.log("Connecting to database for seeding...");
    const client = await pool.connect(); // Explicitly connect
    try {
      console.log("Starting database seeding...");
      await seedSpecialAbilities(client); // Pass client to functions
      await seedCards(client); // Pass client to functions
      console.log("Database seeding completed.");
    } catch (err) {
      console.error("Seeding failed:", err);
    } finally {
      client.release(); // Release client
      await pool.end(); // Close pool
      console.log("Database connection closed.");
    }
  }

  // Modify seed functions to accept client
  async function seedSpecialAbilities(client) {
    for (const ability of SPECIAL_ABILITIES_DATA) {
      try {
        await client.query(/* ... SQL from previous example ... */);
        console.log(`Seeded ability: ${ability.name}`);
      } catch (err) {
        /* ... error handling ... */
      }
    }
  }

  async function seedCards(client) {
    for (const card of CARDS_DATA) {
      try {
        await client.query(/* ... SQL from previous example ... */);
        console.log(`Seeded card: ${card.name}`);
      } catch (err) {
        /* ... error handling ... */
      }
    }
  }

  main();
  ```

#### 2.5. Type Definitions

- **Task:** Create type definitions in a separate file to document the database schema.
- **Action (`myth-server/src/types/database.types.ts`):**

  ```typescript
  // myth-server/src/types/database.types.ts

  /**
   * Type definitions for database schemas
   * These will be maintained in a separate file for future packaging as an NPM module
   */

  export interface User {
    user_id: string;
    username: string;
    email: string;
    password_hash: string;
    in_game_currency: number;
    created_at: Date;
    last_login: Date;
  }

  export interface SpecialAbility {
    ability_id: string;
    id: string;
    name: string;
    description: string;
    triggerMoment:
      | "OnPlace"
      | "OnFlip"
      | "OnFlipped"
      | "OnTurnStart"
      | "OnTurnEnd";
    parameters: Record<string, any>;
  }

  export interface Card {
    card_id: string;
    name: string;
    rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
    image_url: string;
    power: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
    special_ability_id: string | null;
    tags: string[];
  }

  export interface UserCardInstance {
    user_card_instance_id: string;
    user_id: string;
    card_id: string;
    level: number;
    xp: number;
  }

  export interface Deck {
    deck_id: string;
    user_id: string;
    name: string;
    created_at: Date;
    last_updated: Date;
  }

  export interface DeckCard {
    deck_card_id: string;
    deck_id: string;
    user_card_instance_id: string;
  }

  export interface Game {
    game_id: string;
    player1_id: string;
    player2_id: string;
    player1_deck_id: string;
    player2_deck_id: string;
    game_mode: "solo" | "pvp";
    winner_id: string | null;
    game_status: "pending" | "active" | "completed" | "aborted";
    game_state: Record<string, any>;
    board_layout: "4x4";
    created_at: Date;
    completed_at: Date | null;
  }
  ```

#### 2.6. Run Seeding Script

- **Task:** Execute the `seedDatabase.js` script using the `npm run seed` command.
- **Action (Run from `myth-server` directory):**
  ```bash
  npm run seed
  ```
- **Verification:**
  - Check script output for success/error messages.
  - Use your DB client to query the `SpecialAbilities` and `Cards` tables in the `myth` database. Verify data is populated correctly.
  - Ensure `special_ability_id` in `Cards` correctly references `SpecialAbilities` or is NULL.

---

### 3. Testing Points for Phase 1

- [ ] **Database Schema:** All tables, columns, data types, primary keys, foreign keys, `UNIQUE` constraints, `CHECK` constraints, and `DEFAULT` values are created correctly in the local `myth` database.
- [ ] **Indexes:** Indexes specified in the migration scripts are created on the relevant tables and columns.
- [ ] **Migrations Reversibility:** Migrations can be run down (e.g., `npm run migrate down`) and then up again without errors (test a few or all).
- [ ] **Data Seeding - Special Abilities:** The `SpecialAbilities` table is populated accurately from the `SPECIAL_ABILITIES_DATA` source. `parameters` field is stored as JSONB.
- [ ] **Data Seeding - Cards:** The `Cards` table is populated accurately from the `CARDS_DATA` source. All fields, including power values and tags, are correct. Foreign key `special_ability_id` correctly links to `SpecialAbilities` or is `NULL`.
- [ ] **Data Integrity:** Test `ON DELETE` constraints (e.g., deleting a `SpecialAbility` should set `special_ability_id` to `NULL` in referencing `Cards`). Deleting a `User` should cascade delete their `Decks` and `UserOwnedCards`. (Manual tests for now).

---

### 4. Next Steps

Upon successful completion of Phase 1, the project will have a fully structured local database (`myth`) with initial static game data, ready for the API development in Phase 2 (Authentication & Project Setup).

**Important Development Standards:**

1. **Strict TypeScript:** All TypeScript code must use strict mode, as configured in `tsconfig.json`.
2. **Type Definitions:** Maintain all shared type definitions in the separate `src/types` directory files to facilitate future extraction as an NPM package.
3. **Documentation:** Use JSDoc comments to document all important functions, classes, and interfaces.
