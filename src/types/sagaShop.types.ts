export type SagaShopItemType =
  | "seasonal_card"
  | "card_back"
  | "card_border"
  | "art_variant"
  | "pack";

export interface SagaShopItemDefinition {
  id: string;
  type: SagaShopItemType;
  name: string;
  cost: number;
  /** 1 for exclusives; omit for unlimited (packs) */
  max_quantity?: number;
  description?: string;
  preview_image_url?: string;
  metadata?: Record<string, unknown>;
}

export interface SagaShopItemView extends SagaShopItemDefinition {
  owned: boolean;
  purchased_count: number;
  can_purchase: boolean;
}

export interface SagaShopView {
  season_id: string;
  season_name: string;
  currency_label: string;
  currency_balance: number;
  items: SagaShopItemView[];
}

export interface SagaShopPurchaseResult {
  item_id: string;
  cost: number;
  currency_balance: number;
  purchased_item_ids: string[];
}
