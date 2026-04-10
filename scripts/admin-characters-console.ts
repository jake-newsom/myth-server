/**
 * Local admin UI for characters & card variants. Not part of the public API.
 * Run only via: npm run admin:characters
 * Binds to 127.0.0.1 — not exposed to the network by default.
 *
 * .env connection strings (URLs never sent to the browser):
 * - DATABASE_URL → profile id "default" (required unless you only use extras below)
 * - DATABASE_URL_LOCAL → "local"
 * - DATABASE_URL_PROD → "prod"
 * - DATABASE_URL_PRODUCTION → "production"
 * - DATABASE_URL_STAGING → "staging"
 * Optional labels: ADMIN_DB_LABEL_DEFAULT, ADMIN_DB_LABEL_LOCAL, ADMIN_DB_LABEL_PROD, …
 * Default browse target when the UI sends no header: ADMIN_DB_DEFAULT_PROFILE or the first profile.
 *
 * Browse API: header X-Myth-Admin-Db: <profileId> or ?db=<profileId>
 *
 * Raw card images (not on the public game server): set ADMIN_ASSET_ROOT to a folder of unpacked
 * assets, or place files under content/assets/raw mirroring image_url paths (without leading /assets).
 */
import fs from "fs";
import path from "path";
import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import { RarityUtils } from "../src/types/card.types";
import {
  loadAdminDbProfiles,
  resolveProfileId,
  queryForProfile,
  getPublicProfileList,
  AdminDbProfile,
} from "./admin-db";
import { cloneCharactersBetweenProfiles } from "./admin-clone-cards";
import {
  expandCardRewardIds,
  insertMailRow,
  type CardRewardLine,
} from "./admin-mail";
import {
  resolveRawAssetPath,
  adminAssetRootExists,
} from "./admin-assets";
import {
  addPatchFromImageRef,
  clearPatchBuffer,
  getPatchBufferStatus,
  savePatchBufferToPatchesDir,
  buildPatchZipBuffer,
  listPatchZipFiles,
} from "./admin-patch-buffer";

dotenv.config({ path: path.join(__dirname, "../.env") });

const VALID_RARITIES = new Set<string>(RarityUtils.getAllValidRarities());
const PORT = parseInt(process.env.ADMIN_CHARACTERS_PORT || "47821", 10);
const HOST = process.env.ADMIN_CHARACTERS_HOST || "127.0.0.1";

const profiles = loadAdminDbProfiles();
if (profiles.length === 0) {
  console.error(
    "No database URLs configured. Set DATABASE_URL in .env (and optionally DATABASE_URL_LOCAL, DATABASE_URL_PROD, …)."
  );
  process.exit(1);
}

type QueryFn = (text: string, params?: unknown[]) => ReturnType<typeof queryForProfile>;

const app = express();
app.use(express.json({ limit: "2mb" }));

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

type VariantRow = {
  card_variant_id: string;
  rarity: string;
  image_url: string;
  attack_animation: string | null;
  is_exclusive: boolean;
};

type CharacterOut = {
  character_id: string;
  name: string;
  description: string | null;
  type: string;
  base_power: { top: number; right: number; bottom: number; left: number };
  special_ability_id: string | null;
  set_id: string | null;
  set_name: string | null;
  tags: string[];
  created_at: Date;
  updated_at: Date;
  variants: VariantRow[];
};

