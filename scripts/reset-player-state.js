#!/usr/bin/env node
/**
 * reset-player-state.js — end-of-beta full reset of all HUMAN player state.
 *
 * CARD HANDLING
 * -------------
 * "Saga-shop exclusives": is_exclusive=true variants that appear as
 *   seasonal_card / art_variant items in any saga season's shop_items JSON.
 *   → Removed from accounts. Users re-earn them in future seasons.
 *
 * "Kept exclusives": is_exclusive=true variants NOT in any saga shop, plus
 *   any card_variant_ids granted by season_reward_tiers.bundle_json
 *   (season leaderboard prizes — beta testers' special cards).
 *   → Kept. Per-user: card instance re-created at level 1, xp 0, no border.
 *     power-up rows and XP pools are wiped with everything else.
 *
 * SEASON COSMETICS
 * ----------------
 * border_ids and card_back_ids from season_reward_tiers.bundle_json are
 * collected before the wipe and re-granted after (one INSERT per user who
 * had them).
 *
 * ACTIVE SAGA RUNS
 * ----------------
 * If any human user has an active saga run the script aborts before touching
 * anything. Operator must wait for runs to finish or abandon them manually.
 *
 * TOWER
 * -----
 * All tower_floors rows and the AI decks + AI cards they reference are
 * deleted inside the same transaction (same logic as wipe-tower.js, scoped
 * to tower decks only — saga enemy decks are untouched).
 *
 * CHARACTER ACHIEVEMENTS
 * ----------------------
 * user_achievements rows for achievement_kind='character' are reset to
 * progress 0 / not completed / not claimed rather than deleted. All other
 * user_achievements are deleted.
 *
 * Usage:
 *   node scripts/reset-player-state.js               # dry run: counts only
 *   node scripts/reset-player-state.js --confirm     # actually reset
 *   node scripts/reset-player-state.js --confirm --no-starters
 *   node scripts/reset-player-state.js --confirm --reset-tutorials
 *
 * DB: DATABASE_URL env var, else myth-server/.env. For prod set it explicitly:
 *   DATABASE_URL="postgresql://..." node scripts/reset-player-state.js --confirm
 */

const fs   = require("fs");
const path = require("path");
const { Pool } = require("pg");

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

const args           = process.argv.slice(2);
const CONFIRM        = args.includes("--confirm");
const NO_STARTERS    = args.includes("--no-starters");
const RESET_TUTORIALS = args.includes("--reset-tutorials");

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) throw new Error("DATABASE_URL not set and .env not found.");
  const line = fs.readFileSync(envPath, "utf8").split("\n")
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) throw new Error("DATABASE_URL not found in .env");
  let v = line.slice(line.indexOf("=") + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

function makePool(url) {
  const ssl = url.includes("render.com") || process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false } : false;
  return new Pool({ connectionString: url, ssl });
}

// ---------------------------------------------------------------------------
// Pre-wipe catalogue queries (read-only, outside transaction)
// ---------------------------------------------------------------------------

