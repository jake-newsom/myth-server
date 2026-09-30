// myth-server/src/services/event.service.ts

import db, { QueryExecutor } from "../config/db.config";
import FeatureFlagService from "./featureFlag.service";
import logger from "../utils/logger";
import {
  ActiveEvent,
  EventCurrency,
  EventRecord,
  EventSummaryResponse,
  GLOBAL_MECHANIC_EXCLUDED_MODES,
} from "../types/event.types";

/**
 * Event Service
 *
 * Owns event *visibility* and the event currency ledger. Everything else
 * (shop, login sequence, achievements, mechanics) hangs off an event and lives
 * in its own module, so an event with no attachments costs nothing.
 *
 * ## Visibility rules
 *
 * An event is visible to a user when it is `is_active` AND either:
 *
 *   - now() falls inside [starts_at, ends_at)  — the live window, or
 *   - the user has `preview_feature_flag_key` enabled — early access.
 *
 * The flag is a *preview* mechanism only: it is never required during the live
 * window, so shipping the flag off does not hide a running event.
 *
 * `kill_switch_flag_key`, when enabled for a user, hides the event even while
 * live. That gives us a per-user (and, via a global flag rollout, a global)
 * off switch with no redeploy — the rollback plan required for a feature this
 * broad.
 *
 * ## Failure behavior
 *
 * Reads never throw. A database error or an unparseable row resolves to "no
 * events", which is exactly the pre-events behavior of every caller. An event
 * system outage must not be able to break the shop, the game loop, or login.
 */

/** Cached active-event set. Events change on human timescales, so a short TTL
 * is plenty and keeps this off the per-request query path. */
const EVENT_CACHE_TTL_MS = 60_000;

interface EventCacheEntry {
  events: ActiveEvent[];
  expiresAt: number;
}

let eventCache: EventCacheEntry | null = null;

function rowToEvent(row: any): EventRecord {
  return {
    id: row.id,
    event_key: row.event_key,
    name: row.name,
    description: row.description,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    is_active: row.is_active,
    preview_feature_flag_key: row.preview_feature_flag_key,
    kill_switch_flag_key: row.kill_switch_flag_key,
    currency_id: row.currency_id,
    currency_drop_chance: Number(row.currency_drop_chance) || 0,
    currency_drop_min: row.currency_drop_min,
    currency_drop_max: row.currency_drop_max,
    currency_drop_mode_multipliers: row.currency_drop_mode_multipliers ?? {},
    // Outcome-based drop rules. Absent/zero means the event uses the legacy
    // chance/min/max lottery above.
    currency_win_amount: Number(row.currency_win_amount) || 0,
    currency_draw_amount: Number(row.currency_draw_amount) || 0,
    currency_loss_amount: Number(row.currency_loss_amount) || 0,
    currency_forfeit_amount: Number(row.currency_forfeit_amount) || 0,
    currency_first_win_bonus: Number(row.currency_first_win_bonus) || 0,
    currency_daily_cap: Number(row.currency_daily_cap) || 0,
    login_sequence_id: row.login_sequence_id,
    mechanic_key: row.mechanic_key,
    mechanic_config: row.mechanic_config ?? {},
    background_image_url: row.background_image_url,
    board_background_image_url: row.board_background_image_url,
    theme_color: row.theme_color,
    icon_url: row.icon_url,
    has_game_mode: row.has_game_mode,
    game_mode_label: row.game_mode_label,
    game_mode_description: row.game_mode_description,
    sort_order: row.sort_order,
  };
}