async function fetchBootstrap(dbQuery: QueryFn) {
  const [setsRes, abilitiesRes, matrixRes, charCountRes, variantTotalRes] =
    await Promise.all([
      dbQuery(`SELECT set_id, name, description, is_released FROM "sets" ORDER BY name`),
      dbQuery(`SELECT ability_id, id, name FROM special_abilities ORDER BY name`),
      dbQuery(`
        SELECT
          COALESCE(ch.set_id::text, '__none__') AS set_key,
          COALESCE(s.name, '(no set)') AS set_name,
          cv.rarity,
          COUNT(*)::int AS cnt
        FROM card_variants cv
        JOIN characters ch ON ch.character_id = cv.character_id
        LEFT JOIN "sets" s ON s.set_id = ch.set_id
        GROUP BY ch.set_id, s.name, cv.rarity
        ORDER BY set_name, cv.rarity
      `),
      dbQuery(`
        SELECT COALESCE(set_id::text, '__none__') AS set_key, COUNT(*)::int AS cnt
        FROM characters
        GROUP BY set_id
      `),
      dbQuery(`SELECT COUNT(*)::int AS cnt FROM card_variants`),
    ]);

  const variantMatrix: Record<string, { set_name: string; byRarity: Record<string, number> }> =
    {};
  for (const row of matrixRes.rows) {
    const key = row.set_key as string;
    if (!variantMatrix[key]) {
      variantMatrix[key] = { set_name: row.set_name, byRarity: {} };
    }
    variantMatrix[key].byRarity[row.rarity] = row.cnt;
  }

  for (const s of setsRes.rows) {
    const key = s.set_id as string;
    if (!variantMatrix[key]) {
      variantMatrix[key] = { set_name: s.name as string, byRarity: {} };
    } else {
      variantMatrix[key].set_name = s.name as string;
    }
  }
  if (!variantMatrix["__none__"]) {
    variantMatrix["__none__"] = { set_name: "(no set)", byRarity: {} };
  }

  const charactersBySet: Record<string, number> = {};
  for (const row of charCountRes.rows) {
    charactersBySet[row.set_key as string] = row.cnt;
  }

  const charTotalRes = await dbQuery(`SELECT COUNT(*)::int AS cnt FROM characters`);

  const charRows = await dbQuery(`
    SELECT
      ch.character_id, ch.name, ch.description, ch.type,
      ch.base_power, ch.special_ability_id, ch.set_id, ch.tags,
      ch.created_at, ch.updated_at,
      s.name AS set_name,
      cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
      COALESCE(cv.is_exclusive, false) AS is_exclusive
    FROM characters ch
    LEFT JOIN "sets" s ON s.set_id = ch.set_id
    LEFT JOIN card_variants cv ON cv.character_id = ch.character_id
    ORDER BY ch.name, cv.rarity NULLS LAST
  `);

  const byCharacter = new Map<string, CharacterOut>();
  for (const row of charRows.rows) {
    const id = row.character_id as string;
    if (!byCharacter.has(id)) {
      const bp = row.base_power;
      byCharacter.set(id, {
        character_id: id,
        name: row.name,
        description: row.description,
        type: row.type,
        base_power: {
          top: Number(bp?.top ?? 0),
          right: Number(bp?.right ?? 0),
          bottom: Number(bp?.bottom ?? 0),
          left: Number(bp?.left ?? 0),
        },
        special_ability_id: row.special_ability_id,
        set_id: row.set_id,
        set_name: row.set_name,
        tags: row.tags || [],
        created_at: row.created_at,
        updated_at: row.updated_at,
        variants: [],
      });
    }
    if (row.card_variant_id) {
      byCharacter.get(id)!.variants.push({
        card_variant_id: row.card_variant_id,
        rarity: row.rarity,
        image_url: row.image_url,
        attack_animation: row.attack_animation,
        is_exclusive: Boolean(row.is_exclusive),
      });
    }
  }

  return {
    validRarities: RarityUtils.getAllValidRarities(),
    sets: setsRes.rows,
    specialAbilities: abilitiesRes.rows,
    stats: {
      totals: {
        characters: charTotalRes.rows[0].cnt as number,
        variants: variantTotalRes.rows[0].cnt as number,
      },
      variantMatrix,
      charactersBySet,
    },
    characters: Array.from(byCharacter.values()),
  };
}

function browseProfileFromRequest(req: Request): string | undefined {
  const h = req.headers["x-myth-admin-db"];
  if (typeof h === "string" && h.trim()) return h.trim();
  if (Array.isArray(h) && h[0]) return String(h[0]).trim();
  const q = req.query.db ?? req.query.profile;
  if (typeof q === "string" && q.trim()) return q.trim();
  return undefined;
}

function attachBrowseProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = browseProfileFromRequest(req);
    const profile: AdminDbProfile = resolveProfileId(profiles, raw);
    res.locals.adminQuery = (text: string, params?: unknown[]) =>
      queryForProfile(profile, text, params);
    res.locals.adminProfileId = profile.id;
    next();
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Invalid database profile",
    });
  }
}

/**
 * Attach the selected DB pool (from X-Myth-Admin-Db / ?db=) to res.locals.
 * Apply only to routes that need it — do not mount a blanket app.use("/api", …)
 * or Express may never match later app.get("/api/...") routes (404 on /api/admin/*).
 */
function withBrowseDb(req: Request, res: Response, next: NextFunction) {
  return attachBrowseProfile(req, res, next);
}

app.get("/api/profiles", (_req: Request, res: Response) => {
  res.json({
    profiles: getPublicProfileList(profiles),
    defaultProfile:
      process.env.ADMIN_DB_DEFAULT_PROFILE?.trim() || profiles[0].id,
  });
});

app.post("/api/clone-cards", async (req: Request, res: Response) => {
  try {
    const fromId = req.body?.from;
    const toId = req.body?.to;
    if (typeof fromId !== "string" || typeof toId !== "string") {
      res.status(400).json({ error: "JSON body must include string fields: from, to (profile ids)" });
      return;
    }
    if (fromId === toId) {
      res.status(400).json({ error: "Source and destination profiles must differ" });
      return;
    }
    const fromP = resolveProfileId(profiles, fromId);
    const toP = resolveProfileId(profiles, toId);
    const namesRaw = req.body?.characterNames;
    const characterNames =
      Array.isArray(namesRaw) && namesRaw.every((n: unknown) => typeof n === "string")
        ? (namesRaw as string[])
        : null;
    const result = await cloneCharactersBetweenProfiles(fromP, toP, {
      characterNames,
    });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Clone failed",
    });
  }
});

app.get("/api/bootstrap", withBrowseDb, async (req: Request, res: Response) => {
  try {
    const dbQuery = res.locals.adminQuery as QueryFn;
    const data = await fetchBootstrap(dbQuery);
    res.json({
      ...data,
      activeProfile: res.locals.adminProfileId as string,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to load data",
    });
  }
});

app.patch("/api/characters/:characterId", withBrowseDb, async (req: Request, res: Response) => {
  const dbQuery = res.locals.adminQuery as QueryFn;
  const { characterId } = req.params;
  if (!isUuid(characterId)) {
    res.status(400).json({ error: "Invalid character id" });
    return;
  }
  const b = req.body as Record<string, unknown>;
  const updates: string[] = [];
  const values: unknown[] = [];
  let n = 1;

  if (b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    updates.push(`name = $${n++}`);
    values.push(b.name.trim());
  }
  if (b.description !== undefined) {
    updates.push(`description = $${n++}`);
    values.push(b.description === null ? null : String(b.description));
  }
  if (b.type !== undefined) {
    if (typeof b.type !== "string" || !b.type.trim()) {
      res.status(400).json({ error: "type must be a non-empty string" });
      return;
    }
    updates.push(`type = $${n++}`);
    values.push(b.type.trim());
  }
  if (b.base_power !== undefined) {
    const bp = b.base_power as Record<string, unknown>;
    const top = Number(bp?.top);
    const right = Number(bp?.right);
    const bottom = Number(bp?.bottom);
    const left = Number(bp?.left);
    if ([top, right, bottom, left].some((x) => Number.isNaN(x))) {
      res.status(400).json({ error: "base_power must have numeric top, right, bottom, left" });
      return;
    }
    updates.push(`base_power = $${n++}::jsonb`);
    values.push(JSON.stringify({ top, right, bottom, left }));
  }
  if (b.special_ability_id !== undefined) {
    const sid = b.special_ability_id;
    if (sid !== null && (typeof sid !== "string" || !isUuid(sid))) {
      res.status(400).json({ error: "special_ability_id must be UUID or null" });
      return;
    }
    updates.push(`special_ability_id = $${n++}`);
    values.push(sid);
  }
  if (b.set_id !== undefined) {
    const sid = b.set_id;
    if (sid !== null && (typeof sid !== "string" || !isUuid(sid))) {
      res.status(400).json({ error: "set_id must be UUID or null" });
      return;
    }
    updates.push(`set_id = $${n++}`);
    values.push(sid);
  }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || !b.tags.every((t) => typeof t === "string")) {
      res.status(400).json({ error: "tags must be an array of strings" });
      return;
    }
    updates.push(`tags = $${n++}`);
    values.push(b.tags);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  updates.push(`updated_at = NOW()`);
  values.push(characterId);

  const q = `
    UPDATE characters
    SET ${updates.join(", ")}
    WHERE character_id = $${n}
    RETURNING character_id
  `;
  try {
    const { rows } = await dbQuery(q, values);
    if (rows.length === 0) {
      res.status(404).json({ error: "Character not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Update failed",
    });
  }
});

