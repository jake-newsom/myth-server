import test, { after } from "node:test";
import assert from "node:assert/strict";

import { abilities, combatResolvers } from "../../src/game-engine/abilities";
import { TriggerMoment, InGameCard, EffectType } from "../../src/types/card.types";
import {
  BoardPosition,
  GameBoard,
  GameState,
  TileStatus,
} from "../../src/types/game.types";
import { TriggerContext, CombatContext } from "../../src/types/game-engine.types";
import {
  GameStatus,
  applyPreconditionBuffBeat,
} from "../../src/game-engine/game.logic";
import {
  createBoardCell,
  holdPlacedCardDebuffBeforeDefend,
  resolveCombat,
  triggerAbilities,
} from "../../src/game-engine/game.utils";
import { EVENT_TYPES } from "../../src/types";
import { blockTile } from "../../src/game-engine/ability.utils";
import DailyTaskService from "../../src/services/dailyTask.service";
import SeasonSoulsService from "../../src/services/seasonSouls.service";

const BOARD_SIZE = 4;
const PLAYER_1 = "player-1";
const PLAYER_2 = "player-2";
const CENTER: BoardPosition = { x: 1, y: 1 };
const RIGHT_OF_CENTER: BoardPosition = { x: 2, y: 1 };
const LEFT_OF_CENTER: BoardPosition = { x: 0, y: 1 };
const originalConsoleLog = console.log;

// Avoid external DB writes/log noise from fire-and-forget trackers in ability/game utils.
const dailyTaskServiceMutable = DailyTaskService as unknown as Record<string, unknown>;
const seasonSoulsServiceMutable =
  SeasonSoulsService as unknown as Record<string, unknown>;

dailyTaskServiceMutable.trackDestroy = async () => {};
dailyTaskServiceMutable.trackCurse = async () => {};
dailyTaskServiceMutable.trackBless = async () => {};
dailyTaskServiceMutable.trackDefeat = async () => {};
dailyTaskServiceMutable.trackDefeatWithMythology = async () => {};
seasonSoulsServiceMutable.trackDefeat = () => {};

// Reduce noisy ability debug logs during test runs.
console.log = () => {};

function makeBoard(): GameBoard {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({
      card: null,
      tile_enabled: true,
    })),
  );
}

function makeCard(params: {
  id: string;
  name: string;
  owner: string;
  tags?: string[];
  abilityName?: string;
}): InGameCard {
  const { id, name, owner, tags = [], abilityName } = params;

  const specialAbility = abilityName
    ? {
        ability_id: `${abilityName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_id`,
        id: `${abilityName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_slug`,
        name: abilityName,
        description: `${abilityName} test ability`,
        triggerMoments: [TriggerMoment.OnPlace],
        parameters: {},
      }
    : null;

  return {
    user_card_instance_id: id,
    base_card_id: `base-${id}`,
    level: 1,
    xp: 0,
    is_locked: false,
    power_enhancements: { top: 0, bottom: 0, left: 0, right: 0 },
    card_modifiers_positive: { top: 0, bottom: 0, left: 0, right: 0 },
    card_modifiers_negative: { top: 0, bottom: 0, left: 0, right: 0 },
    temporary_effects: [],
    current_power: { top: 5, bottom: 5, left: 5, right: 5 },
    owner,
    original_owner: owner,
    lockedTurns: 0,
    lockedBy: null,
    defeats: [],
    base_card_data: {
      card_id: `card-${id}`,
      name,
      rarity: "rare",
      image_url: "https://example.com/card.png",
      base_power: { top: 5, bottom: 5, left: 5, right: 5 },
      special_ability: specialAbility,
      tags,
      set_id: "test-set",
      attack_animation: "attack",
      is_exclusive: false,
    },
  };
}

function makeGameState(): GameState {
  return {
    board: makeBoard(),
    player1: {
      user_id: PLAYER_1,
      hand: [],
      deck: [],
      discard_pile: [],
      score: 0,
    },
    player2: {
      user_id: PLAYER_2,
      hand: [],
      deck: [],
      discard_pile: [],
      score: 0,
    },
    current_player_id: PLAYER_1,
    turn_number: 1,
    status: GameStatus.ACTIVE,
    max_cards_in_hand: 5,
    initial_cards_to_draw: 3,
    winner: null,
    hydrated_card_data_cache: {},
  };
}

