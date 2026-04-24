import {
  BoardPosition,
  GameState,
  TileStatus,
  TileTerrain,
} from "../../types/game.types";
import { EffectType, InGameCard } from "../../types/card.types";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

export interface RegressionScenarioCandidate {
  card: InGameCard;
  position: BoardPosition;
}

export interface RegressionScenario {
  id: string;
  pack:
    | "comeback"
    | "terrain_package"
    | "cluster_punish"
    | "counter_buff"
    | "anchor_control";
  description: string;
  aiPlayerId: string;
  state: GameState;
  candidates: RegressionScenarioCandidate[];
  expectedPreferredAbilityIds: string[];
}

function buildLokiComebackScenario(): RegressionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 0, y: 0 },
    createTestCard({ id: "e1", owner: "enemy", power: { top: 6, right: 6, bottom: 6, left: 6 } })
  );
  placeCardOnBoard(
    board,
    { x: 1, y: 0 },
    createTestCard({ id: "e2", owner: "enemy", power: { top: 5, right: 5, bottom: 5, left: 5 } })
  );
  placeCardOnBoard(
    board,
    { x: 2, y: 0 },
    createTestCard({ id: "e3", owner: "enemy", power: { top: 4, right: 4, bottom: 4, left: 4 } })
  );
  placeCardOnBoard(
    board,
    { x: 3, y: 3 },
    createTestCard({ id: "a1", owner: "ai", power: { top: 4, right: 4, bottom: 4, left: 4 } })
  );

  const loki = createTestCard({
    id: "loki",
    owner: "ai",
    abilityId: "loki_flip",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const frigg = createTestCard({
    id: "frigg",
    owner: "ai",
    abilityId: "frigg_bless",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });

  const state = createTestGameState({
    board,
    player1Id: "ai",
    player2Id: "enemy",
  });

  return {
    id: "loki-comeback",
    pack: "comeback",
    description: "Loki should be favored when behind on occupied card control.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: loki, position: { x: 2, y: 2 } },
      { card: frigg, position: { x: 2, y: 2 } },
    ],
    expectedPreferredAbilityIds: ["loki_flip"],
  };
}

function buildTyrComebackScenario(): RegressionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 0, y: 0 },
    createTestCard({
      id: "enemy-super",
      owner: "enemy",
      power: { top: 10, right: 10, bottom: 10, left: 10 },
    })
  );
  placeCardOnBoard(
    board,
    { x: 1, y: 0 },
    createTestCard({
      id: "enemy-mid",
      owner: "enemy",
      power: { top: 6, right: 6, bottom: 6, left: 6 },
    })
  );
  placeCardOnBoard(
    board,
    { x: 3, y: 3 },
    createTestCard({
      id: "ally-weak",
      owner: "ai",
      power: { top: 3, right: 3, bottom: 3, left: 3 },
    })
  );

  const tyr = createTestCard({
    id: "tyr",
    owner: "ai",
    abilityId: "tyr_binding_justice",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const odin = createTestCard({
    id: "odin",
    owner: "ai",
    abilityId: "odin_foresight",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });

  const state = createTestGameState({
    board,
    player1Id: "ai",
    player2Id: "enemy",
  });

  return {
    id: "tyr-comeback-power-gap",
    pack: "comeback",
    description:
      "Tyr should be preferred over generic buff when enemy has dominant power advantage.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: tyr, position: { x: 2, y: 2 } },
      { card: odin, position: { x: 2, y: 2 } },
    ],
    expectedPreferredAbilityIds: ["tyr_binding_justice"],
  };
}

function buildFenrirAdjacentScenario(): RegressionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 1, y: 1 },
    createTestCard({
      id: "enemy-weak",
      owner: "enemy",
      power: { top: 2, right: 2, bottom: 2, left: 2 },
    })
  );
  placeCardOnBoard(
    board,
    { x: 2, y: 1 },
    createTestCard({
      id: "enemy-strong",
      owner: "enemy",
      power: { top: 7, right: 7, bottom: 7, left: 7 },
    })
  );

  const fenrir = createTestCard({
    id: "fenrir",
    owner: "ai",
    abilityId: "fenrir_devourer_surge",
    power: { top: 6, right: 6, bottom: 6, left: 6 },
  });
  const neutral = createTestCard({
    id: "neutral",
    owner: "ai",
    abilityId: "verdandi_present",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });

  const state = createTestGameState({
    board,
    player1Id: "ai",
    player2Id: "enemy",
  });

  return {
    id: "fenrir-adjacent-target",
    pack: "cluster_punish",
    description: "Fenrir should be favored when a weaker adjacent enemy is available.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: fenrir, position: { x: 1, y: 2 } },
      { card: neutral, position: { x: 1, y: 2 } },
    ],
    expectedPreferredAbilityIds: ["fenrir_devourer_surge"],
  };
}

