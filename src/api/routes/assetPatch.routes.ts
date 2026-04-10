import { Router, Request, Response } from "express";

const router = Router();

export interface AssetPatch {
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
  patches: AssetPatch[];
}

// Update this array to add/update patch entries.
// Rules:
//   - Never change an existing patch's `id` once deployed.
//   - Increment `version` and update `url`, `checksum`, and `size` when replacing a ZIP.
//   - Use a versioned filename in `url` (e.g. audio-sfx-v2.zip) instead of overwriting the old ZIP.
//   - Generate `checksum` with:  sha256sum <file>.zip   (prefix with "sha256:")
//   - Generate `size` with:      wc -c < <file>.zip
const PATCHES: AssetPatch[] = [
  {
    id: "patch-1",
    version: 1,
    type: "mixed",
    url: "/assets/patches/patch-1.zip",
    checksum:
      "sha256:e948db6a726f1ffabecbc456f9d584b98f3f258f1c742dcbd5388020cbdead31",
    size: 106179534,
    description: "Initial file patch",
  },
];

router.get("/manifest", (req: Request, res: Response) => {
  const manifest: AssetPatchManifest = {
    version: 1,
    patches: PATCHES,
  };

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(manifest);
});

export default router;
