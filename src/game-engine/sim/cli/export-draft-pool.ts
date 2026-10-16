/**
 * Freezes the Ranked Draft pool (every original printing, built exactly as a
 * drafted card is: level 1, no power-ups) into JSON for headless draft sims.
 * Read-only: issues SELECTs only.
 *
 *   TS_NODE_TRANSPILE_ONLY=true npx ts-node src/game-engine/sim/cli/export-draft-pool.ts \
 *     [--prod] [--out .ai-sim/draft-pool.json]
 *
 * --prod reads DATABASE_URL_PROD; like export-deck-pool it must be applied
 * before db.config is imported.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const useProd = args.includes("--prod");
if (useProd) {
  if (!process.env.DATABASE_URL_PROD) {
    throw new Error("--prod given but DATABASE_URL_PROD is not set");
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const db = require("../../../config/db.config").default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const hydration = require("../../draftBattle.hydration");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ORIGINAL_RARITY_SQL } = require("../../../services/rankedDraft.service");

  const outPath = path.resolve(opt("out", ".ai-sim/draft-pool.json"));

  const { rows } = await db.query(
    `SELECT cv.card_variant_id FROM card_variants cv
     WHERE ${ORIGINAL_RARITY_SQL}
     ORDER BY cv.card_variant_id`
  );
  const ids: string[] = rows.map((r: { card_variant_id: string }) => r.card_variant_id);
  const catalog = await hydration.fetchDraftCatalogRows(ids);

  const cards = ids
    .filter((id) => catalog.has(id))
    .map((id) => hydration.buildDraftCard(catalog.get(id), "pool", `pool-${id}`));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        source_db: useProd ? "prod" : "local",
        cards,
      },
      null,
      1
    )
  );
  console.log(`wrote ${cards.length} draftable cards → ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
