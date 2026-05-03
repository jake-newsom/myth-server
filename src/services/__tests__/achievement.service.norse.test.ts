import test from "node:test";
import assert from "node:assert/strict";
import AchievementService from "../achievement.service";
import { createResult, stubIncrementTracker } from "./achievement.test-helpers";

test("thor_push tracks unique targets in one batch and awards once", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-thor";
    const result = createResult();
    const baseEvent = {
      source_ability_id: "thor_push",
      source_card_id: "thor-card",
      batch_id: "batch-thor-1",
      turn_number: 1,
    };

    await AchievementService.handlePowerDebuffApplied(
      userId,
      { ...baseEvent, target_card_id: "enemy-1" },
      result
    );
    await AchievementService.handlePowerDebuffApplied(
      userId,
      { ...baseEvent, target_card_id: "enemy-2" },
      result
    );
    await AchievementService.handlePowerDebuffApplied(
      userId,
      { ...baseEvent, target_card_id: "enemy-3" },
      result
    );
    await AchievementService.handlePowerDebuffApplied(
      userId,
      { ...baseEvent, target_card_id: "enemy-4" },
      result
    );
    assert.equal(tracker.calls.length, 0);

    await AchievementService.handlePowerDebuffApplied(
      userId,
      { ...baseEvent, target_card_id: "enemy-5" },
      result
    );
    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_thor_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("skadi_freeze awards at 3 unique targets in one batch", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-skadi";
    const result = createResult();
    const baseEvent = {
      source_ability_id: "skadi_freeze",
      source_card_id: "skadi-card",
      batch_id: "batch-skadi",
      turn_number: 3,
    };

    await AchievementService.handlePowerDebuffApplied(
      userId,
      { ...baseEvent, target_card_id: "s-1" },
      result
    );
    await AchievementService.handlePowerDebuffApplied(
      userId,
      { ...baseEvent, target_card_id: "s-2" },
      result
    );
    await AchievementService.handlePowerDebuffApplied(
      userId,
      { ...baseEvent, target_card_id: "s-3" },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_skadi_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("norse buff milestones trigger baldr, hel, jormungandr, and vidar", async () => {
  const tracker = stubIncrementTracker();
  try {
    const result = createResult();

    await AchievementService.handlePowerBuffApplied(
      "u-baldr",
      { source_ability_id: "baldr_immune", power_delta: 1, turn_number: 2 },
      result
    );

    await AchievementService.handlePowerBuffApplied(
      "u-hel",
      { source_ability_id: "hel_soul", power_delta: 1, turn_number: 9 },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      "u-hel",
      { source_ability_id: "hel_soul", power_delta: 1, turn_number: 9 },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      "u-hel",
      { source_ability_id: "hel_soul", power_delta: 1, turn_number: 9 },
      result
    );

    await AchievementService.handlePowerBuffApplied(
      "u-jorm",
      { source_ability_id: "jormungandr_shell", power_delta: 1 },
      result
    );
    await AchievementService.handlePowerBuffApplied(
      "u-vidar",
      { source_ability_id: "vidar_vengeance", power_delta: 1 },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId: "u-baldr", baseKey: "char_baldr_ach", incrementBy: 1 },
      { userId: "u-hel", baseKey: "char_hel_ach", incrementBy: 1 },
      { userId: "u-jorm", baseKey: "char_jormungandr_ach", incrementBy: 1 },
      { userId: "u-vidar", baseKey: "char_vidar_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("sigurd accumulated buff threshold awards at +10", async () => {
  const tracker = stubIncrementTracker();
  try {
    const result = createResult();

    await AchievementService.handlePowerBuffApplied(
      "u-sigurd",
      {
        source_ability_id: "sigurd_slayer",
        source_card_id: "sig-card",
        power_delta: 10,
      },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId: "u-sigurd", baseKey: "char_sigurd_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("fenrir destroy events increment character achievement", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-fenrir";
    const result = createResult();

    await AchievementService.handleCardDestroyed(
      userId,
      {
        destroyer_ability_id: "fenrir_devourer_surge",
        destroyer_original_owner: null,
        target_tags: ["beast"],
      },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_fenrir_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("surtr destroy events increment character achievement", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-surtr";
    const result = createResult();

    await AchievementService.handleCardDestroyed(
      userId,
      {
        destroyer_ability_id: "surtr_flames",
        destroyer_original_owner: null,
      },
      result
    );

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_surtr_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("loki requires 3 unique flips in one ability batch", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-loki";
    const result = createResult();
    const baseEvent = {
      source_ability_id: "loki_flip",
      source_original_owner: userId,
      source_card_id: "loki-card-1",
      batch_id: "loki-batch-1",
      turn_number: 7,
    };

    await AchievementService.handleCardFlipped(
      userId,
      { ...baseEvent, target_card_name: "Enemy A" },
      result
    );
    await AchievementService.handleCardFlipped(
      userId,
      { ...baseEvent, target_card_name: "Enemy B" },
      result
    );
    assert.equal(tracker.calls.length, 0);

    await AchievementService.handleCardFlipped(
      userId,
      { ...baseEvent, target_card_name: "Enemy C" },
      result
    );
    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_loki_ach", incrementBy: 1 },
    ]);

    // Additional flips in the same batch should not re-award.
    await AchievementService.handleCardFlipped(
      userId,
      { ...baseEvent, target_card_name: "Enemy D" },
      result
    );
    assert.equal(tracker.calls.length, 1);
  } finally {
    tracker.restore();
  }
});
