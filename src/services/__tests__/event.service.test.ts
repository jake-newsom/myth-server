import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert";

import EventService from "../event.service";
import EventCurrencyDropService from "../eventCurrencyDrop.service";
import EventMechanicService from "../eventMechanic.service";
import FeatureFlagService from "../featureFlag.service";
import { ActiveEvent } from "../../types/event.types";

const HOUR = 60 * 60 * 1000;

function makeEvent(overrides: Partial<ActiveEvent> = {}): ActiveEvent {
  const now = Date.now();
  return {
    id: "event-1",
    event_key: "test-event",
    name: "Test Event",
    description: null,
    starts_at: new Date(now - HOUR) as any,
    ends_at: new Date(now + HOUR) as any,
    is_active: true,
    preview_feature_flag_key: null,
    kill_switch_flag_key: null,
    currency_id: null,
    currency_drop_chance: 0,
    currency_drop_min: 0,
    currency_drop_max: 0,
    currency_drop_mode_multipliers: {},
    login_sequence_id: null,
    mechanic_key: null,
    mechanic_config: {},
    background_image_url: null,
    board_background_image_url: null,
    theme_color: null,
    icon_url: null,
    has_game_mode: false,
    game_mode_label: null,
    game_mode_description: null,
    sort_order: 0,
    access_reason: "live",
    currency: null,
    ...overrides,
  };
}

/** Stub the candidate list so visibility can be tested without a database. */
function withCandidates(events: ActiveEvent[]) {
  mock.method(EventService, "getCandidateEvents", async () => events);
}

/** Stub flag evaluation with an explicit set of enabled keys. */
function withFlags(enabled: string[]) {
  mock.method(FeatureFlagService, "isEnabled", async (_u: any, key: string) =>
    enabled.includes(key)
  );
}

describe("EventService — visibility", () => {
  beforeEach(() => mock.restoreAll());

  test("a live event is visible with no flag at all", async () => {
    withCandidates([makeEvent()]);
    withFlags([]);
    const events = await EventService.getEventsForUser("user-1");
    assert.equal(events.length, 1);
    assert.equal(events[0].access_reason, "live");
  });

  test("a live event does NOT require its preview flag", async () => {
    withCandidates([makeEvent({ preview_feature_flag_key: "halloween-2026" })]);
    withFlags([]); // flag off
    const events = await EventService.getEventsForUser("user-1");
    assert.equal(events.length, 1, "live window must not depend on the flag");
    assert.equal(events[0].access_reason, "live");
  });

  test("an upcoming event is hidden without the preview flag", async () => {
    const now = Date.now();
    withCandidates([
      makeEvent({
        starts_at: new Date(now + HOUR) as any,
        ends_at: new Date(now + 2 * HOUR) as any,
        preview_feature_flag_key: "halloween-2026",
      }),
    ]);
    withFlags([]);
    assert.deepEqual(await EventService.getEventsForUser("user-1"), []);
  });

  test("an upcoming event is visible WITH the preview flag", async () => {
    const now = Date.now();
    withCandidates([
      makeEvent({
        starts_at: new Date(now + HOUR) as any,
        ends_at: new Date(now + 2 * HOUR) as any,
        preview_feature_flag_key: "halloween-2026",
      }),
    ]);
    withFlags(["halloween-2026"]);
    const events = await EventService.getEventsForUser("user-1");
    assert.equal(events.length, 1);
    assert.equal(events[0].access_reason, "preview");
  });

  test("an upcoming event with no preview flag stays hidden", async () => {
    const now = Date.now();
    withCandidates([
      makeEvent({
        starts_at: new Date(now + HOUR) as any,
        ends_at: new Date(now + 2 * HOUR) as any,
      }),
    ]);
    withFlags([]);
    assert.deepEqual(await EventService.getEventsForUser("user-1"), []);
  });

  test("the kill switch hides an otherwise-live event", async () => {
    withCandidates([makeEvent({ kill_switch_flag_key: "halloween-2026-kill" })]);
    withFlags(["halloween-2026-kill"]);
    assert.deepEqual(await EventService.getEventsForUser("user-1"), []);
  });

  test("the kill switch also overrides preview access", async () => {
    const now = Date.now();
    withCandidates([
      makeEvent({
        starts_at: new Date(now + HOUR) as any,
        ends_at: new Date(now + 2 * HOUR) as any,
        preview_feature_flag_key: "halloween-2026",
        kill_switch_flag_key: "halloween-2026-kill",
      }),
    ]);
    withFlags(["halloween-2026", "halloween-2026-kill"]);
    assert.deepEqual(await EventService.getEventsForUser("user-1"), []);
  });

  test("no events for an anonymous user with only a preview event", async () => {
    const now = Date.now();
    withCandidates([
      makeEvent({
        starts_at: new Date(now + HOUR) as any,
        ends_at: new Date(now + 2 * HOUR) as any,
        preview_feature_flag_key: "halloween-2026",
      }),
    ]);
    withFlags([]);
    assert.deepEqual(await EventService.getEventsForUser(null), []);
  });
});

