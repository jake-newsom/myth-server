import { Router, Request, Response } from "express";
import db from "../../config/db.config";

const router = Router();

/**
 * Basic health check endpoint
 * Returns simple status for quick health checks
 */
router.get("/", async (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    message: "API is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

/**
 * Comprehensive health check endpoint
 * Includes database connectivity and other critical service checks
 * This is ideal for Render.com health checks and monitoring
 */
router.get("/detailed", async (req: Request, res: Response) => {
  const healthCheck = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    version: process.env.npm_package_version || "unknown",
    services: {
      database: {
        status: "unknown",
        responseTime: 0,
        error: null as string | null,
      },
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
        external: process.memoryUsage().external,
        rss: process.memoryUsage().rss,
      },
      cpu: {
        usage: process.cpuUsage(),
      },
    },
  };

  // Test database connectivity
  const dbStartTime = Date.now();
  try {
    await db.query("SELECT 1 as test");
    healthCheck.services.database.status = "healthy";
    healthCheck.services.database.responseTime = Date.now() - dbStartTime;
  } catch (error) {
    healthCheck.status = "degraded";
    healthCheck.services.database.status = "unhealthy";
    healthCheck.services.database.error =
      error instanceof Error ? error.message : "Unknown database error";
    healthCheck.services.database.responseTime = Date.now() - dbStartTime;
  }

  // Determine overall status
  const isHealthy = healthCheck.services.database.status === "healthy";
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json(healthCheck);
});

/**
 * Database-specific health check
 * Tests database connectivity and basic operations
 */
router.get("/database", async (req: Request, res: Response) => {
  const dbHealth = {
    status: "unknown",
    timestamp: new Date().toISOString(),
    tests: {
      connectivity: {
        status: "unknown",
        responseTime: 0,
        error: null as string | null,
      },
      basicQuery: {
        status: "unknown",
        responseTime: 0,
        error: null as string | null,
      },
      tablesExist: {
        status: "unknown",
        responseTime: 0,
        error: null as string | null,
        tables: [] as string[],
      },
    },
  };

  let overallHealthy = true;

  // Test 1: Basic connectivity
  const connectivityStartTime = Date.now();
  try {
    await db.query("SELECT 1");
    dbHealth.tests.connectivity.status = "healthy";
    dbHealth.tests.connectivity.responseTime =
      Date.now() - connectivityStartTime;
  } catch (error) {
    overallHealthy = false;
    dbHealth.tests.connectivity.status = "unhealthy";
    dbHealth.tests.connectivity.error =
      error instanceof Error ? error.message : "Unknown error";
    dbHealth.tests.connectivity.responseTime =
      Date.now() - connectivityStartTime;
  }

  // Test 2: Basic query
  const queryStartTime = Date.now();
  try {
    const result = await db.query("SELECT NOW() as current_time");
    dbHealth.tests.basicQuery.status = "healthy";
    dbHealth.tests.basicQuery.responseTime = Date.now() - queryStartTime;
  } catch (error) {
    overallHealthy = false;
    dbHealth.tests.basicQuery.status = "unhealthy";
    dbHealth.tests.basicQuery.error =
      error instanceof Error ? error.message : "Unknown error";
    dbHealth.tests.basicQuery.responseTime = Date.now() - queryStartTime;
  }

  // Test 3: Check if critical tables exist
  const tablesStartTime = Date.now();
  try {
    const result = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'cards', 'sets', 'games', 'decks')
      ORDER BY table_name
    `);

    const expectedTables = ["users", "cards", "sets", "games", "decks"];
    const existingTables = result.rows.map((row) => row.table_name);

    dbHealth.tests.tablesExist.tables = existingTables;
    dbHealth.tests.tablesExist.responseTime = Date.now() - tablesStartTime;

    if (expectedTables.every((table) => existingTables.includes(table))) {
      dbHealth.tests.tablesExist.status = "healthy";
    } else {
      overallHealthy = false;
      dbHealth.tests.tablesExist.status = "unhealthy";
      const missingTables = expectedTables.filter(
        (table) => !existingTables.includes(table)
      );
      dbHealth.tests.tablesExist.error = `Missing tables: ${missingTables.join(
        ", "
      )}`;
    }
  } catch (error) {
    overallHealthy = false;
    dbHealth.tests.tablesExist.status = "unhealthy";
    dbHealth.tests.tablesExist.error =
      error instanceof Error ? error.message : "Unknown error";
    dbHealth.tests.tablesExist.responseTime = Date.now() - tablesStartTime;
  }

  dbHealth.status = overallHealthy ? "healthy" : "unhealthy";
  const statusCode = overallHealthy ? 200 : 503;

  res.status(statusCode).json(dbHealth);
});

/**
 * Readiness check endpoint
 * Returns 200 when the service is ready to handle requests
 * This is different from liveness - it indicates the service is ready to work
 */
router.get("/ready", async (req: Request, res: Response) => {
  try {
    // Test database connectivity
    await db.query("SELECT 1");

    // Check if critical tables exist
    const result = await db.query(`
      SELECT COUNT(*) as table_count
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'cards', 'sets')
    `);

    const tableCount = parseInt(result.rows[0].table_count);

    if (tableCount >= 3) {
      res.status(200).json({
        status: "ready",
        message: "Service is ready to handle requests",
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: "not ready",
        message: "Database tables not properly initialized",
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    res.status(503).json({
      status: "not ready",
      message: "Database not accessible",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Liveness check endpoint
 * Returns 200 if the service is alive (even if not fully functional)
 * This should almost always return 200 unless the process is completely broken
 */
router.get("/live", (req: Request, res: Response) => {
  res.status(200).json({
    status: "alive",
    message: "Service is alive",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
  });
});

export default router;
