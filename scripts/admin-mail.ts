import type { QueryResult } from "pg";

export type AdminQueryFn = (
  text: string,
  params?: unknown[]
) => Promise<QueryResult>;

export type CardRewardLine = { card_variant_id: string; quantity: number };

const MAX_PER_VARIANT = 500;
const MAX_TOTAL_CARDS = 5000;

export function expandCardRewardIds(cards: CardRewardLine[]): {
  ids: string[];
  error?: string;
} {
  const ids: string[] = [];
  let total = 0;
  for (const line of cards) {
    if (!line?.card_variant_id || typeof line.card_variant_id !== "string") {
      return { ids: [], error: "Each card line needs card_variant_id" };
    }
    const q = Math.floor(Number(line.quantity));
    if (Number.isNaN(q) || q < 0) {
      return { ids: [], error: "Invalid quantity for card " + line.card_variant_id };
    }
    const capped = Math.min(q, MAX_PER_VARIANT);
    for (let i = 0; i < capped; i++) {
      ids.push(line.card_variant_id);
      total++;
      if (total > MAX_TOTAL_CARDS) {
        return { ids: [], error: `Total card copies cannot exceed ${MAX_TOTAL_CARDS}` };
      }
    }
  }
  return { ids };
}

export function computeHasRewards(
  gold: number,
  gems: number,
  packs: number,
  fate: number,
  cardIds: string[]
): boolean {
  return (
    gold > 0 ||
    gems > 0 ||
    packs > 0 ||
    fate > 0 ||
    (cardIds && cardIds.length > 0)
  );
}

export async function insertMailRow(
  dbQuery: AdminQueryFn,
  input: {
    user_id: string;
    mail_type: string;
    subject: string;
    content: string;
    sender_name: string;
    reward_gold: number;
    reward_gems: number;
    reward_packs: number;
    reward_fate_coins: number;
    reward_card_ids: string[];
    expires_at: Date | null;
  }
): Promise<QueryResult> {
  const has_rewards = computeHasRewards(
    input.reward_gold,
    input.reward_gems,
    input.reward_packs,
    input.reward_fate_coins,
    input.reward_card_ids
  );
  return dbQuery(
    `
    INSERT INTO mail (
      user_id, mail_type, subject, content, sender_id, sender_name,
      has_rewards, reward_gold, reward_gems, reward_packs, reward_fate_coins,
      reward_card_ids, expires_at
    )
    VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
  `,
    [
      input.user_id,
      input.mail_type,
      input.subject,
      input.content,
      input.sender_name,
      has_rewards,
      input.reward_gold,
      input.reward_gems,
      input.reward_packs,
      input.reward_fate_coins,
      input.reward_card_ids,
      input.expires_at,
    ]
  );
}