describe("EventCurrencyDropService — drop math", () => {
  beforeEach(() => mock.restoreAll());

  test("absent mode multiplier defaults to 1 (new modes inherit base rate)", () => {
    const event = makeEvent({
      currency_drop_mode_multipliers: { pvp: 1.5 },
    });
    assert.equal(EventCurrencyDropService.modeMultiplier(event, "pvp"), 1.5);
    assert.equal(EventCurrencyDropService.modeMultiplier(event, "solo"), 1);
    assert.equal(
      EventCurrencyDropService.modeMultiplier(event, "some_future_mode"),
      1
    );
  });

  test("a nonsense multiplier falls back to 1 rather than zeroing the drop", () => {
    const event = makeEvent({
      currency_drop_mode_multipliers: { solo: "abc" as any },
    });
    assert.equal(EventCurrencyDropService.modeMultiplier(event, "solo"), 1);
  });

  test("no drop when the event has no currency configured", async () => {
    const event = makeEvent({ currency_drop_chance: 1, currency_drop_max: 10 });
    assert.equal(
      await EventCurrencyDropService.rollForEvent("u", event, "solo"),
      null
    );
  });

  test("no drop when the chance is zero", async () => {
    const event = makeEvent({
      currency_id: "c1",
      currency: { id: "c1", currency_key: "candy", name: "Candy", description: null, icon_url: null },
      currency_drop_chance: 0,
      currency_drop_max: 10,
    });
    assert.equal(
      await EventCurrencyDropService.rollForEvent("u", event, "solo"),
      null
    );
  });

  test("a guaranteed drop credits the ledger and reports the amount", async () => {
    mock.method(EventService, "grantCurrency", async () => 42);
    const event = makeEvent({
      currency_id: "c1",
      currency: { id: "c1", currency_key: "candy", name: "Candy", description: null, icon_url: null },
      currency_drop_chance: 1,
      currency_drop_min: 7,
      currency_drop_max: 7,
    });
    const result = await EventCurrencyDropService.rollForEvent("u", event, "solo");
    assert.ok(result);
    assert.equal(result.amount, 7);
    assert.equal(result.balance, 42);
    assert.equal(result.currency_key, "candy");
  });
});

describe("EventMechanicService — config resolution", () => {
  test("no mechanic key resolves to no mechanics", () => {
    assert.deepEqual(EventMechanicService.resolveMechanics(makeEvent()), []);
  });

  test("short form combines the key with its config fields", () => {
    const event = makeEvent({
      mechanic_key: "haunted",
      mechanic_config: { tile_count: 5 },
    });
    assert.deepEqual(EventMechanicService.resolveMechanics(event), [
      { tile_count: 5, id: "haunted" },
    ]);
  });

  test("list form is passed through", () => {
    const event = makeEvent({
      mechanic_key: "haunted",
      mechanic_config: {
        mechanics: [
          { id: "haunted", tile_count: 3 },
          { id: "worlds_end", defeats_per_destroy: 2 },
        ],
      },
    });
    assert.equal(EventMechanicService.resolveMechanics(event).length, 2);
  });

  test("an unknown mechanic resolves to [] instead of throwing", () => {
    const event = makeEvent({
      mechanic_key: "not_a_real_mechanic",
      mechanic_config: {},
    });
    assert.deepEqual(EventMechanicService.resolveMechanics(event), []);
  });

  test("an invalid config for a real mechanic resolves to []", () => {
    const event = makeEvent({
      mechanic_key: "haunted",
      mechanic_config: { tile_count: -1 },
    });
    assert.deepEqual(EventMechanicService.resolveMechanics(event), []);
  });

  test("isKnownMechanic reflects the engine registry", () => {
    assert.equal(EventMechanicService.isKnownMechanic("haunted"), true);
    assert.equal(EventMechanicService.isKnownMechanic("worlds_end"), true);
    assert.equal(EventMechanicService.isKnownMechanic("nope"), false);
  });
});

describe("EventMechanicService — global mechanic scope", () => {
  beforeEach(() => mock.restoreAll());

  const hauntedEvent = () =>
    makeEvent({ mechanic_key: "haunted", mechanic_config: { tile_count: 5 } });

  test("ranked draft is excluded from the global event mechanic", async () => {
    withCandidates([hauntedEvent()]);
    withFlags([]);
    const result = await EventMechanicService.resolveGlobalMechanics(
      "user-1",
      "ranked_draft"
    );
    assert.deepEqual(result.mechanics, [], "rated draft must keep a clean board");
    assert.equal(result.eventId, null);
  });

  test("every other mode receives the mechanic", async () => {
    withCandidates([hauntedEvent()]);
    withFlags([]);
    for (const mode of ["solo", "pvp", "tower"]) {
      const result = await EventMechanicService.resolveGlobalMechanics("user-1", mode);
      assert.equal(result.mechanics.length, 1, `${mode} should get the mechanic`);
      assert.equal(result.mechanicKey, "haunted");
    }
  });

  test("no event means no mechanic (the pre-events path)", async () => {
    withCandidates([]);
    withFlags([]);
    const result = await EventMechanicService.resolveGlobalMechanics("user-1", "solo");
    assert.deepEqual(result.mechanics, []);
  });

  test("an event with no mechanic_key contributes nothing", async () => {
    withCandidates([makeEvent()]);
    withFlags([]);
    const result = await EventMechanicService.resolveGlobalMechanics("user-1", "solo");
    assert.deepEqual(result.mechanics, []);
  });

  test("an anonymous user never gets the mechanic", async () => {
    withCandidates([hauntedEvent()]);
    withFlags([]);
    const result = await EventMechanicService.resolveGlobalMechanics(null, "solo");
    assert.deepEqual(result.mechanics, []);
  });

  test("already-initialised mechanics (saga) are left alone", async () => {
    withCandidates([hauntedEvent()]);
    withFlags([]);
    const state: any = { mechanics: [{ config: { id: "worlds_end", defeats_per_destroy: 3 } }] };
    const result = await EventMechanicService.applyGlobalMechanics(state, "user-1", "solo");
    assert.deepEqual(result.events, []);
    assert.equal(result.eventContext, undefined);
    assert.equal(state.mechanics[0].config.id, "worlds_end");
  });
});
