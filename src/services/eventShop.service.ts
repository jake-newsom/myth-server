// myth-server/src/services/eventShop.service.ts

import db from "../config/db.config";
import { cosmeticBack, cosmeticBorder } from "../utils/eventCosmetics";
import EventService from "./event.service";
import RewardService from "./reward.service";
import UserModel from "../models/user.model";
import logger from "../utils/logger";
import { RewardItem } from "../types/service.types";
import {
  EventShopOffering,
  EventShopOfferingView,
  EventShopPriceCurrency,
} from "../types/event.types";

/**
 * Event Shop Service
 *
 * A per-event storefront whose lifecycle is the event window rather than the
 * daily shop's date rotation, and whose prices are normally denominated in the
 * event's own currency.
 *
 * This is deliberately separate from `dailyShop.service`: folding events into
 * the daily shop would have meant widening the shipped `currency_type` enum and
 * changing live rotation logic — a change to behavior real users depend on
 * today. A separate table and service keeps the whole feature additive and
 * independently revertible.
 */

/** Standard-currency column names on `users`, keyed by price currency. */
const CURRENCY_COLUMNS: Record<
  Exclude<EventShopPriceCurrency, "event">,
  string
> = {
  gems: "gems",
  gold: "gold",
  fate_coins: "fate_coins",
  card_fragments: "card_fragments",
  embers: "embers",
};

function offeringToRewardItems(offering: EventShopOffering): RewardItem[] {
  const amount = offering.grant_amount;
  switch (offering.item_type) {
    case "card":
      // One RewardItem per copy: RewardService keys card grants by variant id.
      return offering.grant_card_variant_id
        ? Array.from({ length: amount }, () => ({
            type: "card" as const,
            card_variant_id: offering.grant_card_variant_id as string,
          }))
        : [];
    case "border":
      return offering.grant_border_id
        ? [{ type: "border", border_id: offering.grant_border_id }]
        : [];
    case "card_back":
      return offering.grant_card_back_id
        ? [{ type: "card_back", back_id: offering.grant_card_back_id }]
        : [];
    case "title":
      return offering.grant_title_id
        ? [{ type: "title", title_id: offering.grant_title_id }]
        : [];
    case "avatar_frame":
      return offering.grant_frame_id
        ? [{ type: "avatar_frame", frame_id: offering.grant_frame_id }]
        : [];
    case "pack":
      return [{ type: "packs", amount }];
    case "event_pack":
      return offering.grant_pack_id
        ? [
            {
              type: "event_pack" as const,
              pack_id: offering.grant_pack_id,
              amount,
            },
          ]
        : [];
    case "gems":
      return [{ type: "gems", amount }];
    case "gold":
      return [{ type: "gold", amount }];
    case "fate_coins":
      return [{ type: "fate_coins", amount }];
    case "card_fragments":
      return [{ type: "card_fragments", amount }];
    case "embers":
      return [{ type: "embers", amount }];
    default:
      return [];
  }
}

