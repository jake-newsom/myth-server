import { test, describe } from "node:test";
import assert from "node:assert";
import ForgeService from "../../services/forge.service";
import { FORGE_CONFIG } from "../constants";

/**
 * Pricing and payout rules for the Forge.
 *
 * `quote`, `sacrificeShards`, `normalizeDraft` and `variantRarity` are pure
 * functions of FORGE_CONFIG, so they are testable without a database — which
 * matters because they are the numbers a player's fragments are spent against.
 */

/*
 * Pricing ignores the reforge fields entirely — the roll is an offset applied
 * after the craft is paid for — so they are filled with their neutral values
 * rather than parameterised.
 */
const draft = (
  tier: string,
  character_id: string | null,
  upgrade: string,
  card_variant_id: string | null = null
) => ({
  tier,
  character_id,
  upgrade,
  card_variant_id,
  roll: { top: 0, right: 0, bottom: 0, left: 0 },
  has_roll: false,
  locks: { top: false, right: false, bottom: false, left: false },
});

describe("forge pricing", () => {
  test("random pick of each tier costs the tier price", () => {
    for (const tier of FORGE_CONFIG.TIERS) {
      assert.equal(
        ForgeService.quote(draft(tier, null, "")).total_cost,
        FORGE_CONFIG.TIER_COST[tier]
      );
    }
  });

  test("naming a character costs the character price", () => {
    for (const tier of FORGE_CONFIG.TIERS) {
      assert.equal(
        ForgeService.quote(draft(tier, "some-character", "")).total_cost,
        FORGE_CONFIG.CHARACTER_COST[tier]
      );
    }
  });

  // The two worked examples given in the design brief.
  test("a specific legendary with ++ artwork costs 600", () => {
    assert.equal(
      ForgeService.quote(draft("legendary", "some-character", "++")).total_cost,
      600
    );
  });

  test("a random legendary with ++ artwork costs 240", () => {
    assert.equal(
      ForgeService.quote(draft("legendary", null, "++")).total_cost,
      240
    );
  });

  test("naming a character always costs more than a random pick", () => {
    for (const tier of FORGE_CONFIG.TIERS) {
      for (const upgrade of FORGE_CONFIG.UPGRADES) {
        assert.ok(
          ForgeService.quote(draft(tier, "c", upgrade)).total_cost >
            ForgeService.quote(draft(tier, null, upgrade)).total_cost,
          `${tier}${upgrade}: specific should cost more than random`
        );
      }
    }
  });

  test("upgrade multipliers are monotonic within a tier", () => {
    let previous = 0;
    for (const upgrade of FORGE_CONFIG.UPGRADES) {
      const cost = ForgeService.quote(draft("epic", null, upgrade)).total_cost;
      assert.ok(cost > previous, `${upgrade} should cost more than the last`);
      previous = cost;
    }
  });

  test("craft multipliers match what sacrifice pays for the same art", () => {
    // The Forge must not value a cosmetic upgrade differently depending on
    // which direction it moves, or base-art duplicates become the cheapest
    // fuel and upgraded cards the cheapest product.
    for (const upgrade of FORGE_CONFIG.UPGRADES) {
      assert.equal(
        FORGE_CONFIG.VARIANT_MULTIPLIER[upgrade],
        FORGE_CONFIG.UPGRADE_SHARD_MULTIPLIER[upgrade],
        `${upgrade}: craft multiplier should equal the sacrifice multiplier`
      );
    }
  });

  test("the top end costs the intended numbers", () => {
    assert.equal(
      ForgeService.quote(draft("legendary", "c", "+++")).total_cost,
      800
    );
    assert.equal(ForgeService.quote(draft("epic", "c", "+++")).total_cost, 400);
    assert.equal(
      ForgeService.quote(draft("legendary", null, "+++")).total_cost,
      320
    );
  });

  test("the quote breaks out the parts the summary displays", () => {
    const q = ForgeService.quote(draft("rare", "c", "+"));
    assert.equal(q.base_cost, 50);
    assert.equal(q.variant_multiplier, 2);
    assert.equal(q.total_cost, 100);
    assert.equal(q.character_specific, true);
  });
});

describe("forge draft normalization", () => {
  test("an unknown tier or upgrade falls back to the cheapest build", () => {
    const d = ForgeService.normalizeDraft({
      tier: "mythic",
      upgrade: "++++",
      character_id: null,
    });
    assert.equal(d.tier, "common");
    assert.equal(d.upgrade, "");
  });

  test("a missing draft normalizes rather than throwing", () => {
    const d = ForgeService.normalizeDraft(null);
    assert.equal(d.tier, "common");
    assert.equal(d.upgrade, "");
    assert.equal(d.character_id, null);
  });

  test("an empty character id means random, not a character named ''", () => {
    assert.equal(
      ForgeService.normalizeDraft({ tier: "epic", character_id: "", upgrade: "" })
        .character_id,
      null
    );
  });

  test("variantRarity packs tier and upgrade the way the column stores it", () => {
    assert.equal(ForgeService.variantRarity(draft("legendary", null, "++")), "legendary++");
    assert.equal(ForgeService.variantRarity(draft("common", null, "")), "common");
  });
});

