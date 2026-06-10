import SagaDeckModel from "../models/sagaDeck.model";
import SagaCollectionModel from "../models/sagaCollection.model";
import SagaCardModel from "../models/sagaCard.model";
import SagaService from "./saga.service";
import type { SagaRosterView } from "../types/sagaLifecycle.types";

const DECK_SIZE = 20;

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

const SagaDeckManageService = {
  async getRoster(runId: string, playerId: string): Promise<SagaRosterView> {
    await SagaService.assertRunOwnership(runId, playerId);
    const deck = await SagaDeckModel.findWithActiveCardsByRunId(runId);
    const collection =
      await SagaCollectionModel.findWithBenchCardsByRunId(runId);
    if (!deck) throw httpError(404, "Saga deck not found");
    if (!collection) throw httpError(404, "Saga collection not found");
    return { run_id: runId, deck, collection };
  },

  async swapCards(
    runId: string,
    playerId: string,
    benchSagaCardId: string,
    deckSagaCardId: string
  ): Promise<SagaRosterView> {
    await SagaService.assertRunOwnership(runId, playerId);
    const deck = await SagaDeckModel.findByRunId(runId);
    if (!deck) throw httpError(404, "Saga deck not found");

    const benchCard = await SagaCardModel.findById(benchSagaCardId);
    const deckCard = await SagaCardModel.findById(deckSagaCardId);

    if (!benchCard || benchCard.run_id !== runId) {
      throw httpError(400, "Invalid bench card");
    }
    if (!deckCard || deckCard.run_id !== runId) {
      throw httpError(400, "Invalid deck card");
    }
    if (benchCard.is_active) {
      throw httpError(400, "First card must be on the bench");
    }
    if (!deckCard.is_active) {
      throw httpError(400, "Second card must be in the active deck");
    }

    await SagaCardModel.update(benchSagaCardId, {
      deck_id: deck.deck_id,
      is_active: true,
    });
    await SagaCardModel.update(deckSagaCardId, {
      deck_id: null,
      is_active: false,
    });

    const active = await SagaCardModel.findActiveByRunId(runId);
    if (active.length !== DECK_SIZE) {
      throw httpError(500, "Deck must have exactly 20 active cards after swap");
    }

    return this.getRoster(runId, playerId);
  },
};

export default SagaDeckManageService;