app.patch("/api/variants/:variantId", withBrowseDb, async (req: Request, res: Response) => {
  const dbQuery = res.locals.adminQuery as QueryFn;
  const { variantId } = req.params;
  if (!isUuid(variantId)) {
    res.status(400).json({ error: "Invalid variant id" });
    return;
  }
  const b = req.body as Record<string, unknown>;
  const updates: string[] = [];
  const values: unknown[] = [];
  let n = 1;

  if (b.rarity !== undefined) {
    const r = String(b.rarity);
    if (!VALID_RARITIES.has(r)) {
      res.status(400).json({ error: `Invalid rarity: ${r}` });
      return;
    }
    updates.push(`rarity = $${n++}`);
    values.push(r);
  }
  if (b.image_url !== undefined) {
    if (typeof b.image_url !== "string" || !b.image_url.trim()) {
      res.status(400).json({ error: "image_url must be a non-empty string" });
      return;
    }
    updates.push(`image_url = $${n++}`);
    values.push(b.image_url.trim().slice(0, 255));
  }
  if (b.attack_animation !== undefined) {
    updates.push(`attack_animation = $${n++}`);
    values.push(
      b.attack_animation === null || b.attack_animation === ""
        ? null
        : String(b.attack_animation).slice(0, 100)
    );
  }
  if (b.is_exclusive !== undefined) {
    if (typeof b.is_exclusive !== "boolean") {
      res.status(400).json({ error: "is_exclusive must be boolean" });
      return;
    }
    updates.push(`is_exclusive = $${n++}`);
    values.push(b.is_exclusive);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  values.push(variantId);
  const q = `
    UPDATE card_variants
    SET ${updates.join(", ")}
    WHERE card_variant_id = $${n}
    RETURNING card_variant_id
  `;
  try {
    const { rows } = await dbQuery(q, values);
    if (rows.length === 0) {
      res.status(404).json({ error: "Variant not found" });
      return;
    }
    let patchAsset: ReturnType<typeof addPatchFromImageRef> | undefined;
    if (b.image_url !== undefined) {
      patchAsset = addPatchFromImageRef(String(b.image_url).trim(), {
        cardVariantId: variantId,
      });
    }
    res.json({ ok: true, ...(patchAsset !== undefined ? { patchAsset } : {}) });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Update failed",
    });
  }
});

