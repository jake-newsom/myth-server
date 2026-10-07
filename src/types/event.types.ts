// myth-server/src/types/event.types.ts
//
// Types for the events system. See migration 1800000000000_events-system.js
// for the schema and the rationale behind each attachment being optional.

/** A temporary, event-scoped currency (schema: event_currencies). */
export interface EventCurrency {
  id: string;
  currency_key: string;
  name: string;
  description: string | null;
  icon_url: string | null;
}

/**
 * An event row. Every field below `is_active` is an optional attachment: an
 * event with all of them null/false is a valid cosmetic-only event.
 */
export interface EventRecord {
  id: string;
  event_key: string;
  name: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date;
  is_active: boolean;

  /** Grants access BEFORE starts_at. Never required during the live window. */
  preview_feature_flag_key: string | null;
  /** When enabled for a user, hides the event even during the live window. */
  kill_switch_flag_key: string | null;

  currency_id: string | null;
  currency_drop_chance: number;
  currency_drop_min: number;
  currency_drop_max: number;
  currency_drop_mode_multipliers: Record<string, number>;
  /**
   * Fixed per-outcome drop amounts. When `currency_win_amount` is 0 the event
   * uses the legacy `currency_drop_chance`/`_min`/`_max` lottery above instead,
   * so events configured before these existed are unaffected.
   */
  currency_win_amount?: number;
  currency_draw_amount?: number;
  currency_loss_amount?: number;
  currency_forfeit_amount?: number;
  /** Added to the first win of each UTC day, on top of the daily cap. */
  currency_first_win_bonus?: number;
  /** Ceiling on ordinary match drops per UTC day; 0 means uncapped. */
  currency_daily_cap?: number;

  login_sequence_id: string | null;

  mechanic_key: string | null;
  mechanic_config: Record<string, unknown>;

  background_image_url: string | null;
  board_background_image_url: string | null;
  theme_color: string | null;
  icon_url: string | null;

  has_game_mode: boolean;
  game_mode_label: string | null;
  game_mode_description: string | null;

  sort_order: number;
}

/** Why an event is visible to a given user — useful for admin/debugging. */
export type EventAccessReason = "live" | "preview";

export interface ActiveEvent extends EventRecord {
  access_reason: EventAccessReason;
  currency: EventCurrency | null;
}

/** Payload shape returned to clients. Additive-only by contract. */
export interface EventSummaryResponse {
  id: string;
  event_key: string;
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  access_reason: EventAccessReason;
  background_image_url: string | null;
  board_background_image_url: string | null;
  theme_color: string | null;
  icon_url: string | null;
  mechanic_key: string | null;
  has_game_mode: boolean;
  game_mode_label: string | null;
  game_mode_description: string | null;
  has_shop: boolean;
  has_login_sequence: boolean;
  currency:
    | (EventCurrency & {
        balance: number;
        /** Total ever earned, which is what milestone progress measures. */
        lifetime_earned: number;
      })
    | null;
  /** Highest milestone threshold, so the client can scale its progress bar. */
  milestone_target: number | null;
  /**
   * Drop rates, so the client can explain how the currency is earned without
   * hard-coding numbers that are tuned live in the events table. Additive and
   * optional: an old client ignores it, and a client that reads it must cope
   * with it being absent.
   */
  currency_drop?: EventCurrencyDropInfo;
}

/** How this event's currency drops from finished matches. */
export interface EventCurrencyDropInfo {
  /** Base per-match chance, 0-1, BEFORE the per-mode multiplier. */
  chance: number;
  min: number;
  max: number;
  /**
   * Per-mode multipliers on `chance`. A mode absent from this map plays at
   * 1.0; a mode mapped to 0 never drops.
   */
  mode_multipliers: Record<string, number>;
  /** Modes that never receive the event's global board mechanic. */
  mechanic_excluded_modes: string[];
}

// ---- Login sequences -------------------------------------------------------

export interface LoginSequence {
  id: string;
  sequence_key: string;
  name: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date;
  is_active: boolean;
}

export interface LoginSequenceReward {
  id: string;
  sequence_id: string;
  /** Rung of the ladder: the Nth login within the window, not a calendar day. */
  day_index: number;
  reward_gold: number;
  reward_gems: number;
  reward_fate_coins: number;
  reward_card_fragments: number;
  reward_packs: number;
  reward_embers: number;
  reward_event_currency: number;
  reward_card_variant_id: string | null;
  reward_border_id: string | null;
  reward_card_back_id: string | null;
  reward_title_id?: string | null;
  reward_frame_id?: string | null;
  is_milestone: boolean;
}

export interface UserLoginSequenceProgress {
  user_id: string;
  sequence_id: string;
  days_credited: number;
  days_claimed: number;
  last_credited_date: string | null;
}