async function buildCatalogue(client) {
  // 1. card_variant_ids that appear in any saga season shop as
  //    seasonal_card or art_variant → these are "saga-shop exclusives"
  const { rows: shopRows } = await client.query(`
    SELECT DISTINCT elem->'metadata'->>'card_variant_id' AS variant_id
    FROM   saga_seasons,
           jsonb_array_elements(shop_items) AS elem
    WHERE  elem->>'type' IN ('seasonal_card', 'art_variant')
      AND  elem->'metadata'->>'card_variant_id' IS NOT NULL
  `);
  const sagaShopVariantIds = new Set(shopRows.map((r) => r.variant_id));

  // 2. All is_exclusive=true variants → the ones NOT in the saga shop are "kept"
  const { rows: exclusiveRows } = await client.query(`
    SELECT card_variant_id FROM card_variants WHERE is_exclusive = true
  `);
  const keptExclusiveVariantIds = new Set(
    exclusiveRows.map((r) => r.card_variant_id).filter((id) => !sagaShopVariantIds.has(id))
  );

  // 3. card_variant_ids from season reward tiers (leaderboard prizes)
  const { rows: tierRows } = await client.query(`
    SELECT DISTINCT jsonb_array_elements_text(bundle_json->'card_variant_ids') AS variant_id
    FROM   season_reward_tiers
    WHERE  bundle_json->'card_variant_ids' != '[]'
  `);
  for (const r of tierRows) {
    // Only keep ones that actually exist in card_variants
    const { rows: exists } = await client.query(
      `SELECT 1 FROM card_variants WHERE card_variant_id = $1`, [r.variant_id]
    );
    if (exists.length > 0) keptExclusiveVariantIds.add(r.variant_id);
  }

  // 4. Season-reward border_ids and card_back_ids to preserve
  const { rows: cosmeticRows } = await client.query(`
    SELECT DISTINCT
      jsonb_array_elements_text(bundle_json->'border_ids')   AS border_id,
      NULL::text AS back_id
    FROM season_reward_tiers WHERE bundle_json->'border_ids' != '[]'
    UNION ALL
    SELECT DISTINCT
      NULL,
      jsonb_array_elements_text(bundle_json->'card_back_ids')
    FROM season_reward_tiers WHERE bundle_json->'card_back_ids' != '[]'
  `);
  const seasonRewardBorderIds  = new Set(cosmeticRows.filter((r) => r.border_id).map((r) => r.border_id));
  const seasonRewardBackIds    = new Set(cosmeticRows.filter((r) => r.back_id).map((r) => r.back_id));

  return { sagaShopVariantIds, keptExclusiveVariantIds, seasonRewardBorderIds, seasonRewardBackIds };
}

// ---------------------------------------------------------------------------
// Guard: active saga runs
// ---------------------------------------------------------------------------

async function assertNoActiveSagaRuns(client) {
  const { rows } = await client.query(`
    SELECT u.username, sr.run_id, sr.current_floor
    FROM   saga_runs sr
    JOIN   users u ON u.user_id = sr.player_id
    WHERE  sr.status = 'active'
      AND  sr.player_id != $1
  `, [AI_PLAYER_ID]);

  if (rows.length > 0) {
    const list = rows.map((r) => `  - ${r.username} (run ${r.run_id}, floor ${r.current_floor})`).join("\n");
    throw new Error(
      `Cannot reset: ${rows.length} active saga run(s) in progress.\n` +
      `Wait for them to finish or abandon them manually, then re-run.\n${list}`
    );
  }
}

// ---------------------------------------------------------------------------
// Snapshot: per-user state to restore after wipe
// ---------------------------------------------------------------------------

async function snapshotUserState(client, keptExclusiveVariantIds, seasonRewardBorderIds, seasonRewardBackIds) {
  const { rows: humans } = await client.query(
    `SELECT user_id, username FROM users WHERE user_id != $1 ORDER BY username`,
    [AI_PLAYER_ID]
  );

  const perUser = {};
  for (const u of humans) {
    const uid = u.user_id;
    perUser[uid] = { username: u.username, keptVariantIds: [], borders: [], backs: [] };

    if (keptExclusiveVariantIds.size > 0) {
      const { rows: keptCards } = await client.query(`
        SELECT DISTINCT card_variant_id
        FROM   user_owned_cards
        WHERE  user_id = $1
          AND  card_variant_id = ANY($2::uuid[])
      `, [uid, Array.from(keptExclusiveVariantIds)]);
      perUser[uid].keptVariantIds = keptCards.map((r) => r.card_variant_id);
    }

    if (seasonRewardBorderIds.size > 0) {
      const { rows: borders } = await client.query(`
        SELECT DISTINCT border_id, character_id
        FROM   user_owned_borders
        WHERE  user_id = $1
          AND  border_id = ANY($2::uuid[])
      `, [uid, Array.from(seasonRewardBorderIds)]);
      perUser[uid].borders = borders;
    }

    if (seasonRewardBackIds.size > 0) {
      const { rows: backs } = await client.query(`
        SELECT DISTINCT back_id
        FROM   user_owned_card_backs
        WHERE  user_id = $1
          AND  back_id = ANY($2::uuid[])
      `, [uid, Array.from(seasonRewardBackIds)]);
      perUser[uid].backs = backs.map((r) => r.back_id);
    }
  }

  return { humans, perUser };
}

