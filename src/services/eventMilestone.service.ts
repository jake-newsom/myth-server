// myth-server/src/services/eventMilestone.service.ts

import db, { QueryExecutor } from "../config/db.config";
import EventService from "./event.service";
import RewardService from "./reward.service";
import logger from "../utils/logger";
import { cosmeticBack, cosmeticBorder } from "../utils/eventCosmetics";
import { RewardItem } from "../types/service.types";
import { EventMilestone, EventMilestoneView } from "../types/event.types";

/**
 * Event Milestone Service
 *
 * Rewards for TOTAL event currency earned, tracked against `lifetime_earned`
 * so spending in the event shop never costs a player milestone progress.
 *
 * Milestones are claimed explicitly rather than auto-granted: the client shows
 * a progress bar with claimable rungs, and the player taps to collect. That
 * keeps the reward moment visible (and lets the client animate it) instead of
 * silently depositing items mid-match.
 */

function rowToMilestone(row: any): EventMilestone {
  return {
    id: row.id,
    event_id: row.event_id,
    threshold: row.threshold,
    name: row.name,
    description: row.description,
    reward_gold: row.reward_gold,
    reward_gems: row.reward_gems,
    reward_fate_coins: row.reward_fate_coins,
    reward_card_fragments: row.reward_card_fragments,
    reward_packs: row.reward_packs,
    reward_embers: row.reward_embers,
    reward_card_variant_id: row.reward_card_variant_id,
    reward_border_id: row.reward_border_id,
    reward_card_back_id: row.reward_card_back_id,
    reward_pack_id: row.reward_pack_id ?? null,
    reward_pack_quantity: Number(row.reward_pack_quantity ?? 0),
    sort_order: row.sort_order,
  };
}

/** Map a milestone's reward columns onto the shared RewardItem vocabulary. */
function milestoneToRewardItems(milestone: EventMilestone): RewardItem[] {
  const items: RewardItem[] = [];
  if (milestone.reward_gems > 0) items.push({ type: "gems", amount: milestone.reward_gems });
  if (milestone.reward_gold > 0) items.push({ type: "gold", amount: milestone.reward_gold });
  if (milestone.reward_fate_coins > 0)
    items.push({ type: "fate_coins", amount: milestone.reward_fate_coins });
  if (milestone.reward_card_fragments > 0)
    items.push({ type: "card_fragments", amount: milestone.reward_card_fragments });
  if (milestone.reward_packs > 0) items.push({ type: "packs", amount: milestone.reward_packs });
  if (milestone.reward_embers > 0) items.push({ type: "embers", amount: milestone.reward_embers });
  if (milestone.reward_card_variant_id)
    items.push({ type: "card", card_variant_id: milestone.reward_card_variant_id });
  if (milestone.reward_border_id)
    items.push({ type: "border", border_id: milestone.reward_border_id });
  if (milestone.reward_card_back_id)
    items.push({ type: "card_back", back_id: milestone.reward_card_back_id });
  if (milestone.reward_pack_id && milestone.reward_pack_quantity > 0)
    items.push({
      type: "event_pack",
      pack_id: milestone.reward_pack_id,
      amount: milestone.reward_pack_quantity,
    });
  return items;
}

