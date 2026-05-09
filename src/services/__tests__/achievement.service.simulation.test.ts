import test from "node:test";
import assert from "node:assert/strict";
import AchievementService from "../achievement.service";
import { simulationContext } from "../../game-engine/simulation.context";
import { stubIncrementTracker } from "./achievement.test-helpers";

// Regression: AI lookahead calls GameLogic.placeCard within simulationContext
// to evaluate hypothetical moves. Those simulated placements must NOT credit
// the human player with achievement progress (e.g. "Minamoto played at +10
// Demon Bane" was being awarded dozens of times per real turn while the AI
// was searching its move tree).
test("triggerAchievementEvent is a no-op while inside simulation context", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-mina";

    await simulationContext.withSimulation(async () => {
      await AchievementService.triggerAchievementEvent({
        userId,
        eventType: "power_buff_applied",
        eventData: {
          source_ability_id: "minamoto_played_with_demon_bane_10",
          source_card_id: "mina-card",
          power_delta: 1,
        },
      });
    });

    assert.deepEqual(tracker.calls, []);
  } finally {
    tracker.restore();
  }
});

test("triggerAchievementEvent processes normally outside simulation context", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-mina";

    await AchievementService.triggerAchievementEvent({
      userId,
      eventType: "power_buff_applied",
      eventData: {
        source_ability_id: "minamoto_played_with_demon_bane_10",
        source_card_id: "mina-card",
        power_delta: 1,
      },
    });

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_minamoto_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});

test("simulation context unwinds correctly after withSimulation", async () => {
  const tracker = stubIncrementTracker();
  try {
    const userId = "u-mina";

    await simulationContext.withSimulation(async () => {
      await AchievementService.triggerAchievementEvent({
        userId,
        eventType: "power_buff_applied",
        eventData: {
          source_ability_id: "minamoto_played_with_demon_bane_10",
          source_card_id: "mina-card",
          power_delta: 1,
        },
      });
    });

    assert.equal(simulationContext.isInSimulation(), false);

    await AchievementService.triggerAchievementEvent({
      userId,
      eventType: "power_buff_applied",
      eventData: {
        source_ability_id: "minamoto_played_with_demon_bane_10",
        source_card_id: "mina-card",
        power_delta: 1,
      },
    });

    assert.deepEqual(tracker.calls, [
      { userId, baseKey: "char_minamoto_ach", incrementBy: 1 },
    ]);
  } finally {
    tracker.restore();
  }
});
