import db from "../config/db.config";
import { RarityUtils } from "../types/card.types";
import type { SagaNodeMapData, SagaMapNode } from "../types/sagaMap.types";

export interface SagaEnemyNodePreview {
  deck_name: string;
  preview_base_card_id: string;
  preview_name: string;
  preview_image_url: string;
  preview_rarity: string;
}

const previewByDeckId = new Map<string, Promise<SagaEnemyNodePreview | null>>();

function rarityRank(rarity: string): number {
  if (RarityUtils.isLegendary(rarity as import("../types/card.types").Rarity)) {
    return 3;
  }
  if (rarity.startsWith("epic")) return 2;
  if (RarityUtils.isRare(rarity as import("../types/card.types").Rarity)) {
    return 1;
  }
  return 0;
}

async function loadEnemyDeckPreview(
  deckId: string
): Promise<SagaEnemyNodePreview | null> {
  const { rows } = await db.query(
    `SELECT d.name AS deck_name,
            cv.card_variant_id,
            ch.name AS card_name,
            cv.image_url,
            cv.rarity
     FROM deck_cards dc
     JOIN decks d ON d.deck_id = dc.deck_id
     JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
     JOIN card_variants cv ON cv.card_variant_id = uoc.card_variant_id
     JOIN characters ch ON ch.character_id = cv.character_id
     WHERE dc.deck_id = $1`,
    [deckId]
  );

  if (!rows.length) return null;

  const deckName = String(rows[0].deck_name ?? "Enemy deck");
  let best = rows[0];
  let bestRank = rarityRank(String(best.rarity ?? "common"));

  for (const row of rows) {
    const rank = rarityRank(String(row.rarity ?? "common"));
    if (rank > bestRank) {
      best = row;
      bestRank = rank;
    }
  }

  return {
    deck_name: deckName,
    preview_base_card_id: String(best.card_variant_id),
    preview_name: String(best.card_name),
    preview_image_url: String(best.image_url ?? ""),
    preview_rarity: String(best.rarity ?? "common"),
  };
}

function getPreview(deckId: string): Promise<SagaEnemyNodePreview | null> {
  let pending = previewByDeckId.get(deckId);
  if (!pending) {
    pending = loadEnemyDeckPreview(deckId);
    previewByDeckId.set(deckId, pending);
  }
  return pending;
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

  const entries = await Promise.all(
    [...deckIds].map(async (id) => [id, await getPreview(id)] as const)
  );
  const previews = new Map(entries);

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
