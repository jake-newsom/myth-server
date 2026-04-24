import { GameState } from "../../types/game.types";
import { InGameCard } from "../../types/card.types";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

export interface MoveSelectionScenario {
  id: string;
  pack: "hold_vs_play_timing";
  description: string;
  state: GameState;
  expectedSelectedAbilityIds?: string[];
  forbiddenAbilityIds?: string[];
}

function buildMauiHoldEarlyScenario(): MoveSelectionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 1, y: 1 },
    createTestCard({
      id: "enemy-1",
      owner: "enemy",
      power: { top: 3, right: 3, bottom: 3, left: 3 },
    })
  );
  placeCardOnBoard(
    board,
    { x: 2, y: 1 },
    createTestCard({
      id: "enemy-2",
      owner: "enemy",
      power: { top: 4, right: 4, bottom: 4, left: 4 },
    })
  );

  const maui = createTestCard({
    id: "maui-early",
    owner: "AI_bot",
    abilityId: "maui_sun_trick",
    power: { top: 3, right: 3, bottom: 3, left: 3 },
  });
  const surtr = createTestCard({
    id: "surtr-early",
    owner: "AI_bot",
    abilityId: "surtr_flames",
    power: { top: 6, right: 6, bottom: 6, left: 6 },
  });

  const state = createTestGameState({
    board,
    player1Id: "AI_bot",
    player2Id: "enemy",
    player1Hand: [maui.user_card_instance_id, surtr.user_card_instance_id],
    hydrated: {
      [maui.user_card_instance_id]: maui,
      [surtr.user_card_instance_id]: surtr,
    },
    turnNumber: 4,
  });

  return {
    id: "hold-maui-early",
    pack: "hold_vs_play_timing",
    description: "Early Maui should be held while Surtr is deployed.",
    state,
    expectedSelectedAbilityIds: ["surtr_flames"],
    forbiddenAbilityIds: ["maui_sun_trick"],
  };
}

function buildMauiReleaseLateScenario(): MoveSelectionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 1, y: 1 },
    createTestCard({
      id: "enemy-late",
      owner: "enemy",
      power: { top: 5, right: 5, bottom: 5, left: 5 },
    })
  );

  const maui = createTestCard({
    id: "maui-late",
    owner: "AI_bot",
    abilityId: "maui_sun_trick",
    power: { top: 3, right: 3, bottom: 3, left: 3 },
  });
  // Simulate in-hand scaling charge gained over rounds.
  maui.current_power = { top: 6, right: 6, bottom: 6, left: 6 };

  const eir = createTestCard({
    id: "eir-late",
    owner: "AI_bot",
    abilityId: "eir_heal",
    power: { top: 1, right: 1, bottom: 1, left: 1 },
  });

  const state = createTestGameState({
    board,
    player1Id: "AI_bot",
    player2Id: "enemy",
    player1Hand: [maui.user_card_instance_id, eir.user_card_instance_id],
    hydrated: {
      [maui.user_card_instance_id]: maui,
      [eir.user_card_instance_id]: eir,
    },
    turnNumber: 12,
  });

  return {
    id: "play-maui-late",
    pack: "hold_vs_play_timing",
    description: "Charged Maui should be played as a late finisher.",
    state,
    expectedSelectedAbilityIds: ["maui_sun_trick"],
  };
}

function buildKanaloaHoldScenario(): MoveSelectionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 1, y: 1 },
    createTestCard({
      id: "enemy-kanaloa",
      owner: "enemy",
      power: { top: 4, right: 4, bottom: 4, left: 4 },
    })
  );

  const kanaloa = createTestCard({
    id: "kanaloa-hold",
    owner: "AI_bot",
    abilityId: "kanaloa_tide_ward",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const surtr = createTestCard({
    id: "surtr-kanaloa",
    owner: "AI_bot",
    abilityId: "surtr_flames",
    power: { top: 6, right: 6, bottom: 6, left: 6 },
  });
  const eir = createTestCard({
    id: "eir-kanaloa",
    owner: "AI_bot",
    abilityId: "eir_heal",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const verdandi = createTestCard({
    id: "verdandi-kanaloa",
    owner: "AI_bot",
    abilityId: "verdandi_present",
    power: { top: 3, right: 3, bottom: 3, left: 3 },
  });

  const state = createTestGameState({
    board,
    player1Id: "AI_bot",
    player2Id: "enemy",
    player1Hand: [
      kanaloa.user_card_instance_id,
      surtr.user_card_instance_id,
      eir.user_card_instance_id,
      verdandi.user_card_instance_id,
    ],
    hydrated: {
      [kanaloa.user_card_instance_id]: kanaloa,
      [surtr.user_card_instance_id]: surtr,
      [eir.user_card_instance_id]: eir,
      [verdandi.user_card_instance_id]: verdandi,
    },
    turnNumber: 5,
  });

  return {
    id: "hold-kanaloa-while-hand-full",
    pack: "hold_vs_play_timing",
    description: "Kanaloa should be held while several cards remain in hand.",
    state,
    forbiddenAbilityIds: ["kanaloa_tide_ward"],
  };
}

function buildTsukuyomiEarlyScenario(): MoveSelectionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 1, y: 1 },
    createTestCard({
      id: "enemy-strong-tsu",
      owner: "enemy",
      power: { top: 9, right: 9, bottom: 9, left: 9 },
    })
  );
  placeCardOnBoard(
    board,
    { x: 2, y: 1 },
    createTestCard({
      id: "enemy-mid-tsu",
      owner: "enemy",
      power: { top: 5, right: 5, bottom: 5, left: 5 },
    })
  );

  const tsukuyomi = createTestCard({
    id: "tsukuyomi-early",
    owner: "AI_bot",
    abilityId: "tsukuyomi_moons_balance",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const frigg = createTestCard({
    id: "frigg-early",
    owner: "AI_bot",
    abilityId: "frigg_bless",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const weakHand = createTestCard({
    id: "weak-hand",
    owner: "AI_bot",
    abilityId: "verdandi_present",
    power: { top: 2, right: 2, bottom: 2, left: 2 },
  });

  const state = createTestGameState({
    board,
    player1Id: "AI_bot",
    player2Id: "enemy",
    player1Hand: [
      tsukuyomi.user_card_instance_id,
      frigg.user_card_instance_id,
      weakHand.user_card_instance_id,
    ],
    hydrated: {
      [tsukuyomi.user_card_instance_id]: tsukuyomi,
      [frigg.user_card_instance_id]: frigg,
      [weakHand.user_card_instance_id]: weakHand,
    },
    turnNumber: 3,
  });

  return {
    id: "play-tsukuyomi-early-pressure",
    pack: "hold_vs_play_timing",
    description:
      "Tsukuyomi should be preferred early when enemy has dominant card and weak hand target exists.",
    state,
    expectedSelectedAbilityIds: ["tsukuyomi_moons_balance"],
  };
}

export const AI_MOVE_SELECTION_SCENARIOS: MoveSelectionScenario[] = [
  buildMauiHoldEarlyScenario(),
  buildKanaloaHoldScenario(),
  buildTsukuyomiEarlyScenario(),
];
