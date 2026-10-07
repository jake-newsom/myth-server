import db, { QueryExecutor } from "../config/db.config";
import {
  AvailableCosmetics,
  EquipCosmeticsInput,
  PublicPlayerProfile,
} from "../types/cosmetics.types";

export class CosmeticsError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "CosmeticsError";
  }
}

/** Avatars a user may equip: default ones, or any character they own a card of. */
const AVATAR_OWNED_SQL = `
  (a.is_default OR EXISTS (
    SELECT 1 FROM user_owned_cards uoc
    JOIN card_variants cv ON cv.card_variant_id = uoc.card_variant_id
    WHERE uoc.user_id = $1 AND cv.character_id = a.character_id
  ))`;

/** Base (non-upgraded) card art for an avatar's character: fallback until sprite art exists. */
const avatarImageSql = (alias: string) => `
  (SELECT cv.image_url FROM card_variants cv
    WHERE cv.character_id = ${alias}.character_id
    ORDER BY (cv.rarity::text LIKE '%+%'), cv.card_variant_id
    LIMIT 1)`;

const PlayerCosmeticsService = {
  /** Idempotent. Returns true when newly granted. */
  async grantTitle(
    userId: string,
    titleId: string,
    source: string | null = null,
    exec: QueryExecutor = db
  ): Promise<boolean> {
    const { rowCount } = await exec.query(
      `INSERT INTO user_owned_titles (user_id, title_id, source)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, titleId, source]
    );
    return (rowCount ?? 0) > 0;
  },

  /**
   * Idempotent. Unique frames are never granted this way — they move only
   * through UniqueFrameService — so a misconfigured reward is a no-op.
   */
  async grantFrame(
    userId: string,
    frameId: string,
    source: string | null = null,
    exec: QueryExecutor = db
  ): Promise<boolean> {
    const { rowCount } = await exec.query(
      `INSERT INTO user_owned_frames (user_id, frame_id, source)
       SELECT $1, frame_id, $3 FROM avatar_frames
        WHERE frame_id = $2 AND is_unique = false
       ON CONFLICT DO NOTHING`,
      [userId, frameId, source]
    );
    return (rowCount ?? 0) > 0;
  },

  async getAvailable(userId: string): Promise<AvailableCosmetics> {
    const [titles, frames, avatars, equipped] = await Promise.all([
      db.query(
        `SELECT t.title_id, t.code_key, t.name, t.description, t.accent,
                (uot.user_id IS NOT NULL) AS owned
           FROM titles t
           LEFT JOIN user_owned_titles uot
             ON uot.title_id = t.title_id AND uot.user_id = $1
          WHERE t.is_active OR uot.user_id IS NOT NULL
          ORDER BY owned DESC, t.name`,
        [userId]
      ),
      db.query(
        `SELECT f.frame_id, f.code_key, f.name, f.description, f.sprite_key, f.is_unique,
                f.is_default,
                CASE WHEN f.is_unique THEN ufh.user_id = $1
                     ELSE (uof.user_id IS NOT NULL OR f.is_default) END AS owned,
                hu.username AS holder_username
           FROM avatar_frames f
           LEFT JOIN user_owned_frames uof
             ON uof.frame_id = f.frame_id AND uof.user_id = $1
           LEFT JOIN unique_frame_holders ufh ON ufh.frame_id = f.frame_id
           LEFT JOIN users hu ON hu.user_id = ufh.user_id
          WHERE f.is_active OR uof.user_id IS NOT NULL
          ORDER BY f.is_unique DESC, f.sort_order, f.name`,
        [userId]
      ),
      db.query(
        `SELECT a.avatar_id, a.character_id, c.name AS character_name,
                a.sprite_key, a.is_default, ${avatarImageSql("a")} AS image_url,
                ${AVATAR_OWNED_SQL} AS owned
           FROM avatars a
           LEFT JOIN characters c ON c.character_id = a.character_id
          WHERE a.is_active
          ORDER BY owned DESC, a.sort_order`,
        [userId]
      ),
      db.query(
        `SELECT equipped_title_id, equipped_frame_id, equipped_avatar_id
           FROM users WHERE user_id = $1`,
        [userId]
      ),
    ]);

    const eq = equipped.rows[0] ?? {};
    return {
      titles: titles.rows,
      frames: frames.rows.map((f) => ({
        ...f,
        owned: !!f.owned,
        holder_username: f.is_unique ? f.holder_username ?? null : undefined,
      })),
      avatars: avatars.rows,
      equipped: {
        title_id: eq.equipped_title_id ?? null,
        frame_id: eq.equipped_frame_id ?? null,
        avatar_id: eq.equipped_avatar_id ?? null,
      },
    };
  },

  /**
   * Equip any subset of title/frame/avatar. `undefined` leaves a slot alone,
   * `null` clears it. Every non-null id is ownership-checked.
   */
  async equip(userId: string, input: EquipCosmeticsInput): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [userId];

    if (input.title_id !== undefined) {
      if (input.title_id !== null) {
        const { rowCount } = await db.query(
          `SELECT 1 FROM user_owned_titles WHERE user_id = $1 AND title_id = $2`,
          [userId, input.title_id]
        );
        if (!rowCount) throw new CosmeticsError("You don't own that title.");
      }
      params.push(input.title_id);
      sets.push(`equipped_title_id = $${params.length}`);
    }

    if (input.frame_id !== undefined) {
      if (input.frame_id !== null) {
        const { rowCount } = await db.query(
          `SELECT 1 FROM avatar_frames f
            WHERE f.frame_id = $2 AND (
              (NOT f.is_unique AND (f.is_default OR EXISTS (SELECT 1 FROM user_owned_frames
                 WHERE user_id = $1 AND frame_id = f.frame_id)))
              OR (f.is_unique AND EXISTS (SELECT 1 FROM unique_frame_holders
                 WHERE user_id = $1 AND frame_id = f.frame_id)))`,
          [userId, input.frame_id]
        );
        if (!rowCount) throw new CosmeticsError("You don't own that frame.");
      }
      params.push(input.frame_id);
      sets.push(`equipped_frame_id = $${params.length}`);
    }

    if (input.avatar_id !== undefined) {
      if (input.avatar_id !== null) {
        const { rowCount } = await db.query(
          `SELECT 1 FROM avatars a
            WHERE a.avatar_id = $2 AND a.is_active AND ${AVATAR_OWNED_SQL}`,
          [userId, input.avatar_id]
        );
        if (!rowCount) {
          throw new CosmeticsError("Collect that character to use its avatar.");
        }
      }
      params.push(input.avatar_id);
      sets.push(`equipped_avatar_id = $${params.length}`);
    }

    if (sets.length === 0) return;
    await db.query(
      `UPDATE users SET ${sets.join(", ")} WHERE user_id = $1`,
      params
    );
  },

  /**
   * Render-ready profiles for a batch of users. Users with no avatar equipped
   * get the default avatar/frame; a frame equipped but no longer held (unique frame
   * lost) is suppressed.
   */
  async getPublicProfiles(
    userIds: string[],
    exec: QueryExecutor = db
  ): Promise<Map<string, PublicPlayerProfile>> {
    const result = new Map<string, PublicPlayerProfile>();
    if (userIds.length === 0) return result;
    const { rows } = await exec.query(
      `SELECT u.user_id,
              av.sprite_key AS avatar_sprite_key,
              ${avatarImageSql("av")} AS avatar_image_url,
              fr.sprite_key AS frame_sprite_key,
              COALESCE(fr.is_unique, false) AS frame_is_unique,
              t.name AS title_name,
              t.accent AS title_accent
         FROM users u
         LEFT JOIN LATERAL (
           SELECT a.sprite_key, a.character_id FROM avatars a
            WHERE a.avatar_id = u.equipped_avatar_id
               OR (u.equipped_avatar_id IS NULL AND a.is_default AND a.is_active)
            ORDER BY (a.avatar_id = u.equipped_avatar_id) DESC NULLS LAST, a.sort_order
            LIMIT 1
         ) av ON true
         -- Equipped frame, unless it's a unique frame they no longer hold;
         -- otherwise the default frame everyone owns.
         LEFT JOIN LATERAL (
           SELECT f.sprite_key, f.is_unique FROM avatar_frames f
             LEFT JOIN unique_frame_holders ufh ON ufh.frame_id = f.frame_id
            WHERE (f.frame_id = u.equipped_frame_id
                   AND (NOT f.is_unique OR ufh.user_id = u.user_id))
               OR (f.is_default AND f.is_active)
            ORDER BY (f.frame_id = u.equipped_frame_id) DESC NULLS LAST, f.sort_order
            LIMIT 1
         ) fr ON true
         LEFT JOIN titles t ON t.title_id = u.equipped_title_id
        WHERE u.user_id = ANY($1::uuid[])`,
      [userIds]
    );
    for (const r of rows) {
      result.set(r.user_id, {
        avatar_sprite_key: r.avatar_sprite_key ?? null,
        avatar_image_url: r.avatar_image_url ?? null,
        frame_sprite_key: r.frame_sprite_key ?? null,
        frame_is_unique: !!r.frame_is_unique,
        title_name: r.title_name ?? null,
        title_accent: r.title_accent ?? null,
      });
    }
    return result;
  },

  async getPublicProfile(
    userId: string,
    exec: QueryExecutor = db
  ): Promise<PublicPlayerProfile | null> {
    const map = await this.getPublicProfiles([userId], exec);
    return map.get(userId) ?? null;
  },

  /** Account reset: drop owned titles/frames and unequip everything. */
  async resetForUser(userId: string, exec: QueryExecutor): Promise<void> {
    await exec.query(`DELETE FROM user_owned_titles WHERE user_id = $1`, [userId]);
    await exec.query(`DELETE FROM user_owned_frames WHERE user_id = $1`, [userId]);
    await exec.query(
      `UPDATE users SET equipped_title_id = NULL, equipped_frame_id = NULL,
                        equipped_avatar_id = NULL
        WHERE user_id = $1`,
      [userId]
    );
  },
};

export default PlayerCosmeticsService;
