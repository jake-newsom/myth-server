import test from "node:test";
import assert from "node:assert/strict";
import { EffectType, TriggerMoment } from "../../types/card.types";
import { simulationContext } from "../simulation.context";
import { norseAbilities } from "../abilities/norse.abilities";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

test("njord_sea buffs when adjacent to a sea-tagged card", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();

    const njord = createTestCard({
      id: "njord",
      owner: "p1",
      abilityId: "njord_sea",
    });
    njord.base_card_data.tags = ["norse", "god", "sea"];

    const seaAlly = createTestCard({
      id: "sea-ally",
      owner: "p1",
    });
    seaAlly.base_card_data.tags = ["norse", "human", "sea"];

    placeCardOnBoard(board, { x: 1, y: 1 }, seaAlly);
    placeCardOnBoard(board, { x: 1, y: 0 }, njord);

    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
    });

    const events = norseAbilities.njord_sea({
      state,
      triggerCard: njord,
      triggerMoment: TriggerMoment.OnPlace,
      position: { x: 1, y: 0 },
    });

    assert.equal(events.length, 1);
    assert.equal(njord.temporary_effects.length, 1);
    assert.equal(njord.temporary_effects[0].power.top, 3);
    assert.equal(
      (events[0] as unknown as { effectName: string }).effectName,
      "Noatun’s Guard",
    );
  } finally {
    simulationContext.exitSimulation();
  }
});

test("njord_sea does not buff without an adjacent sea-tagged card", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();

    const njord = createTestCard({
      id: "njord",
      owner: "p1",
      abilityId: "njord_sea",
    });
    njord.base_card_data.tags = ["norse", "god", "sea"];

    const nonSeaAlly = createTestCard({
      id: "ally",
      owner: "p1",
    });
    nonSeaAlly.base_card_data.tags = ["norse", "human", "warrior"];

    placeCardOnBoard(board, { x: 1, y: 1 }, nonSeaAlly);
    placeCardOnBoard(board, { x: 1, y: 0 }, njord);

    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
    });

    const events = norseAbilities.njord_sea({
      state,
      triggerCard: njord,
      triggerMoment: TriggerMoment.OnPlace,
      position: { x: 1, y: 0 },
    });

    assert.equal(events.length, 0);
    assert.equal(njord.temporary_effects.length, 0);
  } finally {
    simulationContext.exitSimulation();
  }
});

test("vidar_vengeance buffs only Vidar when Odin has been defeated", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();

    const vidar = createTestCard({
      id: "vidar",
      owner: "p1",
      abilityId: "vidar_vengeance",
    });
    vidar.base_card_data.name = "Vidar";

    const ally = createTestCard({
      id: "ally",
      owner: "p1",
    });

    const defeatedOdin = createTestCard({
      id: "odin",
      owner: "p2",
    });
    defeatedOdin.base_card_data.name = "Odin";
    defeatedOdin.defeats.push({
      user_card_instance_id: "defeater",
      base_card_id: "base-defeater",
      name: "Defeater",
    });

    placeCardOnBoard(board, { x: 1, y: 1 }, vidar);
    placeCardOnBoard(board, { x: 1, y: 2 }, ally);
    placeCardOnBoard(board, { x: 0, y: 0 }, defeatedOdin);

    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
    });

    const events = norseAbilities.vidar_vengeance({
      state,
      triggerCard: vidar,
      triggerMoment: TriggerMoment.OnPlace,
      position: { x: 1, y: 1 },
    });

    assert.equal(events.length, 1);
    assert.ok("cardId" in events[0]);
    assert.equal((events[0] as unknown as { cardId: string }).cardId, "vidar");
    assert.equal(vidar.temporary_effects.length, 1);
    assert.equal(ally.temporary_effects.length, 0);
  } finally {
    simulationContext.exitSimulation();
  }
});

// --- baldr_immune: bounce-to-hand ------------------------------------------

function inSimulation(fn: () => void) {
  simulationContext.enterSimulation();
  try {
    fn();
  } finally {
    simulationContext.exitSimulation();
  }
}

/** Baldr, captured by p2, on the board carrying a buff and an enhancement. */
function setupCapturedBaldr() {
  const board = createEmptyBoard();

  const baldr = createTestCard({
    id: "baldr",
    owner: "p1",
    abilityId: "baldr_immune",
  });
  // p2 has flipped him: current controller is p2, original owner still p1.
  baldr.owner = "p2";
  baldr.temporary_effects = [
    {
      type: EffectType.Buff,
      power: { top: 2, right: 2 },
      duration: 99,
      name: "Test Buff",
    },
  ];
  baldr.power_enhancements = { top: 1, right: 0, bottom: 0, left: 0 };
  baldr.current_power = { top: 7, right: 6, bottom: 4, left: 4 };

  placeCardOnBoard(board, { x: 1, y: 1 }, baldr);

  // The hand/cache copy is the pristine card, as it was before it hit the board.
  const cached = createTestCard({ id: "baldr", owner: "p1" });

  const state = createTestGameState({
    board,
    player1Id: "p1",
    player2Id: "p2",
    hydrated: { baldr: cached },
  });

  return { board, baldr, cached, state };
}

function triggerBaldr(state: any, baldr: any) {
  return norseAbilities.baldr_immune({
    state,
    triggerCard: baldr,
    triggerMoment: TriggerMoment.OnFlipped,
    position: { x: 1, y: 1 },
  });
}

test("baldr_immune returns to the current owner, not the original owner", () => {
  inSimulation(() => {
    const { baldr, cached, state } = setupCapturedBaldr();

    triggerBaldr(state, baldr);

    // Current controller p2 gets him, not original owner p1.
    assert.deepEqual(state.player2.hand, ["baldr"]);
    assert.deepEqual(state.player1.hand, []);
    // Cached owner follows, or placeCard would reject him from p2's hand.
    assert.equal(cached.owner, "p2");
    // And he is off the board.
    assert.equal(state.board[1][1].card, null);
  });
});

test("baldr_immune keeps buffs and debuffs when it bounces to hand", () => {
  inSimulation(() => {
    const { baldr, cached, state } = setupCapturedBaldr();

    triggerBaldr(state, baldr);

    // Board state is written back into the cache the hand reads from.
    assert.equal(cached.temporary_effects.length, 1);
    assert.equal(cached.temporary_effects[0].power.top, 2);
    assert.equal(cached.power_enhancements.top, 1);
    assert.deepEqual(cached.current_power, {
      top: 7,
      right: 6,
      bottom: 4,
      left: 4,
    });
  });
});

test("baldr_immune copies effects rather than sharing them", () => {
  inSimulation(() => {
    const { baldr, cached, state } = setupCapturedBaldr();

    triggerBaldr(state, baldr);

    // Mutating the old board card must not reach back into the hand copy.
    baldr.temporary_effects[0].power.top = 99;
    assert.equal(cached.temporary_effects[0].power.top, 2);
  });
});

test("baldr_immune returns an uncaptured Baldr to his owner", () => {
  inSimulation(() => {
    const { baldr, cached, state } = setupCapturedBaldr();
    // Never flipped: controller is still the original owner.
    baldr.owner = "p1";

    triggerBaldr(state, baldr);

    assert.deepEqual(state.player1.hand, ["baldr"]);
    assert.equal(cached.owner, "p1");
    assert.equal(cached.temporary_effects.length, 1);
  });
});