function buildSurtrClusterScenario(): RegressionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 1, y: 1 },
    createTestCard({ id: "e1", owner: "enemy", power: { top: 5, right: 5, bottom: 5, left: 5 } })
  );
  placeCardOnBoard(
    board,
    { x: 2, y: 1 },
    createTestCard({ id: "e2", owner: "enemy", power: { top: 5, right: 5, bottom: 5, left: 5 } })
  );
  placeCardOnBoard(
    board,
    { x: 1, y: 2 },
    createTestCard({ id: "e3", owner: "enemy", power: { top: 5, right: 5, bottom: 5, left: 5 } })
  );

  const surtr = createTestCard({
    id: "surtr",
    owner: "ai",
    abilityId: "surtr_flames",
    power: { top: 7, right: 7, bottom: 7, left: 7 },
  });
  const eir = createTestCard({
    id: "eir-water",
    owner: "ai",
    abilityId: "eir_heal",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });

  const state = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });
  return {
    id: "surtr-cluster-punish",
    pack: "cluster_punish",
    description: "Surtr should be favored in dense adjacent enemy clusters.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: surtr, position: { x: 2, y: 2 } },
      { card: eir, position: { x: 2, y: 2 } },
    ],
    expectedPreferredAbilityIds: ["surtr_flames"],
  };
}

function buildRyujinDiagonalScenario(): RegressionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 0, y: 0 },
    createTestCard({ id: "diag1", owner: "enemy", power: { top: 2, right: 2, bottom: 2, left: 2 } })
  );
  placeCardOnBoard(
    board,
    { x: 2, y: 0 },
    createTestCard({ id: "diag2", owner: "enemy", power: { top: 2, right: 2, bottom: 2, left: 2 } })
  );

  const ryujin = createTestCard({
    id: "ryujin",
    owner: "ai",
    abilityId: "ryujin_tidal_sweep",
    power: { top: 6, right: 6, bottom: 6, left: 6 },
  });
  const frigg = createTestCard({
    id: "frigg",
    owner: "ai",
    abilityId: "frigg_bless",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });

  const state = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });
  return {
    id: "ryujin-diagonal-kills",
    pack: "cluster_punish",
    description: "Ryujin should be favored when diagonals have weaker enemy targets.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: ryujin, position: { x: 1, y: 1 } },
      { card: frigg, position: { x: 1, y: 1 } },
    ],
    expectedPreferredAbilityIds: ["ryujin_tidal_sweep"],
  };
}

function buildTerrainWaterPackageScenario(): RegressionScenario {
  const board = createEmptyBoard();
  board[1][1].tile_effect = {
    status: TileStatus.Normal,
    turns_left: 5,
    terrain: TileTerrain.Ocean,
    power: { top: 1, right: 1, bottom: 1, left: 1 },
    effect_duration: 5,
  };
  board[2][1].tile_effect = {
    status: TileStatus.Normal,
    turns_left: 5,
    terrain: TileTerrain.Ocean,
    power: { top: 1, right: 1, bottom: 1, left: 1 },
    effect_duration: 5,
  };
  placeCardOnBoard(
    board,
    { x: 1, y: 1 },
    createTestCard({ id: "ally-water", owner: "ai", power: { top: 4, right: 4, bottom: 4, left: 4 } })
  );

  const kupua = createTestCard({
    id: "kupua",
    owner: "ai",
    abilityId: "kupua_dual_aspect",
    power: { top: 5, right: 5, bottom: 5, left: 5 },
  });
  const eir = createTestCard({
    id: "eir-water",
    owner: "ai",
    abilityId: "eir_heal",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });

  const state = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });
  return {
    id: "water-package-kupua",
    pack: "terrain_package",
    description: "Kupua should be favored when water package state is active.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: kupua, position: { x: 2, y: 2 } },
      { card: eir, position: { x: 2, y: 2 } },
    ],
    expectedPreferredAbilityIds: ["kupua_dual_aspect"],
  };
}

