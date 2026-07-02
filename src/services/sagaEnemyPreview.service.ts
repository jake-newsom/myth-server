import db from "../config/db.config";
import type { SagaNodeMapData, SagaMapNode } from "../types/sagaMap.types";

export interface SagaEnemyNodePreview {
  deck_name: string;
  preview_base_card_id: string;
  preview_name: string;
  preview_image_url: string;
  preview_rarity: string;
  preview_is_exclusive: boolean;
}

// Preview-card preference, evaluated entirely in SQL (see loadEnemyDeckPreviews):
//   1. A "boss" card always wins the slot.
//   2. Otherwise the highest base rarity (legendary > epic > rare > other).
//   3. Within a base rarity, more "+" tiers win (legendary++ beats legendary+).
// $RARITY_RANK expands to a CASE matching rarityRank()'s former JS behaviour.
const RARITY_RANK_SQL = `
  CASE
    WHEN cv.rarity LIKE 'legendary%' THEN 3
    WHEN cv.rarity LIKE 'epic%' THEN 2
    WHEN cv.rarity LIKE 'rare%' THEN 1
    ELSE 0
  END`;

async function loadEnemyDeckPreviews(
  deckIds: string[]
): Promise<Map<string, SagaEnemyNodePreview>> {
  const result = new Map<string, SagaEnemyNodePreview>();
  if (deckIds.length === 0) return result;

  // DISTINCT ON keeps one row per deck — the first per the ORDER BY, which
  // encodes the boss-first / rarity / "+"-tier preference above. This replaces
  // the previous one-query-per-deck N+1.
  const { rows } = await db.query(
    `SELECT DISTINCT ON (dc.deck_id)
            dc.deck_id,
            d.name AS deck_name,
            cv.card_variant_id,
            ch.name AS card_name,
            cv.image_url,
            cv.rarity,
            cv.is_exclusive
     FROM deck_cards dc
     JOIN decks d ON d.deck_id = dc.deck_id
     JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
     JOIN card_variants cv ON cv.card_variant_id = uoc.card_variant_id
     JOIN characters ch ON ch.character_id = cv.character_id
     WHERE dc.deck_id = ANY($1::uuid[])
     ORDER BY
       dc.deck_id,
       (ch.type = 'boss') DESC,
       ${RARITY_RANK_SQL} DESC,
       (LENGTH(cv.rarity) - LENGTH(REPLACE(cv.rarity, '+', ''))) DESC`,
    [deckIds]
  );

  for (const row of rows) {
    result.set(String(row.deck_id), {
      deck_name: String(row.deck_name ?? "Enemy deck"),
      preview_base_card_id: String(row.card_variant_id),
      preview_name: String(row.card_name),
      preview_image_url: String(row.image_url ?? ""),
      preview_rarity: String(row.rarity ?? "common"),
      preview_is_exclusive: Boolean(row.is_exclusive),
    });
  }

  return result;
}

async function loadEnemyDeckPreview(
  deckId: string
): Promise<SagaEnemyNodePreview | null> {
  const previews = await loadEnemyDeckPreviews([deckId]);
  return previews.get(deckId) ?? null;
}

function attachPreviewToNode(
  node: SagaMapNode,
  preview: SagaEnemyNodePreview | null
): SagaMapNode {
  if (!preview || (node.type !== "battle" && node.type !== "boss")) {
    return node;
  }
  return { ...node, enemy_preview: preview };
}

export async function enrichMapWithEnemyPreviews(
  map: SagaNodeMapData
): Promise<SagaNodeMapData> {
  const deckIds = new Set<string>();
  for (const floor of map.floors) {
    for (const row of floor.rows) {
      for (const node of row.nodes) {
        if (node.enemy_deck_id) deckIds.add(node.enemy_deck_id);
      }
    }
  }

  const previews = await loadEnemyDeckPreviews([...deckIds]);

  const floors = map.floors.map((floor) => ({
    ...floor,
    rows: floor.rows.map((row) => ({
      ...row,
      nodes: row.nodes.map((node) =>
        attachPreviewToNode(
          node,
          node.enemy_deck_id
            ? previews.get(node.enemy_deck_id) ?? null
            : null
        )
      ),
    })),
  }));

  return { ...map, floors };
}

export default { enrichMapWithEnemyPreviews, loadEnemyDeckPreview };
