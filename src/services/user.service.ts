import db from "../config/db.config";

class UserService {
  /**
   * Awards a specified amount of currency to a user.
   * (This is the logic moved from game.controller.ts)
   */
  async awardCurrency(userId: string, amount: number): Promise<void> {
    if (amount <= 0) {
      console.warn(
        `Attempted to award non-positive currency amount (${amount}) to user ${userId}. Skipping.`
      );
      return;
    }
    const query = `
      UPDATE "users"
      SET in_game_currency = in_game_currency + $1
      WHERE user_id = $2;
    `;
    try {
      await db.query(query, [amount, userId]);
      console.log(`Awarded ${amount} currency to user ${userId}.`);
    } catch (error) {
      console.error(`Failed to award currency to user ${userId}:`, error);
      // Depending on requirements, you might want to re-throw or handle more gracefully
      throw new Error(`Failed to award currency: ${(error as Error).message}`);
    }
  }
}

export default new UserService();
