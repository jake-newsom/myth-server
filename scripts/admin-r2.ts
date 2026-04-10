/**
 * Cloudflare R2 storage helpers for the npm admin console.
 * Talks to the Cloudflare Worker in front of R2 using x-dev-key auth.
 *
 * Env:
 *   R2_WORKER_URL   – base URL of the worker (e.g. https://assets.cardsofmyth.com)
 *   R2_DEV_KEY      – shared secret sent as x-dev-key header
 */

const getWorkerUrl = (): string => {
  const u = process.env.R2_WORKER_URL?.trim();
  if (!u) throw new Error("R2_WORKER_URL is not configured");
  return u.replace(/\/+$/, "");
};

const getDevKey = (): string => {
  const k = process.env.R2_DEV_KEY?.trim();
  if (!k) throw new Error("R2_DEV_KEY is not configured");
  return k;
};

/**
 * Download a file from R2 via the worker's /raw/ endpoint.
 * Returns the response body as a Buffer, or throws on non-2xx.
 */
export async function r2Download(objectKey: string): Promise<Buffer> {
  const url = `${getWorkerUrl()}/raw/${objectKey}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { "x-dev-key": getDevKey() },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`R2 GET ${objectKey}: ${resp.status} — ${text}`);
  }
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Upload a file to R2 via the worker's /raw/ endpoint.
 * @param objectKey  Path in the bucket (e.g. "cards/japanese/rare/amaterasu-1.webp")
 * @param body       File contents as Buffer
 * @param contentType  Optional MIME type
 */
export async function r2Upload(
  objectKey: string,
  body: Buffer,
  contentType?: string
): Promise<void> {
  const url = `${getWorkerUrl()}/raw/${objectKey}`;
  const headers: Record<string, string> = {
    "x-dev-key": getDevKey(),
  };
  if (contentType) {
    headers["content-type"] = contentType;
  }
  const resp = await fetch(url, {
    method: "PUT",
    headers,
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`R2 PUT ${objectKey}: ${resp.status} — ${text}`);
  }
}

/**
 * Check whether R2 credentials are configured (non-empty).
 */
export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_WORKER_URL?.trim() && process.env.R2_DEV_KEY?.trim()
  );
}
