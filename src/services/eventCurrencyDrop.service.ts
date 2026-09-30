// myth-server/src/services/eventCurrencyDrop.service.ts

import EventService from "./event.service";
import db from "../config/db.config";
import logger from "../utils/logger";
import { ActiveEvent } from "../types/event.types";

/**
 * Event Currency Drop Service
 *
 * Awards event currency at the end of a game, for ALL game modes.
 * Configuration lives entirely on the event row, so tuning a live event is a
 * data edit, not a deploy.
 *
 * ## Two rule sets
 *
 * An event that sets `currency_win_amount` pays FIXED amounts per outcome
 * (win/draw/loss/forfeit), plus a once-a-day first-win bonus, bounded by a
 * daily cap on ordinary match drops. That is predictable enough for a player to
 * plan against and bounded enough for a milestone track to be designed around.
 *
 * An event that leaves it at 0 uses the older lottery — `currency_drop_chance`
 * with a `[min, max]` range — which is what every pre-existing event is
 * configured for. Both live here so switching an event between them is a data
 * change, and so the new rules could ship without touching live events.
 *
 * ## Why per-mode multipliers instead of a per-mode column
 *
 * Modes come and go (`solo`, `pvp`, `ranked_draft`, saga, tower...). A jsonb
 * map keyed by mode means adding a mode needs no migration, and an absent key
 * simply means 1.0 — so a new mode automatically inherits the base rate rather
 * than silently dropping to zero.
 *
 * ## Failure behavior
 *
 * Never throws and never blocks game completion. Any failure yields no drop,
 * which is exactly the pre-events behavior.
 */

/** How a finished game ended, from the perspective of the player being paid. */
export type EventGameOutcome = "win" | "draw" | "loss" | "forfeit";

export interface EventCurrencyDropResult {
  event_id: string;
  event_key: string;
  currency_id: string;
  currency_key: string;
  currency_name: string;
  icon_url: string | null;
  /** Total awarded, including any first-win bonus. */
  amount: number;
  /**
   * The portion of `amount` that was today's first-win bonus, so the client can
   * call it out separately. 0 on every other match.
   */
  first_win_bonus?: number;
  /**
   * True when the daily cap stopped this match paying its full rate — including
   * the case where it paid nothing at all. Lets the client explain a 0 or a
   * short drop rather than looking broken.
   */
  daily_cap_reached?: boolean;
  /** The user's balance after the drop. */
  balance: number;
}

/**
 * Today's UTC calendar day as YYYY-MM-DD.
 *
 * UTC to match how the daily shop rotates (`getCurrentShopDate`), so a player's
 * event cap and their shop reset happen at the same moment rather than drifting
 * apart by a timezone.
 */
