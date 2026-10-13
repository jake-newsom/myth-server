/**
 * Freezes decks from the database into a JSON pool for headless AI games.
 * Read-only: issues SELECTs only.
 *
 *   npx ts-node src/game-engine/sim/cli/export-deck-pool.ts \
 *     [--prod] [--player-decks 200] [--out .ai-sim/deck-pool.json]
 *
 * --prod reads DATABASE_URL_PROD instead of DATABASE_URL. It must be applied
 * before db.config is imported (it builds its pool at import time), hence the
 * env juggling and the late require below.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const useProd = flag("prod");
if (useProd) {
  if (!process.env.DATABASE_URL_PROD) {
    throw new Error("--prod given but DATABASE_URL_PROD is not set");
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
}

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const DECK_SIZE = 20;
const DECK_EFFECT_MIN_COUNT = 12;

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const db = require("../../../config/db.config").default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GameLogic } = require("../../game.logic");

  const playerDeckLimit = parseInt(opt("player-decks", "0"), 10);
  const outPath = path.resolve(opt("out", ".ai-sim/deck-pool.json"));

  const { rows: aiDecks } = await db.query(
    `SELECT d.deck_id, d.name FROM decks d
     WHERE d.user_id = $1
       AND (SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.deck_id) = $2`,
    [AI_PLAYER_ID, DECK_SIZE]
  );

  // Most recently created complete player decks: a proxy for what people
  // actually play. Swap for a games-played join if that proves too noisy.
  const { rows: playerDecks } = playerDeckLimit
    ? await db.query(
        `SELECT d.deck_id, d.name FROM decks d
         WHERE d.user_id <> $1
           AND (SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.deck_id) = $2
         ORDER BY d.created_at DESC
         LIMIT $3`,
        [AI_PLAYER_ID, DECK_SIZE, playerDeckLimit]
      )
    : { rows: [] };

  const decks = [];
  const all = [
    ...aiDecks.map((d: any) => ({ ...d, source: "ai" as const })),
    ...playerDecks.map((d: any) => ({ ...d, source: "player" as const })),
  ];

  for (const deck of all) {
    const { rows: cardRows } = await db.query(
      `SELECT user_card_instance_id FROM deck_cards WHERE deck_id = $1`,
      [deck.deck_id]
    );
    const ids = cardRows.map((r: any) => r.user_card_instance_id);
    const hydrated: Map<string, any> = await GameLogic.hydrateCardInstances(ids);
    if (hydrated.size !== ids.length) {
      console.warn(
        `skip ${deck.source} deck ${deck.deck_id}: hydrated ${hydrated.size}/${ids.length}`
      );
      continue;
    }

    // Same rule as DeckService.getDeckEffect (≥12 of one set).
    const { rows: effectRows } = await db.query(
      `SELECT LOWER(s.name) AS set_name, COUNT(*) AS count
       FROM deck_cards dc
       JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
       JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
       JOIN characters ch ON cv.character_id = ch.character_id
       JOIN sets s ON ch.set_id = s.set_id
       WHERE dc.deck_id = $1
       GROUP BY s.name HAVING COUNT(*) >= $2
       ORDER BY count DESC LIMIT 1`,
      [deck.deck_id, DECK_EFFECT_MIN_COUNT]
    );
    const setName = effectRows[0]?.set_name;
    const deckEffect = ["norse", "polynesian", "japanese"].includes(setName)
      ? setName
      : null;

    decks.push({
      deck_id: deck.deck_id,
      name: deck.name,
      source: deck.source,
      deck_effect: deckEffect,
      cards: ids.map((id: string) => hydrated.get(id)),
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        source_db: useProd ? "prod" : "local",
        decks,
      },
      null,
      1
    )
  );
  const ai = decks.filter((d) => d.source === "ai").length;
  console.log(
    `wrote ${decks.length} decks (${ai} ai, ${decks.length - ai} player) → ${outPath}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
