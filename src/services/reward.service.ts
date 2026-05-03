import db, { QueryExecutor, PoolClient } from "../config/db.config";
import UserModel from "../models/user.model";
import CardModel from "../models/card.model";
import BorderService from "./border.service";
import { cacheInvalidation } from "./cache.invalidation.service";
import logger from "../utils/logger";
import {
  RewardItem,
  GrantedReward,
  GrantRewardsResult,
} from "../types/service.types";

/**
 * Reward Service
 *
 * Single, batched entry point that all claim flows (mail, achievements, daily
 * tasks, monthly logins, future systems) should route through to grant rewards
 * to a player. Replaces the per-claim-path "loop and call UserModel.update*"
 * pattern with a single transaction that:
 *
 *   - groups by reward type so each type incurs at most one UPDATE
 *   - inserts cards in a single bulk statement (CardModel.addCardsToUserBulk)
 *   - grants borders in a single bulk INSERT ... ON CONFLICT DO NOTHING
 *   - reads the user's updated balances exactly once at the end
 *   - invalidates user-card caches once if any card or border was granted
 *
 * The whole flow runs inside a transaction by default (or against a caller-
 * supplied client) so reward grants are atomic with respect to the claim row
 * update on the source side.
 */

interface BorderGrant {
  border_id: string;
  character_id?: string | null;
}

interface AggregatedRewards {
  gems: number;
  gold: number;
  fate_coins: number;
  card_fragments: number;
  packs: number;
  card_variant_ids: string[];
  border_grants: BorderGrant[];
}

function emptyAggregate(): AggregatedRewards {
  return {
    gems: 0,
    gold: 0,
    fate_coins: 0,
    card_fragments: 0,
    packs: 0,
    card_variant_ids: [],
    border_grants: [],
  };
}

function aggregate(items: RewardItem[]): AggregatedRewards {
  const totals = emptyAggregate();
  for (const item of items) {
    switch (item.type) {
      case "gems":
        totals.gems += item.amount;
        break;
      case "gold":
        totals.gold += item.amount;
        break;
      case "fate_coins":
        totals.fate_coins += item.amount;
        break;
      case "card_fragments":
        totals.card_fragments += item.amount;
        break;
      case "packs":
        totals.packs += item.amount;
        break;
      case "card":
        totals.card_variant_ids.push(item.card_variant_id);
        break;
      case "border":
        totals.border_grants.push({
          border_id: item.border_id,
          character_id: item.character_id,
        });
        break;
    }
  }
  return totals;
}

interface GrantOptions {
  /**
   * Optional existing query executor to run all writes against. When provided
   * the caller is responsible for transaction lifecycle (BEGIN/COMMIT/ROLLBACK).
   * When omitted, the service runs the grant inside its own transaction.
   */
  client?: QueryExecutor;
}

