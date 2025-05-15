# Viking Vengeance: Server-Side Implementation

## Phase 2: API Backend Project Setup & Authentication (Local)

**Objective:** Set up the Node.js/Express.js project structure and implement secure user registration and login APIs with JWT-based authentication. Initialize starter cards and decks for new users.

**Parent Document:** Viking Vengeance: Server-Side Systems - PRD & Implementation Plan
**Prerequisites:** Phase 1 completed (Database schema created in `myth` DB, static data seeded).
**Version:** 1.0
**Date:** May 8, 2025

---

### 1. Prerequisites & Tools

- **Phase 1 Completion:** Local PostgreSQL database `myth` is set up with schema and static card/ability data.
- **Node.js & npm/yarn:** Installed.
- **Project Folder:** `myth-server` created.
- **Core Dependencies from Phase 1:** `pg`, `dotenv`.
- **Text Editor/IDE:** VS Code or any preferred code editor.
- **API Testing Tool:** Postman, Insomnia, or curl for testing API endpoints.
- **TypeScript Configuration:** Ensure strict TypeScript is enabled in `tsconfig.json` with `"strict": true`.

### 2. Install Additional Dependencies

- **Task:** Install Express.js and other necessary libraries for authentication, validation, and development.
- **Action (Run from `myth-server` directory):**
  ```bash
  npm install express cors bcrypt jsonwebtoken # Core libraries
  npm install -D nodemon typescript ts-node @types/node @types/express @types/cors @types/bcrypt @types/jsonwebtoken # TypeScript and development utilities
  npm install swagger-jsdoc swagger-ui-express # For API documentation
  npm install -D @types/swagger-jsdoc @types/swagger-ui-express # TypeScript types for Swagger
  ```
  - `express`: Web framework.
  - `cors`: For enabling Cross-Origin Resource Sharing.
  - `bcrypt`: For hashing passwords.
  - `jsonwebtoken`: For creating and verifying JWTs.
  - `nodemon`: For automatically restarting the server during development.
  - `typescript`, `ts-node`, and type definitions: For TypeScript support.
  - `swagger-jsdoc`, `swagger-ui-express`: For API documentation using OpenAPI.

### 3. Key Tasks & Technical Details

#### 3.1. Setup Basic Express Server & Project Structure

- **Task:** Create the main server entry file and define the basic project structure.
- **Action (`myth-server/src/` directory structure):**
  Create the following directory structure inside `myth-server/`:
  ```
  myth-server/
  ├── src/
  │   ├── api/
  │   │   ├── controllers/
  │   │   │   └── auth.controller.ts
  │   │   ├── middlewares/
  │   │   │   ├── auth.middleware.ts
  │   │   │   └── error.middleware.ts
  │   │   ├── routes/
  │   │   │   ├── index.ts  # Main router for all /api routes
  │   │   │   └── auth.routes.ts
  │   │   └── validators/ # (Optional for now, can add Joi/express-validator later if desired)
  │   ├── config/
  │   │   ├── db.config.ts
  │   │   └── index.ts    # For exporting config variables
  │   ├── models/         # For database interaction logic
  │   │   ├── user.model.ts
  │   │   └── deck.model.ts # For starter deck creation
  │   ├── services/       # For business logic (e.g., starter content service)
  │   │   └── starter.service.ts
  │   ├── types/          # For shared TypeScript type definitions
  │   │   ├── database.types.ts # Created in Phase 1
  │   │   ├── api.types.ts      # New for API request/response types
  │   │   └── index.ts          # For exporting all types
  │   ├── openapi/        # For OpenAPI specifications
  │   │   └── auth.openapi.yaml # Authentication API specs
  │   └── app.ts          # Express app configuration
  ├── .env                # (Already created in Phase 1)
  ├── .gitignore
  ├── package.json
  ├── migrations/         # (From Phase 1)
  └── scripts/            # (From Phase 1)
  ```