const EventMilestoneService = {
  /**
   * The event's milestone ladder with this user's progress folded in.
   * Returns [] for an event with no milestones configured.
   */
  async getMilestones(
    userId: string,
    eventId: string
  ): Promise<{ milestones: EventMilestoneView[]; lifetime_earned: number }> {
    try {
      const [rows, earned] = await Promise.all([
        db.query(
          `SELECT m.*, (c.user_id IS NOT NULL) AS claimed,
                  cv.card_variant_id AS card_card_id, ch.name AS card_name,
                  cv.rarity AS card_rarity, cv.image_url AS card_image_url,
                  ch.tags AS card_tags, ch.set_id AS card_set_id,
                  ch.description AS card_description,
                  ch.base_power->>'top' AS card_power_top,
                  ch.base_power->>'right' AS card_power_right,
                  ch.base_power->>'bottom' AS card_power_bottom,
                  ch.base_power->>'left' AS card_power_left,
                  ch.special_ability_id AS card_special_ability_id,
                  COALESCE(cv.sound_effect, ch.sound_effect) AS card_sound_effect,
                  sa.name AS ability_name, sa.description AS ability_description,
                  sa.trigger_moments AS ability_trigger_moments,
                  sa.parameters AS ability_parameters,
                  sa.sound_effect AS ability_sound_effect,
                  bd.name AS border_name, bd.image_url AS border_image_url,
                  bd.animation_key AS border_animation_key,
                  cb.name AS back_name, cb.image_url AS back_image_url
             FROM event_milestones m
             LEFT JOIN user_event_milestone_claims c
                    ON c.milestone_id = m.id AND c.user_id = $1
             -- Same card join as eventShop.service's getShop, and deliberately
             -- without the daily shop's is_exclusive / 'legendary+++' filters:
             -- event cards are exclusive by construction, so those predicates
             -- would silently blank every card rung.
             LEFT JOIN card_variants cv
                    ON cv.card_variant_id = m.reward_card_variant_id
             LEFT JOIN characters ch ON ch.character_id = cv.character_id
             LEFT JOIN special_abilities sa ON sa.ability_id = ch.special_ability_id
             LEFT JOIN card_borders bd ON bd.border_id = m.reward_border_id
             LEFT JOIN card_backs cb ON cb.back_id = m.reward_card_back_id
            WHERE m.event_id = $2
            ORDER BY m.threshold ASC`,
          [userId, eventId]
        ),
        this.getLifetimeEarned(userId, eventId),
      ]);

      const milestones = rows.rows.map((row: any) => {
        const milestone = rowToMilestone(row);
        return {
          ...milestone,
          claimed: row.claimed,
          unlocked: earned >= milestone.threshold,
          can_claim: earned >= milestone.threshold && !row.claimed,
          // Additive: present only on card rungs, ignorable by older clients.
          card: row.card_name
            ? {
                card_id: row.card_card_id,
                base_card_id: row.card_card_id,
                name: row.card_name,
                description: row.card_description ?? null,
                rarity: row.card_rarity,
                image_url: row.card_image_url,
                tags: row.card_tags || [],
                set_id: row.card_set_id,
                base_power: {
                  top: parseInt(row.card_power_top) || 0,
                  right: parseInt(row.card_power_right) || 0,
                  bottom: parseInt(row.card_power_bottom) || 0,
                  left: parseInt(row.card_power_left) || 0,
                },
                special_ability: row.ability_name
                  ? {
                      ability_id: row.card_special_ability_id,
                      name: row.ability_name,
                      description: row.ability_description,
                      trigger_moments: row.ability_trigger_moments || [],
                      parameters: row.ability_parameters,
                      ...(row.ability_sound_effect && {
                        sound_effect: row.ability_sound_effect,
                      }),
                    }
                  : null,
                ...(row.card_sound_effect && {
                  sound_effect: row.card_sound_effect,
                }),
              }
            : undefined,
          // Additive, like `card`: present only on cosmetic rungs.
          border: cosmeticBorder(row, milestone.reward_border_id),
          card_back: cosmeticBack(row, milestone.reward_card_back_id),
        };
      });

      return { milestones, lifetime_earned: earned };
    } catch (error) {
      logger.error(
        "Failed to load event milestones",
        { userId, eventId },
        error instanceof Error ? error : new Error(String(error))
      );
      return { milestones: [], lifetime_earned: 0 };
    }
  },

  /**
   * Total currency this user has earned for the event's currency.
   *
   * Reads through the event so the caller doesn't need the currency id, and
   * returns 0 for an event with no currency (which simply has no milestones).
   */
  async getLifetimeEarned(
    userId: string,
    eventId: string,
    executor: QueryExecutor = db
  ): Promise<number> {
    const result = await executor.query(
      `SELECT b.lifetime_earned
         FROM events e
         JOIN user_event_currency_balances b
           ON b.currency_id = e.currency_id AND b.user_id = $1
        WHERE e.id = $2`,
      [userId, eventId]
    );
    return result.rows[0]?.lifetime_earned ?? 0;
  },

  /**
   * Claim every unlocked-but-unclaimed milestone at once.
   *
   * Claiming in a batch (rather than one call per rung) means a player who
   * returns after a long session collects everything in one receipt. The
   * INSERT ... ON CONFLICT DO NOTHING on the claims table is the idempotency
   * guard: a concurrent duplicate claim inserts zero rows and grants nothing.
   */
  async claimAvailable(
    userId: string,
    eventId: string
  ): Promise<{
    success: boolean;
    claimed: EventMilestone[];
    items: RewardItem[];
    error?: string;
  }> {
    const event = await EventService.assertEventAccessible(userId, eventId);
    if (!event) {
      return { success: false, claimed: [], items: [], error: "Event is not available" };
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // MUST run on the transaction's client, not the pool: checking out a
      // second connection while this one holds an open transaction deadlocks
      // as soon as the pool is saturated.
      const earned = await this.getLifetimeEarned(userId, eventId, client);

      // Lock the candidate rows so two concurrent claims serialize.
      const result = await client.query(
        `SELECT m.* FROM event_milestones m
          WHERE m.event_id = $1
            AND m.threshold <= $2
            AND NOT EXISTS (
              SELECT 1 FROM user_event_milestone_claims c
               WHERE c.milestone_id = m.id AND c.user_id = $3
            )
          ORDER BY m.threshold ASC
          FOR UPDATE OF m`,
        [eventId, earned, userId]
      );

      const pending = result.rows.map(rowToMilestone);
      if (pending.length === 0) {
        await client.query("ROLLBACK");
        return { success: false, claimed: [], items: [], error: "Nothing to claim" };
      }

      // Record the claims first. ON CONFLICT DO NOTHING means a rung already
      // claimed by a racing request is dropped here, and only the rows we
      // actually inserted are rewarded below.
      const inserted = await client.query(
        `INSERT INTO user_event_milestone_claims (user_id, milestone_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT DO NOTHING
         RETURNING milestone_id`,
        [userId, pending.map((m) => m.id)]
      );

      const claimedIds = new Set(inserted.rows.map((r: any) => r.milestone_id));
      const claimed = pending.filter((m) => claimedIds.has(m.id));

      if (claimed.length === 0) {
        await client.query("ROLLBACK");
        return { success: false, claimed: [], items: [], error: "Nothing to claim" };
      }

      const items = claimed.flatMap(milestoneToRewardItems);
      if (items.length > 0) {
        await RewardService.grantRewards(userId, items, { client });
      }

      await client.query("COMMIT");
      return { success: true, claimed, items };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(
        "Event milestone claim failed",
        { userId, eventId },
        error instanceof Error ? error : new Error(String(error))
      );
      return { success: false, claimed: [], items: [], error: "Claim failed" };
    } finally {
      client.release();
    }
  },
};

export default EventMilestoneService;
