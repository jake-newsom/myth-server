import { Router, Request, Response } from "express";

const router = Router();

const R2_ASSET_ORIGIN =
  process.env.R2_ASSET_ORIGIN?.trim() || "https://assets.cardsofmyth.com";

export interface AssetPatch {
  id: string;
  version: number;
  type: "audio" | "graphics" | "mixed";
  /** R2 object key under the bucket (e.g. "patches/patch-1.zip") */
  r2Key: string;
  checksum: string;
  size: number;
  description: string;
}

export interface AssetPatchManifestEntry {
  id: string;
  version: number;
  type: "audio" | "graphics" | "mixed";
  url: string;
  checksum: string;
  size: number;
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
];

function assetUrl(r2Key: string): string {
  const normalized = r2Key.replace(/^\/+/, "");
  return `${R2_ASSET_ORIGIN}/${normalized}`;
}

router.get("/manifest", (req: Request, res: Response) => {
  const patches: AssetPatchManifestEntry[] = PATCHES.map((p) => ({
    id: p.id,
    version: p.version,
    type: p.type,
    url: assetUrl(p.r2Key),
    checksum: p.checksum,
    size: p.size,
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
