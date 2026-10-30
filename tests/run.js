#!/usr/bin/env node
/*
 * `npm test`: runs every *.test.ts / *.test.js under src/ and tests/ with
 * node:test, so new test files are picked up without editing package.json.
 * Files in QUARANTINE are skipped; each entry says why. Fix and remove them.
 *
 *   npm test                 # everything not quarantined
 *   npm test -- <substring>  # only files whose path contains <substring>
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const QUARANTINE = {
  "tests/game-engine/game.utils.test.ts": "written for Jest (not installed); port to node:test",
  "tests/game-engine/game.validators.test.ts": "written for Jest (not installed); port to node:test",
  "tests/win-streak-bonus.test.js": "written for Jest (not installed); port to node:test",
  "src/services/__tests__/achievement.service.norse.test.ts":
    "hits the real DB with fake user ids ('u-baldr'); needs DB stubs",
  "src/services/__tests__/achievement.service.polynesian.test.ts":
    "hits the real DB with fake user ids ('u-ukupa'); needs DB stubs. Also Pele/Maui assertion fails (1 vs 0); check after stubbing",
  "src/services/__tests__/iap.test.ts":
    "temp schema is built from migration ...014 only; service now needs ...015 (product_kind etc.), which also alters mail/users and can't run in the temp schema as-is. Also failing under test:iap",
};

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.test\.(ts|js)$/.test(name)) out.push(path.relative(ROOT, p));
  }
  return out;
}

const filter = process.argv[2];
const all = [...walk(path.join(ROOT, "src"), []), ...walk(path.join(ROOT, "tests"), [])].sort();
const files = all.filter((f) => !QUARANTINE[f] && (!filter || f.includes(filter)));

for (const f of Object.keys(QUARANTINE)) {
  if (!all.includes(f)) console.warn(`[run-tests] stale quarantine entry (file gone): ${f}`);
}
if (!filter) console.log(`[run-tests] ${files.length} files, ${Object.keys(QUARANTINE).length} quarantined`);

const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-force-exit", // pg Pool keeps some suites alive otherwise
    "--test-concurrency=1", // several suites share the local DB
    "-r", "dotenv/config",
    "-r", "ts-node/register",
    ...files,
  ],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
  }
);
process.exit(result.status ?? 1);