const EventService = {
  /**
   * Every event that is either live now or still within its preview horizon,
   * regardless of user. The per-user filter is applied by `getEventsForUser`.
   *
   * Cached for EVENT_CACHE_TTL_MS. Note the cache holds *candidates* (live or
   * upcoming), not a per-user answer, so flag flips are still reflected on the
   * next request.
   */
  async getCandidateEvents(): Promise<ActiveEvent[]> {
    if (eventCache && eventCache.expiresAt > Date.now()) {
      return eventCache.events;
    }

    try {
      const result = await db.query(
        `SELECT e.*,
                c.currency_key, c.name AS currency_name,
                c.description AS currency_description, c.icon_url AS currency_icon_url
           FROM events e
           LEFT JOIN event_currencies c ON c.id = e.currency_id
          WHERE e.is_active = true
            AND e.ends_at > now()
          ORDER BY e.sort_order ASC, e.starts_at ASC`
      );

      const events: ActiveEvent[] = result.rows.map((row: any) => {
        const currency: EventCurrency | null = row.currency_id
          ? {
              id: row.currency_id,
              currency_key: row.currency_key,
              name: row.currency_name,
              description: row.currency_description,
              icon_url: row.currency_icon_url,
            }
          : null;
        return {
          ...rowToEvent(row),
          // Placeholder; the real reason is decided per user.
          access_reason: "live",
          currency,
        };
      });

      eventCache = { events, expiresAt: Date.now() + EVENT_CACHE_TTL_MS };
      return events;
    } catch (error) {
      logger.error(
        "Failed to load events; treating as no active events",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  },

  /** Drop the cache. Called by admin writes so edits show up immediately. */
  invalidateCache(): void {
    eventCache = null;
  },

  /**
   * The events a specific user can currently see, with the reason recorded.
   *
   * Ordering matters here: the kill switch is checked first so that it can
   * suppress an event that would otherwise be live, and the live-window check
   * comes before the preview flag so a live event never depends on a flag.
   */
  async getEventsForUser(userId: string | null | undefined): Promise<ActiveEvent[]> {
    const candidates = await this.getCandidateEvents();
    if (candidates.length === 0) return [];

    const now = Date.now();
    const visible: ActiveEvent[] = [];

    for (const event of candidates) {
      const startsAt = new Date(event.starts_at).getTime();
      const endsAt = new Date(event.ends_at).getTime();
      const isLive = now >= startsAt && now < endsAt;

      // Kill switch wins over everything.
      if (event.kill_switch_flag_key) {
        const killed = await FeatureFlagService.isEnabled(
          userId,
          event.kill_switch_flag_key
        );
        if (killed) continue;
      }

      if (isLive) {
        visible.push({ ...event, access_reason: "live" });
        continue;
      }

      // Not live yet — only the preview flag can reveal it.
      if (event.preview_feature_flag_key) {
        const preview = await FeatureFlagService.isEnabled(
          userId,
          event.preview_feature_flag_key
        );
        if (preview) visible.push({ ...event, access_reason: "preview" });
      }
    }

    return visible;
  },

  /** The single highest-priority visible event, or null. */
  async getPrimaryEventForUser(
    userId: string | null | undefined
  ): Promise<ActiveEvent | null> {
    const events = await this.getEventsForUser(userId);
    return events[0] ?? null;
  },

  /** Look up one visible event by key. Returns null when not visible. */
  async getEventForUserByKey(
    userId: string | null | undefined,
    eventKey: string
  ): Promise<ActiveEvent | null> {
    const events = await this.getEventsForUser(userId);
    return events.find((e) => e.event_key === eventKey) ?? null;
  },

  /**
   * Resolve an event by id and confirm the user may act on it right now.
   * Used by every write path (shop purchase, claim) so a stale client cannot
   * transact against an event that has ended or been killed.
   */
  async assertEventAccessible(
    userId: string,
    eventId: string
  ): Promise<ActiveEvent | null> {
    const events = await this.getEventsForUser(userId);
    return events.find((e) => e.id === eventId) ?? null;
  },

  // ---- Event currency ledger ----------------------------------------------

  /** A user's balance for one event currency. Missing row reads as 0. */
  async getBalance(
    userId: string,
    currencyId: string,
    executor: QueryExecutor = db
  ): Promise<number> {
    try {
      const result = await executor.query(
        `SELECT balance FROM user_event_currency_balances
          WHERE user_id = $1 AND currency_id = $2`,
        [userId, currencyId]
      );
      return result.rows[0]?.balance ?? 0;
    } catch (error) {
      logger.error(
        "Failed to read event currency balance",
        { userId, currencyId },
        error instanceof Error ? error : new Error(String(error))
      );
      return 0;
    }
  },

  /**
   * Credit event currency. Upserts so the first grant creates the row.
   * Returns the new balance.
   */
  async grantCurrency(
    userId: string,
    currencyId: string,
    amount: number,
    executor: QueryExecutor = db
  ): Promise<number> {
    if (amount <= 0) return this.getBalance(userId, currencyId, executor);

    const result = await executor.query(
      `INSERT INTO user_event_currency_balances
         (user_id, currency_id, balance, lifetime_earned, updated_at)
       VALUES ($1, $2, $3, $3, now())
       ON CONFLICT (user_id, currency_id) DO UPDATE
         SET balance = user_event_currency_balances.balance + EXCLUDED.balance,
             lifetime_earned =
               user_event_currency_balances.lifetime_earned + EXCLUDED.lifetime_earned,
             updated_at = now()
       RETURNING balance`,
      [userId, currencyId, amount]
    );
    return result.rows[0].balance;
  },

  /**
   * Debit event currency, refusing to go negative.
   *
   * The `balance >= $3` predicate in the UPDATE is what makes this safe under
   * concurrent purchases: two simultaneous spends cannot both succeed against
   * the same funds, because the second one matches zero rows. Returns null on
   * insufficient funds so callers can distinguish that from an error.
   */
  async spendCurrency(
    userId: string,
    currencyId: string,
    amount: number,
    executor: QueryExecutor = db
  ): Promise<number | null> {
    if (amount <= 0) return this.getBalance(userId, currencyId, executor);

    const result = await executor.query(
      `UPDATE user_event_currency_balances
          SET balance = balance - $3, updated_at = now()
        WHERE user_id = $1 AND currency_id = $2 AND balance >= $3
        RETURNING balance`,
      [userId, currencyId, amount]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].balance;
  },

  // ---- Client payload ------------------------------------------------------

  /**
   * Shape an event for the client, including the user's currency balance.
   * Purely additive: old clients that don't call this are unaffected, and new
   * fields may only ever be added to this object, never removed or retyped.
   */
  async toSummary(
    userId: string,
    event: ActiveEvent
  ): Promise<EventSummaryResponse> {
    const [wallet, shopCount, milestoneTarget] = await Promise.all([
      event.currency
        ? this.getWallet(userId, event.currency.id)
        : Promise.resolve({ balance: 0, lifetime_earned: 0 }),
      this.countShopOfferings(event.id),
      this.getMilestoneTarget(event.id),
    ]);

    return {
      id: event.id,
      event_key: event.event_key,
      name: event.name,
      description: event.description,
      starts_at: new Date(event.starts_at).toISOString(),
      ends_at: new Date(event.ends_at).toISOString(),
      access_reason: event.access_reason,
      background_image_url: event.background_image_url,
      board_background_image_url: event.board_background_image_url,
      theme_color: event.theme_color,
      icon_url: event.icon_url,
      mechanic_key: event.mechanic_key,
      has_game_mode: event.has_game_mode,
      game_mode_label: event.game_mode_label,
      game_mode_description: event.game_mode_description,
      has_shop: shopCount > 0,
      has_login_sequence: event.login_sequence_id !== null,
      currency: event.currency
        ? {
            ...event.currency,
            balance: wallet.balance,
            lifetime_earned: wallet.lifetime_earned,
          }
        : null,
      milestone_target: milestoneTarget,
      // Surfaced so the client's "how this works" copy can quote live numbers
      // instead of baking them into a shipped build, where a mid-event tuning
      // change would turn the text into a lie.
      currency_drop: {
        chance: event.currency_drop_chance,
        min: event.currency_drop_min,
        max: event.currency_drop_max,
        mode_multipliers: event.currency_drop_mode_multipliers ?? {},
        mechanic_excluded_modes: [
          ...GLOBAL_MECHANIC_EXCLUDED_MODES,
        ],
      },
    };
  },

  /**
   * Balance AND lifetime earned in one read. `lifetime_earned` is what
   * milestone progress measures, so the two always travel together.
   */
  async getWallet(
    userId: string,
    currencyId: string,
    executor: QueryExecutor = db
  ): Promise<{ balance: number; lifetime_earned: number }> {
    try {
      const result = await executor.query(
        `SELECT balance, lifetime_earned FROM user_event_currency_balances
          WHERE user_id = $1 AND currency_id = $2`,
        [userId, currencyId]
      );
      return {
        balance: result.rows[0]?.balance ?? 0,
        lifetime_earned: result.rows[0]?.lifetime_earned ?? 0,
      };
    } catch {
      return { balance: 0, lifetime_earned: 0 };
    }
  },

  /** Highest milestone threshold, so the client can scale a progress bar.
   * Null when the event has no milestones. */
  async getMilestoneTarget(eventId: string): Promise<number | null> {
    try {
      const result = await db.query(
        `SELECT max(threshold) AS target FROM event_milestones WHERE event_id = $1`,
        [eventId]
      );
      return result.rows[0]?.target ?? null;
    } catch {
      return null;
    }
  },

  async countShopOfferings(eventId: string): Promise<number> {
    try {
      const result = await db.query(
        `SELECT count(*)::int AS n FROM event_shop_offerings
          WHERE event_id = $1 AND is_active = true`,
        [eventId]
      );
      return result.rows[0]?.n ?? 0;
    } catch {
      return 0;
    }
  },
};

export default EventService;
