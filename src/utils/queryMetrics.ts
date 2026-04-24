import { AsyncLocalStorage } from "async_hooks";
import { Request, Response, NextFunction } from "express";
import logger from "./logger";

type QueryMetricsContext = {
  queryCount: number;
  totalQueryMs: number;
  maxQueryMs: number;
  requestStartedAtMs: number;
};

const queryMetricsStore = new AsyncLocalStorage<QueryMetricsContext>();

const DEFAULT_TRACKED_PREFIXES = [
  "/api/leaderboard",
  "/api/users/me/decks",
  "/api/achievements",
  "/api/daily",
  "/api/tower",
];

function isEnabled(): boolean {
  return process.env.QUERY_METRICS_ENABLED === "true";
}

function getTrackedPrefixes(): string[] {
  const configured = process.env.QUERY_METRICS_PATH_PREFIXES;
  if (!configured) {
    return DEFAULT_TRACKED_PREFIXES;
  }

  const parsed = configured
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_TRACKED_PREFIXES;
}

function shouldTrackPath(pathname: string): boolean {
  const trackedPrefixes = getTrackedPrefixes();
  return trackedPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function queryMetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isEnabled() || !shouldTrackPath(req.path)) {
    next();
    return;
  }

  const context: QueryMetricsContext = {
    queryCount: 0,
    totalQueryMs: 0,
    maxQueryMs: 0,
    requestStartedAtMs: Date.now(),
  };

  queryMetricsStore.run(context, () => {
    const originalWriteHead: any = res.writeHead.bind(res);
    res.writeHead = ((...args: any[]) => {
      const requestElapsedMs = Date.now() - context.requestStartedAtMs;
      res.setHeader("X-DB-Query-Count", String(context.queryCount));
      res.setHeader("X-DB-Query-Time-Ms", String(round(context.totalQueryMs)));
      res.setHeader("X-Request-Time-Ms", String(round(requestElapsedMs)));
      return originalWriteHead(...args);
    }) as typeof res.writeHead;

    res.on("finish", () => {
      const elapsedMs = Date.now() - context.requestStartedAtMs;
      logger.info("Request query metrics", {
        method: req.method,
        path: req.originalUrl,
        status_code: res.statusCode,
        request_ms: round(elapsedMs),
        query_count: context.queryCount,
        total_query_ms: round(context.totalQueryMs),
        avg_query_ms:
          context.queryCount > 0
            ? round(context.totalQueryMs / context.queryCount)
            : 0,
        max_query_ms: round(context.maxQueryMs),
      });
    });

    next();
  });
}

export function recordQueryMetric(durationMs: number): void {
  const context = queryMetricsStore.getStore();
  if (!context) {
    return;
  }

  context.queryCount += 1;
  context.totalQueryMs += durationMs;
  context.maxQueryMs = Math.max(context.maxQueryMs, durationMs);
}