function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Inclusive integer in [min, max]. */
function rollAmount(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

const EventCurrencyDropService = {
  /**
   * Roll and, on success, credit the drop for one finished game.
   *
   * Returns null when no drop applied — no visible event, no currency
   * configured, a zero chance, or a losing roll. Callers should treat null as
   * "say nothing", and include the result in the completion payload only when
   * present (keeping the response additive for old clients).
   */
  async rollForGame(
    userId: string,
    gameMode: string,
    outcome: EventGameOutcome = "win"
  ): Promise<EventCurrencyDropResult | null> {
    try {
      const events = await EventService.getEventsForUser(userId);
      for (const event of events) {
        const result = await this.rollForEvent(userId, event, gameMode, outcome);
        // First event that pays wins; events are ordered by sort_order, so
        // the "primary" event is the one that drops.
        if (result) return result;
      }
      return null;
    } catch (error) {
      logger.error(
        "Event currency drop failed; no drop awarded",
        { userId, gameMode },
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  },

  async rollForEvent(
    userId: string,
    event: ActiveEvent,
    gameMode: string,
    outcome: EventGameOutcome = "win"
  ): Promise<EventCurrencyDropResult | null> {
    if (!event.currency_id || !event.currency) return null;

    const multiplier = this.modeMultiplier(event, gameMode);
    if (multiplier <= 0) return null;

    // An event that sets a win amount uses the fixed, outcome-based rules; one
    // that does not falls back to the legacy chance/min/max lottery, so events
    // configured before those columns existed are untouched.
    const usesOutcomeRules = (event.currency_win_amount ?? 0) > 0;

    const rolled = usesOutcomeRules
      ? await this.awardByOutcome(userId, event, gameMode, outcome, multiplier)
      : await this.awardByLottery(userId, event, multiplier);

    if (!rolled) return null;

    return {
      event_id: event.id,
      event_key: event.event_key,
      currency_id: event.currency.id,
      currency_key: event.currency.currency_key,
      currency_name: event.currency.name,
      icon_url: event.currency.icon_url,
      ...rolled,
    };
  },

  /**
   * Fixed per-outcome amounts, a once-a-day first-win bonus, and a daily cap on
   * ordinary match drops.
   *
   * The cap and the bonus are tracked in `user_event_currency_daily_drops`,
   * keyed by UTC day so the reset lines up with the daily shop's rotation.
   *
   * The bonus is paid ON TOP of the cap rather than counting against it: it is
   * meant to reward showing up, and a player whose first win of the day happens
   * to land on their 40th Candy should still get it. That is why the real
   * ceiling is cap + bonus.
   */
  async awardByOutcome(
    userId: string,
    event: ActiveEvent,
    gameMode: string,
    outcome: EventGameOutcome,
    multiplier: number
  ): Promise<{
    amount: number;
    first_win_bonus?: number;
    daily_cap_reached?: boolean;
    balance: number;
  } | null> {
    // Guaranteed non-null by rollForEvent, which returns early without it;
    // narrowed here because that check does not carry across the call.
    const currencyId = event.currency_id as string;

    const base =
      outcome === "win"
        ? event.currency_win_amount ?? 0
        : outcome === "draw"
          ? event.currency_draw_amount ?? 0
          : outcome === "loss"
            ? event.currency_loss_amount ?? 0
            : event.currency_forfeit_amount ?? 0;

    // Mode multipliers still apply, so a mode can be worth more per match
    // without needing its own set of amount columns.
    const matchAmount = Math.floor(base * multiplier);
    const cap = event.currency_daily_cap ?? 0;
    const bonusRate = event.currency_first_win_bonus ?? 0;

    const today = utcDateString();

    // One statement decides everything: it clamps the match award to whatever
    // cap headroom is left, pays the first-win bonus only if it is still
    // unpaid, and writes both counters back. Doing it as a single upsert is
    // what stops two games finishing at once from both claiming the bonus or
    // both spending the last of the cap.
    //
    // The CTE captures the row as it was BEFORE the upsert, so the amounts
    // actually credited come out as a plain subtraction rather than being
    // re-derived from the post-update values.
    const { rows } = await db.query(
      `WITH prior AS (
         SELECT match_earned, first_win_bonus
           FROM user_event_currency_daily_drops
          WHERE user_id = $1 AND currency_id = $2 AND drop_date = $3::date
       ), upserted AS (
         INSERT INTO user_event_currency_daily_drops
           (user_id, currency_id, drop_date, match_earned, first_win_bonus)
         VALUES ($1, $2, $3::date,
                 LEAST($4::int, CASE WHEN $5::int = 0 THEN $4::int ELSE $5::int END),
                 $6::int)
         ON CONFLICT (user_id, currency_id, drop_date) DO UPDATE
           SET match_earned = user_event_currency_daily_drops.match_earned
                            + LEAST(
                                $4::int,
                                CASE WHEN $5::int = 0 THEN $4::int
                                     ELSE GREATEST(
                                       0,
                                       $5::int - user_event_currency_daily_drops.match_earned
                                     )
                                END
                              ),
               first_win_bonus = user_event_currency_daily_drops.first_win_bonus
                               + CASE
                                   WHEN user_event_currency_daily_drops.first_win_bonus = 0
                                   THEN $6::int ELSE 0
                                 END,
               updated_at = now()
         RETURNING match_earned, first_win_bonus
       )
       SELECT u.match_earned - COALESCE(p.match_earned, 0) AS awarded_match,
              u.first_win_bonus - COALESCE(p.first_win_bonus, 0) AS awarded_bonus
         FROM upserted u
         LEFT JOIN prior p ON true`,
      [
        userId,
        currencyId,
        today,
        matchAmount,
        cap,
        outcome === "win" ? bonusRate : 0,
      ]
    );

    if (rows.length === 0) return null;

    const awardedMatch = Number(rows[0].awarded_match);
    const awardedBonus = Number(rows[0].awarded_bonus);
    const total = awardedMatch + awardedBonus;
    const capReached = cap > 0 && awardedMatch < matchAmount;

    if (total <= 0) {
      // Nothing to credit, but still report the cap so the client can say why
      // this match paid nothing rather than appearing to have dropped it.
      if (!capReached) return null;
      const balance = await EventService.getBalance(userId, currencyId);
      return { amount: 0, daily_cap_reached: true, balance };
    }

    const balance = await EventService.grantCurrency(
      userId,
      currencyId,
      total
    );

    return {
      amount: total,
      ...(awardedBonus > 0 ? { first_win_bonus: awardedBonus } : {}),
      ...(capReached ? { daily_cap_reached: true } : {}),
      balance,
    };
  },

  /** The pre-existing chance/min/max lottery, unchanged. */
  async awardByLottery(
    userId: string,
    event: ActiveEvent,
    multiplier: number
  ): Promise<{ amount: number; balance: number } | null> {
    if (event.currency_drop_chance <= 0) return null;
    if (event.currency_drop_max <= 0) return null;

    const chance = Math.min(1, event.currency_drop_chance * multiplier);
    if (Math.random() >= chance) return null;

    const amount = rollAmount(event.currency_drop_min, event.currency_drop_max);
    if (amount <= 0) return null;

    const balance = await EventService.grantCurrency(
      userId,
      event.currency_id as string,
      amount
    );
    return { amount, balance };
  },

  /** Absent mode key means 1.0 — a new game mode inherits the base rate. */
  modeMultiplier(event: ActiveEvent, gameMode: string): number {
    const raw = event.currency_drop_mode_multipliers?.[gameMode];
    if (raw === undefined || raw === null) return 1;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : 1;
  },
};

export default EventCurrencyDropService;
