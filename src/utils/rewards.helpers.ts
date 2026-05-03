import { RewardItem } from "../types/service.types";

/**
 * Reward field shapes used across mail, achievements, monthly login, and daily
 * tasks. Centralizing the conversion keeps each claim flow oblivious to the
 * RewardService's wire format and avoids drift if new reward types are added.
 */
export interface MailRewardFields {
  reward_gold: number;
  reward_gems: number;
  reward_fate_coins: number;
  reward_packs: number;
  reward_card_ids: string[];
  reward_border_id?: string | null;
}

export interface AchievementRewardFields {
  reward_gold?: number;
  reward_gems?: number;
  reward_fate_coins?: number;
  reward_packs?: number;
  reward_card_fragments?: number;
  reward_border_id?: string | null;
  /** When set, the border grant is scoped to this character only. */
  character_id?: string | null;
}

export interface MonthlyLoginRewardFields {
  reward_type:
    | "gems"
    | "fate_coins"
    | "card_fragments"
    | "card_pack"
    | "enhanced_card"
    | "border";
  amount?: number | null;
  card_id?: string | null;
  reward_border_id?: string | null;
}

/** Convert mail reward columns into a list of RewardItem entries. */
export function mailRewardsToItems(mail: MailRewardFields): RewardItem[] {
  const items: RewardItem[] = [];
  if (mail.reward_gems > 0) {
    items.push({ type: "gems", amount: mail.reward_gems });
  }
  if (mail.reward_gold > 0) {
    items.push({ type: "gold", amount: mail.reward_gold });
  }
  if (mail.reward_fate_coins > 0) {
    items.push({ type: "fate_coins", amount: mail.reward_fate_coins });
  }
  if (mail.reward_packs > 0) {
    items.push({ type: "packs", amount: mail.reward_packs });
  }
  if (mail.reward_card_ids && mail.reward_card_ids.length > 0) {
    for (const id of mail.reward_card_ids) {
      items.push({ type: "card", card_variant_id: id });
    }
  }
  if (mail.reward_border_id) {
    items.push({ type: "border", border_id: mail.reward_border_id });
  }
  return items;
}

/** Convert achievement reward columns into RewardItem entries. */
export function achievementRewardsToItems(
  achievement: AchievementRewardFields
): RewardItem[] {
  const items: RewardItem[] = [];
  if (achievement.reward_gems && achievement.reward_gems > 0) {
    items.push({ type: "gems", amount: achievement.reward_gems });
  }
  if (achievement.reward_gold && achievement.reward_gold > 0) {
    items.push({ type: "gold", amount: achievement.reward_gold });
  }
  if (achievement.reward_fate_coins && achievement.reward_fate_coins > 0) {
    items.push({ type: "fate_coins", amount: achievement.reward_fate_coins });
  }
  if (achievement.reward_packs && achievement.reward_packs > 0) {
    items.push({ type: "packs", amount: achievement.reward_packs });
  }
  if (
    achievement.reward_card_fragments &&
    achievement.reward_card_fragments > 0
  ) {
    items.push({
      type: "card_fragments",
      amount: achievement.reward_card_fragments,
    });
  }
  if (achievement.reward_border_id) {
    items.push({
      type: "border",
      border_id: achievement.reward_border_id,
      character_id: achievement.character_id ?? null,
    });
  }
  return items;
}

/** Convert a monthly login reward row into RewardItem entries. */
export function monthlyLoginRewardToItems(
  reward: MonthlyLoginRewardFields
): RewardItem[] {
  const amount = reward.amount ?? 0;
  switch (reward.reward_type) {
    case "gems":
      return amount > 0 ? [{ type: "gems", amount }] : [];
    case "fate_coins":
      return amount > 0 ? [{ type: "fate_coins", amount }] : [];
    case "card_fragments":
      return amount > 0 ? [{ type: "card_fragments", amount }] : [];
    case "card_pack":
      return amount > 0 ? [{ type: "packs", amount }] : [];
    case "enhanced_card":
      return reward.card_id
        ? [{ type: "card", card_variant_id: reward.card_id }]
        : [];
    case "border":
      return reward.reward_border_id
        ? [{ type: "border", border_id: reward.reward_border_id }]
        : [];
    default:
      return [];
  }
}
