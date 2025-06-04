export interface PowerValues {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type TriggerMoment =
  | "OnPlace"
  | "OnFlip"
  | "OnFlipped"
  | "OnTurnStart"
  | "OnTurnEnd"
  | "HandOnFlip"
  | "BoardOnFlip"
  | "HandOnPlace" // used to trigger changes while the card is in the player's hand
  | "BoardOnPlace" // used to trigger changes while the card is on the board
  | string;

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

export type SpecialAbility = {
  name: string;
  ability_id: string;
  description: string;
  trigger_moment: TriggerMoment;
  parameters: Record<string, any>; // Can be more strictly typed per ability
};

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
  power_enhancements: PowerValues;
};
/**
 * Represents a card as it exists within an active game session.
 * This is typically a constructed type, not directly stored in its entirety in the DB.
 */
export interface InGameCard extends UserCard {
  card_modifiers_positive: PowerValues; // Temporary buffs in-game
  card_modifiers_negative: PowerValues; // Temporary nerfs in-game
  current_power: PowerValues;
  owner: string;
}
