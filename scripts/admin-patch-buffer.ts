/**
 * In-memory buffer of raw asset files to pack into a client patch ZIP (npm admin only).
 * Entries use paths relative to game /assets, matching docs/openapi/assetPatch.openapi.yaml.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { resolveRawAssetPath, toPatchZipEntry } from "./admin-assets";

const PROJECT_ROOT = path.join(__dirname, "..");

type PatchEntry = {
  absPath: string;
  cardVariantId?: string;
  addedAt: number;
};

const buffer = new Map<string, PatchEntry>();

export function getPatchesDirAbs(): string {
  return path.join(PROJECT_ROOT, "content", "assets", "patches");
}

export type AddPatchResult =
  | { ok: true; entry: string; bytes: number }
  | { ok: false; skipped: "remote_url" }
  | { ok: false; skipped: "missing_file"; entry: string }
  | { ok: false; error: string };

/**
 * Queue a local image_url for the next patch ZIP. Skips http(s) URLs.
 */
export function addPatchFromImageRef(
  imageRef: string,
  opts?: { cardVariantId?: string }
): AddPatchResult {
  const entry = toPatchZipEntry(imageRef);
  if (entry === null) {
    return { ok: false, skipped: "remote_url" };
  }
  const resolved = resolveRawAssetPath(imageRef);
  if (resolved === null) {
    return { ok: false, skipped: "remote_url" };
  }
  if ("error" in resolved) {
    return { ok: false, error: resolved.error };
  }
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, skipped: "missing_file", entry };
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(resolved.abs);
  } catch {
    return { ok: false, skipped: "missing_file", entry };
  }
  if (!st.isFile()) {
    return { ok: false, error: "Not a file" };
  }
  buffer.set(entry, {
    absPath: resolved.abs,
    cardVariantId: opts?.cardVariantId,
    addedAt: Date.now(),
  });
  return { ok: true, entry, bytes: st.size };
}

export function clearPatchBuffer(): void {
  buffer.clear();
}

export type PatchBufferEntryOut = {
  entry: string;
  bytes: number;
  cardVariantId: string | null;
  addedAt: number;
};

export function getPatchBufferStatus(): {
  entries: PatchBufferEntryOut[];
  totalFiles: number;
  totalBytes: number;
} {
  const entries: PatchBufferEntryOut[] = [];
  let totalBytes = 0;
  for (const [entry, meta] of buffer) {
    let bytes = 0;
    if (fs.existsSync(meta.absPath)) {
      try {
        bytes = fs.statSync(meta.absPath).size;
      } catch {
        bytes = 0;
      }
    }
    totalBytes += bytes;
    entries.push({
      entry,
      bytes,
      cardVariantId: meta.cardVariantId ?? null,
      addedAt: meta.addedAt,
    });
  }
  entries.sort((a, b) => a.entry.localeCompare(b.entry));
  return {
    entries,
    totalFiles: entries.length,
    totalBytes,
  };
}

export function sanitizePatchFilename(name: string): string | null {
  const t = name.trim();
  const base = path.basename(t);
  if (!base || base !== t) return null;
  if (!/^[a-zA-Z0-9._-]+\.zip$/.test(base)) return null;
  return base;
}

export function buildPatchZipBuffer(): Buffer {
  if (buffer.size === 0) {
    throw new Error("Patch buffer is empty");
  }
  const zip = new AdmZip();
  let added = 0;
  for (const [entryName, meta] of buffer) {
    if (!fs.existsSync(meta.absPath)) continue;
    try {
      zip.addFile(entryName, fs.readFileSync(meta.absPath));
      added++;
    } catch {
      // skip unreadable
    }
  }
  if (added === 0) {
    throw new Error("No readable files on disk for patch buffer entries");
  }
  return zip.toBuffer();
}

export function savePatchBufferToPatchesDir(filename: string): {
  fullPath: string;
  bytes: number;
  sha256: string;
} {
  const safe = sanitizePatchFilename(filename);
  if (!safe) {
    throw new Error(
      "Invalid filename (use only letters, numbers, dot, underscore, hyphen; must end with .zip)"
    );
  }
  const dir = getPatchesDirAbs();
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, safe);
  const buf = buildPatchZipBuffer();
  fs.writeFileSync(fullPath, buf);
  const sha256 = "sha256:" + crypto.createHash("sha256").update(buf).digest("hex");
  return { fullPath, bytes: buf.length, sha256 };
}

export function listPatchZipFiles(): string[] {
  const dir = getPatchesDirAbs();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".zip"))
    .sort();
}
