import { Request, Response } from "express";
import SetModel from "../../models/set.model";
import UserModel from "../../models/user.model";
import { AuthenticatedRequest } from "../../types";
import { spawn } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import db from "../../config/db.config";
import fs from "fs";
import path from "path";

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

  async runMigrations(req: AuthenticatedRequest, res: Response) {
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

  async seedDatabase(req: AuthenticatedRequest, res: Response) {
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

  async getDatabaseStatus(req: AuthenticatedRequest, res: Response) {
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
};

export default AdminController;
