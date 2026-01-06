/**
 * Tower Service - Handles Infinite Tower game logic and rewards
 */

import db from "../config/db.config";
import { PoolClient } from "pg";
import {
  TowerReward,
  TowerTier,
  TowerFloor,
  TowerFloorWithPreview,
  TowerProgress,
  TowerGameStartResponse,
  TowerCompletionResult,
  TowerListResponse,
  AwardedCard,
  rowToTowerFloor,
} from "../types/tower.types";
import UserModel from "../models/user.model";
import DeckService from "./deck.service";
import { GameLogic } from "../game-engine/game.logic";
import GameService from "./game.service";
import { AI_PLAYER_ID } from "../api/controllers/game.controller";

// Constants for reward calculation
const GROWTH_RATE = 1.06; // +6% every 10 floors
const FRAGMENT_GROWTH_RATE = 1.03; // Gentler scaling for fragments

// Base gem value per tier (at band 0)
const BASE_GEM_VALUE_BY_TIER: Record<TowerTier, number> = {
  E: 10, // normal floor
  D: 35, // divisible by 5
  C: 100, // divisible by 10 (1 pack baseline)
  B: 300, // divisible by 25
  A: 600, // divisible by 50
  S: 1000, // divisible by 100
};

// Base fragments per tier
const BASE_FRAGMENTS_BY_TIER: Record<TowerTier, number> = {
  E: 1,
  D: 3,
  C: 5,
  B: 15,
  A: 35,
  S: 75,
};

class TowerService {
  /**
   * Calculate rewards for a given tower floor
   * Formulaic calculation based on floor number
   */
  getTowerReward(floor: number): TowerReward {
    if (!Number.isFinite(floor) || floor < 1) {
      throw new Error(`floor must be a positive integer. Got: ${floor}`);
    }
    floor = Math.floor(floor);

    // Band: 0 = floors 1-10, 1 = 11-20, etc.
    const band = Math.floor((floor - 1) / 10);

    // Growth multiplier
    const m = Math.pow(GROWTH_RATE, band);

    // Tier detection (highest wins)
    const tier: TowerTier =
      floor % 100 === 0
        ? "S"
        : floor % 50 === 0
          ? "A"
          : floor % 25 === 0
            ? "B"
            : floor % 10 === 0
              ? "C"
              : floor % 5 === 0
                ? "D"
                : "E";

    // Scaled gem value
    let gemValue = Math.round(BASE_GEM_VALUE_BY_TIER[tier] * m);

    // Convert gem value -> packs + gems (packs first)
    let reward_packs = Math.floor(gemValue / 100);
    let reward_gems = gemValue % 100;

    // Fragment calculation with gentler scaling
    const fragMultiplier = Math.pow(FRAGMENT_GROWTH_RATE, band);
    let reward_card_fragments = Math.max(
      0,
      Math.round(BASE_FRAGMENTS_BY_TIER[tier] * fragMultiplier)
    );

    // Special rewards at milestones
    let reward_rare_art_card = 0;
    let reward_legendary_card = 0;
    let reward_epic_card = 0;

    if (floor % 1000 === 0) {
      // Every 1000 floors: rare art + legendary equivalent fragments
      reward_rare_art_card = 1;
      reward_card_fragments += 100; // 1 legendary card worth
    } else if (floor % 500 === 0) {
      // Every 500 floors: legendary card
      reward_legendary_card = 1;
      reward_card_fragments += 100;
    } else if (floor % 250 === 0) {
      // Every 250 floors: epic card
      reward_epic_card = 1;
      reward_card_fragments += 50; // 1 epic
    } else if (floor % 100 === 0) {
      // Every 100 floors: bonus fragments
      reward_card_fragments += 25;
    }

    return {
      floor,
      band,
      tier,
      reward_gems,
      reward_packs,
      reward_card_fragments,
      reward_rare_art_card,
      reward_legendary_card,
      reward_epic_card,
    };
  }

  /**
   * Get user's tower progress
   */
  async getUserTowerProgress(userId: string): Promise<TowerProgress> {
    const result = await db.query(
      "SELECT tower_floor FROM users WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error("User not found");
    }

    const currentFloor = result.rows[0].tower_floor || 1;
    return {
      current_floor: currentFloor,
      highest_completed: currentFloor - 1,
    };
  }