- **Action (`myth-server/server.js` - main entry point in root):**

  ```javascript
  // myth-server/server.js
  require("dotenv").config(); // Load environment variables first
  const http = require("http");
  const app = require("./src/app"); // Import the Express app

  const PORT = process.env.PORT || 3000;

  const server = http.createServer(app);

  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access at http://localhost:${PORT}`);
  });
  ```

- **Action (`myth-server/.gitignore` - ensure these are present):**
  ```
  # .gitignore
  node_modules/
  .env
  coverage/
  dist/
  *.log
  ```
- **Action (`myth-server/src/app.ts`):**

  ```typescript
  // myth-server/src/app.ts
  const express = require("express");
  const cors = require("cors");
  const apiRoutes = require("./api/routes"); // Will create this next
  const { centralErrorHandler } = require("./api/middlewares/error.middleware");

  const app = express();

  // Middleware
  app.use(cors()); // Configure specific origins in production
  app.use(express.json()); // Parse JSON request bodies
  app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request bodies

  // API Routes
  app.use("/api", apiRoutes);

  // Health check route
  app.get("/health", (req, res) => {
    res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
  });

  // Centralized Error Handling
  app.use(centralErrorHandler);

  // 404 Handler for undefined routes
  app.use((req, res, next) => {
    res
      .status(404)
      .json({ error: { message: "Resource not found on this server." } });
  });

  module.exports = app;
  ```

#### 3.2. Configure Environment Variables for Authentication

- **Task:** Add JWT related environment variables to `.env`.
- **Action (`myth-server/.env` - add these lines):**
  ```env
  # .env (add these, DATABASE_URL is from Phase 1)
  PORT=3000
  JWT_SECRET=your-very-strong-and-long-jwt-secret-key # Change this to a random string
  JWT_EXPIRES_IN=1h # Or '7d', '30m', etc.
  BCRYPT_SALT_ROUNDS=10
  ```
- **Action (`myth-server/src/config/index.js`):**
  ```javascript
  // myth-server/src/config/index.js
  module.exports = {
    port: process.env.PORT || 3000,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN,
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10),
    databaseUrl: process.env.DATABASE_URL,
  };
  ```

#### 3.3. Database Connection Module

- **Task:** Create a module to manage database connections using `pg.Pool`.
- **Action (`myth-server/src/config/db.config.ts`):**

  ```typescript
  // myth-server/src/config/db.config.ts
  const { Pool } = require("pg");
  const config = require("./index");

  const pool = new Pool({
    connectionString: config.databaseUrl,
    // Optional: SSL configuration for production if needed
    // ssl: {
    //   rejectUnauthorized: false // Necessary for some cloud providers like Heroku, Render
    // }
  });

  pool.on("connect", () => {
    console.log("Connected to the PostgreSQL database!");
  });

  pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
    process.exit(-1);
  });

  module.exports = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(), // For transactions
    pool, // Export pool if needed directly elsewhere
  };
  ```

#### 3.4. Error Handling Middleware

- **Task:** Implement a centralized error handler.
- **Action (`myth-server/src/api/middlewares/error.middleware.ts`):**

  ```typescript
  // myth-server/src/api/middlewares/error.middleware.ts
  const centralErrorHandler = (err, req, res, next) => {
    console.error("ERROR:", err.name, "-", err.message);
    // console.error(err.stack); // Uncomment for detailed stack trace during dev

    let statusCode = err.statusCode || 500;
    let message =
      err.message || "An unexpected internal server error occurred.";
    let errorCode = err.errorCode; // Optional custom error code

    // Handle specific error types if needed
    if (err.name === "ValidationError") {
      // Example for a validation library
      statusCode = 400;
      message = err.details || err.message; // Joi or express-validator might have different structures
    } else if (err.name === "UnauthorizedError") {
      // Example for JWT errors
      statusCode = 401;
      message = "Invalid or missing authentication token.";
    } else if (err.code === "23505") {
      // Postgres unique violation
      statusCode = 409; // Conflict
      message = "A record with the provided details already exists.";
      // You might want to parse err.detail to provide a more specific message.
    }

    const errorResponse = {
      error: {
        message: message,
        statusCode: statusCode,
      },
    };
    if (errorCode) {
      errorResponse.error.code = errorCode;
    }

    res.status(statusCode).json(errorResponse);
  };

  module.exports = { centralErrorHandler };
  ```

#### 3.5. User Model for Database Interactions

- **Task:** Create a model to handle DB operations for users.
- **Action (`myth-server/src/models/user.model.ts`):**

  ```typescript
  // myth-server/src/models/user.model.ts
  const db = require("../config/db.config");
  const bcrypt = require("bcrypt");
  const config = require("../config");

  const UserModel = {
    async create({ username, email, password }) {
      const hashedPassword = await bcrypt.hash(
        password,
        config.bcryptSaltRounds
      );
      const query = `
        INSERT INTO "Users" (username, email, password_hash, in_game_currency, created_at, last_login_at)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING user_id, username, email, in_game_currency, created_at, last_login_at;
      `;
      // Initial currency can be set here if different from DB default
      const values = [username, email, hashedPassword, 0];
      const { rows } = await db.query(query, values);
      return rows[0];
    },

    async findByEmail(email) {
      const query = `SELECT * FROM "Users" WHERE email = $1;`;
      const { rows } = await db.query(query, [email]);
      return rows[0];
    },

    async findByUsername(username) {
      const query = `SELECT * FROM "Users" WHERE username = $1;`;
      const { rows } = await db.query(query, [username]);
      return rows[0];
    },

    async findById(userId) {
      const query = `SELECT user_id, username, email, in_game_currency, created_at, last_login_at FROM "Users" WHERE user_id = $1;`;
      const { rows } = await db.query(query, [userId]);
      return rows[0];
    },

    async updateLastLogin(userId) {
      const query = `UPDATE "Users" SET last_login_at = NOW() WHERE user_id = $1;`;
      await db.query(query, [userId]);
    },
  };

  module.exports = UserModel;
  ```

#### 3.6. Starter Content Service and Deck Model (Simplified)

- **Task:** Define starter content and create a service to grant it, creating `UserCardInstance` records.
- **Action (`myth-server/src/services/starter.service.ts`):**

  ```typescript
  // myth-server/src/services/starter.service.ts
  import { PoolClient } from "pg";
  import db from "../config/db.config";
  import DeckModel from "../models/deck.model";
  import CardModel from "../models/card.model"; // To get base card details
  import { UserCardInstance } from "../types/database.types";

  // Define Starter Content (IDs should match those in your Cards table after seeding)
  const STARTER_BASE_CARD_NAMES_AND_QUANTITIES: {
    name: string;
    quantity: number;
  }[] = [
    { name: "Odin, Allfather", quantity: 1 }, // Assuming Odin is Legendary
    { name: "Freya, Vanadis", quantity: 1 }, // Assuming Freya is Legendary or Epic
    // Add more common/uncommon cards to reach 20 total instances for the deck
    // Example: Assuming these are non-legendary and we give 2 copies of each
    { name: "Valkyrie Recruit", quantity: 2 },
    { name: "Shield Maiden", quantity: 2 },
    { name: "Berserker Initiate", quantity: 2 },
    { name: "Rune Carver Acolyte", quantity: 2 },
    { name: "Scout of Midgard", quantity: 2 },
    { name: "Aesir Guard", quantity: 2 },
    { name: "Vanir Healer", quantity: 2 },
    { name: "Forest Troll", quantity: 2 },
    { name: "Mountain Giant", quantity: 1 }, // Example of a single non-legendary if needed for deck count
  ]; // This list needs to result in 20 card instances for the deck, respecting legendary limits.

  const STARTER_DECK_CONFIG = {
    name: "Valiant Starter Deck",
  };

  const StarterService = {
    async grantStarterContent(userId: string): Promise<void> {
      const client: PoolClient = await db.getClient();
      try {
        await client.query("BEGIN");

        // 1. Get actual card_ids for starter card names
        const baseCardNames = STARTER_BASE_CARD_NAMES_AND_QUANTITIES.map(
          (c) => c.name
        );
        const cardNamePlaceholders = baseCardNames
          .map((_, i) => `$${i + 1}`)
          .join(",");

        const cardRes = await client.query(
          `SELECT card_id, name, rarity FROM "Cards" WHERE name IN (${cardNamePlaceholders});`,
          baseCardNames
        );
        const cardIdMap = new Map<string, { card_id: string; rarity: string }>(
          cardRes.rows.map((card) => [
            card.name,
            { card_id: card.card_id, rarity: card.rarity },
          ])
        );

        if (cardRes.rows.length !== baseCardNames.length) {
          console.warn(
            "Not all starter base cards found in DB. Check STARTER_BASE_CARD_NAMES_AND_QUANTITIES.",
            cardRes.rows.map((r) => r.name)
          );
          // Potentially throw an error or handle gracefully
        }

        // 2. Create UserCardInstance records for each copy of starter cards
        const createdCardInstanceIds: string[] = [];
        for (const cardInfo of STARTER_BASE_CARD_NAMES_AND_QUANTITIES) {
          const baseCardDetails = cardIdMap.get(cardInfo.name);
          if (baseCardDetails) {
            for (let i = 0; i < cardInfo.quantity; i++) {
              // Create a new instance for each copy
              const instanceRes = await client.query(
                'INSERT INTO "UserCardInstances" (user_id, card_id, level, xp) VALUES ($1, $2, 1, 0) RETURNING user_card_instance_id;',
                [userId, baseCardDetails.card_id]
              );
              createdCardInstanceIds.push(
                instanceRes.rows[0].user_card_instance_id
              );
            }
          }
        }
        console.log(
          `Granted ${createdCardInstanceIds.length} starter card instances to user ${userId}`
        );

        // 3. Create starter deck using the newly created card instances
        // Ensure the selected instances for the deck meet deck rules (20 cards total, max 2 legendary, max 2 of same base card)
        // This logic needs to be robust based on STARTER_BASE_CARD_NAMES_AND_QUANTITIES
        let deckLegendaryCount = 0;
        const deckInstanceIds: string[] = [];
        const baseCardCountInDeck = new Map<string, number>();

        // Select instances for the deck, respecting rules
        // This assumes STARTER_BASE_CARD_NAMES_AND_QUANTITIES is designed to form a valid 20-card deck.
        // A more robust selection might be needed if the sum of quantities > 20 or rules are complex.
        // For simplicity, we'll use all created instances if their total is 20 and they follow rules.

        if (createdCardInstanceIds.length !== 20) {
          // This check is a placeholder. The STARTER_BASE_CARD_NAMES_AND_QUANTITIES needs to be defined
          // such that the sum of quantities is exactly 20.
          console.warn(
            `Starter deck for user ${userId} will not have exactly 20 cards based on instance creation. Needs ${
              20 - createdCardInstanceIds.length
            } more cards.`
          );
          // For now, we will proceed with creating a deck with the instances available.
          // Proper deck validation will occur in Phase 3.
        }

        // This simplified loop assumes the `createdCardInstanceIds` are already chosen for the deck.
        // In a real scenario, you'd iterate through `STARTER_BASE_CARD_NAMES_AND_QUANTITIES`
        // and pick corresponding `user_card_instance_id`s ensuring deck rules.
        // For now, let's assume createdCardInstanceIds are the ones to be added to the deck.
        const deckInstancesForCreation = createdCardInstanceIds.slice(0, 20); // Take up to 20 instances

        await DeckModel.createWithClient(
          client,
          userId,
          STARTER_DECK_CONFIG.name,
          deckInstancesForCreation // Pass array of user_card_instance_id
        );
        console.log(
          `Created starter deck "${STARTER_DECK_CONFIG.name}" for user ${userId} with ${deckInstancesForCreation.length} cards.`
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error granting starter content:", error);
        throw error; // Re-throw to be caught by controller
      } finally {
        client.release();
      }
    },
  };
  export default StarterService; // Assuming ES Module style export
  ```

- **Action (`myth-server/src/models/deck.model.ts`):** Modify `createWithClient` to accept an array of `user_card_instance_id`s.

  ```typescript
  // myth-server/src/models/deck.model.ts
  import { PoolClient } from "pg";
  import db from "../config/db.config";
  // Import UserCardInstance if needed for typing, or just expect string[] for instance IDs

  const DeckModel = {
    // Creates a deck and its cards within a transaction using a provided client
    async createWithClient(
      client: PoolClient,
      userId: string,
      deckName: string,
      userCardInstanceIds: string[]
    ) {
      const deckQuery = `
        INSERT INTO "Decks" (user_id, name, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        RETURNING deck_id, name, user_id, created_at, updated_at;
      `;
      const deckResult = await client.query(deckQuery, [userId, deckName]);
      const deck = deckResult.rows[0];

      if (userCardInstanceIds && userCardInstanceIds.length > 0) {
        const cardInsertPromises = userCardInstanceIds.map((instanceId) => {
          const deckCardQuery = `
            INSERT INTO "DeckCards" (deck_id, user_card_instance_id)
            VALUES ($1, $2);
          `;
          return client.query(deckCardQuery, [deck.deck_id, instanceId]);
        });
        await Promise.all(cardInsertPromises);
      }
      // Fetching cards for response consistency can be more complex now as it involves UserCardInstances.
      // For simplicity, we'll return the basic deck info + instance IDs for now.
      // A more complete deck representation will be handled in Phase 3.
      return {
        deck_id: deck.deck_id,
        name: deck.name,
        user_id: deck.user_id,
        created_at: deck.created_at,
        updated_at: deck.updated_at,
        user_card_instance_ids: userCardInstanceIds,
      };
    },
    // Add other deck methods (find, update, delete) in Phase 3
  };
  export default DeckModel; // Assuming ES Module style export
  ```

#### 3.7. API Type Definitions

- **Task:** Create TypeScript type definitions for API requests and responses.
- **Action (`myth-server/src/types/api.types.ts`):**

  ```typescript
  // myth-server/src/types/api.types.ts

  /**
   * Type definitions for API requests and responses
   * These will be maintained in a separate file for future packaging as an NPM module
   */

  // Authentication types
  export interface RegisterRequest {
    username: string;
    email: string;
    password: string;
  }

  export interface LoginRequest {
    email: string;
    password: string;
  }

  export interface AuthResponse {
    token: string;
    user: {
      user_id: string;
      username: string;
      email: string;
      in_game_currency: number;
    };
  }

  // Error response types
  export interface ErrorResponse {
    error: {
      message: string;
      statusCode: number;
      code?: string;
    };
  }
  ```

#### 3.8. OpenAPI Specification for Authentication

- **Task:** Create OpenAPI specifications for authentication endpoints.
- **Action (`myth-server/src/openapi/auth.openapi.yaml`):**

  ```yaml
  # myth-server/src/openapi/auth.openapi.yaml
  openapi: 3.0.0
  info:
    title: Viking Vengeance Authentication API
    description: API for user registration and authentication
    version: 1.0.0

  paths:
    /api/auth/register:
      post:
        summary: Register a new user
        tags:
          - Authentication
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                required:
                  - username
                  - email
                  - password
                properties:
                  username:
                    type: string
                    example: thor_hammer
                  email:
                    type: string
                    format: email
                    example: thor@asgard.com
                  password:
                    type: string
                    format: password
                    example: mjolnir123
        responses:
          201:
            description: User registered successfully
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    token:
                      type: string
                    user:
                      type: object
                      properties:
                        user_id:
                          type: string
                          format: uuid
                        username:
                          type: string
                        email:
                          type: string
                        in_game_currency:
                          type: number
          400:
            description: Bad request (validation error)
          409:
            description: User already exists with that email or username
          500:
            description: Server error

    /api/auth/login:
      post:
        summary: Log in an existing user
        tags:
          - Authentication
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                required:
                  - email
                  - password
                properties:
                  email:
                    type: string
                    format: email
                    example: thor@asgard.com
                  password:
                    type: string
                    format: password
                    example: mjolnir123
        responses:
          200:
            description: Login successful
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    token:
                      type: string
                    user:
                      type: object
                      properties:
                        user_id:
                          type: string
                          format: uuid
                        username:
                          type: string
                        email:
                          type: string
                        in_game_currency:
                          type: number
          400:
            description: Invalid email or password
          401:
            description: Authentication failed
          500:
            description: Server error
  ```

#### 3.9. Integrate OpenAPI with Express

- **Task:** Set up Swagger UI to serve the OpenAPI documentation.
- **Action (Update `myth-server/src/app.ts`):**

  ```typescript
  // Add to myth-server/src/app.ts

  // Import Swagger packages
  const swaggerJSDoc = require("swagger-jsdoc");
  const swaggerUi = require("swagger-ui-express");
  const fs = require("fs");
  const path = require("path");

  // Swagger setup
  const authApiSpec = fs.readFileSync(
    path.join(__dirname, "openapi/auth.openapi.yaml"),
    "utf8"
  );

  // Setup Swagger
  const swaggerOptions = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "Viking Vengeance API",
        version: "1.0.0",
        description: "API for the Viking Vengeance card game",
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Development server",
        },
      ],
    },
    // Path to API docs
    apis: ["./src/openapi/*.yaml"],
  };

  const swaggerSpec = swaggerJSDoc(swaggerOptions);

  // In your app setup
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Health check route and API routes as before
  ```

---

### 4. Testing Points for Phase 2

- [ ] **Server Starts:** `npm run dev` starts the server without errors, and `nodemon` restarts on file changes. `http://localhost:3000/health` returns 200 OK.
- [ ] **User Registration (`POST /api/auth/register`):**
  - [ ] Successful registration with valid, unique username, email, and password returns 201, user object, and JWT.
  - [ ] Database: New user is created in `Users` table with hashed password and correct default currency.
  - [ ] Database: Starter cards are added to `UserOwnedCards` for the new user.
  - [ ] Database: A starter deck is created in `Decks` and `DeckCards` for the new user.
  - [ ] Attempting to register with an existing email returns 409 Conflict.
  - [ ] Attempting to register with an existing username returns 409 Conflict.
  - [ ] Registration with missing fields (username, email, password) returns 400 Bad Request.
  - [ ] Registration with a short password returns 400 Bad Request.