function buildTerrainLavaPackageScenario(): RegressionScenario {
  const board = createEmptyBoard();
  board[1][1].tile_effect = {
    status: TileStatus.Normal,
    turns_left: 4,
    terrain: TileTerrain.Lava,
    power: { top: 0, right: 0, bottom: 0, left: 0 },
    effect_duration: 4,
  };
  board[2][1].tile_effect = {
    status: TileStatus.Normal,
    turns_left: 4,
    terrain: TileTerrain.Lava,
    power: { top: 0, right: 0, bottom: 0, left: 0 },
    effect_duration: 4,
  };
  const pele = createTestCard({
    id: "pele",
    owner: "ai",
    abilityId: "pele_lava_field",
    power: { top: 5, right: 5, bottom: 5, left: 5 },
  });
  const eir = createTestCard({
    id: "eir",
    owner: "ai",
    abilityId: "eir_heal",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const state = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });
  return {
    id: "lava-package-pele",
    pack: "terrain_package",
    description: "Pele should be favored when lava package is active.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: pele, position: { x: 2, y: 2 } },
      { card: eir, position: { x: 2, y: 2 } },
    ],
    expectedPreferredAbilityIds: ["pele_lava_field"],
  };
}

function buildTileDenialScenario(): RegressionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 1, y: 1 },
    createTestCard({ id: "ally", owner: "ai", power: { top: 4, right: 4, bottom: 4, left: 4 } })
  );

  const kapo = createTestCard({
    id: "kapo",
    owner: "ai",
    abilityId: "kapo_hex_field",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const frigg = createTestCard({
    id: "frigg",
    owner: "ai",
    abilityId: "frigg_bless",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const state = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });

  return {
    id: "tile-denial-kapo",
    pack: "terrain_package",
    description: "Kapo should be favored when many adjacent empty denial tiles exist.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: kapo, position: { x: 2, y: 2 } },
      { card: frigg, position: { x: 2, y: 2 } },
    ],
    expectedPreferredAbilityIds: ["kapo_hex_field"],
  };
}

function buildCounterBuffScenario(): RegressionScenario {
  const board = createEmptyBoard();
  const buffedEnemy = createTestCard({
    id: "buffed-enemy",
    owner: "enemy",
    power: { top: 6, right: 6, bottom: 6, left: 6 },
  });
  buffedEnemy.temporary_effects.push({
    type: EffectType.Buff,
    power: { top: 2 },
    duration: 3,
    name: "blessing",
  });
  placeCardOnBoard(board, { x: 1, y: 1 }, buffedEnemy);

  const nopperabo = createTestCard({
    id: "nopperabo",
    owner: "ai",
    abilityId: "nopperabo_erase_face",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const momotaro = createTestCard({
    id: "momotaro",
    owner: "ai",
    abilityId: "momotaro_allies_rally",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const state = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });

  return {
    id: "counter-buff-nopperabo",
    pack: "counter_buff",
    description: "Nopperabo should be favored when adjacent enemies are buffed.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: nopperabo, position: { x: 1, y: 2 } },
      { card: momotaro, position: { x: 1, y: 2 } },
    ],
    expectedPreferredAbilityIds: ["nopperabo_erase_face"],
  };
}

function buildAnchorControlScenario(): RegressionScenario {
  const board = createEmptyBoard();
  placeCardOnBoard(
    board,
    { x: 1, y: 1 },
    createTestCard({ id: "enemy-center", owner: "enemy", power: { top: 5, right: 5, bottom: 5, left: 5 } })
  );
  const jorm = createTestCard({
    id: "jorm",
    owner: "ai",
    abilityId: "jormungandr_shell",
    power: { top: 6, right: 6, bottom: 6, left: 6 },
  });
  const loki = createTestCard({
    id: "loki",
    owner: "ai",
    abilityId: "loki_flip",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const state = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });
  return {
    id: "anchor-jorm",
    pack: "anchor_control",
    description: "Jormungandr should be favored for safe anchoring when not in hard comeback mode.",
    aiPlayerId: "ai",
    state,
    candidates: [
      { card: jorm, position: { x: 0, y: 3 } },
      { card: loki, position: { x: 0, y: 3 } },
    ],
    expectedPreferredAbilityIds: ["jormungandr_shell"],
  };
}

export const AI_REGRESSION_SCENARIOS: RegressionScenario[] = [
  buildLokiComebackScenario(),
  buildTyrComebackScenario(),
  buildFenrirAdjacentScenario(),
  buildSurtrClusterScenario(),
  buildRyujinDiagonalScenario(),
  buildTerrainWaterPackageScenario(),
  buildTerrainLavaPackageScenario(),
  buildTileDenialScenario(),
  buildCounterBuffScenario(),
  buildAnchorControlScenario(),
];
