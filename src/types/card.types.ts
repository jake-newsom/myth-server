import { SpecialAbility } from "./database.types";

export interface PowerValues {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
// Enum that serves as the source of truth for all trigger moments
export enum TriggerMoment {
  OnPlace = "OnPlace",
  OnFlip = "OnFlip",
  OnFlipped = "OnFlipped",
  OnTurnStart = "OnTurnStart",
  OnTurnEnd = "OnTurnEnd",
  AnyOnFlip = "AnyOnFlip",
  OnDefend = "OnDefend",
  AnyOnDefend = "AnyOnDefend",
  HandOnFlip = "HandOnFlip",
  BoardOnFlip = "BoardOnFlip",
  HandOnPlace = "HandOnPlace",
  BoardOnPlace = "BoardOnPlace",
  BeforeCombat = "BeforeCombat",
  AfterCombat = "AfterCombat",
  OnCombat = "OnCombat",
}

/**
 * Database models
 */
/**
 * Represents the fundamental, static data of a card, as defined in the 'cards' table.
 */
export interface BaseCardData {
  card_id: string;
  name: string;
  description?: string;
  rarity: Rarity;
  faction?: string; // Assuming this is still relevant
  cost?: number; // Assuming this is still relevant
  image_url: string;
  base_power: PowerValues;
  special_ability_id: string | null;
  tags: string[]; // Replaces card_type
}

/**
 * Represents an instance of a card owned by a player, including their specific upgrades.
 * Stored in the 'user_owned_cards' table.
 */
export interface PlayerCardInstance {
  user_card_instance_id: string;
  user_id: string;
  card_id: string; // Foreign key to BaseCardData
  level: number;
  xp: number;
  power_enhancements: PowerValues; // Player-driven permanent stat increases
  created_at?: Date;
}

/**
 * Constructed Models
 */

// SpecialAbility is defined in database.types.ts

export interface BaseCard {
  card_id: string; // base_card_id
  name: string;
  tags: string[];
  rarity: Rarity;
  image_url: string;
  base_power: PowerValues;
  special_ability: SpecialAbility | null;
}

export type UserCard = {
  user_card_instance_id: string;
  base_card_id: string; // Foreign key
  base_card_data: BaseCard;

  level: number;
  xp: number;
  power_enhancements: PowerValues;
};

export type DefeatRecord = {
  user_card_instance_id: string;
  base_card_id: string;
  name: string;
};

/**
 * Represents a card as it exists within an active game session.
 * This is typically a constructed type, not directly stored in its entirety in the DB.
 */
export interface InGameCard extends UserCard {
  card_modifiers_positive: PowerValues; // Temporary buffs in-game
  card_modifiers_negative: PowerValues; // Temporary nerfs in-game
  temporary_effects: TemporaryEffect[];
  current_power: PowerValues;
  owner: string;
  original_owner: string;
  lockedTurns: number;
  defeats: DefeatRecord[];
}

export enum EffectType {
  Buff = "buff",
  Debuff = "debuff",
  BlockDebuff = "block_debuff",
  BlockBuff = "block_buff",
  BlockDefeat = "block_defeat",
  TilePowerBonus = "tile_power_bonus",
}

export interface TemporaryEffect {
  power: Partial<PowerValues>;
  duration: number;
  name?: string;
  data?: Record<string, any>;
  type: EffectType;
}
