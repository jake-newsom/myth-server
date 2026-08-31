import db, { QueryExecutor } from "../config/db.config";
import { FORGE_CONFIG } from "../config/constants";
import { PowerValues } from "../types";
import logger from "../utils/logger";

/**
 * Per-instance edge-power offsets rolled by the Forge's reforge.
 *
 * Signed deltas against a variant's catalogue `base_power`. Kept apart from
 * `user_card_power_ups` on purpose — that table counts level-ups, derives that
 * count by summing its four values, and forbids negatives; see the migration
 * note on `user_card_stat_rolls` for why merging the two corrupts level-up
 * validation in both directions.
 *
 * Consumers do NOT add these themselves: the card model folds them into
 * `base_power` before a card leaves the API, so every existing summation site
 * (server engine, client mirror, GameCard) stays correct untouched.
 */

const ZERO: PowerValues = { top: 0, right: 0, bottom: 0, left: 0 };

export const EDGES = ["top", "right", "bottom", "left"] as const;
export type Edge = (typeof EDGES)[number];

const StatRollService = {
  /**
   * Roll one edge from FORGE_CONFIG.REFORGE.DISTRIBUTION.
   *
   * Weighted pick over the table rather than a shaped random: the design owns
   * the curve as explicit percentages, and reading it straight off the table
   * means changing the odds is a config edit with no maths to re-derive.
   */
  rollOffset(): number {
    const table = FORGE_CONFIG.REFORGE.DISTRIBUTION;
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    let ticket = Math.random() * total;

    for (const entry of table) {
      ticket -= entry.weight;
      if (ticket < 0) return entry.offset;
    }

    // Only reachable through floating-point drift on the final subtraction.
    return table[table.length - 1].offset;
  },

  /**
   * Roll a full set of offsets against a card's catalogue power.
   *
   * `basePower` is needed because the floor is on the RESULT, not the offset:
   * a 1-power edge cannot roll -2 down to -1, since the combat maths is not
   * written for negative edges. Clamping here means the value written to the
   * database is already legal and the client never has to reproduce the rule.
   *
   * Locked edges keep their current offset untouched — that is what the
   * player paid the higher price to hold.
   */
  roll(
    basePower: PowerValues,
    locks: Record<Edge, boolean>,
    current: PowerValues = ZERO
  ): PowerValues {
    const { MIN_RESULTING_POWER, MIN_OFFSET, MAX_OFFSET } =
      FORGE_CONFIG.REFORGE;
    const result: PowerValues = { ...ZERO };

    for (const edge of EDGES) {
      if (locks[edge]) {
        result[edge] = current[edge];
        continue;
      }

      const offset = this.rollOffset();
      const base = basePower[edge] ?? 0;
      // Floor the RESULT, then re-derive the offset that produced it, so the
      // stored delta and the power a player sees can never disagree.
      const floored = Math.max(base + offset, MIN_RESULTING_POWER);
      result[edge] = Math.min(
        Math.max(floored - base, MIN_OFFSET),
        MAX_OFFSET
      );
    }

    return result;
  },

  /** Cost of the next reroll given how many edges are held. */
  costForLocks(lockCount: number): number {
    const table = FORGE_CONFIG.REFORGE.COST_BY_LOCKS;
    const index = Math.min(Math.max(lockCount, 0), table.length - 1);
    return table[index];
  },

  /** Persist a roll for a freshly minted instance. */
  async create(
    userCardInstanceId: string,
    roll: PowerValues,
    client?: QueryExecutor
  ): Promise<void> {
    const exec = client ?? db;
    await exec.query(
      // `right`/`left` are Postgres reserved words; quoted throughout.
      `INSERT INTO "user_card_stat_rolls"
         (user_card_instance_id, "top", "right", "bottom", "left")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_card_instance_id) DO NOTHING`,
      [userCardInstanceId, roll.top, roll.right, roll.bottom, roll.left]
    );
  },

  /**
   * Rolls for many instances at once, as a map.
   *
   * Batched for the same reason the power-up lookup is: these are called from
   * collection and deck listings, and a per-card query there is an N+1 on the
   * hottest read paths in the app. Instances with no row are simply absent —
   * callers treat missing as all-zero.
   */
  async getByCardInstances(
    userCardInstanceIds: string[]
  ): Promise<Map<string, PowerValues>> {
    const map = new Map<string, PowerValues>();
    if (userCardInstanceIds.length === 0) return map;

    try {
      const { rows } = await db.query(
        `SELECT user_card_instance_id, "top", "right", "bottom", "left"
         FROM "user_card_stat_rolls"
         WHERE user_card_instance_id = ANY($1::uuid[])`,
        [userCardInstanceIds]
      );

      rows.forEach((row) => {
        map.set(row.user_card_instance_id, {
          top: row.top,
          right: row.right,
          bottom: row.bottom,
          left: row.left,
        });
      });
    } catch (error) {
      // A failed lookup degrades to catalogue stats rather than failing the
      // whole listing: a card shown at its base power is wrong but harmless,
      // an unopenable collection is not.
      logger.error(
        "Error fetching card stat rolls",
        { instanceCount: userCardInstanceIds.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }

    return map;
  },

  /** The roll for a single instance, or null when it was never reforged. */
  async getByCardInstance(
    userCardInstanceId: string
  ): Promise<PowerValues | null> {
    const map = await this.getByCardInstances([userCardInstanceId]);
    return map.get(userCardInstanceId) ?? null;
  },

  /**
   * Fold a roll into a card's catalogue power.
   *
   * The single place the sum happens, so the floor is applied identically
   * everywhere a card is hydrated.
   */
  applyToBasePower(
    basePower: PowerValues,
    roll: PowerValues | undefined | null
  ): PowerValues {
    if (!roll) return basePower;
    const { MIN_RESULTING_POWER } = FORGE_CONFIG.REFORGE;

    return {
      top: Math.max(basePower.top + roll.top, MIN_RESULTING_POWER),
      right: Math.max(basePower.right + roll.right, MIN_RESULTING_POWER),
      bottom: Math.max(basePower.bottom + roll.bottom, MIN_RESULTING_POWER),
      left: Math.max(basePower.left + roll.left, MIN_RESULTING_POWER),
    };
  },
};

export default StatRollService;
