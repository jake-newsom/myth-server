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
