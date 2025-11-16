import { Request, Response } from "express";
import SetModel from "../../models/set.model";
import UserModel from "../../models/user.model";
import { AuthenticatedRequest, RarityUtils } from "../../types";
import { spawn } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import db from "../../config/db.config";
import fs from "fs";
import path from "path";
import AIAutomationService from "../../services/aiAutomation.service";
import DailyRewardsService from "../../services/dailyRewards.service";
import StarterService from "../../services/starter.service";

const execAsync = promisify(exec);

const AdminController = {
  async givePacksToUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, quantity } = req.body;

      if (!userId || !quantity) {
        return res.status(400).json({
          status: "error",
          message: "userId and quantity are required",
        });
      }

      if (quantity <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Quantity must be greater than 0",
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      // Add packs to user's inventory
      const updatedUser = await UserModel.addPacks(userId, quantity);

      return res.status(200).json({
        user_id: updatedUser?.user_id,
        username: updatedUser?.username,
        pack_count: updatedUser?.pack_count,
      });
    } catch (error) {
      console.error("Error giving packs to user:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async setUserPackQuantity(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, quantity } = req.body;

      if (!userId || typeof quantity !== "number") {
        return res.status(400).json({
          status: "error",
          message: "userId and quantity are required",
        });
      }

      if (quantity < 0) {
        return res.status(400).json({
          status: "error",
          message: "Quantity cannot be negative",
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      // Set pack quantity for user
      const updatedUser = await UserModel.setPackCount(userId, quantity);

      return res.status(200).json({
        user_id: updatedUser?.user_id,
        username: updatedUser?.username,
        pack_count: updatedUser?.pack_count,
      });
    } catch (error) {
      console.error("Error setting user pack quantity:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async getUserPackCount(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          status: "error",
          message: "User ID is required",
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      const packCount = await UserModel.getPackCount(userId);

      return res.status(200).json({
        user_id: user.user_id,
        username: user.username,
        pack_count: packCount,
      });
    } catch (error) {
      console.error("Error getting user pack count:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async runMigrations(req: Request, res: Response) {
    try {
      console.log("🚀 Admin endpoint: Running database migrations...");

      // Check if this is a safe operation by verifying database connectivity first
      try {
        await db.query("SELECT 1");
      } catch (dbError) {
        return res.status(503).json({
          status: "error",
          message: "Database connection failed",
          error:
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error",
        });
      }

      // Run migrations using node-pg-migrate
      const migrationCommand = "npx node-pg-migrate -m ./migrations up";

      try {
        const { stdout, stderr } = await execAsync(migrationCommand, {
          cwd: process.cwd(),
          env: { ...process.env },
        });

        console.log("Migration stdout:", stdout);
        if (stderr) {
          console.log("Migration stderr:", stderr);
        }

        // Check if migrations were successful
        const successKeywords = [
          "No migrations to run",
          "Migrations complete",
          "Migration completed",
        ];
        const isSuccess =
          successKeywords.some(
            (keyword) => stdout.includes(keyword) || stderr.includes(keyword)
          ) ||
          (!stderr && stdout);

        if (isSuccess) {
          return res.status(200).json({
            status: "success",
            message: "Database migrations completed successfully",
            output: stdout,
            warnings: stderr || null,
            timestamp: new Date().toISOString(),
          });
        } else {
          return res.status(500).json({
            status: "error",
            message: "Migration command executed but may have failed",
            output: stdout,
            error: stderr,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (execError: any) {
        console.error("Migration execution error:", execError);
        return res.status(500).json({
          status: "error",
          message: "Failed to execute migrations",
          error: execError.message,
          output: execError.stdout || null,
          stderr: execError.stderr || null,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Admin migration endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during migration",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async seedDatabase(req: Request, res: Response) {
    try {
      console.log("🌱 Admin endpoint: Seeding database...");

      // Check database connectivity
      try {
        await db.query("SELECT 1");
      } catch (dbError) {
        return res.status(503).json({
          status: "error",
          message: "Database connection failed",
          error:
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error",
        });
      }

      // Check if the database-queries.sql file exists
      const sqlFilePath = path.join(
        process.cwd(),
        "scripts",
        "database-queries.sql"
      );
      if (!fs.existsSync(sqlFilePath)) {
        return res.status(404).json({
          status: "error",
          message: "Database queries file not found",
          expectedPath: sqlFilePath,
        });
      }

      // Read and execute the SQL queries
      const sqlContent = fs.readFileSync(sqlFilePath, "utf8");

      // Split queries by semicolon and filter out empty queries and comments
      const queries = sqlContent
        .split(";")
        .map((query) => query.trim())
        .filter(
          (query) =>
            query.length > 0 &&
            !query.startsWith("--") &&
            !query.startsWith("/*") &&
            !query.match(/^\s*$/)
        );

      let successCount = 0;
      let errorCount = 0;
      const errors: any[] = [];

      console.log(`📊 Processing ${queries.length} queries...`);

      // Execute queries in batches
      const batchSize = 10;
      for (let i = 0; i < queries.length; i += batchSize) {
        const batch = queries.slice(i, i + batchSize);

        for (let j = 0; j < batch.length; j++) {
          const query = batch[j];
          const queryNumber = i + j + 1;

          try {
            await db.query(query + ";");
            successCount++;
          } catch (error: any) {
            errorCount++;
            errors.push({
              queryNumber,
              query:
                query.substring(0, 100) + (query.length > 100 ? "..." : ""),
              error: error.message,
            });

            // For seeding, we continue on conflicts (data might already exist)
            if (
              !error.message.includes("duplicate key") &&
              !error.message.includes("already exists")
            ) {
              console.error(`Query ${queryNumber} failed:`, error.message);
            }
          }
        }

        // Small delay between batches
        if (i + batchSize < queries.length) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      const duration = Date.now();
      const hasSignificantErrors =
        errors.filter(
          (e) =>
            !e.error.includes("duplicate key") &&
            !e.error.includes("already exists")
        ).length > 0;

      if (hasSignificantErrors) {
        return res.status(207).json({
          // 207 Multi-Status for partial success
          status: "partial_success",
          message: "Database seeding completed with some errors",
          summary: {
            totalQueries: queries.length,
            successful: successCount,
            failed: errorCount,
            significantErrors: errors.filter(
              (e) =>
                !e.error.includes("duplicate key") &&
                !e.error.includes("already exists")
            ).length,
          },
          errors: errors.slice(0, 10), // Limit errors in response
          timestamp: new Date().toISOString(),
        });
      } else {
        return res.status(200).json({
          status: "success",
          message: "Database seeding completed successfully",
          summary: {
            totalQueries: queries.length,
            successful: successCount,
            failed: errorCount,
            duplicatesIgnored: errors.filter(
              (e) =>
                e.error.includes("duplicate key") ||
                e.error.includes("already exists")
            ).length,
          },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Admin seeding endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during database seeding",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async markMigrationsAsRun(req: Request, res: Response) {
    try {
      console.log(
        "✅ Admin endpoint: Marking duplicate migrations as already run..."
      );

      // Check database connectivity first
      try {
        await db.query("SELECT 1");
      } catch (dbError) {
        return res.status(503).json({
          status: "error",
          message: "Database connection failed",
          error:
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error",
        });
      }

      // List of migrations to mark as run (these are duplicates of the baseline)
      const migrationsToMark = [
        "1747305666855_create-users-table",
        "1747305686471_create-special-abilities-table",
        "1747305702109_create-sets-table",
        "1747305702110_create-cards-table",
        "1747305720869_create-user-owned-cards-table",
        "1747305737036_create-decks-table",
        "1747305760569_create-deck-cards-table",
        "1747305777476_create-games-table",
        "1750694457171_create-pack-opening-history-table",
        "1750694458000_add-dual-currency-system",
        "1750694459000_create-user-card-xp-pools",
        "1750694460000_create-xp-transfers-table",
        "1750700000000_create-friendships-table",
        "1750710000000_create-leaderboard-system",
        "1750720000000_create-achievements-system",
        "1750800000000_create-mail-system",
        "1750979290019_wonder-picks-system",
      ];

      let markedCount = 0;
      const errors: string[] = [];

      for (const migration of migrationsToMark) {
        try {
          // Check if migration is already marked as run
          const existing = await db.query(
            "SELECT name FROM pgmigrations WHERE name = $1",
            [migration]
          );

          if (existing.rows.length === 0) {
            // Mark as run without executing
            await db.query(
              "INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())",
              [migration]
            );
            markedCount++;
            console.log(`✅ Marked ${migration} as run`);
          } else {
            console.log(`⏭️  ${migration} already marked as run`);
          }
        } catch (error: any) {
          errors.push(`${migration}: ${error.message}`);
        }
      }

      return res.status(200).json({
        status: "success",
        message: `Marked ${markedCount} migrations as already run`,
        details: {
          totalMigrations: migrationsToMark.length,
          markedAsRun: markedCount,
          alreadyMarked: migrationsToMark.length - markedCount - errors.length,
          errors: errors.length,
        },
        errors: errors.length > 0 ? errors : null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Admin mark migrations endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during marking migrations",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async resetMigrations(req: Request, res: Response) {
    try {
      console.log("🔄 Admin endpoint: Resetting migrations...");

      // Check database connectivity first
      try {
        await db.query("SELECT 1");
      } catch (dbError) {
        return res.status(503).json({
          status: "error",
          message: "Database connection failed",
          error:
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error",
        });
      }

      // Reset migrations using node-pg-migrate
      const resetCommand = "npx node-pg-migrate -m ./migrations reset";

      try {
        const { stdout, stderr } = await execAsync(resetCommand, {
          cwd: process.cwd(),
          env: { ...process.env },
        });

        console.log("Migration reset stdout:", stdout);
        if (stderr) {
          console.log("Migration reset stderr:", stderr);
        }

        return res.status(200).json({
          status: "success",
          message:
            "Database migrations reset successfully - you can now run migrations fresh",
          output: stdout,
          warnings: stderr || null,
          timestamp: new Date().toISOString(),
        });
      } catch (execError: any) {
        console.error("Migration reset execution error:", execError);
        return res.status(500).json({
          status: "error",
          message: "Failed to reset migrations",
          error: execError.message,
          output: execError.stdout || null,
          stderr: execError.stderr || null,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Admin migration reset endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during migration reset",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async getDatabaseStatus(req: Request, res: Response) {
    try {
      const status = {
        database: {
          connected: false,
          responseTime: 0,
          error: null as string | null,
        },
        tables: {
          exists: [] as string[],
          missing: [] as string[],
          error: null as string | null,
        },
        migrations: {
          status: "unknown",
          error: null as string | null,
        },
        timestamp: new Date().toISOString(),
      };

      // Test database connectivity
      const dbStartTime = Date.now();
      try {
        await db.query("SELECT 1");
        status.database.connected = true;
        status.database.responseTime = Date.now() - dbStartTime;
      } catch (error: any) {
        status.database.error = error.message;
        return res.status(503).json({
          status: "error",
          message: "Database not accessible",
          details: status,
        });
      }

      // Check critical tables
      try {
        const result = await db.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN ('users', 'cards', 'sets', 'special_abilities', 'games', 'decks')
          ORDER BY table_name
        `);

        const expectedTables = [
          "users",
          "cards",
          "sets",
          "special_abilities",
          "games",
          "decks",
        ];
        const existingTables = result.rows.map((row) => row.table_name);

        status.tables.exists = existingTables;
        status.tables.missing = expectedTables.filter(
          (table) => !existingTables.includes(table)
        );
      } catch (error: any) {
        status.tables.error = error.message;
      }

      // Check migration status
      try {
        const migrationResult = await db.query(`
          SELECT name, run_on 
          FROM pgmigrations 
          ORDER BY run_on DESC 
          LIMIT 5
        `);

        if (migrationResult.rows.length > 0) {
          status.migrations.status = `Latest: ${migrationResult.rows[0].name} (${migrationResult.rows[0].run_on})`;
        } else {
          status.migrations.status = "No migrations found";
        }
      } catch (error: any) {
        // pgmigrations table might not exist yet
        if (error.message.includes('relation "pgmigrations" does not exist')) {
          status.migrations.status =
            "Migration table not found - migrations may not have been run";
        } else {
          status.migrations.error = error.message;
        }
      }

      const overallHealthy =
        status.database.connected &&
        status.tables.missing.length === 0 &&
        !status.tables.error;

      return res.status(overallHealthy ? 200 : 207).json({
        status: overallHealthy ? "healthy" : "needs_attention",
        message: overallHealthy
          ? "Database is properly set up"
          : "Database needs migrations or seeding",
        details: status,
        recommendations:
          status.tables.missing.length > 0
            ? [
                "Run migrations: POST /api/admin/migrate",
                "Seed database: POST /api/admin/seed",
              ]
            : ["Database appears ready"],
      });
    } catch (error) {
      console.error("Admin database status error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to check database status",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async createAIUser(req: Request, res: Response) {
    try {
      console.log("🤖 Admin endpoint: Creating AI user...");

      // Check database connectivity first
      try {
        await db.query("SELECT 1");
      } catch (dbError) {
        return res.status(503).json({
          status: "error",
          message: "Database connection failed",
          error:
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error",
        });
      }

      const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
      const AI_USERNAME = "AI Opponent";
      const AI_EMAIL = "ai@mythgame.com";

      // Check if AI user already exists
      const checkQuery = `SELECT * FROM "users" WHERE user_id = $1`;
      const { rows } = await db.query(checkQuery, [AI_PLAYER_ID]);

      if (rows.length > 0) {
        return res.status(200).json({
          status: "success",
          message: "AI user already exists",
          user: rows[0],
          timestamp: new Date().toISOString(),
        });
      }

      // Create AI user with predefined UUID
      const createQuery = `
        INSERT INTO "users" (user_id, username, email, password_hash, in_game_currency, gold, gems, fate_coins, total_xp, pack_count, created_at, last_login)
        VALUES ($1, $2, $3, $4, 0, 0, 0, 2, 0, 10, NOW(), NOW())
      `;

      await db.query(createQuery, [
        AI_PLAYER_ID,
        AI_USERNAME,
        AI_EMAIL,
        "ai_password_hash", // Dummy password hash since AI doesn't log in
      ]);

      console.log("✅ AI user created successfully");

      return res.status(201).json({
        status: "success",
        message: "AI user created successfully",
        user: {
          user_id: AI_PLAYER_ID,
          username: AI_USERNAME,
          email: AI_EMAIL,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Admin create AI user endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during AI user creation",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async createAIDecks(req: Request, res: Response) {
    try {
      console.log("🃏 Admin endpoint: Creating AI decks...");

      // Check database connectivity first
      try {
        await db.query("SELECT 1");
      } catch (dbError) {
        return res.status(503).json({
          status: "error",
          message: "Database connection failed",
          error:
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error",
        });
      }

      const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
      const NUM_DECKS = 10;
      const CARDS_PER_DECK = 20;
      const MAX_LEGENDARY_CARDS = 2;
      const MAX_SAME_NAME_CARDS = 2;

      // Check if AI user exists
      const userCheck = await db.query(
        `SELECT * FROM "users" WHERE user_id = $1`,
        [AI_PLAYER_ID]
      );

      if (userCheck.rows.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "AI user not found. Please create AI user first.",
          timestamp: new Date().toISOString(),
        });
      }

      // Get all available cards
      const { rows: allCards } = await db.query(`SELECT * FROM "cards"`);

      if (allCards.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "No cards found in the database. Please seed cards first.",
          timestamp: new Date().toISOString(),
        });
      }

      const client = await db.getClient();
      await client.query("BEGIN");

      try {
        let createdDecks = 0;

        for (let deckIndex = 0; deckIndex < NUM_DECKS; deckIndex++) {
          const deckName = `AI Deck ${deckIndex + 1}`;

          // Check if deck already exists
          const existingDeck = await client.query(
            `SELECT * FROM "decks" WHERE user_id = $1 AND name = $2`,
            [AI_PLAYER_ID, deckName]
          );

          if (existingDeck.rows.length > 0) {
            console.log(`Deck "${deckName}" already exists, skipping...`);
            continue;
          }

          // Create deck
          const deckResult = await client.query(
            `INSERT INTO "decks" (user_id, name)
             VALUES ($1, $2) RETURNING deck_id`,
            [AI_PLAYER_ID, deckName]
          );

          const deckId = deckResult.rows[0].deck_id;

          // Select random cards for this deck
          const selectedCards: any[] = [];
          const cardNameCounts: { [key: string]: number } = {};
          let legendaryCount = 0;

          const shuffledCards = [...allCards].sort(() => Math.random() - 0.5);

          for (const card of shuffledCards) {
            if (selectedCards.length >= CARDS_PER_DECK) break;

            const cardName = card.name;
            const isLegendary = RarityUtils.isLegendary(card.rarity);

            // Check constraints
            if (isLegendary && legendaryCount >= MAX_LEGENDARY_CARDS) continue;
            if ((cardNameCounts[cardName] || 0) >= MAX_SAME_NAME_CARDS)
              continue;

            // Create user_owned_card entry for AI
            const userCardResult = await client.query(
              `INSERT INTO "user_owned_cards" (user_id, card_id, level, xp)
               VALUES ($1, $2, 1, 0) RETURNING user_card_instance_id`,
              [AI_PLAYER_ID, card.card_id]
            );

            const userCardInstanceId =
              userCardResult.rows[0].user_card_instance_id;

            // Add to deck
            await client.query(
              `INSERT INTO "deck_cards" (deck_id, user_card_instance_id)
               VALUES ($1, $2)`,
              [deckId, userCardInstanceId]
            );

            selectedCards.push(card);
            cardNameCounts[cardName] = (cardNameCounts[cardName] || 0) + 1;
            if (isLegendary) legendaryCount++;
          }

          createdDecks++;
          console.log(
            `✅ Created deck "${deckName}" with ${selectedCards.length} cards`
          );
        }

        await client.query("COMMIT");

        return res.status(201).json({
          status: "success",
          message: `AI deck creation completed`,
          details: {
            totalDecks: NUM_DECKS,
            createdDecks: createdDecks,
            skippedDecks: NUM_DECKS - createdDecks,
            cardsPerDeck: CARDS_PER_DECK,
            availableCards: allCards.length,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Admin create AI decks endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during AI deck creation",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async triggerAIFatePick(req: Request, res: Response) {
    try {
      console.log("🤖 Admin endpoint: Triggering AI fate pick generation...");

      const result = await AIAutomationService.generateAutomatedFatePick();

      if (result.success) {
        return res.status(200).json({
          status: "success",
          message: result.message,
          data: {
            fatePickId: result.fatePickId,
            setUsed: result.setUsed,
            cardsGenerated: result.cardsGenerated,
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        return res.status(400).json({
          status: "error",
          message: result.message,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Admin trigger AI fate pick endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during AI fate pick generation",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async debugFatePicks(req: Request, res: Response) {
    try {
      console.log("🔍 Admin endpoint: Debugging fate picks...");

      // Check what tables exist
      const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
      `;

      const { rows: tables } = await db.query(tablesQuery);

      // Check if fate_picks table exists and get its structure
      let fatePicksInfo = null;
      if (tables.some((t) => t.table_name === "fate_picks")) {
        const columnsQuery = `
          SELECT column_name, data_type, is_nullable 
          FROM information_schema.columns 
          WHERE table_name = 'fate_picks' 
          ORDER BY column_name;
        `;
        const { rows: columns } = await db.query(columnsQuery);

        const countQuery = `SELECT COUNT(*) as count FROM fate_picks;`;
        const { rows: countRows } = await db.query(countQuery);

        fatePicksInfo = {
          exists: true,
          columns: columns,
          count: parseInt(countRows[0].count),
        };
      } else {
        fatePicksInfo = { exists: false };
      }

      // Check users table for fate_coins column
      let usersInfo = null;
      if (tables.some((t) => t.table_name === "users")) {
        const userColumnsQuery = `
          SELECT column_name, data_type, is_nullable 
          FROM information_schema.columns 
          WHERE table_name = 'users' 
          ORDER BY column_name;
        `;
        const { rows: userColumns } = await db.query(userColumnsQuery);

        usersInfo = {
          exists: true,
          columns: userColumns,
          hasFateCoins: userColumns.some((c) => c.column_name === "fate_coins"),
        };
      }

      // Try to run the fate pick service method directly
      let serviceTestResult = null;
      try {
        const FatePickService = await import("../../services/fatePick.service");
        const testUserId = "b6e79f65-c758-44be-8f01-c027a0d1370c"; // Test user from registration
        const result = await FatePickService.default.getAvailableFatePicks(
          testUserId,
          1,
          20
        );
        serviceTestResult = result;
      } catch (serviceError) {
        serviceTestResult = {
          error:
            serviceError instanceof Error
              ? serviceError.message
              : "Unknown service error",
        };
      }

      return res.status(200).json({
        status: "success",
        message: "Debug information collected",
        debug: {
          allTables: tables.map((t) => t.table_name),
          fatePicksTable: fatePicksInfo,
          usersTable: usersInfo,
          serviceTest: serviceTestResult,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Admin debug fate picks endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during debug",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async giveUserFateCoins(req: Request, res: Response) {
    try {
      console.log("💰 Admin endpoint: Giving user fate coins...");

      const { userId, amount } = req.body;

      if (!userId || amount === undefined) {
        return res.status(400).json({
          status: "error",
          message: "userId and amount are required",
          timestamp: new Date().toISOString(),
        });
      }

      const updateQuery = `
        UPDATE users 
        SET fate_coins = fate_coins + $1 
        WHERE user_id = $2 
        RETURNING user_id, username, fate_coins;
      `;

      const { rows } = await db.query(updateQuery, [amount, userId]);

      if (rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(200).json({
        status: "success",
        message: `Successfully gave ${amount} fate coins to user`,
        user: rows[0],
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Admin give fate coins endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during fate coin update",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async fixFatePicksTables(req: Request, res: Response) {
    try {
      console.log("🔧 Admin endpoint: Fixing fate picks tables...");

      // Check if fate_picks table exists
      const checkTableQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'fate_picks';
      `;

      const { rows: tableCheck } = await db.query(checkTableQuery);

      if (tableCheck.length > 0) {
        return res.status(200).json({
          status: "success",
          message: "fate_picks table already exists",
          timestamp: new Date().toISOString(),
        });
      }

      // Create fate_picks table
      const createFatePicksTable = `
        CREATE TABLE fate_picks (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          pack_opening_id UUID NOT NULL,
          original_owner_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          original_cards JSONB NOT NULL,
          set_id UUID NOT NULL REFERENCES sets(set_id) ON DELETE CASCADE,
          cost_fate_coins INTEGER NOT NULL DEFAULT 1,
          max_participants INTEGER NOT NULL DEFAULT 10,
          current_participants INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMP NOT NULL DEFAULT (current_timestamp + INTERVAL '24 hours'),
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
          updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
        );
      `;

      await db.query(createFatePicksTable);

      // Create fate_pick_participations table
      const createParticipationsTable = `
        CREATE TABLE fate_pick_participations (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          fate_pick_id UUID NOT NULL REFERENCES fate_picks(id) ON DELETE CASCADE,
          participant_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          selected_card_index INTEGER NOT NULL,
          selected_at TIMESTAMP DEFAULT current_timestamp,
          expires_at TIMESTAMP NOT NULL,
          UNIQUE(fate_pick_id, participant_id)
        );
      `;

      await db.query(createParticipationsTable);

      // Create pack_opening_history table if it doesn't exist
      const createPackHistoryTable = `
        CREATE TABLE IF NOT EXISTS pack_opening_history (
          pack_opening_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          set_id UUID NOT NULL REFERENCES sets(set_id) ON DELETE CASCADE,
          card_ids JSONB NOT NULL,
          opened_at TIMESTAMP NOT NULL DEFAULT current_timestamp
        );
      `;

      await db.query(createPackHistoryTable);

      // Create indexes
      const createIndexes = [
        `CREATE INDEX idx_fate_picks_owner ON fate_picks(original_owner_id);`,
        `CREATE INDEX idx_fate_picks_set ON fate_picks(set_id);`,
        `CREATE INDEX idx_fate_picks_active_expires ON fate_picks(is_active, expires_at);`,
        `CREATE INDEX idx_fate_picks_created ON fate_picks(created_at);`,
        `CREATE INDEX idx_fate_pick_participations_fate_pick ON fate_pick_participations(fate_pick_id);`,
        `CREATE INDEX idx_fate_pick_participations_participant ON fate_pick_participations(participant_id);`,
        `CREATE INDEX idx_pack_opening_history_user ON pack_opening_history(user_id);`,
        `CREATE INDEX idx_pack_opening_history_set ON pack_opening_history(set_id);`,
      ];

      for (const indexQuery of createIndexes) {
        try {
          await db.query(indexQuery);
        } catch (error) {
          console.log(
            `Index creation skipped (may already exist): ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }

      // Add constraints
      const addConstraints = [
        `ALTER TABLE fate_picks ADD CONSTRAINT fate_picks_cost_check CHECK (cost_fate_coins >= 0);`,
        `ALTER TABLE fate_picks ADD CONSTRAINT fate_picks_participants_check CHECK (current_participants >= 0 AND current_participants <= max_participants);`,
      ];

      for (const constraintQuery of addConstraints) {
        try {
          await db.query(constraintQuery);
        } catch (error) {
          console.log(
            `Constraint creation skipped (may already exist): ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }

      return res.status(200).json({
        status: "success",
        message: "fate_picks and related tables created successfully",
        tables_created: [
          "fate_picks",
          "fate_pick_participations",
          "pack_opening_history",
        ],
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Admin fix fate picks tables endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during table creation",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async triggerDailyRewards(req: Request, res: Response) {
    try {
      console.log(
        "🎁 Admin endpoint: Triggering daily rewards distribution..."
      );

      const result = await DailyRewardsService.runDailyRewards();

      if (result.success) {
        return res.status(200).json({
          status: "success",
          message: result.message,
          data: {
            usersProcessed: result.usersProcessed,
            fateCoinsDistributed: result.fateCoinsDistributed,
            packsDistributed: result.packsDistributed,
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        return res.status(500).json({
          status: "error",
          message: result.message,
          error: result.error,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Admin trigger daily rewards endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during daily rewards distribution",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  async resetAccount(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          status: "error",
          message: "userId is required",
          timestamp: new Date().toISOString(),
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
          timestamp: new Date().toISOString(),
        });
      }

      const client = await db.getClient();
      await client.query("BEGIN");

      try {
        // Delete all user-related data
        // Note: Many tables have CASCADE delete, but we'll explicitly delete for clarity

        // Delete user achievements
        await client.query(
          `DELETE FROM "user_achievements" WHERE user_id = $1`,
          [userId]
        );

        // Delete XP transfers
        await client.query(`DELETE FROM "xp_transfers" WHERE user_id = $1`, [
          userId,
        ]);

        // Delete XP pools
        await client.query(
          `DELETE FROM "user_card_xp_pools" WHERE user_id = $1`,
          [userId]
        );

        // Delete pack opening history
        await client.query(
          `DELETE FROM "pack_opening_history" WHERE user_id = $1`,
          [userId]
        );

        // Delete mail
        await client.query(`DELETE FROM "mail" WHERE user_id = $1`, [userId]);

        // Delete fate pick participations
        await client.query(
          `DELETE FROM "fate_pick_participations" WHERE participant_id = $1`,
          [userId]
        );

        // Delete fate picks created by user
        await client.query(
          `DELETE FROM "fate_picks" WHERE original_owner_id = $1`,
          [userId]
        );

        // Delete friendships (both as requester and addressee)
        await client.query(
          `DELETE FROM "friendships" WHERE requester_id = $1 OR addressee_id = $1`,
          [userId]
        );

        // Delete user rankings
        await client.query(`DELETE FROM "user_rankings" WHERE user_id = $1`, [
          userId,
        ]);

        // Delete story mode progress
        await client.query(
          `DELETE FROM "user_story_progress" WHERE user_id = $1`,
          [userId]
        );

        // Delete game results
        await client.query(
          `DELETE FROM "game_results" WHERE player1_id = $1 OR player2_id = $1`,
          [userId]
        );

        // Delete games (decks will cascade)
        await client.query(
          `DELETE FROM "games" WHERE player1_id = $1 OR player2_id = $1`,
          [userId]
        );

        // Delete decks (deck_cards will cascade, user_owned_cards deletion will cascade to user_card_power_ups)
        await client.query(`DELETE FROM "decks" WHERE user_id = $1`, [userId]);

        // Delete user owned cards (user_card_power_ups will cascade)
        await client.query(
          `DELETE FROM "user_owned_cards" WHERE user_id = $1`,
          [userId]
        );

        // Reset user currencies to default values (same as new account)
        // Default: gold=0, gems=0, fate_coins=2, card_fragments=0, total_xp=0, pack_count=0
        // pack_count will be set to 10 by StarterService.grantStarterPacks
        await client.query(
          `UPDATE "users" 
           SET gold = 0, 
               gems = 0, 
               fate_coins = 2, 
               card_fragments = 0, 
               total_xp = 0, 
               pack_count = 0,
               in_game_currency = 0
           WHERE user_id = $1`,
          [userId]
        );

        await client.query("COMMIT");

        // Grant starter content (cards, deck, packs)
        // This runs outside the transaction since StarterService handles its own transaction
        await StarterService.grantStarterContent(userId);

        // Fetch updated user to return
        const updatedUser = await UserModel.findById(userId);

        return res.status(200).json({
          status: "success",
          message: "Account reset successfully",
          user: {
            user_id: updatedUser?.user_id,
            username: updatedUser?.username,
            gold: updatedUser?.gold,
            gems: updatedUser?.gems,
            fate_coins: updatedUser?.fate_coins,
            card_fragments: updatedUser?.card_fragments,
            total_xp: updatedUser?.total_xp,
            pack_count: updatedUser?.pack_count,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Admin reset account endpoint error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error during account reset",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },
};

export default AdminController;