app.post("/api/variants", withBrowseDb, async (req: Request, res: Response) => {
  const dbQuery = res.locals.adminQuery as QueryFn;
  const b = req.body as Record<string, unknown>;
  const characterId = b.character_id;
  if (typeof characterId !== "string" || !isUuid(characterId)) {
    res.status(400).json({ error: "character_id must be a UUID" });
    return;
  }
  const rarity = b.rarity !== undefined ? String(b.rarity) : "";
  if (!VALID_RARITIES.has(rarity)) {
    res.status(400).json({ error: "Invalid rarity" });
    return;
  }
  if (typeof b.image_url !== "string" || !b.image_url.trim()) {
    res.status(400).json({ error: "image_url is required" });
    return;
  }
  const attack =
    b.attack_animation === undefined || b.attack_animation === null || b.attack_animation === ""
      ? null
      : String(b.attack_animation).slice(0, 100);
  const isExclusive = Boolean(b.is_exclusive);

  try {
    const { rows } = await dbQuery(
      `
      INSERT INTO card_variants (character_id, rarity, image_url, attack_animation, is_exclusive)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING card_variant_id
    `,
      [characterId, rarity, b.image_url.trim().slice(0, 255), attack, isExclusive]
    );
    const newId = rows[0].card_variant_id as string;
    const patchAsset = addPatchFromImageRef(b.image_url.trim(), {
      cardVariantId: newId,
    });
    res.status(201).json({ card_variant_id: newId, patchAsset });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Insert failed",
    });
  }
});

app.delete("/api/variants/:variantId", withBrowseDb, async (req: Request, res: Response) => {
  const dbQuery = res.locals.adminQuery as QueryFn;
  const { variantId } = req.params;
  if (!isUuid(variantId)) {
    res.status(400).json({ error: "Invalid variant id" });
    return;
  }
  try {
    const { rowCount } = await dbQuery(
      `DELETE FROM card_variants WHERE card_variant_id = $1`,
      [variantId]
    );
    if (rowCount === 0 || rowCount === null) {
      res.status(404).json({ error: "Variant not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error:
        e instanceof Error
          ? e.message
          : "Delete failed (variant may still be referenced by players)",
    });
  }
});

app.get("/api/admin/asset-status", (_req: Request, res: Response) => {
  res.json({
    rootExists: adminAssetRootExists(),
    usingEnvOverride: Boolean(process.env.ADMIN_ASSET_ROOT?.trim()),
    defaultRelative: "content/assets/raw",
  });
});

/**
 * Serve a single raw asset file for admin preview. Not for public web (admin binds localhost).
 * Query: ref = image_url from DB (e.g. cards/foo.png).
 */
app.get("/api/admin/local-asset", (req: Request, res: Response) => {
  const ref = String(req.query.ref ?? "");
  const resolved = resolveRawAssetPath(ref);
  if (resolved === null) {
    res.status(400).json({
      error: "http(s) URLs are loaded by the browser directly; omit for local files.",
    });
    return;
  }
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  if (!fs.existsSync(resolved.abs)) {
    res.status(404).end();
    return;
  }
  res.sendFile(resolved.abs, { dotfiles: "deny", maxAge: 0 }, (err) => {
    if (err) {
      console.error("admin local-asset:", err);
      if (!res.headersSent) res.status(500).end();
    }
  });
});

/** Queued local assets for a client patch ZIP (session memory; npm admin only). */
app.get("/api/admin/patch-buffer", (_req: Request, res: Response) => {
  res.json(getPatchBufferStatus());
});

app.delete("/api/admin/patch-buffer", (_req: Request, res: Response) => {
  clearPatchBuffer();
  res.json({ ok: true });
});

app.post("/api/admin/patch-buffer/add", (req: Request, res: Response) => {
  const ref = req.body?.ref;
  if (typeof ref !== "string" || !ref.trim()) {
    res.status(400).json({ error: "ref must be a non-empty string" });
    return;
  }
  const vid = req.body?.card_variant_id;
  const patchAsset = addPatchFromImageRef(ref.trim(), {
    cardVariantId: typeof vid === "string" && isUuid(vid) ? vid : undefined,
  });
  res.json({ patchAsset });
});

app.post("/api/admin/patch-buffer/save", async (req: Request, res: Response) => {
  const name = req.body?.filename;
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "filename is required" });
    return;
  }
  try {
    const out = await Promise.resolve(savePatchBufferToPatchesDir(name.trim()));
    res.json({
      ok: true,
      relativePath: path.relative(path.join(__dirname, ".."), out.fullPath),
      ...out,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed";
    res.status(400).json({ error: msg });
  }
});