// ---------------------------------------------------------------------------
// Tower wipe (inline, runs inside the main transaction)
// ---------------------------------------------------------------------------

async function wipeTower(client) {
  // Capture the tower AI deck IDs before deleting floors
  const { rows: floorRows } = await client.query(
    `SELECT ai_deck_id FROM tower_floors WHERE ai_deck_id IS NOT NULL`
  );
  const towerDeckIds = floorRows.map((r) => r.ai_deck_id);

  // Abort any in-progress tower games (reference tower AI decks)
  if (towerDeckIds.length > 0) {
    const { rowCount: aborted } = await client.query(`
      UPDATE games SET game_status = 'aborted'
      WHERE  game_status = 'active'
        AND  (player1_deck_id = ANY($1::uuid[]) OR player2_deck_id = ANY($1::uuid[]))
    `, [towerDeckIds]);
    if (aborted > 0) console.log(`  aborted ${aborted} in-progress tower game(s)`);
  }

  const { rowCount: floors } = await client.query(`DELETE FROM tower_floors`);
  console.log(`  deleted ${floors} tower floor(s)`);

  if (towerDeckIds.length === 0) return;

  // AI cards for those decks
  const { rows: cardRows } = await client.query(`
    SELECT DISTINCT dc.user_card_instance_id
    FROM   deck_cards dc
    WHERE  dc.deck_id = ANY($1::uuid[])
  `, [towerDeckIds]);
  const towerCardIds = cardRows.map((r) => r.user_card_instance_id);

  // Delete decks (cascades deck_cards)
  const { rowCount: decks } = await client.query(
    `DELETE FROM decks WHERE deck_id = ANY($1::uuid[])`, [towerDeckIds]
  );
  console.log(`  deleted ${decks} tower AI deck(s)`);

  if (towerCardIds.length > 0) {
    const { rowCount: cards } = await client.query(
      `DELETE FROM user_owned_cards WHERE user_card_instance_id = ANY($1::uuid[])`,
      [towerCardIds]
    );
    console.log(`  deleted ${cards} tower AI card instance(s)`);
  }
}

// ---------------------------------------------------------------------------
// Main wipe steps (FK-safe order, all inside the transaction)
// ---------------------------------------------------------------------------

const SIMPLE_WIPE_STEPS = [
  ["game_results",               null],
  ["games",                      null],
  ["fate_pick_participations",   null],
  ["fate_picks",                 null],
  ["pack_opening_history",       null],
  ["mail",                       null],
  ["season_reward_payouts",      null],
  ["season_soul_contributions",  null],
  ["season_mythology_choices",   null],
  ["season_mythology_totals",    null],
  // tower handled separately above
  // saga: cascades saga_cards, saga_decks, saga_collections
  ["saga_runs",                  `player_id != '${AI_PLAYER_ID}'`],
  ["saga_player_seasons",        `player_id != '${AI_PLAYER_ID}'`],
  // decks: cascades deck_cards (AI decks already removed by wipeTower above)
  ["decks",                      `user_id != '${AI_PLAYER_ID}'`],
  // user_owned_cards: cascades user_card_power_ups
  ["user_owned_cards",           `user_id != '${AI_PLAYER_ID}'`],
  ["xp_transfers",               `user_id != '${AI_PLAYER_ID}'`],
  ["user_card_xp_pools",         `user_id != '${AI_PLAYER_ID}'`],
  ["user_owned_borders",         `user_id != '${AI_PLAYER_ID}'`],
  ["user_owned_card_backs",      `user_id != '${AI_PLAYER_ID}'`],
  // character achievements: reset in place (handled separately)
  // all other user_achievements: deleted
  ["user_daily_task_progress",   `user_id != '${AI_PLAYER_ID}'`],
  ["user_monthly_login_progress",`user_id != '${AI_PLAYER_ID}'`],
  ["daily_shop_purchases",       `user_id != '${AI_PLAYER_ID}'`],
  ["user_rankings",              `user_id != '${AI_PLAYER_ID}'`],
  ["user_sessions",              null],
];

