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
//   - Generate `checksum` with:  sha256sum <file>.zip
//     Use the raw 64-char hex digest as-is — no "sha256:" prefix. The plugin
//     detects the algorithm by hex length (64 chars = SHA-256) and rejects
//     anything else as "unknown checksum algorithm".
//   - `minNativeVersion` is the minimum native app-store (Capacitor shell)
//     version required to safely apply this bundle — set it when the bundle
//     relies on native code/permissions not present in older store builds.
//     Omit/null = no floor.
// No OTA bundle published yet — r2Key null makes /check always report
// "no update available" (see the !CURRENT_BUNDLE.r2Key branch below).
const CURRENT_BUNDLE = {
  bundleVersion: "1.0.18",
  r2Key: "updater-bundles/com.nurdturd.myth_1.0.18.zip",
  checksum: "a3f2f781b60a02b853faf6f483c83058ebb0ec68894dc6adbf1f409004a22924",
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
  console.log("[updater] /check hit", JSON.stringify(req.body));

  const meetsFloor =
    !CURRENT_BUNDLE.minNativeVersion ||
    (typeof nativeVersion === "string" &&
      compareSemver(nativeVersion, CURRENT_BUNDLE.minNativeVersion) >= 0);

  if (!meetsFloor || !CURRENT_BUNDLE.r2Key) {
    const body = {
      message: "No update available",
      version: typeof nativeVersion === "string" ? nativeVersion : "",
    };
    console.log("[updater] responding no-update", JSON.stringify(body));
    res.status(200).json(body);
    return;
  }

  const body = {
    version: CURRENT_BUNDLE.bundleVersion,
    url: bundleUrl(CURRENT_BUNDLE.r2Key),
    checksum: CURRENT_BUNDLE.checksum,
  };
  console.log("[updater] responding with update", JSON.stringify(body));
  res.status(200).json(body);
});

export default router;
