/**
 * Server-side PostHog: exceptions and outcome events (see TRACKING.md).
 *
 * Disabled (every call a no-op) unless POSTHOG_PROJECT_TOKEN is set, so local
 * dev, tests and the sim CLIs never send anything. Telemetry must never break
 * a request: every public function swallows its own failures.
 *
 * distinct_id is always the user_id so server events and exceptions join the
 * client's person (the client calls posthog.identify(user_id)). Never put
 * emails or usernames in properties.
 */
import fs from "fs";
import path from "path";
import { PostHog } from "posthog-node";

const SYSTEM_DISTINCT_ID = "myth-server";

let client: PostHog | null | undefined;

function readServerVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
    );
    return String(pkg.version ?? "unknown");
  } catch {
    return "unknown";
  }
}

const SERVER_VERSION = readServerVersion();

/** Railway exposes the deployed commit; fall back to the package version. */
const SERVER_RELEASE =
  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || SERVER_VERSION;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const token = process.env.POSTHOG_PROJECT_TOKEN?.trim();
  if (!token || process.env.NODE_ENV === "test") {
    client = null;
    return client;
  }
  try {
    client = new PostHog(token, {
      host: process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
      flushAt: 20,
      flushInterval: 10_000,
    });
  } catch (error) {
    console.error("[telemetry] PostHog init failed:", error);
    client = null;
  }
  return client;
}

export function isTelemetryEnabled(): boolean {
  return getClient() !== null;
}

/** Common properties on every server event (TRACKING.md "Common properties"). */
function commonProps(): Record<string, unknown> {
  return {
    source: "server",
    server_version: SERVER_VERSION,
    server_release: SERVER_RELEASE,
    environment: process.env.NODE_ENV || "development",
  };
}

/** Client release info, read from the headers the client already sends. */
export function clientReleaseProps(
  headers: Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const pick = (name: string): string | undefined => {
    const raw = headers[name.toLowerCase()];
    const v = Array.isArray(raw) ? raw[0] : raw;
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : undefined;
  };
  // Only X-Client-Version: it is the one custom header CORS allows, and adding
  // headers would break web preflight for new clients on older servers. OTA
  // bundle and platform ride on the client's own events instead.
  const appVersion = pick("X-Client-Version");
  if (appVersion) out.app_version = appVersion;
  return out;
}

/** Report an exception. Pass distinctId = user_id when there is one. */
export function captureServerException(
  error: unknown,
  context: { distinctId?: string | null; [key: string]: unknown } = {},
): void {
  const ph = getClient();
  if (!ph) return;
  try {
    const { distinctId, ...props } = context;
    ph.captureException(error, distinctId || SYSTEM_DISTINCT_ID, {
      ...commonProps(),
      ...props,
    });
  } catch (e) {
    console.error("[telemetry] captureException failed:", e);
  }
}

const reportedOnce = new Set<string>();

/**
 * Report a handled-but-broken condition once per key per process
 * (TRACKING.md gap 5: "report each once, not on every retry").
 */
export function captureServerExceptionOnce(
  key: string,
  error: unknown,
  context: { distinctId?: string | null; [key: string]: unknown } = {},
): void {
  if (reportedOnce.has(key)) return;
  if (reportedOnce.size > 5000) reportedOnce.clear();
  reportedOnce.add(key);
  captureServerException(error, { ...context, once_key: key });
}

/** Report a failure in a cron job / background tick (no Express context). */
export function reportJobError(job: string, error: unknown): void {
  captureServerException(error, { handler_type: "job", job });
}

/**
 * Attach failure reporting to a node-cron v4 task. Covers callbacks that
 * throw without their own try/catch (node-cron catches those and emits
 * `execution:failed` rather than crashing).
 */
export function monitorCronTask<T extends object>(task: T, job: string): T {
  try {
    (task as { on?: (event: any, cb: (ctx: any) => void) => unknown }).on?.(
      "execution:failed",
      (ctx: any) => {
        reportJobError(job, ctx?.execution?.error ?? new Error(`${job} failed`));
      },
    );
  } catch {
    // Older node-cron without events: nothing to attach.
  }
  return task;
}

/** Send an outcome event (game finished, pack opened, ...). */
export function captureServerEvent(
  distinctId: string | null | undefined,
  event: string,
  properties: Record<string, unknown> = {},
): void {
  const ph = getClient();
  if (!ph || !distinctId) return;
  try {
    ph.capture({
      distinctId,
      event,
      properties: { ...commonProps(), ...properties },
    });
  } catch (e) {
    console.error("[telemetry] capture failed:", e);
  }
}

/** Flush queued events. Safe to call more than once. */
export async function shutdownTelemetry(timeoutMs = 3000): Promise<void> {
  const ph = client;
  if (!ph) return;
  try {
    await ph.shutdown(timeoutMs);
  } catch (e) {
    console.error("[telemetry] shutdown failed:", e);
  }
}

let processHandlersInstalled = false;

/**
 * Report uncaught exceptions and unhandled rejections, then exit(1) exactly
 * as Node would without a listener, after giving PostHog a moment to flush.
 * Idempotent: both entrypoints (app.ts, server.js) may call it.
 */
export function installProcessErrorHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;

  let exiting = false;
  const fatal = (origin: string) => (error: unknown) => {
    console.error(`[fatal] ${origin}:`, error);
    captureServerException(error, { handler_type: origin, fatal: true });
    if (exiting) return;
    exiting = true;
    // Hard cap so a hung flush can never keep a broken process alive.
    setTimeout(() => process.exit(1), 4000).unref();
    void shutdownTelemetry(3000).finally(() => process.exit(1));
  };

  process.on("uncaughtException", fatal("uncaughtException"));
  process.on("unhandledRejection", fatal("unhandledRejection"));
}
