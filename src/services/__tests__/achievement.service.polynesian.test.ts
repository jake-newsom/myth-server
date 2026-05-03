import test from "node:test";
import assert from "node:assert/strict";
import AchievementService from "../achievement.service";
import { createResult, stubIncrementTracker } from "./achievement.test-helpers";

test("kupua_dual_aspect hits 4-debuff batch threshold (non-unique targets)", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-kupua";
    const result = createResult();
    for (let i = 1; i <= 3; i++) {
      await AchievementService.handlePowerDebuffApplied(
        userId,
        {
          source_ability_id: "kupua_dual_aspect",
          source_card_id: "kupua-card",
          batch_id: "batch-kupua",
          turn_number: 5,
          target_card_id: "k-repeat",
        },
        result
      );
    }
    assert.equal(tracker.calls.length, 0);

    await AchievementService.handlePowerDebuffApplied(
      userId,
      {
        source_ability_id: "kupua_dual_aspect",
        source_card_id: "kupua-card",
        batch_id: "batch-kupua",
        turn_number: 5,
        target_card_id: "k-repeat",
      },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_kupua_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("kanehekili tracks same enemy across match and resets", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-kanehekili";
    const result = createResult();
    const baseEvent = {
      source_ability_id: "kanehekili_thunderous_omen",
      source_card_id: "kane-card",
      batch_id: "thunder-b",
      turn_number: 2,
      target_card_id: "enemy-z",
    };

    await AchievementService.handlePowerDebuffApplied(userId, baseEvent, result);
    await AchievementService.handlePowerDebuffApplied(userId, baseEvent, result);
    await AchievementService.handlePowerDebuffApplied(userId, baseEvent, result);

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_kanehekili_ach", incrementBy: 1 },
    ]);

    AchievementService.resetMatchScopedCounters(userId);
    await AchievementService.handlePowerDebuffApplied(userId, baseEvent, result);
    await AchievementService.handlePowerDebuffApplied(userId, baseEvent, result);
    await AchievementService.handlePowerDebuffApplied(userId, baseEvent, result);
    assert.equal(tracker.calls.length, 2);
  } finally {
    tracker.restore();
  }
});

