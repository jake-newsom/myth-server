import db from "../config/db.config";
import CardModel from "../models/card.model";
import UserModel from "../models/user.model";
import FeatureFlagService from "./featureFlag.service";
import StatRollService, { EDGES, Edge } from "./statRoll.service";
import { cacheInvalidation } from "./cache.invalidation.service";
import { FORGE_CONFIG, SHOP_CONFIG } from "../config/constants";
import { PowerValues } from "../types";
import { logger } from "../utils/logger";

/**
 * The Forge: pay card fragments to craft a card to spec.
 *
 * Two axes of specificity, priced independently (see FORGE_CONFIG):
 *   - WHICH card: a random one of a tier, or one named character in that tier.
 *   - WHICH artwork: the base art, or a `+` / `++` / `+++` upgrade.
 *
 * The Forge tab is part of the shop overhaul and rides its flag
 * (SHOP_CONFIG.FLAG): with that off the tab is not rendered, these endpoints
 * refuse, and sacrifices pay the old flat rate — so the feature can still be
 * pulled without a redeploy or an app release, without a second flag of its
 * own gating an already-gated surface.
 *
 * Prices are ALWAYS recomputed here from FORGE_CONFIG, never read back from
 * the player's saved draft — a client-supplied or stale price must never be
 * able to buy a legendary for a common's fragments.
 */

/** A Forge configuration: what the player is building. */
export interface ForgeDraft {
  tier: string;
  /** null = "a random character of this tier", the cheaper option. */
  character_id: string | null;
  /** "" | "+" | "++" | "+++" */
  upgrade: string;
  /**
   * The EXACT artwork chosen, when the player named one.
   *
   * null = "any art at this upgrade level", which is what a random-character
   * draft means and what a pre-artwork-picker client sends. Needed because
   * (character, rarity) is not unique: 40 pairs in the catalogue have more
   * than one art, so `upgrade` alone cannot identify which the player picked.
   */
  card_variant_id: string | null;
  /**
   * The reforged edge offsets, signed deltas against the variant's catalogue
   * power. Meaningless unless `has_roll`; see below.
   */
  roll: PowerValues;
  /**
   * Whether a reroll has happened at all.
   *
   * NOT derivable from `roll` being non-zero: every edge rolling 0 is a
   * perfectly ordinary outcome (50% each), and it still counts as reforged —
   * the player paid for it, it blocks a tier change without a warning, and it
   * must write a stat-roll row at craft time.
   */
  has_roll: boolean;
  /** Edges held through the next reroll, which also price it. */
  locks: Record<Edge, boolean>;
}

/** A price broken into the parts the cost summary displays. */
export interface ForgeQuote {
  /** Price of the WHICH-card axis before the artwork multiplier. */
  base_cost: number;
  /** The artwork multiplier itself (1, 1.5, 2, 3). */
  variant_multiplier: number;
  /** What the player actually pays. */
  total_cost: number;
  /** True when base_cost came from CHARACTER_COST rather than TIER_COST. */
  character_specific: boolean;
}

export interface ForgeDraftState extends ForgeDraft {
  quote: ForgeQuote;
  /** Whether the player can afford it right now. */
  affordable: boolean;
  card_fragments: number;
  /** Cost of the NEXT reroll at the current lock count. */
  reforge_cost: number;
  /** Whether the reforge feature is on for this player. */
  reforge_enabled: boolean;
}

export interface ForgeReforgeResult {
  success: boolean;
  message: string;
  /** The new offsets, on success. */
  roll?: PowerValues;
  new_fragment_balance?: number;
}

export interface ForgeCraftResult {
  success: boolean;
  message: string;
  /** The instance minted, on success. */
  card?: unknown;
  /** The variant that was rolled/selected, on success. */
  card_variant_id?: string;
  new_fragment_balance?: number;
}