const EventShopService = {
  /**
   * The event's storefront as the user sees it, with their purchase counts
   * folded in so the client can grey out sold-out slots.
   */
  async getShop(userId: string, eventId: string): Promise<EventShopOfferingView[]> {
    const result = await db.query(
      `SELECT o.*,
              COALESCE(p.purchased, 0)::int AS purchased_count,
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
         FROM event_shop_offerings o
         LEFT JOIN (
              SELECT offering_id, SUM(quantity) AS purchased
                FROM event_shop_purchases
               WHERE user_id = $1
               GROUP BY offering_id
         ) p ON p.offering_id = o.id
         -- Card join mirrors dailyShop.model's getTodaysOfferings so both
         -- shops hand the client the same card shape.
         --
         -- Deliberately WITHOUT that query's is_exclusive / 'legendary+++'
         -- filters: event cards are exclusive BY CONSTRUCTION, so copying
         -- those predicates would drop every card slot from the payload —
         -- silently, since these are LEFT JOINs. Visibility here is already
         -- decided by the offering row's own is_active.
         LEFT JOIN card_variants cv ON cv.card_variant_id = o.grant_card_variant_id
         LEFT JOIN characters ch ON ch.character_id = cv.character_id
         LEFT JOIN special_abilities sa ON sa.ability_id = ch.special_ability_id
         -- Cosmetic art, so border / card back tiles can show the real thing.
         LEFT JOIN card_borders bd ON bd.border_id = o.grant_border_id
         LEFT JOIN card_backs cb ON cb.back_id = o.grant_card_back_id
        WHERE o.event_id = $2 AND o.is_active = true
        ORDER BY o.sort_order ASC, o.slot_number ASC`,
      [userId, eventId]
    );

    return result.rows.map((row: any) => ({
      ...row,
      purchased_count: row.purchased_count,
      sold_out:
        row.purchase_limit !== null && row.purchased_count >= row.purchase_limit,
      // Additive: absent for every non-card slot, and ignorable by any client
      // that does not know the field.
      card: row.card_name
        ? {
            card_id: row.card_card_id,
            // Clients key card rendering and ownership off base_card_id.
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
      // Additive, like `card`: present only on cosmetic slots.
      border: cosmeticBorder(row, row.grant_border_id),
      card_back: cosmeticBack(row, row.grant_card_back_id),
    }));
  },

  /**
   * Buy one offering.
   *
   * Runs the whole thing in a single transaction: verify access, re-check the
   * per-user limit under a lock, debit, then grant. The limit re-check happens
   * inside the transaction (not from the read above) so two concurrent buys
   * cannot both pass a limit of 1.
   */
  async purchase(
    userId: string,
    eventId: string,
    offeringId: string,
    quantity = 1
  ): Promise<{
    success: boolean;
    items?: RewardItem[];
    error?: string;
  }> {
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { success: false, error: "Invalid quantity" };
    }

    const event = await EventService.assertEventAccessible(userId, eventId);
    if (!event) {
      return { success: false, error: "Event is not available" };
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      const offeringResult = await client.query(
        `SELECT * FROM event_shop_offerings
          WHERE id = $1 AND event_id = $2 AND is_active = true
          FOR UPDATE`,
        [offeringId, eventId]
      );
      const offering: EventShopOffering | undefined = offeringResult.rows[0];
      if (!offering) {
        await client.query("ROLLBACK");
        return { success: false, error: "Offering not found" };
      }

      // Per-user purchase limit, re-read inside the transaction.
      if (offering.purchase_limit !== null) {
        const countResult = await client.query(
          `SELECT COALESCE(SUM(quantity), 0)::int AS purchased
             FROM event_shop_purchases
            WHERE user_id = $1 AND offering_id = $2`,
          [userId, offeringId]
        );
        const purchased = countResult.rows[0].purchased;
        if (purchased + quantity > offering.purchase_limit) {
          await client.query("ROLLBACK");
          return { success: false, error: "Purchase limit reached" };
        }
      }

      const totalPrice = offering.price * quantity;

      // ---- Debit -----------------------------------------------------------
      if (offering.price_currency === "event") {
        if (!event.currency_id) {
          await client.query("ROLLBACK");
          return { success: false, error: "Event has no currency configured" };
        }
        const remaining = await EventService.spendCurrency(
          userId,
          event.currency_id,
          totalPrice,
          client
        );
        if (remaining === null) {
          await client.query("ROLLBACK");
          return { success: false, error: "Insufficient event currency" };
        }
      } else {
        const column = CURRENCY_COLUMNS[offering.price_currency];
        // Same guarded-UPDATE pattern as the event ledger: the balance
        // predicate makes concurrent spends mutually exclusive.
        const debit = await client.query(
          `UPDATE users SET ${column} = ${column} - $2
            WHERE user_id = $1 AND ${column} >= $2
            RETURNING ${column}`,
          [userId, totalPrice]
        );
        if (debit.rows.length === 0) {
          await client.query("ROLLBACK");
          return { success: false, error: "Insufficient funds" };
        }
      }

      // ---- Grant -----------------------------------------------------------
      const items: RewardItem[] = [];
      for (let i = 0; i < quantity; i++) {
        items.push(...offeringToRewardItems(offering));
      }
      if (items.length > 0) {
        await RewardService.grantRewards(userId, items, { client });
      }

      await client.query(
        `INSERT INTO event_shop_purchases
           (user_id, offering_id, quantity, price_paid, price_currency)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, offeringId, quantity, totalPrice, offering.price_currency]
      );

      await client.query("COMMIT");
      return { success: true, items };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(
        "Event shop purchase failed",
        { userId, eventId, offeringId },
        error instanceof Error ? error : new Error(String(error))
      );
      return { success: false, error: "Purchase failed" };
    } finally {
      client.release();
    }
  },
};

export default EventShopService;