export interface LoginSequenceStatus {
  sequence: {
    id: string;
    sequence_key: string;
    name: string;
    description: string | null;
    starts_at: string;
    ends_at: string;
  };
  days_credited: number;
  days_claimed: number;
  /** True when at least one credited rung has not been claimed yet. */
  can_claim: boolean;
  credited_today: boolean;
  rewards: (LoginSequenceReward & {
    claimed: boolean;
    unlocked: boolean;
  })[];
}

// ---- Event shop ------------------------------------------------------------

export type EventShopItemType =
  | "card"
  /** Generic packs, credited to the shared `pack_count` balance. */
  | "pack"
  /**
   * A specific pack (`grant_pack_id`), held in per-pack inventory so it stays
   * openable only as itself.
   */
  | "event_pack"
  | "border"
  | "card_back"
  | "title"
  | "avatar_frame"
  | "gems"
  | "gold"
  | "fate_coins"
  | "card_fragments"
  | "embers";

export type EventShopPriceCurrency =
  | "event"
  | "gems"
  | "gold"
  | "fate_coins"
  | "card_fragments"
  | "embers";

export interface EventShopOffering {
  id: string;
  event_id: string;
  slot_number: number;
  item_type: EventShopItemType;
  grant_card_variant_id: string | null;
  grant_border_id: string | null;
  grant_card_back_id: string | null;
  grant_title_id?: string | null;
  grant_frame_id?: string | null;
  /** Set for `event_pack`: which pack is credited to per-pack inventory. */
  grant_pack_id: string | null;
  grant_amount: number;
  price: number;
  price_currency: EventShopPriceCurrency;
  /** null = unlimited for the event's duration. */
  purchase_limit: number | null;
  is_active: boolean;
  sort_order: number;
}

export interface EventShopOfferingView extends EventShopOffering {
  purchased_count: number;
  sold_out: boolean;
  /**
   * The granted card, joined in for `item_type = 'card'` so the client can
   * render real art instead of a placeholder icon. Same shape the daily shop
   * attaches (see dailyShop.model's getTodaysOfferings). Absent on every
   * other item type, and additive — an older client simply ignores it.
   */
  card?: {
    card_id: string;
    base_card_id: string;
    name: string;
    description?: string | null;
    rarity: string;
    image_url: string;
    tags: string[];
    set_id?: string | null;
    base_power: { top: number; right: number; bottom: number; left: number };
    special_ability?: unknown;
    sound_effect?: string;
  };
}

// ---- Milestones ------------------------------------------------------------

/**
 * A reward for total event currency EARNED (not held). Progress is measured
 * against `lifetime_earned`, so spending never costs a player progress.
 */
export interface EventMilestone {
  id: string;
  event_id: string;
  threshold: number;
  name: string | null;
  description: string | null;
  reward_gold: number;
  reward_gems: number;
  reward_fate_coins: number;
  reward_card_fragments: number;
  reward_packs: number;
  reward_embers: number;
  reward_card_variant_id: string | null;
  reward_border_id: string | null;
  reward_card_back_id: string | null;
  reward_title_id?: string | null;
  reward_frame_id?: string | null;
  /**
   * A specific pack, held in per-pack inventory rather than credited to the
   * generic `pack_count` that `reward_packs` moves. `reward_pack_quantity` is
   * how many, and is meaningless without this.
   */
  reward_pack_id: string | null;
  reward_pack_quantity: number;
  sort_order: number;
}

export interface EventMilestoneView extends EventMilestone {
  claimed: boolean;
  /** Threshold reached, whether or not it has been collected. */
  unlocked: boolean;
  can_claim: boolean;
  /**
   * The granted card, joined in for rungs that award one, so the client can
   * render real art instead of a placeholder icon. Same shape the event shop
   * attaches. Absent on every other rung, and additive.
   */
  card?: {
    card_id: string;
    base_card_id: string;
    name: string;
    description?: string | null;
    rarity: string;
    image_url: string;
    tags: string[];
    set_id?: string | null;
    base_power: { top: number; right: number; bottom: number; left: number };
    special_ability?: unknown;
    sound_effect?: string;
  };
}

/**
 * Game modes that NEVER receive an event's global board mechanic.
 *
 * Ranked draft is competitive and ladder-rated: its games are balanced around
 * a known board, and silently adding event tiles mid-season would change the
 * competitive meta for a rated mode. Players can still opt into the mechanic
 * through the event's own game-mode tile.
 *
 * Lives here rather than on EventMechanicService because EventService also
 * reports it to the client, and importing the mechanic service from there
 * would close an import cycle (eventMechanic.service already imports
 * event.service).
 */
export const GLOBAL_MECHANIC_EXCLUDED_MODES: ReadonlySet<string> = new Set([
  "ranked_draft",
]);
