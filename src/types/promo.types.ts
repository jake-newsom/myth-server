// myth-server/src/types/promo.types.ts

import { RewardItem } from "./service.types";

/**
 * Rarities a `random_card` promo reward may draw from. Mirrors the
 * `card_rarity` enum used by the cards table.
 */
export const PROMO_CARD_RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;

export type PromoCardRarity = (typeof PROMO_CARD_RARITIES)[number];

/**
 * A single reward entry as authored on a promo code.
 *
 * These are a superset of RewardService's `RewardItem`: everything except
 * `random_card` is passed through untouched, while `random_card` is resolved
 * into concrete `{ type: "card", card_variant_id }` items at redemption time
 * (so two users redeeming the same code can receive different cards).
 */
export type PromoRewardSpec =
  | { type: "gems"; amount: number }
  | { type: "gold"; amount: number }
  | { type: "fate_coins"; amount: number }
  | { type: "card_fragments"; amount: number }
  | { type: "packs"; amount: number }
  | { type: "card"; card_variant_id: string }
  | { type: "border"; border_id: string; character_id?: string | null }
  | { type: "card_back"; back_id: string }
  | {
      type: "random_card";
      /**
       * Base rarity to draw from. Cosmetic upgrade tiers ("rare+", "rare++")
       * count as the same base rarity and are included by default.
       */
      rarity: PromoCardRarity;
      count?: number;
      /** Restrict the draw to the unsuffixed tier only. Defaults to false. */
      base_only?: boolean;
    };

/** Row shape of the `promo_codes` table. */
export interface PromoCode {
  promo_code_id: string;
  code: string;
  description: string | null;
  rewards: PromoRewardSpec[];
  max_claims: number | null;
  claim_count: number;
  is_active: boolean;
  starts_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Row shape of the `promo_code_redemptions` table. */
export interface PromoCodeRedemption {
  promo_code_id: string;
  user_id: string;
  granted: RewardItem[];
  redeemed_at: Date;
}

/** Fields accepted when creating a promo code. */
export interface CreatePromoCodeInput {
  code: string;
  description?: string | null;
  rewards: PromoRewardSpec[];
  max_claims?: number | null;
  is_active?: boolean;
  starts_at?: string | Date | null;
  expires_at?: string | Date | null;
}

/** Fields accepted when updating a promo code. All optional. */
export type UpdatePromoCodeInput = Partial<CreatePromoCodeInput>;

/**
 * Why a redemption was rejected. Surfaced to the client so it can show a
 * specific message rather than a generic failure.
 */
export type PromoRedemptionFailureReason =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "claim_limit_reached"
  | "already_redeemed"
  | "no_rewards_available";

export interface PromoRedemptionSuccess {
  success: true;
  promo_code_id: string;
  code: string;
  description: string | null;
  /** Concrete items granted, with `random_card` already resolved. */
  granted: RewardItem[];
  updated_currencies?: {
    gems: number;
    gold: number;
    fate_coins: number;
    card_fragments: number;
    pack_count: number;
  };
}

export interface PromoRedemptionFailure {
  success: false;
  reason: PromoRedemptionFailureReason;
  message: string;
}

export type PromoRedemptionResult =
  | PromoRedemptionSuccess
  | PromoRedemptionFailure;
