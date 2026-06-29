import { Router, Request, Response } from "express";
import { getClientVersionFromHeader } from "../../utils/clientVersion";
import { meetsMinAppVersion } from "../../utils/catalogVersion";

const router = Router();

const R2_ASSET_ORIGIN =
  process.env.R2_ASSET_ORIGIN?.trim() || "https://assets.cardsofmyth.com";

export interface AssetPatch {
  id: string;
  version: number;
  type: "audio" | "graphics" | "mixed";
  /**
   * R2 object key under the bucket (e.g. "patches/patch-1.zip"). Omit for a
   * delete-only patch that ships no ZIP.
   */
  r2Key?: string;
  checksum: string;
  size: number;
  /**
   * Canonical asset paths the client should remove when applying this patch.
   * A trailing slash marks a folder ("effects/video/"); a single * matches one
   * filename segment ("effects/video/*.mp4"); otherwise a single file. Entries
   * outside the allowed asset prefixes are ignored client-side.
   */
  delete?: string[];
  description: string;
  /** Minimum client app version required to receive this patch (null = all clients). */
  minAppVersion?: string | null;
}

export interface AssetPatchManifestEntry {
  id: string;
  version: number;
  type: "audio" | "graphics" | "mixed";
  /** Absent for a delete-only patch. */
  url?: string;
  checksum: string;
  size: number;
  delete?: string[];
  description: string;
}

export interface AssetPatchManifest {
  version: number;
  patches: AssetPatchManifestEntry[];
}

// Update this array to add/update patch entries.
// Rules:
//   - Never change an existing patch's `id` once deployed.
//   - Increment `version` and update `r2Key`, `checksum`, and `size` when replacing a ZIP.
//   - `r2Key` is the object path in R2 (e.g. "patches/patch-1.zip").
//   - Generate `checksum` with:  sha256sum <file>.zip   (prefix with "sha256:")
//   - Generate `size` with:      wc -c < <file>.zip
//   - To retire assets, set `delete` to canonical paths (trailing slash = folder,
//     e.g. "effects/video/"; glob = one segment, e.g. "effects/video/*.mp4").
//     A delete-only patch may omit `r2Key`/`checksum`/`size`.
//     Bump `version` on an existing patch to make already-updated clients re-apply.
//   - Set `minAppVersion` (e.g. "1.0.12") to withhold a patch from older clients.
//     Omit or null = unrestricted. Clients below the minimum (or with no version)
//     do not receive the patch.
const PATCHES: AssetPatch[] = [
  {
    id: "patch-1",
    version: 1,
    type: "mixed",
    r2Key: "patches/patch-1.zip",
    checksum:
      "sha256:e948db6a726f1ffabecbc456f9d584b98f3f258f1c742dcbd5388020cbdead31",
    size: 106179534,
    description: "Initial file patch",
  },
  {
    id: "gc-patch-1",
    version: 1,
    type: "graphics",
    r2Key: "patches/gold-cards-2.zip",
    checksum:
      "sha256:4bb8736ca3c652f766afa63c2b2a6e2b5ec2126a429073b49a688d6f2c82a935",
    size: 0,
    description: "initial gold cards patch",
  },
  {
    id: "gc-patch-2",
    version: 1,
    type: "graphics",
    r2Key: "patches/gold-patch-3.zip",
    checksum:
      "sha256:c26ac8c3b2c1713fb6f88fc24c348156a714354723292746da9bfda337efb688",
    size: 0,
    description: "second gold cards patch",
  },
  {
    id: "bp1.5.2",
    version: 6,
    type: "graphics",
    r2Key: "patches/bp1.5.2.zip",
    checksum:
      "sha256:298fd06cb6c1ec40fd1ad30129c40c19a7b7333d31ae9d8cdc7cdb2d9d4be051",
    size: 0,
    description: "border pack",
  },
  {
    id: "audio-pack-2.2",
    version: 3,
    type: "audio",
    r2Key: "patches/audio-patch-3.zip",
    checksum:
      "sha256:69f1c322aaacbbeef59575b607ef1e8c47161e1ae26de1fa8bfc223be25e97e8",
    size: 0,
    description: "audio pack",
  },
  {
    id: "cards-may-2026",
    version: 3,
    type: "graphics",
    r2Key: "patches/card-patch-may-2026.zip",
    checksum:
      "sha256:dd787aed2f6fe5b4cba4c0377896bcb3738d3b46b2d70972d416ac7ad04e0508",
    size: 0,
    description: "cards update",
  },
  {
    id: "ragnarok-saga-june-2026",
    version: 2,
    type: "graphics",
    r2Key: "patches/ragnarok-saga-1.1.zip",
    checksum:
      "sha256:cc4ed5b36cee8c46984752e5090b80af7e213e5eff45ed05cc2f3144d4ceb4e9",
    size: 88257900,
    description: "graphics for ragnarok saga",
  },
  {
    // Delete-only: remove legacy video VFX files; flipbook PNGs stay put.
    id: "vfx-video-cleanup",
    version: 2,
    type: "graphics",
    checksum: "",
    size: 0,
    delete: ["effects/video/*.mp4"],
    description: "remove legacy video VFX (.mp4 only)",
    minAppVersion: "1.0.12",
  },
  {
    id: "s1-complete-june-2026",
    version: 4,
    type: "graphics",
    r2Key: "patches/s1-wrapup-2.zip",
    checksum:
      "sha256:343f666f132de9e76aa280618a54eba6f51a6b614d078fedc5b3f2cf5586e55d",
    size: 15514914,
    description: "Season 1 rewards, SFX, and flipbook VFX",
  },

];

function assetUrl(r2Key: string): string {
  const normalized = r2Key.replace(/^\/+/, "");
  return `${R2_ASSET_ORIGIN}/${normalized}`;
}

function clientVersionFromRequest(req: Request): string | undefined {
  const fromHeader = getClientVersionFromHeader(req.headers);
  if (fromHeader?.trim()) return fromHeader.trim();
  const q = req.query.appVersion;
  if (typeof q === "string") return q.trim() || undefined;
  if (Array.isArray(q)) {
    const first = q[0];
    return typeof first === "string" ? first.trim() || undefined : undefined;
  }
  return undefined;
}

router.get("/manifest", (req: Request, res: Response) => {
  const clientVersion = clientVersionFromRequest(req);
  const visiblePatches = PATCHES.filter((p) =>
    meetsMinAppVersion(p.minAppVersion, { clientVersion })
  );

  const patches: AssetPatchManifestEntry[] = visiblePatches.map((p) => ({
    id: p.id,
    version: p.version,
    type: p.type,
    ...(p.r2Key ? { url: assetUrl(p.r2Key) } : {}),
    checksum: p.checksum,
    size: p.size,
    ...(p.delete && p.delete.length > 0 ? { delete: p.delete } : {}),
    description: p.description,
  }));

  const manifest: AssetPatchManifest = {
    version: 1,
    patches,
  };

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(manifest);
});

export default router;
