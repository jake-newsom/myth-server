import db from "../config/db.config";

export const QUICK_EMOJI_SLOTS = 4;

export interface EmojiRow {
  emoji_id: string;
  name: string;
  sheet_index: number;
  is_default: boolean;
  sort_order: number;
}

export interface MyEmojis {
  catalog: EmojiRow[];
  owned: string[];
  quick_emojis: string[];
  hide_opponent_emojis: boolean;
}

const EmojiService = {
  async getCatalog(): Promise<EmojiRow[]> {
    const { rows } = await db.query(
      `SELECT emoji_id, name, sheet_index, is_default, sort_order
         FROM emojis
        WHERE is_active
        ORDER BY sort_order, sheet_index`
    );
    return rows;
  },

  /** Active emojis the user can use: defaults plus anything unlocked. */
  async getOwnedEmojiIds(userId: string): Promise<string[]> {
    const { rows } = await db.query(
      `SELECT e.emoji_id
         FROM emojis e
         LEFT JOIN user_emojis ue
           ON ue.emoji_id = e.emoji_id AND ue.user_id = $1
        WHERE e.is_active AND (e.is_default OR ue.user_id IS NOT NULL)
        ORDER BY e.sort_order, e.sheet_index`,
      [userId]
    );
    return rows.map((r: { emoji_id: string }) => r.emoji_id);
  },

  async ownsEmoji(userId: string, emojiId: string): Promise<boolean> {
    const { rows } = await db.query(
      `SELECT 1
         FROM emojis e
         LEFT JOIN user_emojis ue
           ON ue.emoji_id = e.emoji_id AND ue.user_id = $1
        WHERE e.emoji_id = $2 AND e.is_active
          AND (e.is_default OR ue.user_id IS NOT NULL)`,
      [userId, emojiId]
    );
    return rows.length > 0;
  },

  async getMyEmojis(userId: string): Promise<MyEmojis> {
    const [catalog, owned, settings] = await Promise.all([
      this.getCatalog(),
      this.getOwnedEmojiIds(userId),
      db.query(
        `SELECT quick_emojis, hide_opponent_emojis FROM users WHERE user_id = $1`,
        [userId]
      ),
    ]);
    const row = settings.rows[0] ?? {};
    const ownedSet = new Set(owned);
    // Drop slots that point at retired/unowned emojis, then top up from
    // what the user owns so the popup always has a full row.
    const quick = ((row.quick_emojis as string[] | null) ?? []).filter((id) =>
      ownedSet.has(id)
    );
    for (const id of owned) {
      if (quick.length >= QUICK_EMOJI_SLOTS) break;
      if (!quick.includes(id)) quick.push(id);
    }
    return {
      catalog,
      owned,
      quick_emojis: quick.slice(0, QUICK_EMOJI_SLOTS),
      hide_opponent_emojis: !!row.hide_opponent_emojis,
    };
  },

  /** Throws a message string on invalid input (caller maps it to 400). */
  async setQuickEmojis(userId: string, emojiIds: unknown): Promise<void> {
    if (
      !Array.isArray(emojiIds) ||
      emojiIds.length > QUICK_EMOJI_SLOTS ||
      !emojiIds.every((id) => typeof id === "string")
    ) {
      throw new EmojiValidationError(
        `quick_emojis must be an array of up to ${QUICK_EMOJI_SLOTS} emoji ids`
      );
    }
    if (new Set(emojiIds).size !== emojiIds.length) {
      throw new EmojiValidationError("quick_emojis must not repeat");
    }
    const owned = new Set(await this.getOwnedEmojiIds(userId));
    if (!emojiIds.every((id) => owned.has(id))) {
      throw new EmojiValidationError("You don't own one of those emojis");
    }
    await db.query(`UPDATE users SET quick_emojis = $2 WHERE user_id = $1`, [
      userId,
      emojiIds,
    ]);
  },

  async setHideOpponentEmojis(userId: string, hide: boolean): Promise<void> {
    await db.query(
      `UPDATE users SET hide_opponent_emojis = $2 WHERE user_id = $1`,
      [userId, hide]
    );
  },

  /** Unlock hook for rewards/shop/promo/admin. Idempotent. */
  async grantEmoji(
    userId: string,
    emojiId: string,
    source: string
  ): Promise<boolean> {
    const { rowCount } = await db.query(
      `INSERT INTO user_emojis (user_id, emoji_id, source)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, emojiId, source]
    );
    return (rowCount ?? 0) > 0;
  },
};

export class EmojiValidationError extends Error {}

export default EmojiService;
