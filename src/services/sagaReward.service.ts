import { v4 as uuidv4 } from "uuid";
import SagaCardModel from "../models/sagaCard.model";
import SagaDeckModel from "../models/sagaDeck.model";
import SagaRunModel from "../models/sagaRun.model";
import SagaMapService from "./sagaMap.service";
import SagaDraftService from "./sagaDraft.service";
import SagaService from "./saga.service";
import { isSagaNodeMapData } from "./sagaMapGeneration.service";
import type { SagaMapNode } from "../types/sagaMap.types";
import type { SagaRuneType } from "../types/saga.types";
import type { SagaPendingNodeReward } from "../types/sagaReward.types";
import type {
  SagaBattleRewardClaimInput,
  SagaBattleRewardOption,
  SagaCardRewardClaimInput,
  SagaRewardClaimResult,
  SagaRewardStatusResponse,
} from "../types/sagaReward.types";
import { CardResponse } from "../types/api.types";

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sampleUnique(pool: string[], count: number): string[] {
  return shuffle(pool).slice(0, Math.min(count, pool.length));
}

function findNode(
  nodeMap: Record<string, unknown>,
  nodeId: string
): SagaMapNode | null {
  if (!isSagaNodeMapData(nodeMap)) return null;
  for (const floor of nodeMap.floors) {
    for (const row of floor.rows) {
      const node = row.nodes.find((n) => n.id === nodeId);
      if (node) return node;
    }
  }
  return null;
}

function parsePending(raw: unknown): SagaPendingNodeReward | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as SagaPendingNodeReward;
  if (!o.node_id || !o.type) return null;
  return o;
}

const BUFF_SIDES = ["top", "left", "right", "bottom"] as const;
const ALL_BLESSINGS: SagaRuneType[] = [
  "fury",
  "slayer",
  "iron",
  "sight",
  "thorns",
  "first",
  "bonds",
  "underdog",
];

type WeightedRewardKind = {
  kind: SagaBattleRewardOption["kind"];
  weight: number;
};

const NORMAL_REWARD_WEIGHTS: WeightedRewardKind[] = [
  { kind: "side_plus_2", weight: 40 },
  { kind: "card_plus_1_all", weight: 40 },
  { kind: "card_plus_2_all", weight: 10 },
  { kind: "blessing_offer", weight: 10 },
];

const HARD_REWARD_WEIGHTS: WeightedRewardKind[] = [
  { kind: "side_plus_2", weight: 5 },
  { kind: "card_plus_1_all", weight: 20 },
  { kind: "card_plus_2_all", weight: 25 },
  { kind: "blessing_offer", weight: 50 },
];

const BLESSING_DESCRIPTION_BY_TYPE: Record<SagaRuneType, string> = {
  fury: "Gain +1 to all sides for every battle this card is played in.",
  slayer: "Gain +2 to all sides when placed adjacent to a stronger enemy.",
  iron: "Cannot drop below original power values.",
  sight: "Draw 1 additional card when played.",
  thorns: "When defeated, inflict -2 to all sides on the defeating card.",
  first: "Gain +2 to all sides if this is your first card played this battle.",
  bonds: "Gain +1 to all sides for each adjacent ally.",
  underdog: "Gain +3 to all sides while controlling fewer tiles than your opponent.",
};

function rollWeightedKind(weights: WeightedRewardKind[]): SagaBattleRewardOption["kind"] {
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll < 0) return entry.kind;
  }
  return weights[weights.length - 1].kind;
}

function randomBlessing(): SagaRuneType {
  return ALL_BLESSINGS[Math.floor(Math.random() * ALL_BLESSINGS.length)];
}

