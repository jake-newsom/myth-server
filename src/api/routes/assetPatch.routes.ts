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