const ForgeService = {
  /**
   * Whether the Forge is on for this player.
   *
   * Rides the shop overhaul's flag rather than carrying its own: the Forge is
   * a tab of that shop, and the tab is not rendered without it.
   */
  async isEnabled(userId: string | null | undefined): Promise<boolean> {
    return FeatureFlagService.isEnabled(userId, SHOP_CONFIG.FLAG);
  },

  /**
   * Normalize whatever the client sent into a valid draft.
   *
   * Anything unrecognised collapses to the cheapest legal configuration rather
   * than throwing: a client one version behind should never be able to wedge a
   * player's saved draft into an unreadable state.
   */
  normalizeDraft(input: Partial<ForgeDraft> | null | undefined): ForgeDraft {
    const tiers = FORGE_CONFIG.TIERS as readonly string[];
    const upgrades = FORGE_CONFIG.UPGRADES as readonly string[];

    // Coalesce BEFORE the membership test, not after: "" is itself a valid
    // upgrade, so testing `input?.upgrade ?? ""` and then reading
    // `input?.upgrade` hands back undefined for a missing draft.
    const requestedTier = input?.tier ?? "common";
    const requestedUpgrade = input?.upgrade ?? "";

    const tier = tiers.includes(requestedTier) ? requestedTier : "common";
    const upgrade = upgrades.includes(requestedUpgrade)
      ? requestedUpgrade
      : "";

    return {
      tier,
      upgrade,
      character_id: input?.character_id || null,
      // Validated against the rest of the draft in `resolveVariant` (it is a
      // DB question, not a shape question) — an id that does not match the
      // chosen tier/character/upgrade is ignored rather than trusted.
      card_variant_id: input?.card_variant_id || null,
      // Clamped, never trusted: the roll decides combat power, so a
      // client-supplied value has to be bounded even though the only writer
      // is meant to be the reforge endpoint.
      roll: this.normalizeRoll(input?.roll),
      has_roll: input?.has_roll === true,
      locks: this.normalizeLocks(input?.locks),
    };
  },

  /** Clamp a roll to the configured offset range, defaulting to all zeroes. */
  normalizeRoll(input: Partial<PowerValues> | null | undefined): PowerValues {
    const { MIN_OFFSET, MAX_OFFSET } = FORGE_CONFIG.REFORGE;
    const clamp = (value: unknown): number => {
      const n = Math.round(Number(value));
      if (!Number.isFinite(n)) return 0;
      return Math.min(Math.max(n, MIN_OFFSET), MAX_OFFSET);
    };

    return {
      top: clamp(input?.top),
      right: clamp(input?.right),
      bottom: clamp(input?.bottom),
      left: clamp(input?.left),
    };
  },

  /** Coerce a locks object to four booleans. */
  normalizeLocks(
    input: Partial<Record<Edge, boolean>> | null | undefined
  ): Record<Edge, boolean> {
    return {
      top: input?.top === true,
      right: input?.right === true,
      bottom: input?.bottom === true,
      left: input?.left === true,
    };
  },

  /** How many edges are currently held. */
  lockCount(locks: Record<Edge, boolean>): number {
    return EDGES.filter((edge) => locks[edge]).length;
  },

  /**
   * The exact variant rarity a draft resolves to, e.g. "legendary++".
   *
   * This is the packed `card_variants.rarity` value — tier and cosmetic
   * upgrade in one string — so it can be matched exactly against the column.
   */
  variantRarity(draft: ForgeDraft): string {
    return `${draft.tier}${draft.upgrade}`;
  },

  /**
   * Price a draft. Pure function of FORGE_CONFIG, no I/O — the client mirrors
   * this arithmetic for its live cost summary, and the craft path re-runs it
   * as the authority.
   */
  quote(draft: ForgeDraft): ForgeQuote {
    const characterSpecific = draft.character_id !== null;
    const baseCost = characterSpecific
      ? FORGE_CONFIG.CHARACTER_COST[draft.tier] ?? 0
      : FORGE_CONFIG.TIER_COST[draft.tier] ?? 0;
    const multiplier = FORGE_CONFIG.VARIANT_MULTIPLIER[draft.upgrade] ?? 1;

    return {
      base_cost: baseCost,
      variant_multiplier: multiplier,
      // Rounded up so a 1.5× on an odd base can never be shaved by a fraction.
      total_cost: Math.ceil(baseCost * multiplier),
      character_specific: characterSpecific,
    };
  },

  /**
   * Fragments a single sacrificed card is worth: its base rarity's value,
   * multiplied for `+` artwork.
   *
   * Exported through the service (rather than inlined in xp.service) so the
   * payout and the Forge's prices are read from one config block.
   */
  sacrificeShards(rarity: string): number {
    // `rarity` packs tier and upgrade ("rare++"). Split, never compare whole.
    const base = rarity.replace(/\+/g, "");
    const suffix = rarity.slice(base.length);
    const value = FORGE_CONFIG.SACRIFICE_SHARDS[base] ?? 1;
    const multiplier = FORGE_CONFIG.UPGRADE_SHARD_MULTIPLIER[suffix] ?? 1;
    return value * multiplier;
  },

  /** Load a player's saved draft, or null when they have none. */
  async getDraft(userId: string): Promise<ForgeDraft | null> {
    const { rows } = await db.query(
      `SELECT tier, character_id, upgrade, card_variant_id,
              roll_top, roll_right, roll_bottom, roll_left, has_roll,
              lock_top, lock_right, lock_bottom, lock_left
       FROM "forge_drafts" WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) return null;
    return {
      tier: rows[0].tier,
      character_id: rows[0].character_id,
      upgrade: rows[0].upgrade,
      card_variant_id: rows[0].card_variant_id,
      roll: {
        top: rows[0].roll_top,
        right: rows[0].roll_right,
        bottom: rows[0].roll_bottom,
        left: rows[0].roll_left,
      },
      has_roll: rows[0].has_roll,
      locks: {
        top: rows[0].lock_top,
        right: rows[0].lock_right,
        bottom: rows[0].lock_bottom,
        left: rows[0].lock_left,
      },
    };
  },

  /**
   * Load the draft plus everything the panel needs to render it: the price and
   * whether it is currently affordable.
   */
  async getDraftState(userId: string): Promise<ForgeDraftState> {
    const saved = await this.getDraft(userId);
    const draft = this.normalizeDraft(saved);
    const quote = this.quote(draft);

    const user = await UserModel.findById(userId);
    const fragments = user?.card_fragments ?? 0;

    return {
      ...draft,
      quote,
      affordable: fragments >= quote.total_cost,
      card_fragments: fragments,
      reforge_cost: StatRollService.costForLocks(this.lockCount(draft.locks)),
      reforge_enabled: await this.isEnabled(userId),
    };
  },

  /**
   * Persist the player's in-progress configuration.
   *
   * Called as they tweak the Forge, so it is an idempotent upsert on the one
   * row they own rather than an append — the point is that the configuration
   * survives leaving the app, not a history of what they considered.
   */
  async saveDraft(
    userId: string,
    input: Partial<ForgeDraft>
  ): Promise<ForgeDraftState> {
    const draft = this.normalizeDraft(input);

    /*
     * The roll is SERVER-OWNED: it is never read from the request.
     *
     * Clients do not send it (the panel only ever posts the build), so taking
     * it from `input` would zero a paid-for roll on the next autosave — and
     * `craft` calls this with a build-only payload, which would have wiped
     * the roll at the exact moment it was about to be minted. Reading it back
     * from the stored row instead makes the reforge endpoint the only writer,
     * which is also what stops a modified client posting its own stats.
     */
    const stored = await this.getDraft(userId);
    draft.roll = stored?.roll ?? this.normalizeRoll(null);
    draft.has_roll = stored?.has_roll ?? false;
    draft.locks = stored?.locks ?? this.normalizeLocks(null);

    // A named character must actually be of the chosen tier, or the price the
    // player was quoted would not match the card they receive.
    if (draft.character_id) {
      const ok = await this.characterHasTier(draft.character_id, draft.tier);
      if (!ok) draft.character_id = null;
    }

    // Same reasoning for the named artwork: if it does not match the rest of
    // the draft (the player changed tier or character after picking it), drop
    // it back to "any art at this level" rather than storing a contradiction
    // that `resolveVariant` would silently ignore at craft time.
    if (draft.card_variant_id) {
      const ok = await this.variantMatchesDraft(draft);
      if (!ok) draft.card_variant_id = null;
    }

    /*
     * A roll belongs to the card it was rolled ON.
     *
     * The stored value is an OFFSET against a specific variant's catalogue
     * power, so carrying it across a change of tier or character would apply
     * a "+3 top" rolled on a common to a legendary — a different card, and a
     * price the player never paid. Changing the build therefore discards the
     * roll and its locks, which is exactly what the client warns about before
     * letting the change through.
     *
     * Enforced HERE as well as in the UI: the warning is a courtesy, this is
     * the guarantee. A client that skips the dialog still cannot smuggle a
     * roll onto a card it was not rolled for.
     */
    if (stored?.has_roll && this.buildChanged(stored, draft)) {
      draft.roll = this.normalizeRoll(null);
      draft.has_roll = false;
      draft.locks = this.normalizeLocks(null);
    }

    const quote = this.quote(draft);

    await db.query(
      `INSERT INTO "forge_drafts"
         (user_id, tier, character_id, upgrade, card_variant_id, quoted_price,
          roll_top, roll_right, roll_bottom, roll_left, has_roll,
          lock_top, lock_right, lock_bottom, lock_left)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (user_id) DO UPDATE
         SET tier = EXCLUDED.tier,
             character_id = EXCLUDED.character_id,
             upgrade = EXCLUDED.upgrade,
             card_variant_id = EXCLUDED.card_variant_id,
             quoted_price = EXCLUDED.quoted_price,
             roll_top = EXCLUDED.roll_top,
             roll_right = EXCLUDED.roll_right,
             roll_bottom = EXCLUDED.roll_bottom,
             roll_left = EXCLUDED.roll_left,
             has_roll = EXCLUDED.has_roll,
             lock_top = EXCLUDED.lock_top,
             lock_right = EXCLUDED.lock_right,
             lock_bottom = EXCLUDED.lock_bottom,
             lock_left = EXCLUDED.lock_left,
             updated_at = current_timestamp`,
      [
        userId,
        draft.tier,
        draft.character_id,
        draft.upgrade,
        draft.card_variant_id,
        quote.total_cost,
        draft.roll.top,
        draft.roll.right,
        draft.roll.bottom,
        draft.roll.left,
        draft.has_roll,
        draft.locks.top,
        draft.locks.right,
        draft.locks.bottom,
        draft.locks.left,
      ]
    );

    return this.getDraftState(userId);
  },

  /**
   * Whether a save invalidates an existing roll.
   *
   * Only tier and character matter. A roll is an offset against the card's
   * catalogue power, and `base_power` lives on `characters` — every artwork
   * variant of one character shares it — so switching art (or upgrade level)
   * leaves the numbers the roll was computed against completely unchanged.
   * Dropping the roll there would have charged the player again for a reroll
   * that nothing about the card had invalidated.
   *
   * Tier still counts even at the same character: it selects a different
   * variant row, and a draft is priced and resolved by tier.
   *
   * Locks and the roll itself are excluded on purpose — rerolling or toggling
   * a lock must not count as changing the build, or a reroll would wipe its
   * own result.
   */
  buildChanged(previous: ForgeDraft, next: ForgeDraft): boolean {
    return (
      previous.tier !== next.tier ||
      previous.character_id !== next.character_id
    );
  },

  /**
   * Roll the unlocked edges of a player's draft, charging for it.
   *
   * The roll is generated HERE, never accepted from the client: it decides
   * combat power, so the odds have to live somewhere the player cannot edit.
   * The client sends only which edges are locked.
   *
   * Charged and stored in one transaction with a conditional debit, the same
   * concurrency guard `craft` uses: two simultaneous rerolls cannot both pass
   * the balance check, so a player cannot get two rolls for one payment.
   */
  async reforge(
    userId: string,
    locks: Partial<Record<Edge, boolean>> | null | undefined
  ): Promise<ForgeReforgeResult> {
    if (!(await this.isEnabled(userId))) {
      return { success: false, message: "Reforging is not available." };
    }

    const draft = this.normalizeDraft(await this.getDraft(userId));
    const nextLocks = this.normalizeLocks(locks);

    // At most three edges may be held: a fourth leaves nothing to reroll, so
    // it would charge fragments for a guaranteed no-op. The panel does not
    // offer the fourth lock; this is the guarantee behind that.
    if (this.lockCount(nextLocks) > FORGE_CONFIG.REFORGE.MAX_LOCKS) {
      return {
        success: false,
        message: "Unlock at least one power to reforge.",
      };
    }

    // The roll is an offset against a REAL card's power, so the draft has to
    // resolve to one first. A random-character draft has no fixed base power
    // to roll against, which is why the panel requires a named character.
    const variantId = await this.resolveVariant(draft);
    if (!variantId) {
      return {
        success: false,
        message: "Choose a character before reforging.",
      };
    }

    const basePower = await this.variantBasePower(variantId);
    if (!basePower) {
      return { success: false, message: "That card cannot be reforged." };
    }

    const cost = StatRollService.costForLocks(this.lockCount(nextLocks));

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      const { rows: spent } = await client.query(
        `UPDATE "users"
         SET card_fragments = card_fragments - $2
         WHERE user_id = $1 AND card_fragments >= $2
         RETURNING card_fragments`,
        [userId, cost]
      );
      if (spent.length === 0) {
        await client.query("ROLLBACK");
        return { success: false, message: "Not enough card fragments." };
      }

      const roll = StatRollService.roll(basePower, nextLocks, draft.roll);

      await client.query(
        `UPDATE "forge_drafts"
         SET roll_top = $2, roll_right = $3, roll_bottom = $4, roll_left = $5,
             has_roll = true,
             lock_top = $6, lock_right = $7, lock_bottom = $8, lock_left = $9,
             updated_at = current_timestamp
         WHERE user_id = $1`,
        [
          userId,
          roll.top,
          roll.right,
          roll.bottom,
          roll.left,
          nextLocks.top,
          nextLocks.right,
          nextLocks.bottom,
          nextLocks.left,
        ]
      );

      await client.query("COMMIT");

      await cacheInvalidation.invalidateAfterShopPurchase(userId, "forge_reforge");

      return {
        success: true,
        message: "Reforged!",
        roll,
        new_fragment_balance: spent[0].card_fragments,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error("Forge reforge failed", { userId, error });
      return { success: false, message: "Reforging failed. Please try again." };
    } finally {
      client.release();
    }
  },

  /** A variant's catalogue edge powers, or null when it does not exist. */
  async variantBasePower(variantId: string): Promise<PowerValues | null> {
    const { rows } = await db.query(
      `SELECT ch.base_power
       FROM "card_variants" cv
       JOIN "characters" ch ON cv.character_id = ch.character_id
       WHERE cv.card_variant_id = $1`,
      [variantId]
    );
    if (rows.length === 0) return null;

    const power = rows[0].base_power ?? {};
    return {
      top: Number(power.top ?? 0),
      right: Number(power.right ?? 0),
      bottom: Number(power.bottom ?? 0),
      left: Number(power.left ?? 0),
    };
  },

  /** Drop a player's draft (the "start over" action). */
  async clearDraft(userId: string): Promise<void> {
    await db.query(`DELETE FROM "forge_drafts" WHERE user_id = $1`, [userId]);
  },

  /**
   * Whether a draft's named artwork is still consistent with the rest of it.
   *
   * Mirrors the guard in `resolveVariant` so a draft is never PERSISTED in a
   * state the craft path would quietly ignore — the player would otherwise see
   * their chosen art in the picker and be handed a different one.
   */
  async variantMatchesDraft(draft: ForgeDraft): Promise<boolean> {
    if (!draft.card_variant_id) return true;
    const { rows } = await db.query(
      `SELECT 1
       FROM "card_variants" cv
       JOIN "characters" ch ON ch.character_id = cv.character_id
       WHERE cv.card_variant_id = $1
         AND cv.rarity::text = $2
         AND cv.is_exclusive = false
         AND cv.released_at <= NOW()
         AND ch.released_at <= NOW()
         AND ($3::uuid IS NULL OR cv.character_id = $3::uuid)
       LIMIT 1`,
      [draft.card_variant_id, this.variantRarity(draft), draft.character_id]
    );
    return rows.length > 0;
  },

  /**
   * Whether a character has any craftable variant at the given base tier.
   *
   * Matches on the NORMALIZED rarity: an exact `rarity = 'epic'` would answer
   * "no" for a character whose only epic art is `epic++`.
   */
  async characterHasTier(characterId: string, tier: string): Promise<boolean> {
    const { rows } = await db.query(
      `SELECT 1
       FROM "card_variants" cv
       JOIN "characters" ch ON ch.character_id = cv.character_id
       WHERE cv.character_id = $1
         AND replace(cv.rarity::text, '+', '') = $2
         AND cv.is_exclusive = false
         AND cv.released_at <= NOW()
         AND ch.released_at <= NOW()
       LIMIT 1`,
      [characterId, tier]
    );
    return rows.length > 0;
  },

  /**
   * Resolve a draft to the exact variant to mint.
   *
   * A named character resolves to their variant at that exact packed rarity.
   * An unnamed one draws uniformly ("equally weighted within that tier/set of
   * rarities" per the design) from every released, non-exclusive variant at
   * that rarity — the same pool definition the tower and onboarding rewards
   * use, kept as one SQL predicate so the pools can't drift apart.
   */
  async resolveVariant(draft: ForgeDraft): Promise<string | null> {
    const rarity = this.variantRarity(draft);

    // An explicitly chosen artwork. Re-validated here rather than trusted:
    // this decides which card the player is handed, so the id must still be a
    // released, non-exclusive variant AND actually match the tier, upgrade and
    // character being paid for. A mismatch falls through to the resolution
    // below instead of erroring — the draft is still craftable, just less
    // specific — which is also what happens when the named art is retired.
    if (draft.card_variant_id) {
      const { rows } = await db.query(
        `SELECT cv.card_variant_id
         FROM "card_variants" cv
         JOIN "characters" ch ON ch.character_id = cv.character_id
         WHERE cv.card_variant_id = $1
           AND cv.rarity::text = $2
           AND cv.is_exclusive = false
           AND cv.released_at <= NOW()
           AND ch.released_at <= NOW()
           AND ($3::uuid IS NULL OR cv.character_id = $3::uuid)
         LIMIT 1`,
        [draft.card_variant_id, rarity, draft.character_id]
      );
      if (rows[0]?.card_variant_id) return rows[0].card_variant_id;
    }

    if (draft.character_id) {
      // No specific art named (or the named one no longer qualifies), so any
      // art of this character at this rarity will do. ORDER BY random() rather
      // than an unordered LIMIT 1: (character, rarity) is not unique, and an
      // arbitrary-but-stable pick would mean one art of a multi-art pair could
      // never be minted at all.
      const { rows } = await db.query(
        `SELECT cv.card_variant_id
         FROM "card_variants" cv
         JOIN "characters" ch ON ch.character_id = cv.character_id
         WHERE cv.character_id = $1
           AND cv.rarity::text = $2
           AND cv.is_exclusive = false
           AND cv.released_at <= NOW()
           AND ch.released_at <= NOW()
         ORDER BY random()
         LIMIT 1`,
        [draft.character_id, rarity]
      );
      return rows[0]?.card_variant_id ?? null;
    }

    // ORDER BY random() over a rarity-filtered slice: the pool is one rarity's
    // worth of variants (tens, not the whole catalogue), so the sort is cheap
    // and the draw is uniform without a second count round-trip.
    const { rows } = await db.query(
      `SELECT cv.card_variant_id
       FROM "card_variants" cv
       JOIN "characters" ch ON ch.character_id = cv.character_id
       WHERE cv.rarity::text = $1
         AND cv.is_exclusive = false
         AND cv.released_at <= NOW()
         AND ch.released_at <= NOW()
       ORDER BY random()
       LIMIT 1`,
      [rarity]
    );
    return rows[0]?.card_variant_id ?? null;
  },

  /**
   * Spend the fragments and mint the card.
   *
   * The price is recomputed from the SAVED draft, never from the request body,
   * so the client cannot name its own price. Fragments are debited with a
   * conditional UPDATE inside the transaction, which is also the concurrency
   * guard: two simultaneous crafts cannot both pass `card_fragments >= price`.
   */
  async craft(userId: string, input: Partial<ForgeDraft>): Promise<ForgeCraftResult> {
    if (!(await this.isEnabled(userId))) {
      return { success: false, message: "The Forge is not available." };
    }

    // Persist first, so the configuration the player paid for is the one on
    // record even if the mint fails below.
    await this.saveDraft(userId, input);
    const draft = this.normalizeDraft(await this.getDraft(userId));
    const quote = this.quote(draft);

    const variantId = await this.resolveVariant(draft);
    if (!variantId) {
      return {
        success: false,
        message: "No card matches that combination yet. Try different artwork.",
      };
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Conditional debit: returns no row when the balance is short.
      const { rows: spent } = await client.query(
        `UPDATE "users"
         SET card_fragments = card_fragments - $2
         WHERE user_id = $1 AND card_fragments >= $2
         RETURNING card_fragments`,
        [userId, quote.total_cost]
      );
      if (spent.length === 0) {
        await client.query("ROLLBACK");
        return {
          success: false,
          message: "Not enough card fragments.",
        };
      }

      const card = await CardModel.addCardToUser(userId, variantId, client);

      /*
       * Carry the draft's roll onto the card that was just minted.
       *
       * Copied verbatim rather than re-rolled: the player was shown these
       * stats and paid to roll them, so redemption must not be another throw
       * of the dice. `has_roll` (not a non-zero test) decides whether to write
       * at all — an all-zero roll is a real, paid-for outcome and gets its row
       * like any other.
       *
       * Inside the craft transaction, so a card can never exist without the
       * stats it was bought with.
       */
      if (draft.has_roll) {
        await StatRollService.create(
          card.user_card_instance_id,
          draft.roll,
          client
        );
      }

      // The draft has been redeemed; the player starts fresh next visit.
      await client.query(`DELETE FROM "forge_drafts" WHERE user_id = $1`, [
        userId,
      ]);

      await client.query("COMMIT");

      /*
       * A craft mints a card, so the user's card cache MUST be dropped.
       *
       * `invalidateAfterShopPurchase` only purges for three hardcoded item
       * types ('legendary_card', 'epic_card', 'enhanced_card') and silently
       * does nothing for anything else — so the "forge_craft" call it used to
       * make was a no-op, and a freshly forged card did not appear in the
       * gallery until the cache expired or the app restarted. Call the card
       * invalidation directly rather than adding another magic string to that
       * list, where the next new card source would hit the same trap.
       */
      await cacheInvalidation.invalidateUserCards(userId);
      await cacheInvalidation.invalidateAfterShopPurchase(userId, "forge_craft");

      return {
        success: true,
        message: "Forged!",
        card,
        card_variant_id: variantId,
        new_fragment_balance: spent[0].card_fragments,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error("Forge craft failed", { userId, error });
      return { success: false, message: "Forging failed. Please try again." };
    } finally {
      client.release();
    }
  },
};

export default ForgeService;