function placeCard(state: GameState, position: BoardPosition, card: InGameCard): void {
  state.board[position.y][position.x].card = card;
  state.hydrated_card_data_cache![card.user_card_instance_id] = card;
}

function setupContext(abilityName: string): {
  state: GameState;
  triggerCard: InGameCard;
  allyCard: InGameCard;
  enemyCard: InGameCard;
  defeatedEnemyCard: InGameCard;
} {
  const state = makeGameState();

  const triggerCard = makeCard({
    id: `trigger-${abilityName}`,
    name: abilityName,
    owner: PLAYER_1,
    tags: ["warrior", "demon", "dragon", "beast", "goddess", "valkyrie"],
    abilityName,
  });

  const allyCard = makeCard({
    id: `ally-${abilityName}`,
    name: "Ally",
    owner: PLAYER_1,
    tags: ["goddess", "valkyrie"],
  });

  const enemyCard = makeCard({
    id: `enemy-${abilityName}`,
    name: "Enemy",
    owner: PLAYER_2,
    tags: ["demon", "dragon", "beast", "thor", "goddess"],
  });

  const defeatedEnemyCard = makeCard({
    id: `defeated-${abilityName}`,
    name: "Defeated Enemy",
    owner: PLAYER_2,
    tags: ["demon"],
  });

  // Seed board for adjacency/row/column based abilities.
  placeCard(state, CENTER, triggerCard);
  placeCard(state, LEFT_OF_CENTER, allyCard);
  placeCard(state, RIGHT_OF_CENTER, enemyCard);

  // Add one extra enemy to row/column to satisfy broader selectors.
  placeCard(state, { x: 1, y: 0 }, defeatedEnemyCard);

  // Add hand cards for hand-targeting abilities.
  const handAlly1 = makeCard({
    id: `hand-a-${abilityName}`,
    name: "Hand Ally A",
    owner: PLAYER_1,
  });
  const handAlly2 = makeCard({
    id: `hand-b-${abilityName}`,
    name: "Hand Ally B",
    owner: PLAYER_1,
  });
  const handEnemy = makeCard({
    id: `hand-e-${abilityName}`,
    name: "Hand Enemy",
    owner: PLAYER_2,
  });

  state.player1.hand = [handAlly1.user_card_instance_id, handAlly2.user_card_instance_id];
  state.player2.hand = [handEnemy.user_card_instance_id];
  state.hydrated_card_data_cache![handAlly1.user_card_instance_id] = handAlly1;
  state.hydrated_card_data_cache![handAlly2.user_card_instance_id] = handAlly2;
  state.hydrated_card_data_cache![handEnemy.user_card_instance_id] = handEnemy;

  // Seed an existing tile effect for terrain interactions.
  state.board[CENTER.y][CENTER.x].tile_effect = {
    status: TileStatus.Boosted,
    turns_left: 5,
    animation_label: "water",
    terrain: undefined,
    effect_duration: 5,
    power: { top: 1, bottom: 1, left: 1, right: 1 },
  };

  return { state, triggerCard, allyCard, enemyCard, defeatedEnemyCard };
}

function buildContext(params: {
  state: GameState;
  triggerCard: InGameCard;
  triggerMoment: TriggerMoment;
  position?: BoardPosition;
  originalTriggerCard?: InGameCard;
  flippedCard?: InGameCard;
  flippedBy?: InGameCard;
}): TriggerContext {
  return {
    state: params.state,
    triggerCard: params.triggerCard,
    triggerMoment: params.triggerMoment,
    position: params.position ?? CENTER,
    originalTriggerCard: params.originalTriggerCard,
    flippedCard: params.flippedCard,
    flippedBy: params.flippedBy,
  } as TriggerContext;
}

