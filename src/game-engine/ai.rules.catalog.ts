import { AbilityRule } from "./ai.rule-types";

function withDefaultPlacement(rule: AbilityRule): AbilityRule {
  return {
    ...rule,
    placementPriorities:
      rule.placementPriorities.length > 0
        ? rule.placementPriorities
        : [{ metric: "safePlacementScore", score: 0.2 }],
  };
}

function makeRule(rule: AbilityRule): AbilityRule {
  return withDefaultPlacement(rule);
}

const rules: Record<string, AbilityRule> = {
  // ---- Comeback / high variance ----
  loki_flip: makeRule({
    cardId: "loki_flip",
    timing: "late",
    riskProfile: "swingy",
    preferWhen: [
      { metric: "enemyOwnedOccupiedRatio", operator: ">=", value: 0.6, score: 45 },
      {
        metric: "enemyOwnedCountMinusPlayerOwnedCount",
        operator: ">=",
        value: 2,
        score: 35,
      },
      { metric: "turnsRemaining", operator: "<=", value: 3, score: 15 },
    ],
    avoidWhen: [
      { metric: "playerOwnedOccupiedRatio", operator: ">=", value: 0.55, score: -60 },
      {
        metric: "playerOwnedCountMinusEnemyOwnedCount",
        operator: ">=",
        value: 2,
        score: -50,
      },
    ],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.35 }],
  }),
  tyr_binding_justice: makeRule({
    cardId: "tyr_binding_justice",
    timing: "conditional",
    riskProfile: "comeback",
    preferWhen: [
      { metric: "enemyPowerAdvantage", operator: ">=", value: 6, score: 55 },
      { metric: "isBehind", operator: "==", value: 1, score: 20 },
    ],
    avoidWhen: [{ metric: "isAhead", operator: "==", value: 1, score: -35 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
  }),
  vali_revenge: makeRule({
    cardId: "vali_revenge",
    timing: "late",
    riskProfile: "comeback",
    preferWhen: [
      { metric: "defeatedAlliesCount", operator: ">=", value: 2, score: 40 },
      { metric: "isBehind", operator: "==", value: 1, score: 18 },
    ],
    avoidWhen: [{ metric: "defeatedAlliesCount", operator: "==", value: 0, score: -30 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.18 }],
  }),
  urd_past_weaves: makeRule({
    cardId: "urd_past_weaves",
    timing: "late",
    riskProfile: "comeback",
    preferWhen: [{ metric: "defeatedAlliesCount", operator: ">=", value: 2, score: 34 }],
    avoidWhen: [{ metric: "defeatedAlliesCount", operator: "==", value: 0, score: -20 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.15 }],
  }),
  ku_war_stance: makeRule({
    cardId: "ku_war_stance",
    timing: "late",
    riskProfile: "comeback",
    preferWhen: [
      { metric: "defeatedAlliesCount", operator: ">=", value: 3, score: 45 },
      { metric: "adjacentEnemyCount", operator: ">=", value: 1, score: 12 },
    ],
    avoidWhen: [{ metric: "defeatedAlliesCount", operator: "<=", value: 1, score: -25 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 10 }],
  }),
  okuriinu_hunters_mark: makeRule({
    cardId: "okuriinu_hunters_mark",
    timing: "mid",
    riskProfile: "comeback",
    preferWhen: [{ metric: "allyDefeatForecast", operator: ">=", value: 1, score: 18 }],
    avoidWhen: [{ metric: "isAhead", operator: "==", value: 1, score: -10 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
  }),
  amaterasu_radiant_blessing: makeRule({
    cardId: "amaterasu_radiant_blessing",
    timing: "mid",
    riskProfile: "comeback",
    preferWhen: [
      { metric: "allyDefeatForecast", operator: ">=", value: 1, score: 16 },
      { metric: "adjacentAllyCount", operator: ">=", value: 1, score: 8 },
    ],
    avoidWhen: [{ metric: "adjacentAllyCount", operator: "==", value: 0, score: -8 }],
    placementPriorities: [{ metric: "adjacentAllyCount", score: 8 }],
  }),
  hel_soul: makeRule({
    cardId: "hel_soul",
    timing: "late",
    riskProfile: "comeback",
    preferWhen: [
      { metric: "adjacentWeakerEnemyCount", operator: ">=", value: 1, score: 35 },
      { metric: "enemyStrongestPower", operator: ">=", value: 20, score: 15 },
    ],
    avoidWhen: [{ metric: "adjacentWeakerEnemyCount", operator: "==", value: 0, score: -30 }],
    placementPriorities: [{ metric: "adjacentWeakerEnemyCount", score: 18 }],
  }),

  // ---- Cluster punish / denial ----
  surtr_flames: makeRule({
    cardId: "surtr_flames",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [
      { metric: "adjacentEnemyCount", operator: ">=", value: 2, score: 40 },
      { metric: "adjacentEnemyClusterSize", operator: ">=", value: 3, score: 20 },
    ],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: -55 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 22 }],
  }),
  gashadokuro_bone_chill: makeRule({
    cardId: "gashadokuro_bone_chill",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [
      { metric: "adjacentEnemyCount", operator: ">=", value: 2, score: 34 },
      { metric: "isCenterPlacement", operator: "==", value: 1, score: 14 },
    ],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: "<=", value: 1, score: -28 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 14 }],
  }),
  ryujin_tidal_sweep: makeRule({
    cardId: "ryujin_tidal_sweep",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [
      { metric: "diagonalKillCount", operator: ">=", value: 1, score: 38 },
      { metric: "adjacentEnemyCount", operator: "<=", value: 1, score: 10 },
    ],
    avoidWhen: [{ metric: "diagonalKillCount", operator: "==", value: 0, score: -26 }],
    placementPriorities: [{ metric: "diagonalKillCount", score: 20 }],
  }),
  yuki_onna_frost_row: makeRule({
    cardId: "yuki_onna_frost_row",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [{ metric: "rowEnemyCount", operator: ">=", value: 2, score: 30 }],
    avoidWhen: [{ metric: "rowEnemyCount", operator: "<=", value: 1, score: -22 }],
    placementPriorities: [{ metric: "rowEnemyCount", score: 16 }],
  }),
  skadi_freeze: makeRule({
    cardId: "skadi_freeze",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [{ metric: "columnEnemyCount", operator: ">=", value: 2, score: 30 }],
    avoidWhen: [{ metric: "columnEnemyCount", operator: "<=", value: 1, score: -22 }],
    placementPriorities: [{ metric: "columnEnemyCount", score: 16 }],
  }),
  tawara_piercing_shot: makeRule({
    cardId: "tawara_piercing_shot",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [{ metric: "columnEnemyCount", operator: ">=", value: 2, score: 32 }],
    avoidWhen: [{ metric: "columnEnemyCount", operator: "==", value: 0, score: -24 }],
    placementPriorities: [{ metric: "columnEnemyCount", score: 18 }],
  }),
  yamata_many_heads: makeRule({
    cardId: "yamata_many_heads",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [{ metric: "rowOrColumnEnemyCount", operator: ">=", value: 3, score: 28 }],
    avoidWhen: [{ metric: "rowOrColumnEnemyCount", operator: "<=", value: 1, score: -18 }],
    placementPriorities: [{ metric: "rowOrColumnEnemyCount", score: 12 }],
  }),
  poliahu_icy_presence: makeRule({
    cardId: "poliahu_icy_presence",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [{ metric: "adjacentEnemyCount", operator: ">=", value: 2, score: 26 }],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: -18 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 12 }],
  }),
  nopperabo_erase_face: makeRule({
    cardId: "nopperabo_erase_face",
    timing: "conditional",
    riskProfile: "denial",
    preferWhen: [{ metric: "adjacentBuffedEnemyCount", operator: ">=", value: 1, score: 35 }],
    avoidWhen: [{ metric: "adjacentBuffedEnemyCount", operator: "==", value: 0, score: -30 }],
    placementPriorities: [{ metric: "adjacentBuffedEnemyCount", score: 20 }],
  }),
  urashima_time_shift: makeRule({
    cardId: "urashima_time_shift",
    timing: "conditional",
    riskProfile: "denial",
    preferWhen: [{ metric: "columnEnemyCount", operator: ">=", value: 1, score: 10 }],
    avoidWhen: [{ metric: "enemyBuffedCountBoard", operator: "==", value: 0, score: -18 }],
    placementPriorities: [{ metric: "columnEnemyCount", score: 8 }],
  }),
  nurarihyon_slipstream: makeRule({
    cardId: "nurarihyon_slipstream",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [{ metric: "enemyBuffedCountBoard", operator: ">=", value: 1, score: 30 }],
    avoidWhen: [{ metric: "enemyBuffedCountBoard", operator: "==", value: 0, score: -18 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.25 }],
  }),
  thor_push: makeRule({
    cardId: "thor_push",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [
      { metric: "enemyOwnedCountMinusPlayerOwnedCount", operator: ">=", value: 1, score: 15 },
      { metric: "enemyStrongestPower", operator: ">=", value: 16, score: 20 },
    ],
    avoidWhen: [],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.15 }],
  }),
  fafnir_venom: makeRule({
    cardId: "fafnir_venom",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [{ metric: "adjacentEnemyCount", operator: ">=", value: 1, score: 20 }],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: -18 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 10 }],
  }),
  laamaomao_gale_aura: makeRule({
    cardId: "laamaomao_gale_aura",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [
      { metric: "adjacentEnemyCount", operator: ">=", value: 1, score: 15 },
      { metric: "adjacentEmptyCount", operator: ">=", value: 1, score: 10 },
    ],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: -12 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 8 }],
  }),
  ran_pull: makeRule({
    cardId: "ran_pull",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [
      { metric: "adjacentEnemyCount", operator: ">=", value: 1, score: 12 },
      { metric: "safePlacementScore", operator: ">=", value: 0, score: 8 },
    ],
    avoidWhen: [{ metric: "safePlacementScore", operator: "<", value: -5, score: -12 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 8 }],
  }),

  // ---- Scaling / hold timing ----
  maui_sun_trick: makeRule({
    cardId: "maui_sun_trick",
    timing: "conditional",
    riskProfile: "combo",
    preferWhen: [
      { metric: "currentCardPowerGain", operator: ">=", value: 8, score: 80 },
      { metric: "turnsRemaining", operator: "<=", value: 4, score: 20 },
    ],
    avoidWhen: [{ metric: "currentCardPowerGain", operator: "<", value: 8, score: -35 }],
    placementPriorities: [
      { metric: "cardPowerTotal", score: 1.2 },
      { metric: "safePlacementScore", score: 0.18 },
    ],
  }),
  kanaloa_tide_ward: makeRule({
    cardId: "kanaloa_tide_ward",
    timing: "conditional",
    riskProfile: "combo",
    preferWhen: [{ metric: "lowHandSize", operator: "==", value: 1, score: 20 }],
    avoidWhen: [{ metric: "highHandSize", operator: "==", value: 1, score: -40 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.12 }],
  }),
  tsukuyomi_moons_balance: makeRule({
    cardId: "tsukuyomi_moons_balance",
    timing: "early",
    riskProfile: "safe",
    preferWhen: [
      { metric: "enemyStrongestPower", operator: ">=", value: 18, score: 28 },
      { metric: "weakestHandPower", operator: "<=", value: 12, score: 12 },
    ],
    avoidWhen: [{ metric: "lowHandSize", operator: "==", value: 1, score: -16 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.28 }],
  }),
  pele_lava_field: makeRule({
    cardId: "pele_lava_field",
    timing: "early",
    riskProfile: "combo",
    preferWhen: [
      { metric: "hasLavaSynergy", operator: ">=", value: 1, score: 34 },
      { metric: "turnsRemaining", operator: ">=", value: 6, score: 20 },
    ],
    avoidWhen: [{ metric: "hasLavaSynergy", operator: "==", value: 0, score: -30 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.16 }],
  }),
  sigurd_slayer: makeRule({
    cardId: "sigurd_slayer",
    timing: "conditional",
    riskProfile: "combo",
    preferWhen: [{ metric: "allDragonCount", operator: ">=", value: 2, score: 28 }],
    avoidWhen: [{ metric: "allDragonCount", operator: "==", value: 0, score: -22 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.16 }],
  }),
  minamoto_demon_bane: makeRule({
    cardId: "minamoto_demon_bane",
    timing: "conditional",
    riskProfile: "combo",
    preferWhen: [
      { metric: "enemyDemonCount", operator: ">=", value: 1, score: 22 },
      { metric: "enemyYokaiCount", operator: ">=", value: 1, score: 14 },
    ],
    avoidWhen: [{ metric: "enemyDemonCount", operator: "==", value: 0, score: -10 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.12 }],
  }),
  heimdall_block: makeRule({
    cardId: "heimdall_block",
    timing: "early",
    riskProfile: "combo",
    preferWhen: [
      { metric: "highHandSize", operator: "==", value: 1, score: 20 },
      { metric: "isAhead", operator: "==", value: 0, score: 8 },
    ],
    avoidWhen: [{ metric: "lowHandSize", operator: "==", value: 1, score: -20 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
  }),
  nightmarchers_dread_aura: makeRule({
    cardId: "nightmarchers_dread_aura",
    timing: "early",
    riskProfile: "combo",
    preferWhen: [
      { metric: "adjacentEmptyCount", operator: ">=", value: 1, score: 24 },
      { metric: "turnsRemaining", operator: ">=", value: 5, score: 14 },
    ],
    avoidWhen: [{ metric: "adjacentEmptyCount", operator: "==", value: 0, score: -28 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.18 }],
  }),
  kanehekili_thunderous_omen: makeRule({
    cardId: "kanehekili_thunderous_omen",
    timing: "early",
    riskProfile: "combo",
    preferWhen: [
      { metric: "enemyOwnedCountMinusPlayerOwnedCount", operator: ">=", value: 0, score: 12 },
      { metric: "turnsRemaining", operator: ">=", value: 5, score: 10 },
    ],
    avoidWhen: [{ metric: "turnsRemaining", operator: "<=", value: 2, score: -16 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.18 }],
  }),
  kamapuaa_wild_shift: makeRule({
    cardId: "kamapuaa_wild_shift",
    timing: "early",
    riskProfile: "combo",
    preferWhen: [{ metric: "turnsRemaining", operator: ">=", value: 6, score: 22 }],
    avoidWhen: [{ metric: "turnsRemaining", operator: "<=", value: 2, score: -14 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.18 }],
  }),
  hauwahine_rains_blessing: makeRule({
    cardId: "hauwahine_rains_blessing",
    timing: "early",
    riskProfile: "combo",
    preferWhen: [{ metric: "turnsRemaining", operator: ">=", value: 5, score: 20 }],
    avoidWhen: [{ metric: "turnsRemaining", operator: "<=", value: 2, score: -15 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
  }),
  lono_fertile_ground: makeRule({
    cardId: "lono_fertile_ground",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [{ metric: "allyBuffedCountBoard", operator: ">=", value: 1, score: 18 }],
    avoidWhen: [{ metric: "allyBuffedCountBoard", operator: "==", value: 0, score: -16 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
  }),
  hachiman_warriors_aura: makeRule({
    cardId: "hachiman_warriors_aura",
    timing: "early",
    riskProfile: "combo",
    preferWhen: [{ metric: "rowAllyCount", operator: ">=", value: 1, score: 24 }],
    avoidWhen: [{ metric: "rowAllyCount", operator: "==", value: 0, score: -18 }],
    placementPriorities: [{ metric: "rowAllyCount", score: 12 }],
  }),

  // ---- Terrain package ----
  kupua_dual_aspect: makeRule({
    cardId: "kupua_dual_aspect",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [{ metric: "cardsOnWaterCount", operator: ">=", value: 1, score: 28 }],
    avoidWhen: [{ metric: "cardsOnWaterCount", operator: "==", value: 0, score: -18 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.18 }],
  }),
  mooinanea_sacred_spring: makeRule({
    cardId: "mooinanea_sacred_spring",
    timing: "early",
    riskProfile: "safe",
    preferWhen: [
      { metric: "hasWaterSynergy", operator: "==", value: 1, score: 36 },
      { metric: "handSize", operator: ">=", value: 2, score: 12 },
    ],
    avoidWhen: [{ metric: "hasWaterSynergy", operator: "==", value: 0, score: -42 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.3 }],
  }),
  ukupanipo_feast_or_famine: makeRule({
    cardId: "ukupanipo_feast_or_famine",
    timing: "early",
    riskProfile: "combo",
    preferWhen: [
      { metric: "hasWaterSynergy", operator: "==", value: 1, score: 18 },
      { metric: "allyDefeatForecast", operator: ">=", value: 1, score: 12 },
    ],
    avoidWhen: [{ metric: "isAhead", operator: "==", value: 1, score: -10 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.18 }],
  }),
  njord_sea: makeRule({
    cardId: "njord_sea",
    timing: "conditional",
    riskProfile: "anchor",
    preferWhen: [{ metric: "adjacentSeaAllyCount", operator: ">=", value: 1, score: 30 }],
    avoidWhen: [{ metric: "adjacentSeaAllyCount", operator: "==", value: 0, score: -20 }],
    placementPriorities: [{ metric: "adjacentSeaAllyCount", score: 14 }],
  }),
  kamohoalii_oceans_shield: makeRule({
    cardId: "kamohoalii_oceans_shield",
    timing: "mid",
    riskProfile: "anchor",
    preferWhen: [
      { metric: "enemyStrongestPower", operator: "<=", value: 24, score: 20 },
      { metric: "safePlacementScore", operator: ">=", value: 0, score: 10 },
    ],
    avoidWhen: [{ metric: "enemyStrongestPower", operator: ">=", value: 30, score: -15 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.3 }],
  }),
  kane_pure_waters: makeRule({
    cardId: "kane_pure_waters",
    timing: "mid",
    riskProfile: "safe",
    preferWhen: [
      { metric: "adjacentAllyCount", operator: ">=", value: 1, score: 14 },
      { metric: "allyDefeatForecast", operator: ">=", value: 1, score: 12 },
    ],
    avoidWhen: [{ metric: "adjacentAllyCount", operator: "==", value: 0, score: -12 }],
    placementPriorities: [{ metric: "adjacentAllyCount", score: 8 }],
  }),
  jorogumo_web_curse: makeRule({
    cardId: "jorogumo_web_curse",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [
      { metric: "adjacentEmptyCount", operator: ">=", value: 2, score: 26 },
      { metric: "isCenterPlacement", operator: "==", value: 1, score: 8 },
    ],
    avoidWhen: [{ metric: "adjacentEmptyCount", operator: "<=", value: 1, score: -18 }],
    placementPriorities: [{ metric: "adjacentEmptyCount", score: 10 }],
  }),
  kapo_hex_field: makeRule({
    cardId: "kapo_hex_field",
    timing: "mid",
    riskProfile: "denial",
    preferWhen: [
      { metric: "adjacentEmptyCount", operator: ">=", value: 2, score: 30 },
      { metric: "isCenterPlacement", operator: "==", value: 1, score: 8 },
    ],
    avoidWhen: [{ metric: "adjacentEmptyCount", operator: "<=", value: 1, score: -20 }],
    placementPriorities: [{ metric: "adjacentEmptyCount", score: 12 }],
  }),

  // ---- Buff/support anchors ----
  odin_foresight: makeRule({
    cardId: "odin_foresight",
    timing: "mid",
    riskProfile: "anchor",
    preferWhen: [{ metric: "playerOwnedOccupiedRatio", operator: ">=", value: 0.4, score: 25 }],
    avoidWhen: [{ metric: "playerOwnedOccupiedRatio", operator: "<", value: 0.25, score: -16 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.25 }],
  }),
  frigg_bless: makeRule({
    cardId: "frigg_bless",
    timing: "mid",
    riskProfile: "safe",
    preferWhen: [{ metric: "adjacentAllyCount", operator: ">=", value: 2, score: 26 }],
    avoidWhen: [{ metric: "adjacentAllyCount", operator: "==", value: 0, score: -20 }],
    placementPriorities: [{ metric: "adjacentAllyCount", score: 12 }],
  }),
  freyja_bless: makeRule({
    cardId: "freyja_bless",
    timing: "mid",
    riskProfile: "safe",
    preferWhen: [{ metric: "adjacentAllyCount", operator: ">=", value: 2, score: 24 }],
    avoidWhen: [{ metric: "adjacentAllyCount", operator: "==", value: 0, score: -18 }],
    placementPriorities: [{ metric: "adjacentAllyCount", score: 12 }],
  }),
  gunnr_war: makeRule({
    cardId: "gunnr_war",
    timing: "mid",
    riskProfile: "safe",
    preferWhen: [{ metric: "adjacentAllyCount", operator: ">=", value: 2, score: 18 }],
    avoidWhen: [{ metric: "adjacentAllyCount", operator: "==", value: 0, score: -10 }],
    placementPriorities: [{ metric: "adjacentAllyCount", score: 8 }],
  }),
  bragi_inspire: makeRule({
    cardId: "bragi_inspire",
    timing: "early",
    riskProfile: "safe",
    preferWhen: [{ metric: "adjacentEmptyCount", operator: ">=", value: 2, score: 18 }],
    avoidWhen: [{ metric: "adjacentEmptyCount", operator: "<=", value: 1, score: -8 }],
    placementPriorities: [{ metric: "adjacentEmptyCount", score: 6 }],
  }),
  momotaro_allies_rally: makeRule({
    cardId: "momotaro_allies_rally",
    timing: "mid",
    riskProfile: "safe",
    preferWhen: [{ metric: "adjacentAllyCount", operator: ">=", value: 1, score: 15 }],
    avoidWhen: [{ metric: "adjacentAllyCount", operator: "==", value: 0, score: -8 }],
    placementPriorities: [{ metric: "adjacentAllyCount", score: 8 }],
  }),
  eir_heal: makeRule({
    cardId: "eir_heal",
    timing: "conditional",
    riskProfile: "safe",
    preferWhen: [{ metric: "allyDebuffedCountBoard", operator: ">=", value: 1, score: 18 }],
    avoidWhen: [{ metric: "allyDebuffedCountBoard", operator: "==", value: 0, score: -10 }],
    placementPriorities: [{ metric: "adjacentAllyCount", score: 8 }],
  }),
  hiaka_cleansing_hula: makeRule({
    cardId: "hiaka_cleansing_hula",
    timing: "mid",
    riskProfile: "safe",
    preferWhen: [{ metric: "allyDebuffedCountBoard", operator: ">=", value: 1, score: 16 }],
    avoidWhen: [{ metric: "allyDebuffedCountBoard", operator: "==", value: 0, score: -8 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
  }),
  kaahupahau_harbor_guardian: makeRule({
    cardId: "kaahupahau_harbor_guardian",
    timing: "mid",
    riskProfile: "anchor",
    preferWhen: [{ metric: "adjacentAllyCount", operator: ">=", value: 1, score: 18 }],
    avoidWhen: [{ metric: "adjacentAllyCount", operator: "==", value: 0, score: -12 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.28 }],
  }),
  jormungandr_shell: makeRule({
    cardId: "jormungandr_shell",
    timing: "mid",
    riskProfile: "anchor",
    preferWhen: [
      { metric: "safePlacementScore", operator: ">=", value: 0, score: 16 },
      { metric: "isCornerPlacement", operator: "==", value: 1, score: 10 },
    ],
    avoidWhen: [],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.32 }],
  }),
  baldr_immune: makeRule({
    cardId: "baldr_immune",
    timing: "mid",
    riskProfile: "anchor",
    preferWhen: [
      { metric: "isEdgePlacement", operator: "==", value: 1, score: 10 },
      { metric: "safePlacementScore", operator: ">=", value: 0, score: 8 },
    ],
    avoidWhen: [],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.25 }],
  }),

  // ---- Conditional adjacency cards ----
  fenrir_devourer_surge: makeRule({
    cardId: "fenrir_devourer_surge",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [
      { metric: "adjacentWeakerEnemyCount", operator: ">=", value: 1, score: 45 },
      { metric: "adjacentEnemyClusterSize", operator: ">=", value: 2, score: 20 },
      { metric: "turnsRemaining", operator: ">=", value: 5, score: 20 },
    ],
    avoidWhen: [
      { metric: "adjacentWeakerEnemyCount", operator: "==", value: 0, score: -60 },
      { metric: "safePlacementScore", operator: "<", value: -5, score: -35 },
    ],
    placementPriorities: [
      { metric: "adjacentWeakerEnemyCount", score: 18 },
      { metric: "safePlacementScore", score: 0.25 },
    ],
  }),
  benkei_steadfast_guard: makeRule({
    cardId: "benkei_steadfast_guard",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [{ metric: "adjacentEnemyCount", operator: ">=", value: 2, score: 28 }],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: -25 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 14 }],
  }),
  kintaro_beast_friend: makeRule({
    cardId: "kintaro_beast_friend",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [{ metric: "adjacentEnemyCount", operator: ">=", value: 2, score: 24 }],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: -20 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 12 }],
  }),
  brynhildr_valk: makeRule({
    cardId: "brynhildr_valk",
    timing: "conditional",
    riskProfile: "combo",
    preferWhen: [{ metric: "adjacentValkyrieAllyCount", operator: ">=", value: 1, score: 26 }],
    avoidWhen: [{ metric: "adjacentValkyrieAllyCount", operator: "==", value: 0, score: -16 }],
    placementPriorities: [{ metric: "adjacentValkyrieAllyCount", score: 14 }],
  }),
  hrungnir_worthy: makeRule({
    cardId: "hrungnir_worthy",
    timing: "conditional",
    riskProfile: "combo",
    preferWhen: [{ metric: "adjacentThorCount", operator: ">=", value: 1, score: 22 }],
    avoidWhen: [{ metric: "adjacentThorCount", operator: "==", value: 0, score: -12 }],
    placementPriorities: [{ metric: "adjacentThorCount", score: 10 }],
  }),
  thrym_demand: makeRule({
    cardId: "thrym_demand",
    timing: "conditional",
    riskProfile: "combo",
    preferWhen: [{ metric: "adjacentGoddessCount", operator: ">=", value: 1, score: 24 }],
    avoidWhen: [{ metric: "adjacentGoddessCount", operator: "==", value: 0, score: -12 }],
    placementPriorities: [{ metric: "adjacentGoddessCount", score: 10 }],
  }),
  ushi_oni_shore_fury: makeRule({
    cardId: "ushi_oni_shore_fury",
    timing: "conditional",
    riskProfile: "anchor",
    preferWhen: [{ metric: "isEdgePlacement", operator: "==", value: 1, score: 24 }],
    avoidWhen: [{ metric: "isEdgePlacement", operator: "==", value: 0, score: -20 }],
    placementPriorities: [{ metric: "isEdgePlacement", score: 16 }],
  }),
  ymir_isolation: makeRule({
    cardId: "ymir_isolation",
    timing: "early",
    riskProfile: "anchor",
    preferWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: 32 }],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: ">=", value: 1, score: -28 }],
    placementPriorities: [{ metric: "isCornerPlacement", score: 10 }],
  }),
  freyr_peace: makeRule({
    cardId: "freyr_peace",
    timing: "early",
    riskProfile: "anchor",
    preferWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: 24 }],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: ">=", value: 1, score: -20 }],
    placementPriorities: [{ metric: "isCornerPlacement", score: 8 }],
  }),
  futakuchi_onna_vengeful_bite: makeRule({
    cardId: "futakuchi_onna_vengeful_bite",
    timing: "mid",
    riskProfile: "combo",
    preferWhen: [
      { metric: "adjacentEnemyCount", operator: ">=", value: 1, score: 18 },
      { metric: "safePlacementScore", operator: ">=", value: 0, score: 8 },
    ],
    avoidWhen: [{ metric: "safePlacementScore", operator: "<", value: -4, score: -20 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.22 }],
  }),
  milu_spirit_bind: makeRule({
    cardId: "milu_spirit_bind",
    timing: "conditional",
    riskProfile: "comeback",
    preferWhen: [
      { metric: "adjacentEnemyCount", operator: ">=", value: 1, score: 14 },
      { metric: "enemyStrongestPower", operator: ">=", value: 18, score: 12 },
    ],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: -8 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 8 }],
  }),
  yamabiko_echo_power: makeRule({
    cardId: "yamabiko_echo_power",
    timing: "conditional",
    riskProfile: "combo",
    preferWhen: [{ metric: "adjacentEnemyCount", operator: ">=", value: 1, score: 14 }],
    avoidWhen: [{ metric: "adjacentEnemyCount", operator: "==", value: 0, score: -10 }],
    placementPriorities: [{ metric: "adjacentEnemyCount", score: 8 }],
  }),

  // ---- Draw / tempo ----
  sleipnir_swift_messenger: makeRule({
    cardId: "sleipnir_swift_messenger",
    timing: "early",
    riskProfile: "safe",
    preferWhen: [{ metric: "lowHandSize", operator: "==", value: 1, score: 30 }],
    avoidWhen: [{ metric: "turnsRemaining", operator: "<=", value: 2, score: -14 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.22 }],
  }),
  verdandi_present: makeRule({
    cardId: "verdandi_present",
    timing: "early",
    riskProfile: "safe",
    preferWhen: [{ metric: "lowHandSize", operator: "==", value: 1, score: 20 }],
    avoidWhen: [{ metric: "turnsRemaining", operator: "<=", value: 2, score: -10 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
  }),
  susanoo_storm_breaker: makeRule({
    cardId: "susanoo_storm_breaker",
    timing: "conditional",
    riskProfile: "denial",
    preferWhen: [{ metric: "enemyBeastOrDragonCount", operator: ">=", value: 1, score: 38 }],
    avoidWhen: [{ metric: "enemyBeastOrDragonCount", operator: "==", value: 0, score: -28 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
  }),
  vidar_vengeance: makeRule({
    cardId: "vidar_vengeance",
    timing: "late",
    riskProfile: "comeback",
    preferWhen: [{ metric: "turnsRemaining", operator: "<=", value: 4, score: 16 }],
    avoidWhen: [{ metric: "turnsRemaining", operator: ">=", value: 7, score: -12 }],
    placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
  }),
};

const neutralRuleIds = [
  "fafnir_venom",
  "kane_pure_waters",
  "kupua_dual_aspect",
  "amaterasu_radiant_blessing",
  "lono_fertile_ground",
  "yamabiko_echo_power",
  "milu_spirit_bind",
] as const;

for (const id of neutralRuleIds) {
  if (!rules[id]) {
    rules[id] = makeRule({
      cardId: id,
      timing: "conditional",
      riskProfile: "combo",
      preferWhen: [],
      avoidWhen: [],
      placementPriorities: [{ metric: "safePlacementScore", score: 0.2 }],
    });
  }
}

export const ABILITY_RULES: Record<string, AbilityRule> = rules;