describe("sacrifice payouts", () => {
  test("base rarities pay the brief's values", () => {
    assert.equal(ForgeService.sacrificeShards("common"), 1);
    assert.equal(ForgeService.sacrificeShards("rare"), 3);
    assert.equal(ForgeService.sacrificeShards("epic"), 6);
    assert.equal(ForgeService.sacrificeShards("legendary"), 12);
  });

  test("upgraded cards pay 2x / 3x / 4x their tier", () => {
    assert.equal(ForgeService.sacrificeShards("legendary+"), 24);
    assert.equal(ForgeService.sacrificeShards("legendary++"), 36);
    assert.equal(ForgeService.sacrificeShards("legendary+++"), 48);
    assert.equal(ForgeService.sacrificeShards("common+++"), 4);
  });

  /* The bug this guards: `rarity` packs tier and upgrade in one string, so any
     whole-string comparison silently values every upgraded card at the
     fallback of 1 — an error that only ever hits invested players. */
  test("an upgraded rarity is never valued as an unknown tier", () => {
    for (const tier of ["common", "rare", "epic", "legendary"]) {
      for (const upgrade of ["", "+", "++", "+++"]) {
        assert.ok(
          ForgeService.sacrificeShards(`${tier}${upgrade}`) >=
            FORGE_CONFIG.SACRIFICE_SHARDS[tier],
          `${tier}${upgrade} fell through to the fallback value`
        );
      }
    }
  });

  test("sacrificing is worth more for rarer cards", () => {
    assert.ok(
      ForgeService.sacrificeShards("legendary") >
        ForgeService.sacrificeShards("epic")
    );
    assert.ok(
      ForgeService.sacrificeShards("epic") > ForgeService.sacrificeShards("rare")
    );
  });
});

/**
 * The Forge panel shows a cost under each of its three columns and the total
 * on the Craft button. Those four numbers are read together, so the parts must
 * sum to the total for every build — otherwise the UI appears to be doing
 * arithmetic wrong even though the charge is correct.
 *
 * Mirrors `columnCosts` in ForgePanel.vue:
 *   tier      = TIER_COST[tier]
 *   character = base_cost - TIER_COST[tier]   (0 for a random pick)
 *   artwork   = total_cost - base_cost        (0 for base art)
 */
describe("forge column cost split", () => {
  const split = (tier: string, character: string | null, upgrade: string) => {
    const q = ForgeService.quote(draft(tier, character, upgrade));
    const tierCost = FORGE_CONFIG.TIER_COST[tier];
    return {
      tier: tierCost,
      character: q.base_cost - tierCost,
      artwork: q.total_cost - q.base_cost,
      total: q.total_cost,
    };
  };

  test("the three column costs always sum to the craft total", () => {
    for (const tier of FORGE_CONFIG.TIERS) {
      for (const character of [null, "some-character"]) {
        for (const upgrade of FORGE_CONFIG.UPGRADES) {
          const s = split(tier, character, upgrade);
          assert.equal(
            s.tier + s.character + s.artwork,
            s.total,
            `${tier}${upgrade} character=${character}: parts do not sum`
          );
        }
      }
    }
  });

  test("no column ever shows a negative cost", () => {
    for (const tier of FORGE_CONFIG.TIERS) {
      for (const character of [null, "some-character"]) {
        for (const upgrade of FORGE_CONFIG.UPGRADES) {
          const s = split(tier, character, upgrade);
          assert.ok(s.tier >= 0 && s.character >= 0 && s.artwork >= 0,
            `${tier}${upgrade} character=${character}: negative part`);
        }
      }
    }
  });

  test("a random pick adds nothing for the character column", () => {
    for (const tier of FORGE_CONFIG.TIERS) {
      assert.equal(split(tier, null, "").character, 0);
    }
  });

  test("base artwork adds nothing for the artwork column", () => {
    for (const tier of FORGE_CONFIG.TIERS) {
      assert.equal(split(tier, "c", "").artwork, 0);
      assert.equal(split(tier, null, "").artwork, 0);
    }
  });

  test("the legendary ++ example splits as 80 / 120 / 400", () => {
    const s = split("legendary", "some-character", "++");
    assert.deepEqual(
      [s.tier, s.character, s.artwork, s.total],
      [80, 120, 400, 600]
    );
  });
});
