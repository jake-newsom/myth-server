import { v4 as uuidv4 } from "uuid";
import SagaCardModel from "../models/sagaCard.model";
import SagaDeckModel from "../models/sagaDeck.model";
import SagaRunModel from "../models/sagaRun.model";
import SagaMapService from "./sagaMap.service";
import { getSagaCardRewardPickRarityWeights } from "../config/sagaDraft.config";
import SagaDraftService from "./sagaDraft.service";
import SagaService from "./saga.service";
import { isSagaNodeMapData } from "./sagaMapGeneration.service";
import {
  computeSagaCardPower,
  fetchCardRowsByVariantIds,
} from "../game-engine/sagaBattle.hydration";
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
import type { PowerValues } from "../types/card.types";

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
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

const BLESSING_DESCRIPTION_BY_TYPE: Record<SagaRuneType, string> = {
  fury: "Gain +1 to all sides for every battle this card is played in.",
  slayer:
    "When this card defeats an enemy, permanently steal +1 from the enemy's highest side and add it to this card's lowest side.",
  iron: "Cannot drop below original power values.",
  sight: "Draw 1 additional card when played.",
  thorns: "When defeated, destroy the card that defeated it. Once per battle.",
  first:
    "The first time this card enters play each battle, it cannot be defeated for 2 rounds.",
  bonds: "This card cannot be defeated while adjacent to an ally.",
  underdog:
    "When placed adjacent to a stronger enemy, reduce that enemy's highest side by 2.",
};

function randomBlessing(): SagaRuneType {
  return ALL_BLESSINGS[Math.floor(Math.random() * ALL_BLESSINGS.length)];
}

function randomDistinctBlessings(count: number): SagaRuneType[] {
  const pool = [...ALL_BLESSINGS];
  const picked: SagaRuneType[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

function rollEqual<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

function buildBlessingOption(blessing: SagaRuneType): SagaBattleRewardOption {
  const blessingName = `${blessing.charAt(0).toUpperCase()}${blessing.slice(1)}`;
  return {
    id: uuidv4(),
    kind: "blessing_offer",
    label: `${blessingName} Blessing`,
    description: BLESSING_DESCRIPTION_BY_TYPE[blessing],
    rune_type: blessing,
  };
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
    const owned = await SagaCardModel.findByRunId(runId);
    const ownedIds = new Set(owned.map((c) => c.base_card_id));
    return SagaDraftService.generateWeightedPickOptions(
      ownedIds,
      getSagaCardRewardPickRarityWeights()
    );
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
    const isHard = node.battle_difficulty === "hard";

    const CARD_PLUS_1_ALL: SagaBattleRewardOption = {
      id: uuidv4(),
      kind: "card_plus_1_all",
      label: "Card Power +1",
      description: "Grant +1 to all sides of a card.",
      buff_amount: 1,
    };
    const CARD_PLUS_2_ALL: SagaBattleRewardOption = {
      id: uuidv4(),
      kind: "card_plus_2_all",
      label: "Card Power +2",
      description: "Grant +2 to all sides of a card.",
      buff_amount: 2,
    };
    const SIDE_PLUS_2_WEAKEST: SagaBattleRewardOption = {
      id: uuidv4(),
      kind: "side_plus_2_weakest",
      label: "Weakest Side +2",
      description: "Grant +2 to a card's weakest side.",
      buff_amount: 2,
    };
    const SIDE_PLUS_4_WEAKEST: SagaBattleRewardOption = {
      id: uuidv4(),
      kind: "side_plus_4_weakest",
      label: "Weakest Side +4",
      description: "Grant +4 to a card's weakest side.",
      buff_amount: 4,
    };

    if (isBoss) {
      return randomDistinctBlessings(3).map(buildBlessingOption);
    }

    if (isHard) {
      const options = [CARD_PLUS_2_ALL, SIDE_PLUS_4_WEAKEST];
      const blessingCount = Math.random() < 0.5 ? 1 : 2;
      for (const blessing of randomDistinctBlessings(blessingCount)) {
        options.push(buildBlessingOption(blessing));
      }
      return options;
    }

    const rolledKind = rollEqual<SagaBattleRewardOption["kind"]>([
      "blessing_offer",
      "card_plus_2_all",
      "side_plus_4_weakest",
    ]);
    const rolledOption =
      rolledKind === "blessing_offer"
        ? buildBlessingOption(randomBlessing())
        : rolledKind === "card_plus_2_all"
          ? CARD_PLUS_2_ALL
          : SIDE_PLUS_4_WEAKEST;

    return [CARD_PLUS_1_ALL, SIDE_PLUS_2_WEAKEST, rolledOption];
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

  async applyWeakestSideBuff(
    sagaCardId: string,
    playerId: string,
    amount: number,
    floor: number
  ): Promise<void> {
    const card = await SagaCardModel.findById(sagaCardId);
    if (!card) throw httpError(404, "Saga card not found");
    await SagaService.assertRunOwnership(card.run_id, playerId);

    const rows = await fetchCardRowsByVariantIds([card.base_card_id]);
    const dbRow = rows.get(card.base_card_id);
    if (!dbRow) throw httpError(404, "Base card not found");

    const basePower: PowerValues = {
      top: parseInt(dbRow.base_power_top, 10),
      right: parseInt(dbRow.base_power_right, 10),
      bottom: parseInt(dbRow.base_power_bottom, 10),
      left: parseInt(dbRow.base_power_left, 10),
    };
    const effective = computeSagaCardPower(basePower, card);

    let weakestSide: keyof PowerValues = "top";
    for (const side of ["top", "left", "right", "bottom"] as const) {
      if (effective[side] < effective[weakestSide]) {
        weakestSide = side;
      }
    }

    const field = `${weakestSide}_buff` as "top_buff" | "left_buff" | "right_buff" | "bottom_buff";
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

    if (option.kind === "side_plus_2_weakest" || option.kind === "side_plus_4_weakest") {
      if (!input.saga_card_id) {
        throw httpError(400, "Choose a card for this buff");
      }
      await this.applyWeakestSideBuff(
        input.saga_card_id,
        playerId,
        option.buff_amount ?? (option.kind === "side_plus_2_weakest" ? 2 : 4),
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