for (const [abilityName, abilityFn] of Object.entries(abilities)) {
  test(`ability "${abilityName}" handles baseline and edge-case contexts`, () => {
    // Baseline board-driven invocation.
    {
      const { state, triggerCard, allyCard, enemyCard } = setupContext(abilityName);
      const context = buildContext({
        state,
        triggerCard,
        triggerMoment: TriggerMoment.OnPlace,
        position: CENTER,
        originalTriggerCard: allyCard,
        flippedCard: enemyCard,
        flippedBy: triggerCard,
      });

      const result = abilityFn(context);
      assert.ok(Array.isArray(result), `${abilityName} should return events array`);
    }

    // Trigger card missing from board should not crash.
    {
      const { state, triggerCard, allyCard, enemyCard } = setupContext(abilityName);
      state.board[CENTER.y][CENTER.x].card = null;
      const offBoardContext = buildContext({
        state,
        triggerCard,
        triggerMoment: TriggerMoment.OnTurnEnd,
        position: CENTER,
        originalTriggerCard: allyCard,
        flippedCard: enemyCard,
        flippedBy: triggerCard,
      });

      assert.doesNotThrow(() => abilityFn(offBoardContext));
      const result = abilityFn(offBoardContext);
      assert.ok(Array.isArray(result), `${abilityName} should return array off-board`);
    }

    // Flip/defeat style trigger with sparse optional context.
    {
      const { state, triggerCard, enemyCard } = setupContext(abilityName);
      const sparseContext = buildContext({
        state,
        triggerCard,
        triggerMoment: TriggerMoment.AnyOnFlip,
        position: CENTER,
        originalTriggerCard: enemyCard,
      });

      assert.doesNotThrow(() => abilityFn(sparseContext));
      const result = abilityFn(sparseContext);
      assert.ok(Array.isArray(result), `${abilityName} should return array for AnyOnFlip`);
    }

    // Detached trigger metadata should not crash (card IDs not found on board).
    {
      const { state, triggerCard } = setupContext(abilityName);
      const detachedCard = makeCard({
        id: `detached-${abilityName}`,
        name: "Detached",
        owner: PLAYER_2,
        tags: ["demon", "dragon"],
      });

      const detachedContext = buildContext({
        state,
        triggerCard,
        triggerMoment: TriggerMoment.AnyOnFlip,
        position: CENTER,
        originalTriggerCard: detachedCard,
        flippedCard: detachedCard,
        flippedBy: detachedCard,
      });

      assert.doesNotThrow(() => abilityFn(detachedContext));
      const result = abilityFn(detachedContext);
      assert.ok(Array.isArray(result), `${abilityName} should return array with detached cards`);
    }
  });
}

for (const [resolverName, resolverFn] of Object.entries(combatResolvers)) {
  test(`combat resolver "${resolverName}" handles sparse combat contexts`, () => {
    const { state, triggerCard, enemyCard } = setupContext(resolverName);
    const context: CombatContext = {
      ...(buildContext({
        state,
        triggerCard,
        triggerMoment: TriggerMoment.OnCombat,
        position: RIGHT_OF_CENTER,
        flippedCard: enemyCard,
        flippedBy: triggerCard,
      }) as TriggerContext),
      combatType: "STANDARD",
    };

    const result = resolverFn(context);
    assert.equal(typeof result.preventDefeat, "boolean");

    const sparseContext: CombatContext = {
      ...(buildContext({
        state,
        triggerCard,
        triggerMoment: TriggerMoment.OnCombat,
        position: RIGHT_OF_CENTER,
      }) as TriggerContext),
      combatType: "STANDARD",
    };

    assert.doesNotThrow(() => resolverFn(sparseContext));
    const sparseResult = resolverFn(sparseContext);
    assert.equal(typeof sparseResult.preventDefeat, "boolean");
  });
}

/**
 * Regression: `blockTile` must not soft-lock the board by blocking the last
 * playable tile. A tile is "playable" only if it has no card AND isn't already
 * blocked. The previous implementation counted every empty tile (including
 * blocked ones) as "open", which let Heimdall block the final playable tile
 * when other empties were already blocked, or block both of two adjacent
 * empties in sequence (each call mutates the board and the next call sees the
 * just-blocked tile as still "open").
 */

function fillBoardExcept(
  board: GameBoard,
  emptyPositions: BoardPosition[],
  ownerId: string,
): void {
  const emptyKeys = new Set(emptyPositions.map((p) => `${p.x},${p.y}`));
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (emptyKeys.has(`${x},${y}`)) continue;
      board[y][x].card = makeCard({
        id: `filler-${x}-${y}`,
        name: `Filler ${x},${y}`,
        owner: ownerId,
      });
    }
  }
}

