// shop.types.ts - Client-side Daily Shop Types (Updated with Full Card Data)

export type ShopItemType =
  | "legendary_card"
  | "epic_card"
  | "enhanced_card"
  | "pack";

export type CurrencyType = "gems" | "card_fragments" | "fate_coins";

export interface ShopCard {
  card_id: string;
  name: string;
  rarity: string;
  image_url: string;
  tags: string[];
  set_id?: string | null;
  base_power: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  special_ability?: {
    ability_id: string;
    name: string;
    description: string;
    trigger_moments: string[];
    parameters: Record<string, any>;
  } | null;
}

export interface ShopOffering {
  offering_id: string;
  shop_date: string;
  item_type: ShopItemType;
  card_id?: string;
  mythology?: "norse" | "japanese" | "polynesian";
  price: number;
  currency: CurrencyType;
  slot_number: number;
  card?: ShopCard;
}

export interface UserPurchase {
  purchase_id: string;
  offering_id: string;
  shop_date: string;
  item_type: ShopItemType;
  quantity_purchased: number;
  total_cost: number;
  currency_used: CurrencyType;
  resets_used: number;
  purchased_at: string;
}

export interface UserCurrencies {
  gold: number;
  gems: number;
  card_fragments: number;
  fate_coins: number;
}

export interface DailyShopData {
  shop_date: string;
  offerings: ShopOffering[];
  user_purchases: UserPurchase[];
  purchase_limits: Record<ShopItemType, number>;
  reset_costs: Record<ShopItemType, number>;
  user_currencies: UserCurrencies;
}

// API Request/Response Types
export interface PurchaseItemRequest {
  offering_id: string;
  quantity?: number;
  use_reset?: boolean;
}

export interface PurchaseItemResponse {
  status: "success";
  message: string;
  data: {
    purchase: UserPurchase;
    new_currency_balance: number;
    card_received?: {
      user_card_instance_id: string;
      card_id: string;
      level: number;
      xp: number;
    };
    packs_received?: number;
  };
}

export interface GetShopResponse {
  status: "success";
  data: DailyShopData;
  timestamp: string;
}

export interface ShopErrorResponse {
  status: "error";
  message: string;
  timestamp: string;
}
