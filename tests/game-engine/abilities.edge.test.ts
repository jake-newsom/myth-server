import test, { after } from "node:test";
import assert from "node:assert/strict";

import { abilities, combatResolvers } from "../../src/game-engine/abilities";
import { TriggerMoment, InGameCard } from "../../src/types/card.types";
import {
  BoardPosition,
  GameBoard,
  GameState,
  TileStatus,
} from "../../src/types/game.types";
import { TriggerContext, CombatContext } from "../../src/types/game-engine.types";
import { GameStatus } from "../../src/game-engine/game.logic";
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
    power_enhancements: { top: 0, bottom: 0, left: 0, right: 0 },
    card_modifiers_positive: { top: 0, bottom: 0, left: 0, right: 0 },
    card_modifiers_negative: { top: 0, bottom: 0, left: 0, right: 0 },
    temporary_effects: [],
    current_power: { top: 5, bottom: 5, left: 5, right: 5 },
    owner,
    original_owner: owner,
    lockedTurns: 0,
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

after(() => {
  console.log = originalConsoleLog;
});