const SagaRewardService = {
  async touchModifierFloor(
    sagaCardId: string,
    floor: number
  ): Promise<void> {
    const card = await SagaCardModel.findById(sagaCardId);
    if (!card) return;
    const current = card.modifier_floor ?? 1;
    if (floor > current) {
      await SagaCardModel.update(sagaCardId, { modifier_floor: floor });
    }
  },

  async getDeckSize(runId: string): Promise<number> {
    const deck = await SagaDeckModel.findWithActiveCardsByRunId(runId);
    return deck?.cards.length ?? 0;
  },

  async generateCardRewardOptions(runId: string): Promise<string[]> {
    const pool = await SagaDraftService.getCatalogPoolIds();
    const owned = await SagaCardModel.findByRunId(runId);
    const ownedIds = new Set(owned.map((c) => c.base_card_id));
    const available = pool.filter((id) => !ownedIds.has(id));
    const source = available.length >= 3 ? available : pool;
    return sampleUnique(source, 3);
  },

  async setPendingReward(
    runId: string,
    pending: SagaPendingNodeReward
  ): Promise<void> {
    await SagaRunModel.update(runId, { pending_node_reward: pending });
  },

  async clearPendingReward(runId: string): Promise<void> {
    await SagaRunModel.update(runId, { pending_node_reward: null });
  },

  async startCardRewardNode(
    runId: string,
    playerId: string,
    nodeId: string
  ): Promise<SagaPendingNodeReward> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    if (run.current_node !== nodeId) {
      throw httpError(400, "You must be on this node");
    }
    const node = findNode(run.node_map, nodeId);
    if (!node || node.type !== "card_reward") {
      throw httpError(400, "Not a card reward node");
    }

    const existing = parsePending(run.pending_node_reward);
    if (existing?.node_id === nodeId && existing.card_options?.length) {
      return existing;
    }

    const card_options = await this.generateCardRewardOptions(runId);
    const pending: SagaPendingNodeReward = {
      node_id: nodeId,
      type: "card_reward",
      card_options,
    };
    await this.setPendingReward(runId, pending);
    return pending;
  },

  buildBattleRewardOptions(node: SagaMapNode): SagaBattleRewardOption[] {
    const isBoss = node.type === "boss";
    const isHard = node.battle_difficulty === "hard" || isBoss;
    const weights = isHard ? HARD_REWARD_WEIGHTS : NORMAL_REWARD_WEIGHTS;
    const options: SagaBattleRewardOption[] = [];
    const pickedKinds = new Set<SagaBattleRewardOption["kind"]>();
    for (let i = 0; i < 3; i++) {
      const availableWeights = weights.filter((entry) => !pickedKinds.has(entry.kind));
      if (availableWeights.length === 0) break;
      const kind = rollWeightedKind(availableWeights);
      pickedKinds.add(kind);
      if (kind === "side_plus_2") {
        options.push({
          id: uuidv4(),
          kind,
          label: "Side Power +2",
          description: "Grant +2 to one side of a card.",
          buff_amount: 2,
        });
      } else if (kind === "card_plus_1_all") {
        options.push({
          id: uuidv4(),
          kind,
          label: "Card Power +1",
          description: "Grant +1 to all sides of a card.",
          buff_amount: 1,
        });
      } else if (kind === "card_plus_2_all") {
        options.push({
          id: uuidv4(),
          kind,
          label: "Card Power +2",
          description: "Grant +2 to all sides of a card.",
          buff_amount: 2,
        });
      } else {
        const blessing = randomBlessing();
        const blessingName = `${blessing.charAt(0).toUpperCase()}${blessing.slice(1)}`;
        options.push({
          id: uuidv4(),
          kind: "blessing_offer",
          label: `${blessingName} Blessing`,
          description: BLESSING_DESCRIPTION_BY_TYPE[blessing],
          rune_type: blessing,
        });
      }
    }

    return options;
  },

  async startBattleRewardNode(
    runId: string,
    playerId: string,
    nodeId: string
  ): Promise<SagaPendingNodeReward> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    const node = findNode(run.node_map, nodeId);
    if (!node || (node.type !== "battle" && node.type !== "boss")) {
      throw httpError(400, "Not a battle node");
    }

    const existing = parsePending(run.pending_node_reward);
    if (existing?.node_id === nodeId && existing.battle_options?.length) {
      return existing;
    }

    const pending: SagaPendingNodeReward = {
      node_id: nodeId,
      type: "battle_reward",
      battle_options: this.buildBattleRewardOptions(node),
    };
    await this.setPendingReward(runId, pending);
    return pending;
  },

  async getRewardStatus(
    runId: string,
    playerId: string
  ): Promise<SagaRewardStatusResponse> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    const pending = parsePending(run.pending_node_reward);
    const deckSize = await this.getDeckSize(runId);

    if (!pending) {
      return {
        pending: null,
        deck_size: deckSize,
        deck_at_capacity: deckSize >= 20,
      };
    }

    let card_options: CardResponse[] | undefined;
    if (pending.type === "card_reward" && pending.card_options?.length) {
      card_options = await SagaDraftService.loadCardsByIds(
        pending.card_options
      );
    }

    return {
      pending,
      card_options,
      deck_size: deckSize,
      deck_at_capacity: deckSize >= 20,
    };
  },

  async applyGambleBuff(
    runId: string,
    floor: number,
    amount: number
  ): Promise<string> {
    const deck = await SagaDeckModel.findWithActiveCardsByRunId(runId);
    if (!deck?.cards.length) throw httpError(400, "No cards in deck");
    const card = deck.cards[Math.floor(Math.random() * deck.cards.length)];
    const side = BUFF_SIDES[Math.floor(Math.random() * BUFF_SIDES.length)];
    const field = `${side}_buff` as "top_buff" | "left_buff" | "right_buff" | "bottom_buff";
    const current = card[field];
    await SagaCardModel.update(card.saga_card_id, {
      [field]: current + amount,
    });
    await this.touchModifierFloor(card.saga_card_id, floor);
    return card.saga_card_id;
  },

  async applyPrecisionBuff(
    sagaCardId: string,
    playerId: string,
    side: "top" | "left" | "right" | "bottom",
    amount: number,
    floor: number
  ): Promise<void> {
    const card = await SagaCardModel.findById(sagaCardId);
    if (!card) throw httpError(404, "Saga card not found");
    await SagaService.assertRunOwnership(card.run_id, playerId);
    const field = `${side}_buff` as "top_buff" | "left_buff" | "right_buff" | "bottom_buff";
    await SagaCardModel.update(sagaCardId, {
      [field]: card[field] + amount,
    });
    await this.touchModifierFloor(sagaCardId, floor);
  },

  async applyCardWideBuff(
    sagaCardId: string,
    playerId: string,
    amount: number,
    floor: number
  ): Promise<void> {
    const card = await SagaCardModel.findById(sagaCardId);
    if (!card) throw httpError(404, "Saga card not found");
    await SagaService.assertRunOwnership(card.run_id, playerId);
    await SagaCardModel.update(sagaCardId, {
      top_buff: card.top_buff + amount,
      right_buff: card.right_buff + amount,
      bottom_buff: card.bottom_buff + amount,
      left_buff: card.left_buff + amount,
    });
    await this.touchModifierFloor(sagaCardId, floor);
  },

  async applyRune(
    sagaCardId: string,
    playerId: string,
    runeType: SagaRuneType,
    floor: number
  ): Promise<void> {
    const card = await SagaCardModel.findById(sagaCardId);
    if (!card) throw httpError(404, "Saga card not found");
    await SagaService.assertRunOwnership(card.run_id, playerId);
    if (card.rune_type) {
      throw httpError(400, "This card already has a rune");
    }
    await SagaCardModel.update(sagaCardId, {
      rune_type: runeType,
      rune_stacks: runeType === "fury" ? card.rune_stacks : 0,
    });
    await this.touchModifierFloor(sagaCardId, floor);
  },

  async claimCardReward(
    runId: string,
    playerId: string,
    input: SagaCardRewardClaimInput
  ): Promise<SagaRewardClaimResult> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    const pending = parsePending(run.pending_node_reward);
    if (!pending || pending.type !== "card_reward") {
      throw httpError(400, "No card reward pending");
    }
    if (pending.node_id !== input.node_id) {
      throw httpError(400, "Reward does not match current node");
    }
    const deck = await SagaDeckModel.findByRunId(runId);
    if (!deck) throw httpError(500, "Deck missing");

    const deckSize = await this.getDeckSize(runId);
    let sagaCardId: string | undefined;

    if (input.skip) {
      await this.clearPendingReward(runId);
      const mapView = await SagaMapService.completeNode(
        runId,
        playerId,
        input.node_id
      );
      return { pending: null, map_view: mapView };
    }

    if (!pending.card_options?.includes(input.base_card_id)) {
      throw httpError(400, "Invalid card selection");
    }

    if (deckSize >= 20) {
      const created = await SagaCardModel.create(runId, {
        base_card_id: input.base_card_id,
        deck_id: null,
        is_active: false,
        modifier_floor: run.current_floor,
      });
      sagaCardId = created.saga_card_id;
    } else {
      const created = await SagaCardModel.create(runId, {
        base_card_id: input.base_card_id,
        deck_id: deck.deck_id,
        is_active: true,
        modifier_floor: run.current_floor,
      });
      sagaCardId = created.saga_card_id;
    }

    await this.clearPendingReward(runId);
    const mapView = await SagaMapService.completeNode(
      runId,
      playerId,
      input.node_id
    );

    return { pending: null, map_view: mapView, saga_card_id: sagaCardId };
  },

  async claimBattleReward(
    runId: string,
    playerId: string,
    input: SagaBattleRewardClaimInput
  ): Promise<SagaRewardClaimResult> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    const pending = parsePending(run.pending_node_reward);
    if (!pending || pending.type !== "battle_reward") {
      throw httpError(400, "No battle reward pending");
    }
    if (pending.node_id !== input.node_id) {
      throw httpError(400, "Reward does not match current node");
    }

    const option = pending.battle_options?.find((o) => o.id === input.option_id);
    if (!option) throw httpError(400, "Invalid reward option");

    const floor = run.current_floor;

    if (option.kind === "side_plus_2") {
      if (!input.saga_card_id || !input.side) {
        throw httpError(400, "Choose a card and side for this buff");
      }
      await this.applyPrecisionBuff(
        input.saga_card_id,
        playerId,
        input.side,
        option.buff_amount ?? 2,
        floor
      );
    } else if (option.kind === "card_plus_1_all") {
      if (!input.saga_card_id) {
        throw httpError(400, "Choose a card for this buff");
      }
      await this.applyCardWideBuff(input.saga_card_id, playerId, 1, floor);
    } else if (option.kind === "card_plus_2_all") {
      if (!input.saga_card_id) {
        throw httpError(400, "Choose a card for this buff");
      }
      await this.applyCardWideBuff(input.saga_card_id, playerId, 2, floor);
    } else if (option.kind === "blessing_offer") {
      if (!input.saga_card_id) {
        throw httpError(400, "Choose a card for this blessing");
      }
      if (!option.rune_type || !ALL_BLESSINGS.includes(option.rune_type)) {
        throw httpError(400, "Invalid blessing on reward option");
      }
      await this.applyRune(input.saga_card_id, playerId, option.rune_type, floor);
    }

    await this.clearPendingReward(runId);
    const mapView = await SagaMapService.completeNode(
      runId,
      playerId,
      input.node_id
    );

    return { pending: null, map_view: mapView };
  },
};

export default SagaRewardService;
