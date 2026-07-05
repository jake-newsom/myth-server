import { Router, Request, Response } from "express";
import { moderateRateLimit } from "../middlewares/rateLimit.middleware";
import { compareSemver } from "../../utils/clientVersion";

const router = Router();

const R2_ASSET_ORIGIN =
  process.env.R2_ASSET_ORIGIN?.trim() || "https://assets.cardsofmyth.com";

// Update this after uploading a new OTA zip to R2 (see @capgo/cli `bundle zip`)
// and merging to main — that's what ships the update to devices.
// Rules:
//   - `bundleVersion` is independent of the native app-store version; bump it
//     on every OTA push (e.g. "1.0.13", "1.0.14", ...).
//   - `r2Key` is the object path in the R2 bucket (e.g. "updater-bundles/1.0.13.zip").
//   - Generate `checksum` with:  sha256sum <file>.zip   (prefix with "sha256:")
//   - `minNativeVersion` is the minimum native app-store (Capacitor shell)
//     version required to safely apply this bundle — set it when the bundle
//     relies on native code/permissions not present in older store builds.
//     Omit/null = no floor.
const CURRENT_BUNDLE = {
  bundleVersion: "1.0.13",
  r2Key: "updater-bundles/com.nurdturd.myth_1.0.13.zip",
  checksum: "sha256:c32bcf017e59829151d215b06f87c8f16e6ca586ee0e358624cef5a8c4201dbd",
  minNativeVersion: null as string | null,
};

function bundleUrl(r2Key: string): string {
  const normalized = r2Key.replace(/^\/+/, "");
  return `${R2_ASSET_ORIGIN}/${normalized}`;
}

/**
 * Capgo capacitor-updater self-hosted "auto update" check endpoint. The
 * native plugin POSTs device/app info on launch; the plugin itself tracks
 * which bundle version it already has applied and no-ops if the returned
 * `version` matches, so this always reports the currently configured
 * bundle rather than trying to diff against the caller.
 * https://capgo.app/docs/plugins/updater/self-hosted/handling-updates/
 */
router.post("/check", moderateRateLimit, (req: Request, res: Response) => {
  const { version_name: nativeVersion } = req.body || {};

  const meetsFloor =
    !CURRENT_BUNDLE.minNativeVersion ||
    (typeof nativeVersion === "string" &&
      compareSemver(nativeVersion, CURRENT_BUNDLE.minNativeVersion) >= 0);

  if (!meetsFloor || !CURRENT_BUNDLE.r2Key) {
    res.status(200).json({
      message: "No update available",
      version: typeof nativeVersion === "string" ? nativeVersion : "",
    });
    return;
  }

  res.status(200).json({
    version: CURRENT_BUNDLE.bundleVersion,
    url: bundleUrl(CURRENT_BUNDLE.r2Key),
    checksum: CURRENT_BUNDLE.checksum,
  });
});

export default router;
