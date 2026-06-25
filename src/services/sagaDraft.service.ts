import db from "../config/db.config";
import CardModel from "../models/card.model";
import SagaSeasonModel from "../models/sagaSeason.model";
import SagaRunModel from "../models/sagaRun.model";
import SagaDeckModel from "../models/sagaDeck.model";
import SagaCardModel from "../models/sagaCard.model";
import SagaService from "./saga.service";
import SagaMapService from "./sagaMap.service";
import { RarityUtils } from "../types/card.types";
import { CardResponse } from "../types/api.types";
import {
  getSagaDraftPickRarityWeights,
  rollSagaPickRarity,
  type SagaPickRarityWeights,
} from "../config/sagaDraft.config";
import {
  SAGA_DRAFT_CONFIG,
  SagaDraftState,
  SagaRunDetail,
} from "../types/saga.types";

type DraftCard = Omit<
  CardResponse,
  "user_card_instance_id" | "level" | "xp" | "power_enhancements"
>;

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

function sampleUnique<T>(pool: T[], count: number): T[] {
  if (pool.length < count) {
    throw httpError(500, "Not enough cards in draft pool");
  }
  return shuffle(pool).slice(0, count);
}

function isEpicRarity(rarity: string): boolean {
  return rarity.startsWith("epic");
}

type DraftRarityPools = Record<"legendary" | "epic" | "rare", string[]>;

function parseLegendaryAnchorIds(anchors: unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of anchors) {
    if (typeof entry === "string") {
      ids.push(entry);
    } else if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const id = obj.base_card_id ?? obj.card_variant_id ?? obj.card_id;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}