test("blockTile refuses to block the last playable tile when other empties are already blocked", () => {
  const board = makeBoard();
  const blockedEmpty: BoardPosition = { x: 0, y: 0 };
  const lastOpen: BoardPosition = { x: 3, y: 3 };

  fillBoardExcept(board, [blockedEmpty, lastOpen], PLAYER_1);

  // Pre-block one empty tile so it has `card === null` but is not playable.
  board[blockedEmpty.y][blockedEmpty.x].tile_effect = {
    status: TileStatus.Blocked,
    turns_left: 2,
    animation_label: "frozen",
  };

  const before = board[lastOpen.y][lastOpen.x].tile_effect;
  const event = blockTile(lastOpen, board, 2, "heimdall_gate");

  assert.equal(event, undefined, "should refuse to block the last playable tile");
  assert.equal(
    board[lastOpen.y][lastOpen.x].tile_effect,
    before,
    "tile_effect should be unchanged when the call is refused",
  );
});

test("sequential blockTile calls leave at least one playable tile (Heimdall soft-lock regression)", () => {
  const board = makeBoard();
  const tileA: BoardPosition = { x: 0, y: 0 };
  const tileB: BoardPosition = { x: 0, y: 1 };

  // Only two playable tiles on the entire board.
  fillBoardExcept(board, [tileA, tileB], PLAYER_1);

  const eventA = blockTile(tileA, board, 2, "heimdall_gate");
  assert.ok(eventA, "first call should successfully block tile A");
  assert.equal(
    board[tileA.y][tileA.x].tile_effect?.status,
    TileStatus.Blocked,
  );

  // The buggy implementation counted tile A (now blocked, no card) as still
  // "open" and would happily block tile B too, leaving zero playable tiles.
  const eventB = blockTile(tileB, board, 2, "heimdall_gate");
  assert.equal(
    eventB,
    undefined,
    "second call must refuse so at least one playable tile remains",
  );
  assert.notEqual(
    board[tileB.y][tileB.x].tile_effect?.status,
    TileStatus.Blocked,
    "tile B should remain playable",
  );
});

test("heimdall_block end-to-end never blocks the last playable tile on the board", () => {
  const state = makeGameState();
  const board = state.board;

  const heimdallPos: BoardPosition = { x: 1, y: 1 };
  // Two empty tiles adjacent to Heimdall; everything else is filled.
  // After Heimdall is placed, only these two adjacent tiles remain playable.
  const adjacentEmpty1: BoardPosition = { x: 0, y: 1 };
  const adjacentEmpty2: BoardPosition = { x: 2, y: 1 };

  fillBoardExcept(board, [heimdallPos, adjacentEmpty1, adjacentEmpty2], PLAYER_2);

  const heimdall = makeCard({
    id: "heimdall-1",
    name: "Heimdall",
    owner: PLAYER_1,
    abilityName: "Heimdall",
  });
  placeCard(state, heimdallPos, heimdall);

  const heimdallBlock = abilities["heimdall_block"];
  assert.ok(heimdallBlock, "heimdall_block ability should be registered");

  const events = heimdallBlock(
    buildContext({
      state,
      triggerCard: heimdall,
      triggerMoment: TriggerMoment.OnPlace,
      position: heimdallPos,
    }),
  );

  assert.ok(Array.isArray(events));

  const playableCount = board
    .flat()
    .filter(
      (t) => t.card === null && t.tile_effect?.status !== TileStatus.Blocked,
    ).length;

  assert.ok(
    playableCount >= 1,
    `heimdall_block left ${playableCount} playable tiles; must leave at least 1`,
  );
});

