import test from "node:test";
import assert from "node:assert/strict";
import AchievementService from "../achievement.service";
import { createResult, stubIncrementTracker } from "./achievement.test-helpers";

test("amaterasu grants on third blessing within the same turn", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-ama";
    const result = createResult();

    const turnOneEvent = {
      source_ability_id: "amaterasu_radiant_blessing",
      turn_number: 8,
      power_delta: 1,
    };
    await AchievementService.handlePowerBuffApplied(userId, turnOneEvent, result);
    await AchievementService.handlePowerBuffApplied(userId, turnOneEvent, result);
    await AchievementService.handlePowerBuffApplied(userId, turnOneEvent, result);

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_amaterasu_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("jorogumo increments when web-curse is actually applied as debuff", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-joro";
    const result = createResult();

    await AchievementService.handlePowerDebuffApplied(
      userId,
      {
        source_ability_id: "jorogumo_web_curse",
        target_card_id: "enemy-1",
        power_delta: -2,
      },
      result
    );
    await AchievementService.handleTileStateChanged(
      userId,
      { status: "cursed", animation_label: "web-curse" },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_jorogumo_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("yuki-onna, futakuchi-onna, and yamata batch debuffs hit thresholds", async () => {
  const tracker = stubIncrementTracker();
  try {
    const result = createResult();
    const users = [
      {
        userId: "u-yuki",
        ability: "yuki_onna_frost_row",
        threshold: 3,
        baseKey: "char_yukionna_ach",
      },
      {
        userId: "u-futa",
        ability: "futakuchi_onna_vengeful_bite",
        threshold: 4,
        baseKey: "char_futakuchionna_ach",
      },
      {
        userId: "u-yamata",
        ability: "yamata_many_heads",
        threshold: 5,
        baseKey: "char_yamatanoorochi_ach",
      },
    ];

    for (const entry of users) {
      for (let i = 1; i <= entry.threshold; i++) {
        await AchievementService.handlePowerDebuffApplied(
          entry.userId,
          {
            source_ability_id: entry.ability,
            source_card_id: `${entry.userId}-card`,
            batch_id: `${entry.userId}-batch`,
            turn_number: 2,
            target_card_id: `${entry.userId}-t-${i}`,
          },
          result
        );
      }
    }

    assert.deepEqual(tracker.calls, [
      { userId: "u-yuki", baseKey: "char_yukionna_ach", incrementBy: 1 },
      { userId: "u-futa", baseKey: "char_futakuchionna_ach", incrementBy: 1 },
      { userId: "u-yamata", baseKey: "char_yamatanoorochi_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("ryujin needs two flips in one ability batch", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-ryu";
    const result = createResult();
    const event = {
      source_ability_id: "ryujin_tidal_sweep",
      source_original_owner: userId,
      source_card_id: "ryu-card",
      batch_id: "ryu-batch-1",
    };

    await AchievementService.handleCardFlipped(
      userId,
      { ...event, target_card_id: "enemy-1" },
      result
    );
    assert.deepEqual(tracker.calls, []);
    await AchievementService.handleCardFlipped(
      userId,
      { ...event, target_card_id: "enemy-2" },
      result
    );
    await AchievementService.handleCardFlipped(
      userId,
      {
        source_ability_id: "ryujin_tidal_sweep",
        source_original_owner: userId,
        source_card_id: "ryu-card",
        target_card_id: "enemy-3",
      },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_ryujin_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("japanese special predicates trigger tsukuyomi and buff milestones", async () => {
  const tracker = stubIncrementTracker();
  try {
    const result = createResult();
    const userId = "u-jp";

    await AchievementService.handlePowerDebuffApplied(
      "u-tsu",
      {
        source_ability_id: "tsukuyomi_moons_balance",
        target_card_id: "enemy-a",
        target_max_side_power_before: 15,
      },
      result
    );

    await AchievementService.handlePowerBuffApplied(
      userId,
      {
        source_ability_id: "hachiman_warriors_aura",
        source_card_id: "hachiman-card",
        batch_id: "h-batch",
        turn_number: 5,
        target_card_id: "ally-1",
      },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      userId,
      {
        source_ability_id: "hachiman_warriors_aura",
        source_card_id: "hachiman-card",
        batch_id: "h-batch",
        turn_number: 5,
        target_card_id: "ally-2",
      },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      userId,
      {
        source_ability_id: "hachiman_warriors_aura",
        source_card_id: "hachiman-card",
        batch_id: "h-batch",
        turn_number: 5,
        target_card_id: "ally-3",
      },
      result
    );

    await AchievementService.handlePowerBuffApplied(
      userId,
      { source_ability_id: "benkei_steadfast_guard", power_delta: 4 },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      userId,
      { source_ability_id: "kintaro_beast_friend", power_delta: 6 },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      userId,
      {
        source_ability_id: "yamabiko_echo_power",
        power_delta: 3,
        source_card_id: "yamabiko-card",
        copied_target_card_id: "enemy-yamabiko-1",
      },
      result
    );
    await AchievementService.handleCardFlipped(
      userId,
      {
        source_ability_id: "yamabiko_echo_power",
        source_original_owner: userId,
        source_card_id: "yamabiko-card",
        target_card_id: "enemy-yamabiko-1",
      },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      userId,
      { source_ability_id: "nurarihyon_slipstream", power_delta: 1 },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      "u-mina",
      {
        source_ability_id: "minamoto_demon_bane",
        source_card_id: "mina-card",
        power_delta: 10,
      },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      "u-mina",
      {
        source_ability_id: "minamoto_played_with_demon_bane_10",
        source_card_id: "mina-card",
        power_delta: 1,
      },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId: "u-tsu", baseKey: "char_tsukuyomi_ach", incrementBy: 1 },
      { userId, baseKey: "char_hachiman_ach", incrementBy: 1 },
      { userId, baseKey: "char_benkei_ach", incrementBy: 1 },
      { userId, baseKey: "char_kintaro_ach", incrementBy: 1 },
      { userId, baseKey: "char_yamabiko_ach", incrementBy: 1 },
      { userId, baseKey: "char_nurarihyon_ach", incrementBy: 1 },
      { userId: "u-mina", baseKey: "char_minamoto_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("susanoo increments when destroying beast or dragon tags (case-insensitive)", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-susa";
    const result = createResult();

    await AchievementService.handleCardDestroyed(
      userId,
      {
        destroyer_ability_id: "susanoo_storm_breaker",
        destroyer_original_owner: null,
        target_tags: ["beast"],
      },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_susanoo_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});
