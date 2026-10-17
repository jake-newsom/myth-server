/**
 * The one way HTTP handlers report errors. Throw (or `next()`) an HttpError;
 * the global errorHandler turns it into the standard body:
 *
 *   { error: string, message: string, code: string, details?: object }
 *
 * `error` and `message` carry the same human-readable text: shipped clients
 * read `message` first (apiClient) and some read `error` as a string
 * (towerService), so both must stay present. See myth-server/CLAUDE.md.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    /**
     * Extra top-level fields kept only so shipped clients still see a legacy
     * body's shape (e.g. `{ success: false }`, `{ retryAfter }`). New code
     * should not use this; put data in `details`.
     */
    public readonly legacy?: Record<string, unknown>
  ) {
    super(message);
    this.name = "HttpError";
  }

  /** Returns a copy that also emits `fields` at the top level of the body. */
  withLegacy(fields: Record<string, unknown>): HttpError {
    return new HttpError(this.status, this.code, this.message, this.details, {
      ...this.legacy,
      ...fields,
    });
  }
}

type Details = Record<string, unknown>;

export const badRequest = (message: string, code = "BAD_REQUEST", details?: Details) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = "Unauthorized", code = "UNAUTHORIZED", details?: Details) =>
  new HttpError(401, code, message, details);
export const forbidden = (message = "Access denied", code = "FORBIDDEN", details?: Details) =>
  new HttpError(403, code, message, details);
export const notFound = (message: string, code = "NOT_FOUND", details?: Details) =>
  new HttpError(404, code, message, details);
export const conflict = (message: string, code = "CONFLICT", details?: Details) =>
  new HttpError(409, code, message, details);
export const tooManyRequests = (message: string, code = "RATE_LIMITED", details?: Details) =>
  new HttpError(429, code, message, details);