// Regression: AnyOnFlip reaction abilities (Hunter's Mark) must (a) still
// identify the defeated card's original owner after the OnFlip event emission
// was reordered to animate AFTER the flip, and (b) emit their CARD_POWER_CHANGED
// events *after* the CARD_FLIPPED they react to.
test("Hunter's Mark: applied on ally defeat AND emitted after the flip", () => {
  const state = makeGameState();

  // My board: an Okuriinu (Hunter's Mark) watcher + the ally that gets defeated.
  const okuriinu = makeCard({
    id: "okuriinu",
    name: "Okuriinu",
    owner: PLAYER_1,
    tags: ["beast"],
  });
  okuriinu.base_card_data.special_ability = {
    ability_id: "okuriinu_hunters_mark",
    id: "okuriinu_hunters_mark",
    name: "Hunter's Mark",
    description: "When an ally is defeated, drain power from the attacker.",
    triggerMoments: [TriggerMoment.AnyOnFlip],
    parameters: {},
  } as InGameCard["base_card_data"]["special_ability"];

  const myAlly = makeCard({
    id: "my-ally",
    name: "My Ally",
    owner: PLAYER_1,
    tags: ["beast"],
  });
  myAlly.base_card_data.base_power = { top: 2, right: 2, bottom: 2, left: 2 };
  myAlly.current_power = { top: 2, right: 2, bottom: 2, left: 2 };

  // Enemy attacker placed adjacent to my ally; strong enough to flip it.
  const attacker = makeCard({
    id: "attacker",
    name: "Attacker",
    owner: PLAYER_2,
    tags: ["demon"],
  });
  attacker.base_card_data.base_power = { top: 9, right: 9, bottom: 9, left: 9 };
  attacker.current_power = { top: 9, right: 9, bottom: 9, left: 9 };

  // Layout: okuriinu at (0,1), my ally at (1,1), attacker placed at (2,1).
  // Attacker's left(9) beats ally's right(2) → ally flips to PLAYER_2.
  placeCard(state, { x: 0, y: 1 }, okuriinu);
  placeCard(state, { x: 1, y: 1 }, myAlly);
  placeCard(state, { x: 2, y: 1 }, attacker);
  state.current_player_id = PLAYER_2;

  const { events } = resolveCombat(state, { x: 2, y: 1 }, PLAYER_2);

  // (a) Owner-timing parity: the ally flipped, and Hunter's Mark debuffed the
  // attacker (a -2 CARD_POWER_CHANGED named "Hunter's Mark" on the attacker).
  assert.equal(
    state.board[1][1].card?.owner,
    PLAYER_2,
    "ally should have flipped to the attacker",
  );
  const huntersMark = events.find(
    (e) =>
      e.type === EVENT_TYPES.CARD_POWER_CHANGED &&
      (e as any).effectName === "Hunter's Mark" &&
      (e as any).cardId === attacker.user_card_instance_id,
  );
  assert.ok(
    huntersMark,
    "Hunter's Mark debuff should be applied to the attacker",
  );

  // (b) Ordering: the CARD_FLIPPED for my ally must come before the Hunter's
  // Mark power change (consequence animates after the flip).
  const flipIdx = events.findIndex(
    (e) =>
      e.type === EVENT_TYPES.CARD_FLIPPED &&
      (e as any).cardId === myAlly.user_card_instance_id,
  );
  const markIdx = events.indexOf(huntersMark!);
  assert.ok(flipIdx >= 0, "expected a CARD_FLIPPED for the defeated ally");
  assert.ok(
    flipIdx < markIdx,
    `CARD_FLIPPED (idx ${flipIdx}) must precede Hunter's Mark (idx ${markIdx})`,
  );
});

// An OnPlace placement buff must hold long enough to read before the following
// combat / turn-end events rush past. The OnPlace ability batch closes with a
// longer trailing delay (250ms) than the default (100ms).
test("OnPlace buff (Shore Fury) gets the longer 250ms hold", () => {
  const state = makeGameState();

  const ushiOni = makeCard({
    id: "ushi-oni",
    name: "Ushi-Oni",
    owner: PLAYER_1,
    tags: ["beast"],
  });
  ushiOni.base_card_data.special_ability = {
    ability_id: "ushi_oni_shore_fury",
    id: "ushi_oni_shore_fury",
    name: "Shore Fury",
    description: "Gains +2 power if placed on an edge.",
    triggerMoments: [TriggerMoment.OnPlace],
    parameters: {},
  } as InGameCard["base_card_data"]["special_ability"];

  // Edge placement (x:0) so Shore Fury triggers.
  const edgePos: BoardPosition = { x: 0, y: 1 };
  placeCard(state, edgePos, ushiOni);

  const events = triggerAbilities(TriggerMoment.OnPlace, {
    state,
    triggerCard: ushiOni,
    triggerMoment: TriggerMoment.OnPlace,
    position: edgePos,
  });

  const shoreFury = events.find(
    (e) =>
      e.type === EVENT_TYPES.CARD_POWER_CHANGED &&
      (e as any).effectName === "Shore Fury",
  );
  assert.ok(shoreFury, "Shore Fury buff event should be emitted");
  assert.equal(
    shoreFury!.delayAfterMs,
    250,
    "OnPlace placement buff should hold for 250ms, not the default 100ms",
  );
});

