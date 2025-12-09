import FatePickModel, {
  FatePickWithDetails,
  FatePickParticipation,
} from "../models/fatePick.model";
import UserModel from "../models/user.model";
import db from "../config/db.config";
import DailyTaskService from "./dailyTask.service";

const FatePickService = {
  /**
   * Create a Fate pick from a pack opening
   */
  async createFatePickFromPackOpening(
    packOpeningId: string,
    originalOwnerId: string,
    cards: any[],
    setId: string,
    costWonderCoins: number = 1
  ): Promise<{ success: boolean; fatePick?: any; error?: string }> {
    try {
      // Only create Fate picks for packs with exactly 5 cards
      if (cards.length !== 5) {
        return {
          success: false,
          error: "Fate picks can only be created from 5-card packs",
        };
      }

      const fatePick = await FatePickModel.createFromPackOpening(
        packOpeningId,
        originalOwnerId,
        cards,
        setId,
        costWonderCoins
      );

      return {
        success: true,
        fatePick,
      };
    } catch (error) {
      console.error("Error creating Fate pick:", error);
      return {
        success: false,
        error: "Failed to create Fate pick",
      };
    }
  },

  /**
   * Get available Fate picks for a user
   */
  async getAvailableFatePicks(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    success: boolean;
    fatePicks?: FatePickWithDetails[];
    pagination?: { page: number; limit: number; total: number };
    userFateCoins?: number;
    error?: string;
  }> {
    try {
      const offset = (page - 1) * limit;

      // Get user's current Fate coins
      const user = await UserModel.findById(userId);
      if (!user) {
        return {
          success: false,
          error: "User not found",
        };
      }

      // Get available Fate picks
      const fatePicks = await FatePickModel.getAvailableFatePicks(
        userId,
        limit,
        offset
      );

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM fate_picks wp
        WHERE wp.is_active = true 
          AND wp.expires_at > NOW() 
          AND wp.original_owner_id != $1
          AND wp.current_participants < wp.max_participants;
      `;
      const { rows: countRows } = await db.query(countQuery, [userId]);
      const total = parseInt(countRows[0].total);

      return {
        success: true,
        fatePicks,
        pagination: {
          page,
          limit,
          total,
        },
        userFateCoins: user.fate_coins || 0,
      };
    } catch (error) {
      console.error("Error getting available Fate picks:", error);
      console.error("Error details:", {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : "No stack trace",
        userId,
        page,
        limit,
      });
      return {
        success: false,
        error: `Failed to retrieve Fate picks: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  },

  /**
   * Get Fate pick details by ID
   */
  async getFatePickDetails(
    fatePickId: string,
    userId: string
  ): Promise<{
    success: boolean;
    fatePick?: FatePickWithDetails;
    userParticipation?: FatePickParticipation;
    error?: string;
  }> {
    try {
      const fatePick = await FatePickModel.getFatePickById(fatePickId, userId);

      if (!fatePick) {
        return {
          success: false,
          error: "Fate pick not found",
        };
      }

      // Get user's participation if it exists
      const userParticipation = await FatePickModel.getUserParticipation(
        fatePickId,
        userId
      );

      return {
        success: true,
        fatePick,
        userParticipation: userParticipation || undefined,
      };
    } catch (error) {
      console.error("Error getting Fate pick details:", error);
      return {
        success: false,
        error: "Failed to retrieve Fate pick details",
      };
    }
  },

  /**
   * Participate in a Fate pick (spend coins and shuffle)
   */
  async participateInFatePick(
    fatePickId: string,
    userId: string
  ): Promise<{
    success: boolean;
    participation?: FatePickParticipation;
    updatedWonderCoins?: number;
    error?: string;
  }> {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Get Fate pick details
      const fatePick = await FatePickModel.getFatePickById(fatePickId, userId);

      if (!fatePick) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "Fate pick not found",
        };
      }

      // Validation checks
      if (!fatePick.is_active) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "Fate pick is no longer active",
        };
      }

      if (new Date() > new Date(fatePick.expires_at)) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "Fate pick has expired",
        };
      }

      if (fatePick.current_participants >= fatePick.max_participants) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "Fate pick is full",
        };
      }

      if (fatePick.user_has_participated) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "You have already participated in this Fate pick",
        };
      }

      if (fatePick.original_owner_id === userId) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "You cannot participate in your own Fate pick",
        };
      }

      // Get user and check Fate coins
      const user = await UserModel.findById(userId);
      if (!user) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "User not found",
        };
      }

      const userFateCoins = user.fate_coins || 0;
      if (userFateCoins < fatePick.cost_fate_coins) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: `Insufficient Fate coins. Required: ${fatePick.cost_fate_coins}, Available: ${userFateCoins}`,
        };
      }

      // Spend Fate coins
      const spendQuery = `
        UPDATE users 
        SET fate_coins = fate_coins - $1 
        WHERE user_id = $2 AND fate_coins >= $1
        RETURNING fate_coins;
      `;

      const { rows: spendRows } = await client.query(spendQuery, [
        fatePick.cost_fate_coins,
        userId,
      ]);

      if (spendRows.length === 0) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "Failed to spend Fate coins (insufficient funds)",
        };
      }

      // Create participation (this handles the shuffling)
      const participation = await FatePickModel.createParticipation(
        fatePickId,
        userId,
        fatePick.cost_fate_coins
      );

      await client.query("COMMIT");

      return {
        success: true,
        participation,
        updatedWonderCoins: spendRows[0].fate_coins,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error participating in Fate pick:", error);
      return {
        success: false,
        error: "Failed to participate in Fate pick",
      };
    } finally {
      client.release();
    }
  },

  /**
   * Select a card position and get the result
   */
  async selectCardPosition(
    fatePickId: string,
    userId: string,
    selectedPosition: number
  ): Promise<{
    success: boolean;
    result?: {
      participation: FatePickParticipation;
      wonCard: any;
      addedToCollection: boolean;
    };
    error?: string;
  }> {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Validation
      if (selectedPosition < 0 || selectedPosition > 4) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "Selected position must be between 0 and 4",
        };
      }

      // Get user's participation
      const userParticipation = await FatePickModel.getUserParticipation(
        fatePickId,
        userId
      );

      if (!userParticipation) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "You have not participated in this Fate pick",
        };
      }

      if (userParticipation.status !== "shuffled") {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "This participation has already been completed or expired",
        };
      }

      if (new Date() > new Date(userParticipation.expires_at)) {
        await client.query("ROLLBACK");
        return {
          success: false,
          error: "Your participation time has expired",
        };
      }

      // Select the card position and get the result
      const { participation, wonCard } = await FatePickModel.selectCardPosition(
        userParticipation.id,
        selectedPosition
      );

      // Add the won card to user's collection
      let addedToCollection = false;
      try {
        const addCardQuery = `
          INSERT INTO user_owned_cards (user_id, card_id, level, xp, created_at)
          VALUES ($1, $2, 1, 0, NOW());
        `;
        await client.query(addCardQuery, [userId, wonCard.card_id]);
        addedToCollection = true;
      } catch (error) {
        console.error("Error adding won card to collection:", error);
        // Don't fail the entire operation if card addition fails
      }

      await client.query("COMMIT");

      // Track daily task progress for fate pick completion
      try {
        await DailyTaskService.trackFatePick(userId);
      } catch (error) {
        console.error("Error tracking fate pick for daily task:", error);
        // Don't fail the operation if tracking fails
      }

      return {
        success: true,
        result: {
          participation,
          wonCard,
          addedToCollection,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error selecting card position:", error);
      return {
        success: false,
        error: "Failed to select card position",
      };
    } finally {
      client.release();
    }
  },

  /**
   * Get user's Fate pick participation history
   */
  async getUserParticipationHistory(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    success: boolean;
    participations?: Array<
      FatePickParticipation & { fate_pick: FatePickWithDetails }
    >;
    pagination?: { page: number; limit: number; total: number };
    stats?: {
      total_participations: number;
      total_cards_won: number;
      total_fate_coins_spent: number;
      favorite_set: string | null;
    };
    error?: string;
  }> {
    try {
      const offset = (page - 1) * limit;

      // Get participations
      const participations = await FatePickModel.getUserParticipationHistory(
        userId,
        limit,
        offset
      );

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM fate_pick_participations wpp
        WHERE wpp.participant_id = $1;
      `;
      const { rows: countRows } = await db.query(countQuery, [userId]);
      const total = parseInt(countRows[0].total);

      // Get user stats
      const statsQuery = `
        SELECT 
          COUNT(*) as total_participations,
          COUNT(CASE WHEN status = 'selected' THEN 1 END) as total_cards_won,
          SUM(cost_paid) as total_fate_coins_spent,
          (
            SELECT s.name
            FROM fate_pick_participations wpp2
            JOIN fate_picks wp ON wpp2.fate_pick_id = wp.id
            JOIN sets s ON wp.set_id = s.set_id
            WHERE wpp2.participant_id = $1
            GROUP BY s.name
            ORDER BY COUNT(*) DESC
            LIMIT 1
          ) as favorite_set
        FROM fate_pick_participations wpp
        WHERE wpp.participant_id = $1;
      `;
      const { rows: statsRows } = await db.query(statsQuery, [userId]);
      const stats = statsRows[0];

      return {
        success: true,
        participations,
        pagination: {
          page,
          limit,
          total,
        },
        stats: {
          total_participations: parseInt(stats.total_participations),
          total_cards_won: parseInt(stats.total_cards_won),
          total_fate_coins_spent: parseInt(stats.total_fate_coins_spent || 0),
          favorite_set: stats.favorite_set,
        },
      };
    } catch (error) {
      console.error("Error getting user participation history:", error);
      return {
        success: false,
        error: "Failed to retrieve participation history",
      };
    }
  },

  /**
   * Award Fate coins to a user
   */
  async awardFateCoins(
    userId: string,
    amount: number,
    reason: string = "Fate coins awarded"
  ): Promise<{
    success: boolean;
    newBalance?: number;
    error?: string;
  }> {
    try {
      if (amount <= 0) {
        return {
          success: false,
          error: "Award amount must be positive",
        };
      }

      const query = `
        UPDATE users 
        SET fate_coins = COALESCE(fate_coins, 0) + $1 
        WHERE user_id = $2
        RETURNING fate_coins;
      `;

      const { rows } = await db.query(query, [amount, userId]);

      if (rows.length === 0) {
        return {
          success: false,
          error: "User not found",
        };
      }

      return {
        success: true,
        newBalance: rows[0].fate_coins,
      };
    } catch (error) {
      console.error("Error awarding Fate coins:", error);
      return {
        success: false,
        error: "Failed to award Fate coins",
      };
    }
  },

  /**
   * Get Fate pick statistics
   */
  async getFatePickStats(): Promise<{
    success: boolean;
    stats?: {
      total_active_picks: number;
      total_participations_today: number;
      average_participants_per_pick: number;
      most_popular_set: string | null;
    };
    error?: string;
  }> {
    try {
      const stats = await FatePickModel.getFatePickStats();

      return {
        success: true,
        stats,
      };
    } catch (error) {
      console.error("Error getting Fate pick stats:", error);
      return {
        success: false,
        error: "Failed to retrieve Fate pick statistics",
      };
    }
  },

  /**
   * Clean up expired Fate picks and participations
   */
  async cleanupExpired(): Promise<{
    success: boolean;
    cleanup?: { expiredPicks: number; expiredParticipations: number };
    error?: string;
  }> {
    try {
      const cleanup = await FatePickModel.cleanupExpired();

      return {
        success: true,
        cleanup,
      };
    } catch (error) {
      console.error("Error cleaning up expired Fate picks:", error);
      return {
        success: false,
        error: "Failed to cleanup expired Fate picks",
      };
    }
  },
};

export default FatePickService;