app.get("/api/admin/patch-buffer/download", (_req: Request, res: Response) => {
  try {
    const buf = buildPatchZipBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="patch-export.zip"');
    res.send(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Empty buffer";
    res.status(400).json({ error: msg });
  }
});

app.get("/api/admin/patches-folder", (_req: Request, res: Response) => {
  try {
    res.json({ files: listPatchZipFiles() });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "List failed",
    });
  }
});

function parseNonNegInt(v: unknown, fallback = 0): number {
  const n = Math.floor(Number(v));
  if (Number.isNaN(n) || n < 0) return fallback;
  return Math.min(n, 1_000_000_000);
}

app.get("/api/admin/users-search", withBrowseDb, async (req: Request, res: Response) => {
  const dbQuery = res.locals.adminQuery as QueryFn;
  const q = String(req.query.q || "").trim();
  if (q.length < 1) {
    res.json({ users: [] });
    return;
  }
  // ILIKE wildcards: strip % _ \ so input is a literal substring; avoids ESCAPE edge cases.
  const literal = q.replace(/[%_\\]/g, "");
  if (literal.length < 1) {
    res.json({ users: [] });
    return;
  }
  const pattern = `%${literal}%`;
  try {
    const { rows } = await dbQuery(
      `SELECT user_id, username, email FROM users
       WHERE username ILIKE $1 OR email ILIKE $1
       ORDER BY username
       LIMIT 50`,
      [pattern]
    );
    res.json({ users: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Search failed",
    });
  }
});

app.get("/api/admin/users-count", withBrowseDb, async (req: Request, res: Response) => {
  const dbQuery = res.locals.adminQuery as QueryFn;
  try {
    const { rows } = await dbQuery(`SELECT COUNT(*)::int AS c FROM users`, []);
    res.json({ count: rows[0].c as number });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Count failed",
    });
  }
});

app.get("/api/admin/card-variants-search", withBrowseDb, async (req: Request, res: Response) => {
  const dbQuery = res.locals.adminQuery as QueryFn;
  const q = String(req.query.q || "").trim();
  if (q.length < 1) {
    res.json({ variants: [] });
    return;
  }
  try {
    const safe = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const like = `%${safe}%`;
    let rows;
    if (isUuid(q)) {
      const { rows: r } = await dbQuery(
        `SELECT cv.card_variant_id, ch.name, cv.rarity, cv.image_url, s.name AS set_name
         FROM card_variants cv
         JOIN characters ch ON ch.character_id = cv.character_id
         LEFT JOIN sets s ON s.set_id = ch.set_id
         WHERE cv.card_variant_id = $1
            OR ch.name ILIKE $2 ESCAPE '\\'
            OR cv.rarity ILIKE $2 ESCAPE '\\'
         ORDER BY ch.name, cv.rarity
         LIMIT 50`,
        [q, like]
      );
      rows = r;
    } else {
      const { rows: r } = await dbQuery(
        `SELECT cv.card_variant_id, ch.name, cv.rarity, cv.image_url, s.name AS set_name
         FROM card_variants cv
         JOIN characters ch ON ch.character_id = cv.character_id
         LEFT JOIN sets s ON s.set_id = ch.set_id
         WHERE ch.name ILIKE $1 ESCAPE '\\' OR cv.rarity ILIKE $1 ESCAPE '\\'
            OR cv.image_url ILIKE $1 ESCAPE '\\'
         ORDER BY ch.name, cv.rarity
         LIMIT 50`,
        [like]
      );
      rows = r;
    }
    res.json({ variants: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Search failed",
    });
  }
});