// A board card debuffed by a lifecycle/Any* ability (Moon's Balance on
// OnRoundEnd) must have its current_power recomputed before the state is
// returned. Previously triggerIndirectAbilities only recomputed hand cards, so
// the board enemy's current_power was stale and the client showed old values
// until the next state push.
test("Moon's Balance debuff updates the board enemy's current_power", () => {
  const state = makeGameState();

  const tsukuyomi = makeCard({
    id: "tsukuyomi",
    name: "Tsukuyomi",
    owner: PLAYER_1,
    tags: ["goddess"],
  });
  tsukuyomi.base_card_data.special_ability = {
    ability_id: "tsukuyomi_moons_balance",
    id: "tsukuyomi_moons_balance",
    name: "Moon's Balance",
    description: "Each round, weaken the strongest enemy and buff a hand card.",
    triggerMoments: [TriggerMoment.OnRoundEnd],
    parameters: {},
  } as InGameCard["base_card_data"]["special_ability"];

  const enemy = makeCard({
    id: "moon-enemy",
    name: "Moon Enemy",
    owner: PLAYER_2,
    tags: ["demon"],
  });
  enemy.current_power = { top: 5, right: 5, bottom: 5, left: 5 };

  placeCard(state, CENTER, tsukuyomi);
  placeCard(state, RIGHT_OF_CENTER, enemy);

  triggerAbilities(TriggerMoment.OnRoundEnd, {
    state,
    triggerMoment: TriggerMoment.OnRoundEnd,
    position: { x: 0, y: 0 },
  });

  // Enemy (base 5/side) should now read 3/side from the -2 Moon's Balance debuff.
  const enemyOnBoard = state.board[CENTER.y][RIGHT_OF_CENTER.x].card;
  assert.equal(
    enemyOnBoard?.user_card_instance_id,
    enemy.user_card_instance_id,
    "enemy should still be at RIGHT_OF_CENTER",
  );
  assert.equal(
    enemyOnBoard?.current_power.top,
    3,
    "board enemy current_power should reflect the -2 Moon's Balance debuff",
  );
  assert.equal(enemyOnBoard?.current_power.left, 3);
});

// CARD_PLACED carries `powerOnPlace` = the card's power as it lands, taken from
// createBoardCell's computed current_power. It must include effects the card
// already carried from hand (e.g. Sacred Spring's +1) so the client doesn't
// render end-of-batch power at placement time.
test("createBoardCell includes hand-carried buffs in the placed card's power", () => {
  const card = makeCard({
    id: "ukupanipo",
    name: "Ukupanipo",
    owner: PLAYER_1,
    tags: ["beast"],
  });
  card.base_card_data.base_power = { top: 4, right: 4, bottom: 13, left: 4 };
  // Buff picked up while still in hand (Sacred Spring).
  card.temporary_effects = [
    {
      power: { top: 1, right: 1, bottom: 1, left: 1 },
      duration: 1000,
      name: "Sacred Spring",
      type: EffectType.Buff,
    },
  ] as InGameCard["temporary_effects"];

  const { boardCell } = createBoardCell(card, PLAYER_1);

  assert.equal(
    boardCell.card?.current_power.bottom,
    14,
    "placed power should be base 13 + Sacred Spring 1 = 14",
  );
});

// An OnPlace self-buff that enables the placed card's attack (Yamabiko's Echo
// Power) must fully resolve before the combat flips animate, else the flip
// reads as unjustified. applyPreconditionBuffBeat gives that buff a full beat,
// but only when combat actually flipped and the buff is on the placed card.
test("applyPreconditionBuffBeat: buff on placed card before a flip gets a beat", () => {
  const PLACED = "placed-card";
  const buffEvent = {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    cardId: PLACED,
    delayAfterMs: 100,
  } as any;
  const combatEvents = [{ type: EVENT_TYPES.CARD_FLIPPED, cardId: "enemy" }] as any[];

  applyPreconditionBuffBeat(buffEvent, combatEvents, PLACED);
  assert.equal(buffEvent.delayAfterMs, 400, "buff should be held a full beat");
});