test("pele reaches 5 stacks once per card and maui only increments on play threshold", async () => {
  const tracker = stubIncrementTracker();
  try {
    const result = createResult();
    const peleUser = "u-pele";

    await AchievementService.handlePowerBuffApplied(
      peleUser,
      {
        source_ability_id: "pele_lava_field",
        source_card_id: "pele-card-1",
        power_delta: 5,
      },
      result
    );
    assert.equal(
      tracker.calls.filter((c) => c.baseKey === "char_pele_ach").length,
      0
    );
    await AchievementService.handlePowerBuffApplied(
      peleUser,
      {
        source_ability_id: "pele_lava_field",
        source_card_id: "pele-card-1",
        power_delta: 1,
      },
      result
    );
    assert.equal(
      tracker.calls.filter((c) => c.baseKey === "char_pele_ach").length,
      1
    );
    await AchievementService.handlePowerBuffApplied(
      peleUser,
      {
        source_ability_id: "pele_lava_field",
        source_card_id: "pele-card-1",
        power_delta: 1,
      },
      result
    );
    assert.equal(
      tracker.calls.filter((c) => c.baseKey === "char_pele_ach").length,
      1
    );

    await AchievementService.handlePowerBuffApplied(
      "u-maui",
      {
        source_ability_id: "maui_sun_trick",
        source_card_id: "maui-card",
        power_delta: 10,
      },
      result
    );
    assert.equal(
      tracker.calls.filter((c) => c.baseKey === "char_maui_ach").length,
      0
    );
    await AchievementService.handlePowerBuffApplied(
      "u-maui",
      {
        source_ability_id: "maui_played_with_sun_trick_5",
        source_card_id: "maui-card",
        power_delta: 1,
      },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId: peleUser, baseKey: "char_pele_ach", incrementBy: 1 },
      { userId: "u-maui", baseKey: "char_maui_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("tile-source milestones trigger ukupa, nightmarchers, and kamapuaa", async () => {
  const tracker = stubIncrementTracker();
  try {
    const result = createResult();

    for (let i = 0; i < 4; i++) {
      await AchievementService.handleTileStateChanged(
        "u-ukupa",
        {
          source_ability_id: "ukupanipo_feast_or_famine",
          source_card_id: "ukupa-card-1",
          terrain: "ocean",
          status: "normal",
        },
        result
      );
    }
    for (let i = 0; i < 4; i++) {
      await AchievementService.handleTileStateChanged(
        "u-night",
        {
          source_ability_id: "nightmarchers_dread_aura",
          terrain: null,
          status: "cursed",
        },
        result
      );
    }
    for (let i = 0; i < 5; i++) {
      const lava_active_count = 4;
      await AchievementService.handleTileStateChanged(
        "u-kama",
        {
          source_ability_id: "kamapuaa_wild_shift",
          terrain: "lava",
          status: "cursed",
          lava_active_count,
        },
        result
      );
    }

    assert.deepEqual(tracker.calls, [
      { userId: "u-ukupa", baseKey: "char_ukupa_ach", incrementBy: 1 },
      { userId: "u-night", baseKey: "char_nightmarchers_ach", incrementBy: 1 },
      { userId: "u-kama", baseKey: "char_kamapuaa_ach", incrementBy: 1 },
    ]);

    // Extra cursed tiles in the same match should not increment again.
    await AchievementService.handleTileStateChanged(
      "u-night",
      {
        source_ability_id: "nightmarchers_dread_aura",
        terrain: null,
        status: "cursed",
      },
      result
    );
    assert.equal(
      tracker.calls.filter((c) => c.baseKey === "char_nightmarchers_ach").length,
      1
    );

    // Extra water tiles from same Ukupa in same match should not increment again.
    await AchievementService.handleTileStateChanged(
      "u-ukupa",
      {
        source_ability_id: "ukupanipo_feast_or_famine",
        source_card_id: "ukupa-card-1",
        terrain: "ocean",
        status: "normal",
      },
      result
    );
    assert.equal(
      tracker.calls.filter((c) => c.baseKey === "char_ukupa_ach").length,
      1
    );
  } finally {
    tracker.restore();
  }
});

test("polynesian special predicates trigger kaahupahau, milu, kane, laamaomao, ku blood altar kills, and kamohoalii stronger defeat", async () => {
  const tracker = stubIncrementTracker();
  try {
    const result = createResult();

    await AchievementService.handlePowerDebuffApplied(
      "u-kaa",
      {
        source_ability_id: "kaahupahau_harbor_guardian",
        target_card_id: "self",
        power_delta: 0,
      },
      result
    );
    await AchievementService.handlePowerDebuffApplied(
      "u-kaa",
      {
        source_ability_id: "kaahupahau_harbor_guardian",
        target_card_id: "self",
        power_delta: -3,
      },
      result
    );
    await AchievementService.handlePowerDebuffApplied(
      "u-milu",
      {
        source_ability_id: "milu_spirit_bind",
        target_card_id: "enemy-b",
        target_max_side_power_before: 12,
      },
      result
    );

    await AchievementService.handlePowerBuffApplied(
      "u-kane",
      {
        source_ability_id: "kane_pure_waters",
        source_card_id: "kane-card",
        batch_id: "kane-batch",
        turn_number: 4,
        target_card_id: "ally-1",
        defeat_prevented_by_protection: false,
      },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      "u-kane",
      {
        source_ability_id: "kane_pure_waters",
        source_card_id: "kane-card",
        batch_id: "kane-batch",
        turn_number: 4,
        target_card_id: "ally-2",
        defeat_prevented_by_protection: true,
      },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      "u-kane",
      {
        source_ability_id: "kane_pure_waters",
        source_card_id: "kane-card",
        batch_id: "kane-batch",
        turn_number: 4,
        target_card_id: "ally-3",
        defeat_prevented_by_protection: true,
      },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      "u-laa",
      { source_ability_id: "laamaomao_gale_aura", power_delta: 2, turn_number: 8 },
      result
    );
    await AchievementService.handleCardFlipped(
      "u-ku",
      {
        source_ability_id: "ku_war_stance",
        source_original_owner: "u-ku",
        source_card_id: "ku-card",
        batch_id: "ku-blood-altar-batch",
        turn_number: 9,
        target_card_id: "enemy-1",
      },
      result
    );
    await AchievementService.handleCardFlipped(
      "u-ku",
      {
        source_ability_id: "ku_war_stance",
        source_original_owner: "u-ku",
        source_card_id: "ku-card",
        batch_id: "ku-blood-altar-batch",
        turn_number: 9,
        target_card_id: "enemy-2",
      },
      result
    );
    await AchievementService.handleCardFlipped(
      "u-kamo",
      {
        source_ability_id: "kamohoalii_oceans_shield",
        source_original_owner: "u-kamo",
        source_card_id: "kamo-card",
        target_card_id: "enemy-strong",
        source_total_power_before: 20,
        target_total_power_before: 29,
      },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId: "u-kaa", baseKey: "char_kaahupahau_ach", incrementBy: 1 },
      { userId: "u-milu", baseKey: "char_milu_ach", incrementBy: 1 },
      { userId: "u-kane", baseKey: "char_kane_ach", incrementBy: 1 },
      { userId: "u-laa", baseKey: "char_laamaomao_ach", incrementBy: 1 },
      { userId: "u-ku", baseKey: "char_ku_ach", incrementBy: 1 },
      { userId: "u-kamo", baseKey: "char_kamohoalii_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});
