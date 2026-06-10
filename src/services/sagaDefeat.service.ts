import SagaMapService from "./sagaMap.service";
import SagaService from "./saga.service";
import SagaCurrencyService from "./sagaCurrency.service";
import type { SagaDefeatResult } from "../types/sagaLifecycle.types";

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

const SagaDefeatService = {
  async processDefeat(
    runId: string,
    playerId: string,
    nodeId: string
  ): Promise<SagaDefeatResult> {
    const run = await SagaService.assertRunOwnership(runId, playerId);
    if (run.status !== "active") {
      throw httpError(400, "Run is not active");
    }

    await SagaService.updateRun(runId, playerId, {
      current_node: run.current_node ?? nodeId,
      pending_node_reward: null,
    });

    const mapView = await SagaMapService.getMapView(runId, playerId);
    const balance = await SagaCurrencyService.getBalance(
      playerId,
      run.season_id
    );

    return {
      run_id: runId,
      node_id: nodeId,
      had_checkpoint: true,
      reset_floor: run.current_floor,
      message: "Defeat recorded. You remain on this node and can retry the battle.",
      map_view: mapView,
      currency_earned: balance,
      run_currency_delta: 0,
    };
  },
};

export default SagaDefeatService;
