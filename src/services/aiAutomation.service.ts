import SetModel from "../models/set.model";
import PackService from "./pack.service";
import FatePickService from "./fatePick.service";
import UserModel from "../models/user.model";
import db from "../config/db.config";

// AI Player ID constant (matches the one used in game controller)
const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

interface AutomatedFatePickResult {
  success: boolean;
  message: string;
  fatePickId?: string;
  setUsed?: string;
  cardsGenerated?: number;
}

const AIAutomationService = {
  /**
   * Generate an automated fate pick for the AI user
   * This function:
   * 1. Chooses a random available set
   * 2. Opens a pack for the AI user (bypassing pack count check)
   * 3. Creates a fate pick from the pack
   * 4. Deletes the 5 cards from the AI user's collection
   */
  async generateAutomatedFatePick(): Promise<AutomatedFatePickResult> {
    console.log("🤖 Starting automated fate pick generation for AI user...");

    try {
      // 1. Check if AI user exists
      const aiUser = await UserModel.findById(AI_PLAYER_ID);
      if (!aiUser) {
        console.error("❌ AI user not found");
        return {
          success: false,
          message: "AI user not found. Please create the AI user first.",
        };
      }

      // 2. Get all released sets
      const availableSets = await SetModel.findReleased();
      if (availableSets.length === 0) {
        console.error("❌ No released sets available");
        return {
          success: false,
          message: "No released sets available for pack opening",
        };
      }

      // 3. Choose a random set
      const randomSetIndex = Math.floor(Math.random() * availableSets.length);
      const selectedSet = availableSets[randomSetIndex];
      console.log(
        `🎲 Selected set: ${selectedSet.name} (${selectedSet.set_id})`
      );

      // 4. Check if the set has cards available
      const setCardsCount = await PackService.getSetCardCount(
        selectedSet.set_id
      );
      if (setCardsCount === 0) {
        console.error(`❌ Set ${selectedSet.name} has no cards available`);
        return {
          success: false,
          message: `Selected set ${selectedSet.name} has no cards available`,
        };
      }

      // 5. Generate pack contents (simulate pack opening without pack count check)
      const setCards = await PackService.getCardsFromSet(selectedSet.set_id);
      if (setCards.length === 0) {
        console.error(
          `❌ Could not retrieve cards from set ${selectedSet.name}`
        );
        return {
          success: false,
          message: `Could not retrieve cards from set ${selectedSet.name}`,
        };
      }

      // 6. Select 5 random cards for the pack
      const selectedCards = PackService.selectRandomCards(setCards, 5);
      console.log(`📦 Generated pack with ${selectedCards.length} cards`);

      // 7. Add cards to AI user's collection temporarily
      await this.addCardsToAICollection(selectedCards);

      // 8. Log the pack opening for the AI user
      const packOpeningId = await this.logAIPackOpening(
        selectedSet.set_id,
        selectedCards
      );

      // 9. Create fate pick from the pack opening
      const fatePickResult =
        await FatePickService.createFatePickFromPackOpening(
          packOpeningId,
          AI_PLAYER_ID,
          selectedCards,
          selectedSet.set_id,
          1 // Cost in fate coins
        );

      if (!fatePickResult.success) {
        console.error("❌ Failed to create fate pick:", fatePickResult.error);
        // Clean up - remove the cards we added
        await this.removeCardsFromAICollection(selectedCards);
        return {
          success: false,
          message: fatePickResult.error || "Failed to create fate pick",
        };
      }

      // 10. Remove the 5 cards from AI user's collection
      await this.removeCardsFromAICollection(selectedCards);

      console.log(
        `✅ Successfully created automated fate pick: ${fatePickResult.fatePick?.id}`
      );
      return {
        success: true,
        message: `Successfully created automated fate pick from ${selectedSet.name}`,
        fatePickId: fatePickResult.fatePick?.id,
        setUsed: selectedSet.name,
        cardsGenerated: selectedCards.length,
      };
    } catch (error) {
      console.error("❌ Error generating automated fate pick:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },

  /**
   * Add cards to AI user's collection temporarily
   */
  async addCardsToAICollection(cards: any[]): Promise<void> {
    for (const card of cards) {
      const query = `
        INSERT INTO "user_owned_cards" (user_id, card_id, level, xp, created_at)
        VALUES ($1, $2, 1, 0, NOW());
      `;
      await db.query(query, [AI_PLAYER_ID, card.card_id]);
    }
  },

  /**
   * Remove cards from AI user's collection
   */
  async removeCardsFromAICollection(cards: any[]): Promise<void> {
    const cardIds = cards.map((card) => card.card_id);

    // Get the most recent card instances for these card IDs for the AI user
    const query = `
      DELETE FROM "user_owned_cards" 
      WHERE user_card_instance_id IN (
        SELECT user_card_instance_id 
        FROM "user_owned_cards" 
        WHERE user_id = $1 AND card_id = ANY($2)
        ORDER BY created_at DESC 
        LIMIT $3
      );
    `;

    await db.query(query, [AI_PLAYER_ID, cardIds, cards.length]);
    console.log(`🗑️ Removed ${cards.length} cards from AI user's collection`);
  },

  /**
   * Log pack opening for AI user
   */
  async logAIPackOpening(setId: string, cards: any[]): Promise<string> {
    const cardIds = cards.map((card) => card.card_id);

    const query = `
      INSERT INTO "pack_opening_history" (user_id, set_id, card_ids)
      VALUES ($1, $2, $3)
      RETURNING pack_opening_id;
    `;

    const { rows } = await db.query(query, [
      AI_PLAYER_ID,
      setId,
      JSON.stringify(cardIds),
    ]);
    return rows[0].pack_opening_id;
  },

  /**
   * Start the automated fate pick generation scheduler
   * Runs every 30 minutes
   */
  startAutomatedFatePickScheduler(): NodeJS.Timeout {
    console.log("🕒 Starting automated fate pick scheduler (every 30 minutes)");

    // Run immediately on startup (optional)
    // this.generateAutomatedFatePick();

    // Set up interval for every 30 minutes (30 * 60 * 1000 milliseconds)
    const intervalId = setInterval(async () => {
      console.log("⏰ Running scheduled automated fate pick generation...");
      const result = await this.generateAutomatedFatePick();

      if (result.success) {
        console.log(`✅ Scheduled fate pick created: ${result.message}`);
      } else {
        console.error(`❌ Scheduled fate pick failed: ${result.message}`);
      }
    }, 30 * 60 * 1000); // 30 minutes

    return intervalId;
  },

  /**
   * Stop the automated fate pick generation scheduler
   */
  stopAutomatedFatePickScheduler(intervalId: NodeJS.Timeout): void {
    console.log("🛑 Stopping automated fate pick scheduler");
    clearInterval(intervalId);
  },
};

export default AIAutomationService;