const SagaDraftService = {
  async loadCardsByIds(cardIds: string[]): Promise<DraftCard[]> {
    if (cardIds.length === 0) return [];
    const { data } = await CardModel.findAllStatic(
      { ids: cardIds.join(",") },
      1,
      0
    );
    const byId = new Map(data.map((c) => [c.base_card_id, c]));
    return cardIds
      .map((id) => byId.get(id))
      .filter((c): c is DraftCard => Boolean(c));
  },

  /** All released catalog variants (includes legendaries). */
  async getCatalogPoolIds(): Promise<string[]> {
    const { data } = await CardModel.findAllStatic({}, 1, 0);
    return data.map((c) => c.base_card_id);
  },

  /** Map of base_card_id -> character_id for the full catalog. */
  async getCharacterIdByBaseCardId(): Promise<Map<string, string>> {
    const { data } = await CardModel.findAllStatic({}, 1, 0);
    return new Map(
      data
        .filter((c) => Boolean(c.character_id))
        .map((c) => [c.base_card_id, c.character_id])
    );
  },

  /** Cards eligible for weighted core draft picks. */
  async getDraftRarityPools(): Promise<DraftRarityPools> {
    const { data } = await CardModel.findAllStatic({}, 1, 0);
    const pools: DraftRarityPools = { legendary: [], epic: [], rare: [] };
    for (const card of data) {
      if (RarityUtils.isLegendary(card.rarity)) {
        pools.legendary.push(card.base_card_id);
      } else if (isEpicRarity(card.rarity)) {
        pools.epic.push(card.base_card_id);
      } else if (RarityUtils.isRare(card.rarity)) {
        pools.rare.push(card.base_card_id);
      }
    }
    return pools;
  },

  /** Core draft picks — non-legendary only (legendary anchor is separate). */
  async getDraftPoolIds(): Promise<string[]> {
    const { data } = await CardModel.findAllStatic({}, 1, 0);
    return data
      .filter((c) => !RarityUtils.isLegendary(c.rarity))
      .map((c) => c.base_card_id);
  },

  async getLegendaryPoolIds(): Promise<string[]> {
    const legendaryRarities = RarityUtils.getAllValidRarities().filter((r) =>
      RarityUtils.isLegendary(r)
    );
    const ids: string[] = [];
    for (const rarity of legendaryRarities) {
      const { data } = await CardModel.findAllStatic({ rarity }, 1, 0);
      ids.push(...data.map((c) => c.base_card_id));
    }
    return [...new Set(ids)];
  },

  assertDraftPhase(
    run: { draft_state: SagaDraftState | null },
    expected: SagaDraftState["phase"] | SagaDraftState["phase"][]
  ): SagaDraftState {
    const state = run.draft_state;
    if (!state) {
      throw httpError(400, "This run has no draft in progress");
    }
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(state.phase)) {
      throw httpError(400, `Draft is not in the expected phase (${allowed.join("|")})`);
    }
    return state;
  },

  async startDraft(playerId: string, seasonId: string): Promise<{
    run: SagaRunDetail;
    legendary_options: DraftCard[];
    draft_state: SagaDraftState;
  }> {
    const season = await SagaSeasonModel.findById(seasonId);
    if (!season) throw httpError(404, "Saga season not found");

    await SagaService.expireStaleInstanceRun(playerId, seasonId);

    const existing = await SagaRunModel.findActiveByPlayerAndSeason(
      playerId,
      seasonId
    );
    if (existing?.draft_state?.phase === "complete") {
      throw httpError(
        409,
        "You already have an active saga run with a completed draft"
      );
    }
    if (existing && existing.draft_state) {
      const options = await this.getLegendaryOptionsForRun(existing);
      return {
        run: (await SagaService.getRunDetail(existing.run_id, playerId)) as SagaRunDetail,
        legendary_options: options,
        draft_state: existing.draft_state,
      };
    }
    if (existing) {
      throw httpError(409, "Active saga run exists without draft state");
    }

    const runDetail = await SagaService.createRun(playerId, { season_id: seasonId });
    const draftState: SagaDraftState = {
      phase: "legendary",
      picked_base_card_ids: [],
      picks_completed: 0,
    };
    await SagaRunModel.update(runDetail.run_id, { draft_state: draftState });

    const legendary_options = await this.getLegendaryOptionsForSeason(seasonId);
    const run = await SagaService.getRunDetail(runDetail.run_id, playerId);
    return { run: run as SagaRunDetail, legendary_options, draft_state: draftState };
  },

  async getLegendaryOptionsForSeason(seasonId: string): Promise<DraftCard[]> {
    const season = await SagaSeasonModel.findById(seasonId);
    if (!season) throw httpError(404, "Saga season not found");

    const anchorIds = parseLegendaryAnchorIds(season.legendary_anchors);
    let optionIds: string[];

    if (anchorIds.length >= 3) {
      optionIds = sampleUnique(anchorIds, 3);
    } else {
      const legendaryPool = await this.getLegendaryPoolIds();
      const exclude = new Set(anchorIds);
      const pool = legendaryPool.filter((id) => !exclude.has(id));
      const filler = sampleUnique(pool, Math.max(0, 3 - anchorIds.length));
      optionIds = sampleUnique([...anchorIds, ...filler], Math.min(3, anchorIds.length + filler.length));
      if (optionIds.length < 3) {
        optionIds = sampleUnique(legendaryPool, 3);
      }
    }

    return this.loadCardsByIds(optionIds);
  },

  async getLegendaryOptionsForRun(run: { season_id: string }): Promise<DraftCard[]> {
    return this.getLegendaryOptionsForSeason(run.season_id);
  },

  async selectLegendary(
    runId: string,
    playerId: string,
    baseCardId: string
  ): Promise<{
    run: SagaRunDetail;
    draft_state: SagaDraftState;
    pick_options: DraftCard[];
  }> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    this.assertDraftPhase(run, "legendary");

    const options = await this.getLegendaryOptionsForSeason(run.season_id);
    if (!options.some((c) => c.base_card_id === baseCardId)) {
      throw httpError(400, "Selected card is not a valid legendary anchor option");
    }

    const deck = await SagaDeckModel.findByRunId(runId);
    if (!deck) throw httpError(500, "Saga deck missing for run");

    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await SagaCardModel.deleteByRunId(runId, client);

      const copies = SAGA_DRAFT_CONFIG.COPIES_PER_CARD;
      for (let i = 0; i < copies; i++) {
        await SagaCardModel.create(
          runId,
          { base_card_id: baseCardId, deck_id: deck.deck_id, is_active: true },
          client
        );
      }

      const draftState: SagaDraftState = {
        phase: "picking",
        picked_base_card_ids: [baseCardId],
        picks_completed: 0,
        legendary_base_card_id: baseCardId,
      };

      const pickOptionIds = await this.generatePickOptions(draftState);
      draftState.pending_pick_options = pickOptionIds;

      await SagaRunModel.update(runId, { draft_state: draftState }, client);
      await client.query("COMMIT");

      const pick_options = await this.loadCardsByIds(pickOptionIds);
      const updatedRun = await SagaService.getRunDetail(runId, playerId);
      return { run: updatedRun as SagaRunDetail, draft_state: draftState, pick_options };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async generateWeightedPickOptions(
    excludedIds: Iterable<string>,
    weights: SagaPickRarityWeights,
    count = 3
  ): Promise<string[]> {
    const pools = await this.getDraftRarityPools();
    const characterByBaseCard = await this.getCharacterIdByBaseCardId();
    const excluded = new Set(excludedIds);
    const picked = new Set<string>();

    // A character is "taken" once any of its variants is already drafted or
    // offered in this batch, so a single draft never shows the same base
    // character twice (regardless of variant).
    const excludedCharacters = new Set<string>();
    for (const id of excluded) {
      const charId = characterByBaseCard.get(id);
      if (charId) excludedCharacters.add(charId);
    }
    const pickedCharacters = new Set<string>();
    const options: string[] = [];

    const isAvailable = (id: string): boolean => {
      if (excluded.has(id) || picked.has(id)) return false;
      const charId = characterByBaseCard.get(id);
      if (charId && (excludedCharacters.has(charId) || pickedCharacters.has(charId))) {
        return false;
      }
      return true;
    };

    const poolForRarity = (rarity: keyof DraftRarityPools): string[] =>
      pools[rarity].filter(isAvailable);

    const fallbackPool = (): string[] =>
      [...pools.legendary, ...pools.epic, ...pools.rare].filter(isAvailable);

    let attempts = 0;
    while (options.length < count && attempts < 100) {
      attempts++;
      const rarity = rollSagaPickRarity(weights);
      let pool = poolForRarity(rarity);
      if (pool.length === 0) pool = fallbackPool();
      if (pool.length === 0) break;
      const choice = shuffle(pool)[0];
      picked.add(choice);
      const charId = characterByBaseCard.get(choice);
      if (charId) pickedCharacters.add(charId);
      options.push(choice);
    }

    if (options.length < count) {
      throw httpError(500, "Not enough cards in draft pool");
    }
    return options;
  },

  async generatePickOptions(draftState: SagaDraftState): Promise<string[]> {
    return this.generateWeightedPickOptions(
      draftState.picked_base_card_ids,
      getSagaDraftPickRarityWeights()
    );
  },

  async getCurrentPickOptions(runId: string, playerId: string): Promise<{
    draft_state: SagaDraftState;
    pick_options: DraftCard[];
    pick_index: number;
    total_picks: number;
  }> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    const draftState = this.assertDraftPhase(run, "picking");

    if (draftState.picks_completed >= SAGA_DRAFT_CONFIG.CORE_PICKS) {
      throw httpError(400, "All core draft picks are complete");
    }

    const pools = await this.getDraftRarityPools();
    const draftPool = new Set([
      ...pools.legendary,
      ...pools.epic,
      ...pools.rare,
    ]);
    let optionIds = draftState.pending_pick_options;
    const optionsStale =
      optionIds?.some((id) => !draftPool.has(id)) ?? false;
    if (!optionIds?.length || optionsStale) {
      optionIds = await this.generatePickOptions(draftState);
      await SagaRunModel.update(runId, {
        draft_state: { ...draftState, pending_pick_options: optionIds },
      });
    }

    return {
      draft_state: { ...draftState, pending_pick_options: optionIds },
      pick_options: await this.loadCardsByIds(optionIds),
      pick_index: draftState.picks_completed + 1,
      total_picks: SAGA_DRAFT_CONFIG.CORE_PICKS,
    };
  },

  async selectPick(
    runId: string,
    playerId: string,
    baseCardId: string
  ): Promise<{
    run: SagaRunDetail;
    draft_state: SagaDraftState;
    pick_options: DraftCard[] | null;
    pick_index: number;
    total_picks: number;
  }> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    const draftState = this.assertDraftPhase(run, "picking");

    if (draftState.picks_completed >= SAGA_DRAFT_CONFIG.CORE_PICKS) {
      throw httpError(400, "All core draft picks are complete");
    }

    const optionIds = draftState.pending_pick_options ?? [];
    if (!optionIds.includes(baseCardId)) {
      throw httpError(400, "Selected card is not among the current pick options");
    }
    if (draftState.picked_base_card_ids.includes(baseCardId)) {
      throw httpError(400, "Card already drafted");
    }

    const deck = await SagaDeckModel.findByRunId(runId);
    if (!deck) throw httpError(500, "Saga deck missing for run");

    const copies = SAGA_DRAFT_CONFIG.COPIES_PER_CARD;
    for (let i = 0; i < copies; i++) {
      await SagaCardModel.create(runId, {
        base_card_id: baseCardId,
        deck_id: deck.deck_id,
        is_active: true,
      });
    }

    const picksCompleted = draftState.picks_completed + 1;
    const pickedIds = [...draftState.picked_base_card_ids, baseCardId];
    const isLastPick = picksCompleted >= SAGA_DRAFT_CONFIG.CORE_PICKS;

    const nextState: SagaDraftState = {
      ...draftState,
      picks_completed: picksCompleted,
      picked_base_card_ids: pickedIds,
      pending_pick_options: undefined,
      phase: isLastPick ? "review" : "picking",
    };

    if (!isLastPick) {
      nextState.pending_pick_options = await this.generatePickOptions(nextState);
    }

    await SagaRunModel.update(runId, { draft_state: nextState });

    const pick_options = isLastPick
      ? null
      : await this.loadCardsByIds(nextState.pending_pick_options!);

    const updatedRun = await SagaService.getRunDetail(runId, playerId);
    return {
      run: updatedRun as SagaRunDetail,
      draft_state: nextState,
      pick_options,
      pick_index: isLastPick ? SAGA_DRAFT_CONFIG.CORE_PICKS : picksCompleted + 1,
      total_picks: SAGA_DRAFT_CONFIG.CORE_PICKS,
    };
  },

  async finalizeDraft(runId: string, playerId: string): Promise<SagaRunDetail> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    const draftState = this.assertDraftPhase(run, "review");

    const deck = await SagaDeckModel.findWithActiveCardsByRunId(runId);
    const cardCount = deck?.cards.length ?? 0;
    if (cardCount !== SAGA_DRAFT_CONFIG.DECK_SIZE) {
      throw httpError(
        400,
        `Draft deck must have ${SAGA_DRAFT_CONFIG.DECK_SIZE} cards (found ${cardCount})`
      );
    }

    const uniqueCount = new Set(draftState.picked_base_card_ids).size;
    const expectedUnique =
      SAGA_DRAFT_CONFIG.LEGENDARY_PICKS + SAGA_DRAFT_CONFIG.CORE_PICKS;
    if (uniqueCount !== expectedUnique) {
      throw httpError(400, `Draft must contain ${expectedUnique} unique cards`);
    }

    await SagaRunModel.update(runId, {
      draft_state: { ...draftState, phase: "complete" },
    });

    await SagaMapService.generateAndPersistMap(runId, run.season_id);

    return (await SagaService.getRunDetail(runId, playerId)) as SagaRunDetail;
  },

  async getDraftStatus(runId: string, playerId: string) {
    const run = await SagaService.getRunDetail(runId, playerId);
    const state = run.draft_state;
    let legendary_options: DraftCard[] | null = null;
    let pick_options: DraftCard[] | null = null;
    let pick_index: number | null = null;

    if (state?.phase === "legendary") {
      legendary_options = await this.getLegendaryOptionsForSeason(run.season_id);
    } else if (state?.phase === "picking") {
      const pickData = await this.getCurrentPickOptions(runId, playerId);
      pick_options = pickData.pick_options;
      pick_index = pickData.pick_index;
    }

    return {
      run,
      draft_state: state,
      legendary_options,
      pick_options,
      pick_index,
      total_picks: SAGA_DRAFT_CONFIG.CORE_PICKS,
    };
  },
};

export default SagaDraftService;