  /**
   * Get a specific tower floor
   */
  async getTowerFloor(floorNumber: number): Promise<TowerFloor | null> {
    const result = await db.query(
      "SELECT * FROM tower_floors WHERE floor_number = $1 AND is_active = true",
      [floorNumber]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToTowerFloor(result.rows[0]);
  }

  /**
   * Get the highest available floor number
   */
  async getMaxFloorNumber(): Promise<number> {
    const result = await db.query(
      "SELECT MAX(floor_number) as max_floor FROM tower_floors WHERE is_active = true"
    );
    return result.rows[0]?.max_floor || 0;
  }

  /**
   * Get floors around user's current progress
   */
  async getFloorsNearUser(
    userId: string,
    range: number = 5
  ): Promise<TowerListResponse> {
    const progress = await this.getUserTowerProgress(userId);
    const currentFloor = progress.current_floor;

    // Get floors from (current - range) to (current + range), but at least floor 1
    const minFloor = Math.max(1, currentFloor - range);
    const maxFloor = currentFloor + range;

    const result = await db.query(
      `SELECT * FROM tower_floors 
       WHERE floor_number >= $1 AND floor_number <= $2 AND is_active = true
       ORDER BY floor_number ASC`,
      [minFloor, maxFloor]
    );

    const floors: TowerFloorWithPreview[] = result.rows.map((row) => {
      const floor = rowToTowerFloor(row);
      return {
        ...floor,
        reward_preview: this.getTowerReward(floor.floor_number),
      };
    });

    // Add preview cards for each floor
    const client = await db.getClient();
    try {
      for (const floor of floors) {
        floor.preview_cards = await this.getTopCardsFromDeck(
          client,
          floor.ai_deck_id,
          3
        );
      }
    } finally {
      client.release();
    }

    const maxAvailable = await this.getMaxFloorNumber();

    return {
      current_floor: currentFloor,
      floors,
      max_available_floor: maxAvailable,
    };
  }

  /**
   * Get top N cards from a deck for preview
   */
  private async getTopCardsFromDeck(
    client: PoolClient,
    deckId: string,
    limit: number = 3
  ): Promise<string[]> {
    const result = await client.query(
      `
      SELECT 
        c.card_id,
        c.rarity,
        COALESCE((c.power->>'top')::integer, 0) +
        COALESCE((c.power->>'right')::integer, 0) +
        COALESCE((c.power->>'bottom')::integer, 0) +
        COALESCE((c.power->>'left')::integer, 0) as total_power
      FROM deck_cards dc
      JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN cards c ON uoc.card_id = c.card_id
      WHERE dc.deck_id = $1
      GROUP BY c.card_id, c.rarity, c.power
    `,
      [deckId]
    );

    const rarityPriority: Record<string, number> = {
      legendary: 4,
      epic: 3,
      rare: 2,
      uncommon: 1,
      common: 0,
    };

    const sortedCards = result.rows.sort((a, b) => {
      const aRarity = rarityPriority[a.rarity] || 0;
      const bRarity = rarityPriority[b.rarity] || 0;
      if (aRarity !== bRarity) return bRarity - aRarity;
      return b.total_power - a.total_power;
    });

    return [...new Set(sortedCards.map((c) => c.card_id))].slice(0, limit);
  }

  /**
   * Start a tower game
   */
  async startTowerGame(
    userId: string,
    playerDeckId: string
  ): Promise<TowerGameStartResponse> {
    const client = await db.getClient();

    try {
      // Get user's current floor
      const progress = await this.getUserTowerProgress(userId);
      const floorNumber = progress.current_floor;

      // Get the floor configuration
      const floor = await this.getTowerFloor(floorNumber);
      if (!floor) {
        throw new Error(
          `Floor ${floorNumber} not available. Maximum floor may have been reached.`
        );
      }

      // Verify player deck exists and belongs to user
      await DeckService.validateUserDeck(playerDeckId, userId);
      const playerCardInstanceIds =
        await DeckService.getDeckCardInstances(playerDeckId);

      if (playerCardInstanceIds.length === 0) {
        throw new Error("Player deck is empty");
      }

      // Validate player deck meets game rules
      await this.validatePlayerDeckRules(playerDeckId, userId);

      // Validate and get AI deck card instances
      await DeckService.validateAIDeck(floor.ai_deck_id);
      let aiCardInstanceIds = await DeckService.getDeckCardInstances(
        floor.ai_deck_id
      );

      if (aiCardInstanceIds.length === 0) {
        // Fallback to creating AI card copies
        aiCardInstanceIds =
          await DeckService.createAICardCopies(playerCardInstanceIds);
      }

      // Initialize game state
      const initialGameState = await GameLogic.initializeGame(
        playerCardInstanceIds,
        aiCardInstanceIds,
        userId,
        AI_PLAYER_ID
      );

      // Randomly choose starting player
      const startingPlayerId = Math.random() < 0.5 ? userId : AI_PLAYER_ID;
      initialGameState.current_player_id = startingPlayerId;

      // Create game record with floor_number
      const createdGame = await this.createTowerGameRecord(
        userId,
        AI_PLAYER_ID,
        playerDeckId,
        floor.ai_deck_id,
        floorNumber,
        initialGameState
      );

      // Get AI deck info for preview
      const aiDeckResult = await client.query(
        "SELECT name FROM decks WHERE deck_id = $1",
        [floor.ai_deck_id]
      );

      return {
        game_id: createdGame.game_id,
        floor_number: floorNumber,
        floor_name: floor.name,
        ai_deck_preview: aiDeckResult.rows.length
          ? {
              name: aiDeckResult.rows[0].name,
              card_count: 20,
            }
          : undefined,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Create a game record specifically for tower games (includes floor_number)
   */
  private async createTowerGameRecord(
    player1Id: string,
    player2Id: string,
    player1DeckId: string,
    player2DeckId: string,
    floorNumber: number,
    initialGameState: any
  ): Promise<{ game_id: string }> {
    const query = `
      INSERT INTO "games" (player1_id, player2_id, player1_deck_id, player2_deck_id, game_mode, game_status, board_layout, game_state, floor_number, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING game_id;
    `;
    const values = [
      player1Id,
      player2Id,
      player1DeckId,
      player2DeckId,
      "solo",
      "active",
      "4x4",
      JSON.stringify(initialGameState),
      floorNumber,
    ];
    const { rows } = await db.query(query, values);
    return { game_id: rows[0].game_id };
  }

  /**
   * Process tower game completion
   */
  async processTowerCompletion(
    userId: string,
    floorNumber: number,
    won: boolean,
    gameId?: string
  ): Promise<TowerCompletionResult> {
    if (!won) {
      return {
        success: true,
        won: false,
        floor_number: floorNumber,
      };
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Verify the user is actually on this floor
      const progressResult = await client.query(
        "SELECT tower_floor FROM users WHERE user_id = $1",
        [userId]
      );

      if (progressResult.rows.length === 0) {
        throw new Error("User not found");
      }

      const currentFloor = progressResult.rows[0].tower_floor;
      if (currentFloor !== floorNumber) {
        throw new Error(
          `User is on floor ${currentFloor}, not ${floorNumber}`
        );
      }

      // Calculate rewards
      const rewards = this.getTowerReward(floorNumber);

      // Award currency rewards
      const awardPromises: Promise<any>[] = [];

      if (rewards.reward_gems > 0) {
        awardPromises.push(UserModel.updateGems(userId, rewards.reward_gems));
      }

      if (rewards.reward_packs > 0) {
        awardPromises.push(UserModel.addPacks(userId, rewards.reward_packs));
      }

      if (rewards.reward_card_fragments > 0) {
        awardPromises.push(
          UserModel.updateCardFragments(userId, rewards.reward_card_fragments)
        );
      }

      await Promise.all(awardPromises);

      // Award special cards
      const cardsAwarded: TowerCompletionResult["cards_awarded"] = {};

      if (rewards.reward_rare_art_card > 0) {
        const card = await this.awardRandomVariantCard(userId, "rare");
        if (card) {
          cardsAwarded.rare_art_card = card;
        }
      }

      if (rewards.reward_legendary_card > 0) {
        const card = await this.awardRandomCardByRarity(userId, "legendary");
        if (card) {
          cardsAwarded.legendary_card = card;
        }
      }

      if (rewards.reward_epic_card > 0) {
        const card = await this.awardRandomCardByRarity(userId, "epic");
        if (card) {
          cardsAwarded.epic_card = card;
        }
      }

      // Increment user's tower floor
      const newFloor = floorNumber + 1;
      await client.query(
        "UPDATE users SET tower_floor = $1 WHERE user_id = $2",
        [newFloor, userId]
      );

      // Check if we need to generate new floors
      const maxFloor = await this.getMaxFloorNumber();
      const generationTriggered = await this.checkAndTriggerFloorGeneration(
        newFloor,
        maxFloor,
        floorNumber
      );

      await client.query("COMMIT");

      return {
        success: true,
        won: true,
        floor_number: floorNumber,
        rewards_earned: rewards,
        cards_awarded:
          Object.keys(cardsAwarded).length > 0 ? cardsAwarded : undefined,
        new_floor: newFloor,
        generation_triggered: generationTriggered,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Award a random variant card (+/++/+++) with minimum base rarity
   */
  private async awardRandomVariantCard(
    userId: string,
    minRarity: "rare" | "epic" | "legendary"
  ): Promise<AwardedCard | null> {
    const validRarities =
      minRarity === "legendary"
        ? ["legendary"]
        : minRarity === "epic"
          ? ["epic", "legendary"]
          : ["rare", "epic", "legendary"];

    // Build rarity filter for variants
    const rarityConditions = validRarities
      .map((r) => `c.rarity::text LIKE '${r}%'`)
      .join(" OR ");

    const query = `
      SELECT c.card_id, c.name, c.rarity, c.image_url
      FROM cards c
      WHERE (${rarityConditions})
        AND c.rarity::text LIKE '%+'
      ORDER BY RANDOM()
      LIMIT 1;
    `;

    const { rows } = await db.query(query);

    if (rows.length === 0) {
      // Fallback to base rarity if no variants exist
      return this.awardRandomCardByRarity(userId, minRarity);
    }

    const card = rows[0];

    // Add to user's collection
    const insertQuery = `
      INSERT INTO user_owned_cards (user_id, card_id, level, xp)
      VALUES ($1, $2, 1, 0)
      RETURNING user_card_instance_id;
    `;
    const { rows: insertRows } = await db.query(insertQuery, [
      userId,
      card.card_id,
    ]);

    return {
      user_card_instance_id: insertRows[0]?.user_card_instance_id,
      card_id: card.card_id,
      name: card.name,
      rarity: card.rarity,
      image_url: card.image_url,
    };
  }

  /**
   * Award a random card of a specific rarity
   */
  private async awardRandomCardByRarity(
    userId: string,
    rarity: "rare" | "epic" | "legendary"
  ): Promise<AwardedCard | null> {
    const query = `
      SELECT c.card_id, c.name, c.rarity, c.image_url
      FROM cards c
      WHERE c.rarity::text = $1
      ORDER BY RANDOM()
      LIMIT 1;
    `;

    const { rows } = await db.query(query, [rarity]);

    if (rows.length === 0) {
      return null;
    }

    const card = rows[0];

    // Add to user's collection
    const insertQuery = `
      INSERT INTO user_owned_cards (user_id, card_id, level, xp)
      VALUES ($1, $2, 1, 0)
      RETURNING user_card_instance_id;
    `;
    const { rows: insertRows } = await db.query(insertQuery, [
      userId,
      card.card_id,
    ]);

    return {
      user_card_instance_id: insertRows[0]?.user_card_instance_id,
      card_id: card.card_id,
      name: card.name,
      rarity: card.rarity,
      image_url: card.image_url,
    };
  }

  /**
   * Check if new floor generation is needed and trigger it
   */
  private async checkAndTriggerFloorGeneration(
    userNewFloor: number,
    maxFloor: number,
    completedFloor: number
  ): Promise<boolean> {
    // Trigger generation if user is within 10 floors of the max
    if (userNewFloor > maxFloor - 10) {
      // Import and call the generation service (async, don't wait)
      try {
        const TowerGenerationService = require("./towerGeneration.service")
          .default;
        
        // Fire and forget - don't block the response
        // Generate only 2 floors at a time for testing
        // Use maxFloor as reference (highest available) for better power scaling
        TowerGenerationService.triggerGeneration(
          maxFloor + 1,
          2,
          maxFloor
        ).catch((error: Error) => {
          console.error("[Tower] Floor generation failed:", error);
        });

        return true;
      } catch (error) {
        console.error("[Tower] Failed to trigger floor generation:", error);
        return false;
      }
    }

    return false;
  }

  /**
   * Get floor data for a completed game (used by game completion handlers)
   */
  async getGameFloorNumber(gameId: string): Promise<number | null> {
    const result = await db.query(
      "SELECT floor_number FROM games WHERE game_id = $1",
      [gameId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].floor_number;
  }

  /**
   * Get reference deck data for floor generation
   */
  async getReferenceDeckData(floorNumber: number): Promise<{
    floor_number: number;
    cards: {
      name: string;
      level: number;
      effective_power: { top: number; right: number; bottom: number; left: number };
    }[];
    average_power: number;
  } | null> {
    const floor = await this.getTowerFloor(floorNumber);
    if (!floor) return null;

    const result = await db.query(
      `
      SELECT 
        c.name,
        uoc.level,
        c.power->>'top' as base_top,
        c.power->>'right' as base_right,
        c.power->>'bottom' as base_bottom,
        c.power->>'left' as base_left,
        COALESCE(ucp.power_up_data->>'top', '0') as powerup_top,
        COALESCE(ucp.power_up_data->>'right', '0') as powerup_right,
        COALESCE(ucp.power_up_data->>'bottom', '0') as powerup_bottom,
        COALESCE(ucp.power_up_data->>'left', '0') as powerup_left
      FROM deck_cards dc
      JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN cards c ON uoc.card_id = c.card_id
      LEFT JOIN user_card_power_ups ucp ON uoc.user_card_instance_id = ucp.user_card_instance_id
      WHERE dc.deck_id = $1
    `,
      [floor.ai_deck_id]
    );

    const cards = result.rows.map((row) => ({
      name: row.name,
      level: row.level,
      effective_power: {
        top: parseInt(row.base_top || "0") + parseInt(row.powerup_top || "0"),
        right: parseInt(row.base_right || "0") + parseInt(row.powerup_right || "0"),
        bottom: parseInt(row.base_bottom || "0") + parseInt(row.powerup_bottom || "0"),
        left: parseInt(row.base_left || "0") + parseInt(row.powerup_left || "0"),
      },
    }));

    const totalPower = cards.reduce((sum, card) => {
      return (
        sum +
        card.effective_power.top +
        card.effective_power.right +
        card.effective_power.bottom +
        card.effective_power.left
      );
    }, 0);

    return {
      floor_number: floorNumber,
      cards,
      average_power: cards.length > 0 ? totalPower / cards.length : 0,
    };
  }

  /**
   * Validate that a player deck meets game rules
   * - Must not be owned by AI player
   * - Maximum 2 legendary cards
   * - Maximum 2 copies of any card name
   * - Must have exactly 20 cards
   */
  private async validatePlayerDeckRules(
    deckId: string,
    userId: string
  ): Promise<void> {
    const client = await db.getClient();

    try {
      // Check deck ownership - must not be AI player
      const deckOwnerResult = await client.query(
        "SELECT user_id FROM decks WHERE deck_id = $1",
        [deckId]
      );

      if (deckOwnerResult.rows.length === 0) {
        throw new Error("Deck not found");
      }

      const deckOwnerId = deckOwnerResult.rows[0].user_id;

      // Ensure deck is not owned by AI player
      if (deckOwnerId === AI_PLAYER_ID) {
        throw new Error("Cannot use AI decks for tower games");
      }

      // Ensure deck is owned by the requesting user
      if (deckOwnerId !== userId) {
        throw new Error("You do not own this deck");
      }

      // Get all cards in the deck with their details
      const cardsResult = await client.query(
        `
        SELECT 
          c.card_id,
          c.name,
          c.rarity
        FROM deck_cards dc
        JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
        JOIN cards c ON uoc.card_id = c.card_id
        WHERE dc.deck_id = $1
      `,
        [deckId]
      );

      const cards = cardsResult.rows;

      // Rule 1: Must have exactly 20 cards
      if (cards.length !== 20) {
        throw new Error(
          `Deck must have exactly 20 cards. Your deck has ${cards.length} cards.`
        );
      }

      // Rule 2: Count legendary cards (max 2)
      const legendaryCount = cards.filter((card) =>
        card.rarity.toLowerCase().startsWith("legendary")
      ).length;

      if (legendaryCount > 2) {
        throw new Error(
          `Deck can have maximum 2 legendary cards. Your deck has ${legendaryCount} legendary cards.`
        );
      }

      // Rule 3: Count duplicates by name (max 2 of same name)
      const nameCount = new Map<string, number>();
      for (const card of cards) {
        const count = nameCount.get(card.name) || 0;
        nameCount.set(card.name, count + 1);
      }

      const violations: string[] = [];
      nameCount.forEach((count, name) => {
        if (count > 2) {
          violations.push(`${name} (${count} copies)`);
        }
      });

      if (violations.length > 0) {
        throw new Error(
          `Deck can have maximum 2 copies of any card. Violations: ${violations.join(", ")}`
        );
      }

      // All validations passed
    } finally {
      client.release();
    }
  }
}

export default new TowerService();

