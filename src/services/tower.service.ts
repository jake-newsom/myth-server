/**
 * Tower Service - Handles Infinite Tower game logic and rewards
 */

import db from "../config/db.config";
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
import DeckService from "./deck.service";
import { GameLogic } from "../game-engine/game.logic";
import { hydrateGameStateCards } from "../game-engine/game.utils";
import { AI_PLAYER_ID } from "../api/controllers/game.controller";
import {
  applyPlayerMulligan,
  bootstrapSoloMulliganForClient,
  chooseAIMulligan,
} from "../game-engine/game.mulligan";
import { clientSupportsMulligan } from "../utils/clientVersion";

// Constants for reward calculation
// Linear growth: both gems and fragments scale by (1 + band * GROWTH_SLOPE).
const GROWTH_SLOPE = 0.05; // +5% of base value per band (every 10 floors)

// Base gem value per tier (at band 0). +50% across the board over the prior
// 5/10/25/50/125/250 baseline.
const BASE_GEM_VALUE_BY_TIER: Record<TowerTier, number> = {
  E: 8, // normal floor (5 -> 7.5, rounded)
  D: 15, // divisible by 5
  C: 38, // divisible by 10 (25 -> 37.5, rounded)
  B: 75, // divisible by 25
  A: 188, // divisible by 50 (125 -> 187.5, rounded)
  S: 375, // divisible by 100
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

// ---------------------------------------------------------------------------
// Milestone card rewards. Each milestone awards a full-art variant
// (+/++/+++), never a plain base card. Weights pick the base rarity, then the
// variant level. Tunable here.
// ---------------------------------------------------------------------------
type CardRarity = "rare" | "epic" | "legendary";
type VariantLevel = "+" | "++" | "+++";

interface MilestoneCardSpec {
  rarityWeights: Partial<Record<CardRarity, number>>;
  levelWeights: Record<VariantLevel, number>;
}

// %25 floors: rare -> legendary full-art variant
const MILESTONE_CARD_25: MilestoneCardSpec = {
  rarityWeights: { rare: 50, epic: 35, legendary: 15 },
  levelWeights: { "+": 70, "++": 20, "+++": 10 },
};

// %50 floors: epic or legendary full-art variant
const MILESTONE_CARD_50: MilestoneCardSpec = {
  rarityWeights: { epic: 60, legendary: 40 },
  levelWeights: { "+": 70, "++": 20, "+++": 10 },
};

// %100 floors: legendary full-art variant, skewed toward higher levels
const MILESTONE_CARD_100: MilestoneCardSpec = {
  rarityWeights: { legendary: 100 },
  levelWeights: { "+": 50, "++": 30, "+++": 20 },
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

    // Growth multiplier (linear with a steep slope, not exponential)
    const m = 1 + band * GROWTH_SLOPE;

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

    // Fragment calculation — same linear scaling as gems.
    let reward_card_fragments = Math.max(
      0,
      Math.round(BASE_FRAGMENTS_BY_TIER[tier] * m)
    );

    // Special rewards at milestones
    let reward_rare_art_card = 0;
    let reward_legendary_card = 0;
    let reward_epic_card = 0;

    // Milestone card flags signal which weighted variant award to roll.
    // The actual card (base rarity + +/++/+++ level) is chosen at award time.
    if (floor % 100 === 0) {
      // Every 100th floor: legendary full-art variant
      reward_rare_art_card = 1;
      reward_card_fragments += 100; // 1 legendary card worth
      reward_gems += Math.floor(gemValue * 0.75);
    } else if (floor % 50 === 0) {
      // Every 50th floor: epic/legendary full-art variant
      reward_legendary_card = 1;
      reward_card_fragments += 100;
      reward_gems += Math.floor(gemValue * 0.4);
    } else if (floor % 25 === 0) {
      // Every 25th floor: rare->legendary full-art variant
      reward_epic_card = 1;
      reward_card_fragments += 50;
      reward_gems += Math.floor(gemValue * 0.25);
    } else if (floor % 10 === 0) {
      // Every 10th floor: bonus fragments
      reward_card_fragments += 25;
      reward_gems += Math.floor(gemValue * 0.1);
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
   * Get paginated tower leaderboard sorted by highest completed floor,
   * with floor advancement timestamp as tiebreaker (earlier = ranked higher).
   * Players who haven't completed any floor (tower_floor = 1) are excluded.
   */
  async getTowerLeaderboard(page: number = 1): Promise<{
    rankings: Array<{
      rank: number;
      username: string;
      highest_completed: number;
      reached_at: Date | null;
    }>;
    pagination: {
      page: number;
      page_size: number;
      total: number;
      total_pages: number;
    };
  }> {
    const PAGE_SIZE = 100;
    const offset = (page - 1) * PAGE_SIZE;

    const [rankResult, countResult] = await Promise.all([
      db.query(
        `SELECT
           username,
           tower_floor - 1         AS highest_completed,
           tower_floor_updated_at  AS reached_at
         FROM users
         WHERE tower_floor > 1
         ORDER BY tower_floor DESC, tower_floor_updated_at ASC NULLS LAST
         LIMIT $1 OFFSET $2`,
        [PAGE_SIZE, offset]
      ),
      db.query(
        "SELECT COUNT(*) AS total FROM users WHERE tower_floor > 1"
      ),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    const rankings = rankResult.rows.map((row, index) => ({
      rank: offset + index + 1,
      username: row.username as string,
      highest_completed: row.highest_completed as number,
      reached_at: row.reached_at as Date | null,
    }));

    return {
      rankings,
      pagination: {
        page,
        page_size: PAGE_SIZE,
        total,
        total_pages: Math.ceil(total / PAGE_SIZE),
      },
    };
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

    // Add preview cards for each floor in a single batched query (was one
    // query per floor — an N+1 over the tower-list endpoint).
    const deckIds = floors.map((f) => f.ai_deck_id);
    const previewsByDeck = await this.getTopCardsForDecks(deckIds, 3);
    for (const floor of floors) {
      floor.preview_cards = previewsByDeck.get(floor.ai_deck_id) ?? [];
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
  /**
   * Batched top-N preview cards for many decks at once.
   *
   * Returns a map of deck_id -> ordered card_variant_id[] (best first, by
   * rarity then total base power). The rarity priority and per-deck top-N
   * selection are done in SQL via a window function partitioned by deck, so
   * this is a single round-trip regardless of how many decks are requested.
   */
  private async getTopCardsForDecks(
    deckIds: string[],
    limit: number = 3
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (deckIds.length === 0) return result;

    const { rows } = await db.query(
      `
      WITH deck_cards_power AS (
        SELECT DISTINCT ON (dc.deck_id, cv.card_variant_id)
          dc.deck_id,
          cv.card_variant_id AS card_id,
          CASE cv.rarity
            WHEN 'legendary' THEN 4
            WHEN 'epic' THEN 3
            WHEN 'rare' THEN 2
            WHEN 'uncommon' THEN 1
            ELSE 0
          END AS rarity_rank,
          COALESCE((ch.base_power->>'top')::integer, 0) +
          COALESCE((ch.base_power->>'right')::integer, 0) +
          COALESCE((ch.base_power->>'bottom')::integer, 0) +
          COALESCE((ch.base_power->>'left')::integer, 0) AS total_power
        FROM deck_cards dc
        JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
        JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
        JOIN characters ch ON cv.character_id = ch.character_id
        WHERE dc.deck_id = ANY($1::uuid[])
      ),
      ranked AS (
        SELECT
          deck_id,
          card_id,
          ROW_NUMBER() OVER (
            PARTITION BY deck_id
            ORDER BY rarity_rank DESC, total_power DESC, card_id
          ) AS rn
        FROM deck_cards_power
      )
      SELECT deck_id, card_id
      FROM ranked
      WHERE rn <= $2
      ORDER BY deck_id, rn;
    `,
      [deckIds, limit]
    );

    for (const row of rows) {
      const list = result.get(row.deck_id);
      if (list) {
        list.push(row.card_id);
      } else {
        result.set(row.deck_id, [row.card_id]);
      }
    }
    return result;
  }

  /**
   * Start a tower game
   */
  async startTowerGame(
    userId: string,
    playerDeckId: string,
    clientVersion?: string
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
      const playerCardInstanceIds = await DeckService.getDeckCardInstances(
        playerDeckId
      );

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
        aiCardInstanceIds = await DeckService.createAICardCopies(
          playerCardInstanceIds
        );
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

      // Attach deck effects based on mythology composition
      const [playerDeckEffect, aiDeckEffect] = await Promise.all([
        DeckService.getDeckEffect(playerDeckId),
        DeckService.getDeckEffect(floor.ai_deck_id),
      ]);

      if (playerDeckEffect) {
        initialGameState.player1.deck_effect = playerDeckEffect;
        initialGameState.player1.deck_effect_state = { last_triggered_round: 0 };
      }
      if (aiDeckEffect) {
        initialGameState.player2.deck_effect = aiDeckEffect;
        initialGameState.player2.deck_effect_state = { last_triggered_round: 0 };
      }

      // AI auto-commits its mulligan at game creation (player2 is always AI in tower).
      const aiReplacedIds = chooseAIMulligan(initialGameState, AI_PLAYER_ID);
      const aiMulliganResult = applyPlayerMulligan(
        initialGameState,
        AI_PLAYER_ID,
        aiReplacedIds,
      );
      let finalGameState = aiMulliganResult.state;
      const supportsMulliganUi = clientSupportsMulligan(clientVersion);
      const legacyBootstrap = bootstrapSoloMulliganForClient(
        finalGameState,
        userId,
        supportsMulliganUi
      );
      finalGameState = legacyBootstrap.state;
      await hydrateGameStateCards(finalGameState);

      // Create game record with floor_number
      const createdGame = await this.createTowerGameRecord(
        userId,
        AI_PLAYER_ID,
        playerDeckId,
        floor.ai_deck_id,
        floorNumber,
        finalGameState
      );

      // Get AI deck info for preview and opponent mythology in parallel
      const [aiDeckResult, opponentMythology] = await Promise.all([
        client.query("SELECT name FROM decks WHERE deck_id = $1", [
          floor.ai_deck_id,
        ]),
        DeckService.getDeckDominantMythology(floor.ai_deck_id),
      ]);

      return {
        game_id: createdGame.game_id,
        floor_number: floorNumber,
        floor_name: floor.name,
        opponent_mythology: opponentMythology,
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
   *
   * Idempotency guarantees:
   * 1. SELECT ... FOR UPDATE on the user row serializes concurrent requests
   *    so two in-flight calls for the same user never race.
   * 2. If a gameId is provided, we verify it hasn't already been reward-
   *    processed (game_status must still be 'completed', not 'rewarded').
   *    After granting rewards we mark it 'rewarded' atomically inside the
   *    same transaction.
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

      // --- Game validation (sanity check) ---
      if (gameId) {
        const gameCheck = await client.query(
          `SELECT game_id, floor_number, player1_id
           FROM "games"
           WHERE game_id = $1`,
          [gameId]
        );

        if (gameCheck.rows.length === 0) {
          throw new Error("Game not found");
        }

        const game = gameCheck.rows[0];

        if (game.player1_id !== userId) {
          throw new Error("Game does not belong to this user");
        }

        if (game.floor_number !== floorNumber) {
          throw new Error(
            `Game floor (${game.floor_number}) does not match requested floor (${floorNumber})`
          );
        }
      }

      // --- Idempotency: row-level lock on user ---
      // FOR NO KEY UPDATE serializes concurrent requests for the same user
      // without conflicting with FOR KEY SHARE locks acquired by FK checks
      // (e.g. INSERT INTO user_owned_cards during card awards on a pool connection).
      const progressResult = await client.query(
        "SELECT tower_floor FROM users WHERE user_id = $1 FOR NO KEY UPDATE",
        [userId]
      );

      if (progressResult.rows.length === 0) {
        throw new Error("User not found");
      }

      const currentFloor = progressResult.rows[0].tower_floor;
      if (currentFloor !== floorNumber) {
        throw new Error(`User is on floor ${currentFloor}, not ${floorNumber}`);
      }

      // Calculate rewards
      const rewards = this.getTowerReward(floorNumber);

      // Award currency rewards using the transaction client directly.
      // IMPORTANT: The users row is locked by FOR UPDATE above, so we MUST use
      // the same client connection. Using pool queries (e.g. UserModel.updateGems)
      // would deadlock because pool queries run on separate connections that
      // cannot acquire the row lock held by this transaction.
      const setClauses: string[] = [];
      const values: any[] = [userId];
      let paramIndex = 2;

      if (rewards.reward_gems > 0) {
        setClauses.push(`gems = gems + $${paramIndex}`);
        values.push(rewards.reward_gems);
        paramIndex++;
      }

      if (rewards.reward_packs > 0) {
        setClauses.push(`pack_count = pack_count + $${paramIndex}`);
        values.push(rewards.reward_packs);
        paramIndex++;
      }

      if (rewards.reward_card_fragments > 0) {
        setClauses.push(`card_fragments = card_fragments + $${paramIndex}`);
        values.push(rewards.reward_card_fragments);
        paramIndex++;
      }

      if (setClauses.length > 0) {
        await client.query(
          `UPDATE "users" SET ${setClauses.join(", ")} WHERE user_id = $1`,
          values
        );
      }

      // Award milestone cards (always full-art variants, weighted).
      // The reward flags map to milestones: rare_art -> %100, legendary -> %50,
      // epic -> %25 (flag names are legacy; the spec decides the actual card).
      const cardsAwarded: TowerCompletionResult["cards_awarded"] = {};

      if (rewards.reward_rare_art_card > 0) {
        const card = await this.awardWeightedVariantCard(
          userId,
          MILESTONE_CARD_100
        );
        if (card) {
          cardsAwarded.rare_art_card = card;
        }
      }

      if (rewards.reward_legendary_card > 0) {
        const card = await this.awardWeightedVariantCard(
          userId,
          MILESTONE_CARD_50
        );
        if (card) {
          cardsAwarded.legendary_card = card;
        }
      }

      if (rewards.reward_epic_card > 0) {
        const card = await this.awardWeightedVariantCard(
          userId,
          MILESTONE_CARD_25
        );
        if (card) {
          cardsAwarded.epic_card = card;
        }
      }

      // Increment user's tower floor and record when they advanced
      const newFloor = floorNumber + 1;
      await client.query(
        "UPDATE users SET tower_floor = $1, tower_floor_updated_at = NOW() WHERE user_id = $2",
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
   * Weighted pick from a {key: weight} map. Returns a key, or null if empty.
   */
  private weightedPick<K extends string>(
    weights: Partial<Record<K, number>>
  ): K | null {
    const entries = (Object.entries(weights) as [K, number][]).filter(
      ([, w]) => w > 0
    );
    const total = entries.reduce((s, [, w]) => s + w, 0);
    if (total <= 0) return null;
    let roll = Math.random() * total;
    for (const [key, w] of entries) {
      roll -= w;
      if (roll < 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  /**
   * Award a full-art variant card chosen by weighted base rarity + variant
   * level (e.g. "epic++"). Falls back across other levels of the chosen
   * rarity, then other rarities in the spec, so an empty variant pool never
   * silently drops the reward.
   */
  private async awardWeightedVariantCard(
    userId: string,
    spec: MilestoneCardSpec
  ): Promise<AwardedCard | null> {
    // Build an ordered list of preferred rarities (weighted pick first, then
    // remaining rarities by descending weight as fallback).
    const primaryRarity = this.weightedPick(spec.rarityWeights);
    if (!primaryRarity) return null;
    const rarityOrder: CardRarity[] = [
      primaryRarity,
      ...(Object.keys(spec.rarityWeights) as CardRarity[]).filter(
        (r) => r !== primaryRarity
      ),
    ];

    for (const rarity of rarityOrder) {
      // Preferred level by weight, then the other levels as fallback.
      const primaryLevel = this.weightedPick(spec.levelWeights) ?? "+";
      const levelOrder: VariantLevel[] = [
        primaryLevel,
        ...(["+", "++", "+++"] as VariantLevel[]).filter(
          (l) => l !== primaryLevel
        ),
      ];

      for (const level of levelOrder) {
        const card = await this.awardSpecificVariant(userId, `${rarity}${level}`);
        if (card) return card;
      }
    }

    return null;
  }

  /**
   * Award one random card of an exact variant rarity (e.g. "legendary++").
   * Returns null if no such variant exists.
   */
  private async awardSpecificVariant(
    userId: string,
    variantRarity: string
  ): Promise<AwardedCard | null> {
    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM card_variants cv
      JOIN characters ch ON ch.character_id = cv.character_id
      WHERE cv.rarity::text = $1
        AND cv.is_exclusive = false
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW();
    `;
    const { rows: countRows } = await db.query(countQuery, [variantRarity]);
    const total = Number(countRows[0]?.total || 0);
    if (total === 0) return null;

    const randomOffset = Math.floor(Math.random() * total);
    const query = `
      SELECT cv.card_variant_id as card_id, ch.name, cv.rarity, cv.image_url
      FROM card_variants cv
      JOIN characters ch ON cv.character_id = ch.character_id
      WHERE cv.rarity::text = $1
        AND cv.is_exclusive = false
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW()
      ORDER BY cv.card_variant_id
      LIMIT 1 OFFSET $2;
    `;
    const { rows } = await db.query(query, [variantRarity, randomOffset]);
    if (rows.length === 0) return null;

    const card = rows[0];
    const insertQuery = `
      INSERT INTO user_owned_cards (user_id, card_variant_id, level, xp)
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
        const TowerGenerationService =
          require("./towerGeneration.service").default;

        // Fire and forget - don't block the response
        // Use maxFloor as reference (highest available) for better power scaling
        TowerGenerationService.triggerGeneration(
          maxFloor + 1,
          3,
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
      effective_power: {
        top: number;
        right: number;
        bottom: number;
        left: number;
      };
    }[];
    average_power: number;
  } | null> {
    const floor = await this.getTowerFloor(floorNumber);
    if (!floor) return null;

    const result = await db.query(
      `
      SELECT 
        ch.name,
        uoc.level,
        ch.base_power->>'top' as base_top,
        ch.base_power->>'right' as base_right,
        ch.base_power->>'bottom' as base_bottom,
        ch.base_power->>'left' as base_left,
        COALESCE(ucp.power_up_data->>'top', '0') as powerup_top,
        COALESCE(ucp.power_up_data->>'right', '0') as powerup_right,
        COALESCE(ucp.power_up_data->>'bottom', '0') as powerup_bottom,
        COALESCE(ucp.power_up_data->>'left', '0') as powerup_left
      FROM deck_cards dc
      JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN characters ch ON cv.character_id = ch.character_id
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
        right:
          parseInt(row.base_right || "0") + parseInt(row.powerup_right || "0"),
        bottom:
          parseInt(row.base_bottom || "0") +
          parseInt(row.powerup_bottom || "0"),
        left:
          parseInt(row.base_left || "0") + parseInt(row.powerup_left || "0"),
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
          cv.card_variant_id as card_id,
          ch.name,
          cv.rarity
        FROM deck_cards dc
        JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
        JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
        JOIN characters ch ON cv.character_id = ch.character_id
        WHERE dc.deck_id = $1
      `,
        [deckId]
      );

      const cards = cardsResult.rows;

      // Rule 1: Must have exactly 20 cards
      if (cards.length !== 20) {
        const missingCount = 20 - cards.length;
        const message =
          missingCount > 0
            ? `Your deck is missing ${missingCount} card${
                missingCount === 1 ? "" : "s"
              }. Decks must contain exactly 20 cards to start a game (your deck currently has ${cards.length}).`
            : `Your deck has too many cards. Decks must contain exactly 20 cards to start a game (your deck currently has ${cards.length}).`;
        throw new Error(message);
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
          `Deck can have maximum 2 copies of any card. Violations: ${violations.join(
            ", "
          )}`
        );
      }

      // All validations passed
    } finally {
      client.release();
    }
  }
}

export default new TowerService();
