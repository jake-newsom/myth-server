export interface SagaPickRarityWeights {
  legendary: number;
  epic: number;
}

export const SAGA_DRAFT_PICK_RARITY_WEIGHTS_ENV = "SAGA_DRAFT_PICK_RARITY_WEIGHTS";
export const SAGA_CARD_REWARD_RARITY_WEIGHTS_ENV = "SAGA_CARD_REWARD_RARITY_WEIGHTS";

const DEFAULT_DRAFT_PICK_RARITY_WEIGHTS: SagaPickRarityWeights = {
  legendary: 0.08,
  epic: 0.39,
};

const DEFAULT_CARD_REWARD_RARITY_WEIGHTS: SagaPickRarityWeights = {
  legendary: 0.02,
  epic: 0.39,
};

function parsePickRarityWeights(raw: string): SagaPickRarityWeights | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const legendary = parsed.legendary;
    const epic = parsed.epic;
    if (typeof legendary !== "number" || typeof epic !== "number") {
      return null;
    }
    if (!Number.isFinite(legendary) || !Number.isFinite(epic)) {
      return null;
    }
    if (legendary < 0 || epic < 0 || legendary + epic > 1) {
      return null;
    }
    return { legendary, epic };
  } catch {
    return null;
  }
}

function loadPickRarityWeights(
  envKey: string,
  defaults: SagaPickRarityWeights,
  label: string
): SagaPickRarityWeights {
  const raw = process.env[envKey]?.trim();
  if (!raw) return defaults;

  const parsed = parsePickRarityWeights(raw);
  if (parsed) return parsed;

  console.warn(
    `[saga] Invalid ${envKey}; using ${label} defaults. ` +
      'Expected JSON like {"legendary":0.08,"epic":0.39}'
  );
  return defaults;
}

export const sagaDraftPickRarityWeights = loadPickRarityWeights(
  SAGA_DRAFT_PICK_RARITY_WEIGHTS_ENV,
  DEFAULT_DRAFT_PICK_RARITY_WEIGHTS,
  "draft pick"
);

export const sagaCardRewardRarityWeights = loadPickRarityWeights(
  SAGA_CARD_REWARD_RARITY_WEIGHTS_ENV,
  DEFAULT_CARD_REWARD_RARITY_WEIGHTS,
  "card reward node"
);

export function getSagaDraftPickRarityWeights(): SagaPickRarityWeights {
  return sagaDraftPickRarityWeights;
}

export function getSagaCardRewardPickRarityWeights(): SagaPickRarityWeights {
  return sagaCardRewardRarityWeights;
}

export function rollSagaPickRarity(
  weights: SagaPickRarityWeights
): "legendary" | "epic" | "rare" {
  const roll = Math.random();
  if (roll < weights.legendary) return "legendary";
  if (roll < weights.legendary + weights.epic) return "epic";
  return "rare";
}