app.post("/api/admin/send-mail", withBrowseDb, async (req: Request, res: Response) => {
  const dbQuery = res.locals.adminQuery as QueryFn;
  const b = req.body as Record<string, unknown>;

  const audience = b.audience === "all" ? "all" : b.audience === "selected" ? "selected" : null;
  if (!audience) {
    res.status(400).json({ error: 'audience must be "all" or "selected"' });
    return;
  }

  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  const content = typeof b.content === "string" ? b.content.trim() : "";
  if (!subject || !content) {
    res.status(400).json({ error: "subject and content are required" });
    return;
  }

  const sender_name =
    typeof b.sender_name === "string" && b.sender_name.trim()
      ? b.sender_name.trim().slice(0, 100)
      : "Admin";

  let userIds: string[] = [];
  if (audience === "all") {
    const { rows } = await dbQuery(`SELECT user_id FROM users`, []);
    userIds = rows.map((r) => r.user_id as string);
  } else {
    const raw = b.userIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ error: "userIds must be a non-empty array when audience is selected" });
      return;
    }
    userIds = raw.filter((id): id is string => typeof id === "string" && isUuid(id));
    if (userIds.length !== raw.length) {
      res.status(400).json({ error: "All userIds must be valid UUIDs" });
      return;
    }
  }

  if (userIds.length === 0) {
    res.status(400).json({ error: "No users to send mail to" });
    return;
  }

  const reward_gold = parseNonNegInt(b.reward_gold);
  const reward_gems = parseNonNegInt(b.reward_gems);
  const reward_packs = parseNonNegInt(b.reward_packs);
  const reward_fate_coins = parseNonNegInt(b.reward_fate_coins);

  let cards: CardRewardLine[] = [];
  if (Array.isArray(b.cards)) {
    for (const line of b.cards) {
      if (!line || typeof line !== "object") continue;
      const o = line as Record<string, unknown>;
      if (typeof o.card_variant_id === "string" && isUuid(o.card_variant_id)) {
        cards.push({
          card_variant_id: o.card_variant_id,
          quantity: parseNonNegInt(o.quantity, 1),
        });
      }
    }
  }

  const expanded = expandCardRewardIds(cards);
  if (expanded.error) {
    res.status(400).json({ error: expanded.error });
    return;
  }
  const reward_card_ids = expanded.ids;

  if (
    reward_gold === 0 &&
    reward_gems === 0 &&
    reward_packs === 0 &&
    reward_fate_coins === 0 &&
    reward_card_ids.length === 0
  ) {
    res.status(400).json({ error: "Add at least one reward (currency or cards)" });
    return;
  }

  const uniqueCardIds = [...new Set(reward_card_ids)];
  if (uniqueCardIds.length > 0) {
    const { rows: found } = await dbQuery(
      `SELECT card_variant_id FROM card_variants WHERE card_variant_id = ANY($1::uuid[])`,
      [uniqueCardIds]
    );
    if (found.length !== uniqueCardIds.length) {
      res.status(400).json({ error: "One or more card_variant_id values do not exist in this database" });
      return;
    }
  }

  let expires_at: Date | null = null;
  if (b.expires_in_days != null) {
    const d = Math.min(3650, Math.max(1, parseNonNegInt(b.expires_in_days, 30)));
    expires_at = new Date(Date.now() + d * 24 * 60 * 60 * 1000);
  }

  const errors: { user_id: string; message: string }[] = [];
  let sent = 0;

  for (const user_id of userIds) {
    try {
      await insertMailRow(dbQuery, {
        user_id,
        mail_type: "admin",
        subject,
        content,
        sender_name,
        reward_gold,
        reward_gems,
        reward_packs,
        reward_fate_coins,
        reward_card_ids,
        expires_at,
      });
      sent++;
    } catch (err) {
      errors.push({
        user_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.json({
    sent,
    failed: errors.length,
    errors: errors.slice(0, 50),
    total_users: userIds.length,
  });
});

app.use(
  express.static(path.join(__dirname, "admin-characters-ui"), {
    index: "index.html",
  })
);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

app.listen(PORT, HOST, () => {
  const ids = profiles.map((p) => p.id).join(", ");
  console.log(
    `\n  Admin console (characters): http://${HOST}:${PORT}\n  Profiles: ${ids}\n  Browse DB: header X-Myth-Admin-Db or ?db=\n  Stop with Ctrl+C.\n`
  );
});
