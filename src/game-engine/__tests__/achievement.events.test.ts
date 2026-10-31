import test from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.config";
import GameService from "../../services/game.service";
import AchievementService from "../../services/achievement.service";
import DailyTaskService from "../../services/dailyTask.service";
import { GameStatus } from "../game.logic";
import { simulationContext } from "../simulation.context";
import {
  beginAchievementMove,
  emitAchievementEvent,
  emitDailyTaskEvent,
} from "../achievement.events";
import { GameState } from "../../types/game.types";

const state = { status: GameStatus.ACTIVE } as unknown as GameState;
const event = (userId: string) =>
  ({ userId, eventType: "power_buff_applied", eventData: {} }) as any;

function stubTrigger(t: any) {
  return t.mock.method(AchievementService, "triggerAchievementEvent", async () => []);
}
const users = (trigger: any) =>
  trigger.mock.calls.map((c: any) => c.arguments[0].userId);

test("buffered events dispatch in order only after the save", async (t) => {
  const trigger = stubTrigger(t);
  t.mock.method(db, "query", async () => ({ rows: [{ state_version: 1 }] }));

  await (async () => {
    beginAchievementMove();
    emitAchievementEvent(event("a"));
    emitAchievementEvent(event("b"));
    assert.deepEqual(users(trigger), []);
    await GameService.updateGameAfterAction("g", state, GameStatus.ACTIVE, null);
    assert.deepEqual(users(trigger), ["a", "b"]);
    // Already flushed: a second write in the same move doesn't repeat them.
    await GameService.updateGameAfterAction("g", state, GameStatus.ACTIVE, null);
    assert.deepEqual(users(trigger), ["a", "b"]);
  })();
});

test("a version conflict credits nothing", async (t) => {
  const trigger = stubTrigger(t);
  t.mock.method(db, "query", async () => ({ rows: [] }));

  await (async () => {
    beginAchievementMove();
    emitAchievementEvent(event("a"));
    await assert.rejects(
      GameService.updateGameAfterAction("g", state, GameStatus.ACTIVE, null, 3)
    );
  })();
  assert.deepEqual(users(trigger), []);
});

test("a failed save credits nothing", async (t) => {
  const trigger = stubTrigger(t);
  t.mock.method(db, "query", async () => {
    throw new Error("db down");
  });

  await (async () => {
    beginAchievementMove();
    emitAchievementEvent(event("a"));
    await assert.rejects(
      GameService.updateGameAfterAction("g", state, GameStatus.ACTIVE, null)
    );
  })();
  assert.deepEqual(users(trigger), []);
});

test("concurrent moves keep separate buffers", async (t) => {
  const trigger = stubTrigger(t);
  t.mock.method(db, "query", async () => ({ rows: [{ state_version: 1 }] }));

  const move = async (user: string, save: boolean) => {
    beginAchievementMove();
    emitAchievementEvent(event(user));
    await new Promise((resolve) => setImmediate(resolve));
    if (save) {
      await GameService.updateGameAfterAction("g", state, GameStatus.ACTIVE, null);
    }
  };
  await Promise.all([move("saved", true), move("rejected", false)]);
  assert.deepEqual(users(trigger), ["saved"]);
});

test("simulation emits nothing, and no open buffer dispatches immediately", async (t) => {
  const trigger = stubTrigger(t);

  await simulationContext.withSimulation(async () => {
    emitAchievementEvent(event("sim"));
  });
  assert.deepEqual(users(trigger), []);

  emitAchievementEvent(event("direct"));
  assert.deepEqual(users(trigger), ["direct"]);
});

test("daily tasks wait for the save too", async (t) => {
  const defeat = t.mock.method(DailyTaskService, "trackDefeat", async () => {});
  const mythology = t.mock.method(DailyTaskService, "trackDefeatWithMythology", async () => {});
  const curse = t.mock.method(DailyTaskService, "trackCurse", async () => {});
  t.mock.method(db, "query", async () => ({ rows: [{ state_version: 1 }] }));

  await (async () => {
    beginAchievementMove();
    emitDailyTaskEvent({ type: "defeat", userId: "a", setId: "s" });
    emitDailyTaskEvent({ type: "curse", userId: "a" });
    assert.equal(defeat.mock.callCount(), 0);
    await GameService.updateGameAfterAction("g", state, GameStatus.ACTIVE, null);
  })();
  assert.equal(defeat.mock.callCount(), 1);
  assert.deepEqual(mythology.mock.calls[0].arguments, ["a", "s"]);
  assert.equal(curse.mock.callCount(), 1);
});

test("a rejected move's daily tasks are dropped", async (t) => {
  const defeat = t.mock.method(DailyTaskService, "trackDefeat", async () => {});
  t.mock.method(db, "query", async () => ({ rows: [] }));

  await (async () => {
    beginAchievementMove();
    emitDailyTaskEvent({ type: "defeat", userId: "a", setId: "s" });
    await assert.rejects(
      GameService.updateGameAfterAction("g", state, GameStatus.ACTIVE, null, 3)
    );
  })();
  assert.equal(defeat.mock.callCount(), 0);
});
