import { Request } from "express";

/**
 * Resolve the real client IP.
 *
 * Cloudflare fronts Render, and `app.set("trust proxy", 1)` only unwinds a
 * single hop — so `req.ip` resolves to the Cloudflare *edge node*, not the
 * user. That made every request look like it came from 104.22.x / 104.23.x:
 * IP logging was useless for attribution and IP rate limiting effectively
 * bucketed unrelated users together.
 *
 * `CF-Connecting-IP` is set by Cloudflare itself and any client-supplied copy
 * is stripped at the edge, so it is trustworthy *provided* the origin only
 * ever receives Cloudflare traffic. It is preferred over widening
 * `trust proxy`, which would let a client forge `X-Forwarded-For` and choose
 * its own rate-limit bucket.
 *
 * Falls back to previous behaviour when the header is absent (local dev,
 * direct-to-origin health checks).
 */
export function getClientIp(req: Request): string | undefined {
  const cfConnectingIp = req.get("CF-Connecting-IP");
  if (cfConnectingIp) {
    // Header is single-valued, but be defensive: take the first entry and
    // strip any port suffix Cloudflare/proxies may append to IPv4 addresses.
    const first = cfConnectingIp.split(",")[0]?.trim();
    if (first) return first;
  }

  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
}