async function wipeAchievements(client) {
  // Reset character achievement progress in-place (preserves the row, clears counts)
  const { rowCount: reset } = await client.query(`
    UPDATE user_achievements ua
    SET    current_progress = 0,
           is_completed     = false,
           completed_at     = NULL,
           claimed_at       = NULL,
           is_claimed       = false,
           updated_at       = NOW()
    FROM   achievements a
    WHERE  ua.achievement_id = a.id
      AND  a.achievement_kind = 'character'
      AND  ua.user_id != $1
  `, [AI_PLAYER_ID]);
  console.log(`  reset   ${String(reset).padStart(6)} character achievement rows`);

  const { rowCount: deleted } = await client.query(`
    DELETE FROM user_achievements ua
    USING  achievements a
    WHERE  ua.achievement_id = a.id
      AND  a.achievement_kind != 'character'
      AND  ua.user_id != $1
  `, [AI_PLAYER_ID]);
  console.log(`  deleted ${String(deleted).padStart(6)} non-character achievement rows`);
}

function resetUsersSql() {
  const tutorialReset = RESET_TUTORIALS
    ? `, tutorial_completed_at = NULL, completed_feature_tutorials = '{}'`
    : "";
  return `
    UPDATE users SET
      in_game_currency      = 0,
      gold                  = 0,
      gems                  = 0,
      fate_coins            = 0,
      card_fragments        = 0,
      echoes                = 0,
      total_xp              = 0,
      pack_count            = 0,
      win_streak_multiplier = 1,
      tower_floor           = 1,
      tower_floor_updated_at = NULL${tutorialReset}
    WHERE user_id != '${AI_PLAYER_ID}'`;
}

// ---------------------------------------------------------------------------
// Post-wipe restore: kept exclusives + season cosmetics
// ---------------------------------------------------------------------------

async function restoreKeptExclusives(client, uid, variantIds) {
  for (const variantId of variantIds) {
    await client.query(`
      INSERT INTO user_owned_cards (user_id, card_variant_id, level, xp)
      VALUES ($1, $2, 1, 0)
    `, [uid, variantId]);
  }
}