- [ ] **User Login (`POST /api/auth/login`):**
  - [ ] Successful login with correct email and password returns 200, user object, and JWT.
  - [ ] Database: `last_login_at` is updated for the user.
  - [ ] Login with incorrect password returns 401 Unauthorized.
  - [ ] Login with non-existent email returns 401 Unauthorized (or 404, depending on desired behavior for security - 401 is common to not reveal if email exists).
  - [ ] Login with missing fields returns 400 Bad Request.
- [ ] **JWT Protection (Manual Test - Create a dummy protected route for now):**
  - [ ] Accessing a protected route without a token returns 401.
  - [ ] Accessing a protected route with an invalid/expired token returns 401.
  - [ ] Accessing a protected route with a valid token (obtained from login/register) allows access.
- [ ] **Error Handling:** Invalid requests or server errors result in standardized JSON error responses handled by `centralErrorHandler`. Check for appropriate status codes.
- [ ] Database: New `UserCardInstance` records are created for each starter card copy.
- [ ] Database: A starter deck is created in `Decks` and `DeckCards` (linking to `UserCardInstance` records) for the new user.

---

### 5. Next Steps

Upon successful completion of Phase 2, the project will have a functional authentication system. The next phase (Phase 3) will focus on implementing the core resource APIs for users, cards, and decks.

**Important Development Standards:**

1. **Strict TypeScript:** All TypeScript code must use strict mode, as configured in `tsconfig.json`.
2. **Type Definitions:** Maintain all shared type definitions (including `UserCardInstance` and updated `DeckCard`) in the separate `src/types` directory files.
3. **OpenAPI Documentation:** Create OpenAPI specifications for all new API endpoints in the `src/openapi` directory, following the established pattern.
4. **Code Documentation:** Use JSDoc comments to document all important functions, classes, and interfaces.