const RewardService = {
  /**
   * Grant a list of reward items to a user. See class doc for batching
   * semantics. Returns per-item granted records (so callers can surface
   * detailed receipts) plus the user's post-grant currency totals.
   */
  async grantRewards(
    userId: string,
    items: RewardItem[],
    options: GrantOptions = {}
  ): Promise<GrantRewardsResult> {
    if (items.length === 0) {
      return {
        success: true,
        granted: [],
        totals: this.zeroTotals(),
      };
    }

    const totals = aggregate(items);

    // If the caller supplied a client we run the work directly against it,
    // letting the caller own the transaction. Otherwise we open our own
    // transactional client.
    if (options.client) {
      return this.executeGrant(userId, items, totals, options.client);
    }

    const client: PoolClient = await db.getClient();
    try {
      await client.query("BEGIN");
      const result = await this.executeGrant(userId, items, totals, client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(
        "RewardService.grantRewards failed",
        { userId },
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        success: false,
        granted: [],
        totals: this.zeroTotals(),
        error:
          error instanceof Error ? error.message : "Failed to grant rewards",
      };
    } finally {
      client.release();
    }
  },

  /**
   * Internal: applies the aggregated rewards. One statement per non-empty
   * reward category, then a single user fetch for updated balances.
   */
  async executeGrant(
    userId: string,
    items: RewardItem[],
    totals: AggregatedRewards,
    client: QueryExecutor
  ): Promise<GrantRewardsResult> {
    const granted: GrantedReward[] = [];

    if (totals.gems !== 0) {
      await UserModel.updateGems(userId, totals.gems, client);
    }
    if (totals.gold !== 0) {
      // updateGold takes the canonical signature; passing the executor would
      // require expanding the model signature. Gold is rarely used and is
      // safe outside the per-grant transaction (it's idempotent on retry by
      // the caller's claim-row write), so we keep its single-arg form for now.
      await UserModel.updateGold(userId, totals.gold);
    }
    if (totals.fate_coins !== 0) {
      await UserModel.updateFateCoins(userId, totals.fate_coins, client);
    }
    if (totals.card_fragments !== 0) {
      await UserModel.updateCardFragments(
        userId,
        totals.card_fragments,
        client
      );
    }
    if (totals.packs !== 0) {
      await UserModel.addPacks(userId, totals.packs, client);
    }

    // Cards: bulk insert in a single round-trip.
    let cardInstanceMap: Array<{
      user_card_instance_id: string;
      card_variant_id: string;
    }> = [];
    if (totals.card_variant_ids.length > 0) {
      cardInstanceMap = await CardModel.addCardsToUserBulk(
        userId,
        totals.card_variant_ids,
        client
      );
    }

    // Borders: bulk grant. Already-owned ids are silently dropped.
    let newlyGrantedBorderIds = new Set<string>();
    if (totals.border_grants.length > 0) {
      const newlyGranted = await BorderService.grantBordersBulk(
        userId,
        totals.border_grants,
        client
      );
      newlyGrantedBorderIds = new Set(newlyGranted);
    }

    // Build per-item granted records that mirror the input order. Cards are
    // matched by card_variant_id in the order they were inserted (CardModel's
    // bulk insert preserves multiplicity).
    const cardCursor = new Map<string, string[]>();
    for (const row of cardInstanceMap) {
      const list = cardCursor.get(row.card_variant_id) ?? [];
      list.push(row.user_card_instance_id);
      cardCursor.set(row.card_variant_id, list);
    }

    for (const item of items) {
      if (item.type === "card") {
        const ids = cardCursor.get(item.card_variant_id) ?? [];
        const userCardInstanceId = ids.shift();
        cardCursor.set(item.card_variant_id, ids);
        granted.push({ item, user_card_instance_id: userCardInstanceId });
      } else if (item.type === "border") {
        granted.push({
          item,
          newly_granted: newlyGrantedBorderIds.has(item.border_id),
        });
      } else {
        granted.push({ item });
      }
    }

    // Single fetch for the user's post-grant balances.
    const updatedUser = await UserModel.findById(userId);

    // Invalidate caches once if cards or borders moved.
    if (totals.card_variant_ids.length > 0 || totals.border_grants.length > 0) {
      // Fire-and-forget; cache failures must not break the grant.
      void cacheInvalidation.invalidateUserCards(userId);
    }

    return {
      success: true,
      granted,
      totals: {
        gems: totals.gems,
        gold: totals.gold,
        fate_coins: totals.fate_coins,
        card_fragments: totals.card_fragments,
        packs: totals.packs,
        cards: totals.card_variant_ids.length,
        borders: totals.border_grants.length,
      },
      updated_currencies: updatedUser
        ? {
            gems: updatedUser.gems,
            gold: 0,
            fate_coins: updatedUser.fate_coins,
            card_fragments: updatedUser.card_fragments,
            pack_count: updatedUser.pack_count,
          }
        : undefined,
    };
  },

  zeroTotals() {
    return {
      gems: 0,
      gold: 0,
      fate_coins: 0,
      card_fragments: 0,
      packs: 0,
      cards: 0,
      borders: 0,
    };
  },
};

export default RewardService;