async function restoreSeasonCosmetics(client, uid, borders, backIds) {
  for (const { border_id, character_id } of borders) {
    // ON CONFLICT: safe if they somehow already have it
    await client.query(`
      INSERT INTO user_owned_borders (user_id, border_id, character_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `, [uid, border_id, character_id]);
  }
  for (const backId of backIds) {
    await client.query(`
      INSERT INTO user_owned_card_backs (user_id, back_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [uid, backId]);
  }
}

// ---------------------------------------------------------------------------
// Dry-run report
// ---------------------------------------------------------------------------

async function dryRun(client, catalogue, humans, perUser) {
  const { keptExclusiveVariantIds, seasonRewardBorderIds, seasonRewardBackIds } = catalogue;

  console.log(`\nHuman users: ${humans.length}`);
  for (const u of humans) {
    const s = perUser[u.user_id];
    const kept   = s.keptVariantIds.length;
    const borders = s.borders.length;
    const backs   = s.backs.length;
    console.log(`  - ${u.username.padEnd(24)} kept exclusives: ${kept}  season borders: ${borders}  season backs: ${backs}`);
  }

  console.log("\nKept exclusive variant IDs (non-saga, all users):");
  if (keptExclusiveVariantIds.size === 0) {
    console.log("  (none)");
  } else {
    for (const id of keptExclusiveVariantIds) console.log(`  ${id}`);
  }

  console.log("\nSeason reward borders to re-grant:");
  for (const id of seasonRewardBorderIds) console.log(`  ${id}`);
  console.log("Season reward card backs to re-grant:");
  for (const id of seasonRewardBackIds) console.log(`  ${id}`);

  console.log("\nRows that would be deleted/reset:");
  const steps = [
    ...SIMPLE_WIPE_STEPS,
    ["user_achievements (non-character, deleted)", `user_id != '${AI_PLAYER_ID}'`],
    ["user_achievements (character, reset to 0)",  `user_id != '${AI_PLAYER_ID}'`],
    ["tower_floors",                               null],
  ];
  for (const [label, where] of steps) {
    const table = label.split(" ")[0];
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM ${table}${where ? ` WHERE ${where}` : ""}`
    );
    console.log(`  ${label.padEnd(46)} ${rows[0].n}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const dbUrl = loadDatabaseUrl();
  process.env.DATABASE_URL = dbUrl; // ensure StarterService uses same DB

  const host = new URL(dbUrl).host;
  console.log(`Target database: ${host}`);
  console.log(CONFIRM ? "MODE: LIVE (--confirm)" : "MODE: dry run (pass --confirm to execute)");

  const pool   = makePool(dbUrl);
  const client = await pool.connect();

  try {
    // ---- pre-flight reads (outside transaction) ----
    await assertNoActiveSagaRuns(client);

    const catalogue = await buildCatalogue(client);
    const { humans, perUser } = await snapshotUserState(
      client,
      catalogue.keptExclusiveVariantIds,
      catalogue.seasonRewardBorderIds,
      catalogue.seasonRewardBackIds
    );

    if (!CONFIRM) {
      await dryRun(client, catalogue, humans, perUser);
      console.log("\nDry run complete. Nothing was changed.");
      return;
    }

    // ---- single transaction: wipe everything ----
    console.log("\nBeginning reset transaction...");
    await client.query("BEGIN");

    await wipeTower(client);

    for (const [table, where] of SIMPLE_WIPE_STEPS) {
      const res = await client.query(
        `DELETE FROM ${table}${where ? ` WHERE ${where}` : ""}`
      );
      console.log(`  deleted ${String(res.rowCount).padStart(6)} from ${table}`);
    }

    await wipeAchievements(client);

    const upd = await client.query(resetUsersSql());
    console.log(`  reset currencies/xp/tower on ${upd.rowCount} users`);

    // ---- restore kept exclusives + season cosmetics (still in transaction) ----
    for (const u of humans) {
      const s = perUser[u.user_id];
      if (s.keptVariantIds.length > 0) {
        await restoreKeptExclusives(client, u.user_id, s.keptVariantIds);
        console.log(`  restored ${s.keptVariantIds.length} exclusive card(s) for ${u.username}`);
      }
      if (s.borders.length > 0 || s.backs.length > 0) {
        await restoreSeasonCosmetics(client, u.user_id, s.borders, s.backs);
        console.log(`  restored ${s.borders.length} border(s) + ${s.backs.length} card back(s) for ${u.username}`);
      }
    }

    await client.query("COMMIT");
    console.log("Wipe + restore committed.");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }

  // ---- starter grant (outside transaction — StarterService manages its own) ----
  if (!NO_STARTERS) {
    console.log("\nRe-granting starter content (same path as registration)...");
    require("ts-node/register/transpile-only");
    const StarterService = require("../src/services/starter.service").default;

    const { rows } = await pool.query(
      `SELECT user_id, username FROM users WHERE user_id != $1 ORDER BY username`,
      [AI_PLAYER_ID]
    );
    for (const u of rows) {
      await StarterService.grantStarterContent(u.user_id);
      console.log(`  granted starter cards/deck/packs to ${u.username}`);
    }

    const appDb = require("../src/config/db.config").default;
    if (appDb.pool && typeof appDb.pool.end === "function") await appDb.pool.end();
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("\nReset failed:", err.message ?? err);
  process.exit(1);
});