test("applyPreconditionBuffBeat: no flip means no beat", () => {
  const PLACED = "placed-card";
  const buffEvent = {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    cardId: PLACED,
    delayAfterMs: 100,
  } as any;
  const combatEvents = [
    { type: EVENT_TYPES.CARD_DEFENDED, cardId: "enemy" },
  ] as any[];

  applyPreconditionBuffBeat(buffEvent, combatEvents, PLACED);
  assert.equal(buffEvent.delayAfterMs, 100, "no flip → delay untouched");
});

test("applyPreconditionBuffBeat: buff on a different card is untouched", () => {
  const buffEvent = {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    cardId: "some-other-card",
    delayAfterMs: 100,
  } as any;
  const combatEvents = [{ type: EVENT_TYPES.CARD_FLIPPED, cardId: "enemy" }] as any[];

  applyPreconditionBuffBeat(buffEvent, combatEvents, "placed-card");
  assert.equal(buffEvent.delayAfterMs, 100, "buff not on placed card → untouched");
});

test("applyPreconditionBuffBeat: never shrinks an existing larger delay", () => {
  const PLACED = "placed-card";
  const buffEvent = {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    cardId: PLACED,
    delayAfterMs: 600,
  } as any;
  const combatEvents = [{ type: EVENT_TYPES.CARD_FLIPPED, cardId: "enemy" }] as any[];

  applyPreconditionBuffBeat(buffEvent, combatEvents, PLACED);
  assert.equal(buffEvent.delayAfterMs, 600, "existing larger delay preserved");
});

// Before a CARD_DEFENDED, the placed card's most recent power-reducing event in
// this combat gets a full beat so a per-event-ticking client shows the drop
// before the defend plays.
test("holdPlacedCardDebuffBeforeDefend: debuff on placed card gets a beat", () => {
  const PLACED = "placed";
  const events = [
    { type: EVENT_TYPES.CARD_FLIPPED, cardId: "enemy-top" },
    {
      type: EVENT_TYPES.CARD_POWER_CHANGED,
      cardId: PLACED,
      powerBySide: { top: -2, bottom: -2, left: -2, right: -2 },
      delayAfterMs: 100,
    },
  ] as any[];

  holdPlacedCardDebuffBeforeDefend(events, PLACED);
  assert.equal(events[1].delayAfterMs, 400, "the -2 debuff should hold a beat");
});

test("holdPlacedCardDebuffBeforeDefend: a buff on the placed card is left alone", () => {
  const PLACED = "placed";
  const events = [
    {
      type: EVENT_TYPES.CARD_POWER_CHANGED,
      cardId: PLACED,
      powerBySide: { top: 2, bottom: 2, left: 2, right: 2 },
      delayAfterMs: 100,
    },
  ] as any[];

  holdPlacedCardDebuffBeforeDefend(events, PLACED);
  assert.equal(events[0].delayAfterMs, 100, "a buff should not be held");
});

test("holdPlacedCardDebuffBeforeDefend: no power change for the placed card is a no-op", () => {
  const events = [
    {
      type: EVENT_TYPES.CARD_POWER_CHANGED,
      cardId: "someone-else",
      powerBySide: { top: -2 },
      delayAfterMs: 100,
    },
  ] as any[];

  holdPlacedCardDebuffBeforeDefend(events, "placed");
  assert.equal(events[0].delayAfterMs, 100, "unrelated card untouched");
});

test("holdPlacedCardDebuffBeforeDefend: never shrinks an existing larger delay", () => {
  const PLACED = "placed";
  const events = [
    {
      type: EVENT_TYPES.CARD_POWER_CHANGED,
      cardId: PLACED,
      powerDelta: -2,
      delayAfterMs: 600,
    },
  ] as any[];

  holdPlacedCardDebuffBeforeDefend(events, PLACED);
  assert.equal(events[0].delayAfterMs, 600, "existing larger delay preserved");
});

after(() => {
  console.log = originalConsoleLog;
});
