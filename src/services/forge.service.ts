import db from "../config/db.config";
import CardModel from "../models/card.model";
import UserModel from "../models/user.model";
import FeatureFlagService from "./featureFlag.service";
import { cacheInvalidation } from "./cache.invalidation.service";
import { FORGE_CONFIG, SHOP_CONFIG } from "../config/constants";
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
    };
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
      `SELECT tier, character_id, upgrade, card_variant_id
       FROM "forge_drafts" WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) return null;
    return {
      tier: rows[0].tier,
      character_id: rows[0].character_id,
      upgrade: rows[0].upgrade,
      card_variant_id: rows[0].card_variant_id,
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

    const quote = this.quote(draft);

    await db.query(
      `INSERT INTO "forge_drafts"
         (user_id, tier, character_id, upgrade, card_variant_id, quoted_price)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET tier = EXCLUDED.tier,
             character_id = EXCLUDED.character_id,
             upgrade = EXCLUDED.upgrade,
             card_variant_id = EXCLUDED.card_variant_id,
             quoted_price = EXCLUDED.quoted_price,
             updated_at = current_timestamp`,
      [
        userId,
        draft.tier,
        draft.character_id,
        draft.upgrade,
        draft.card_variant_id,
        quote.total_cost,
      ]
    );

    return this.getDraftState(userId);
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

      // The draft has been redeemed; the player starts fresh next visit.
      await client.query(`DELETE FROM "forge_drafts" WHERE user_id = $1`, [
        userId,
      ]);

      await client.query("COMMIT");

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
