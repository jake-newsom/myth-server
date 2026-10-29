import { Response } from "express";
import { AuthenticatedRequest } from "../../types/middleware.types";
import RiddleService from "../../services/riddle.service";
import PlayerCosmeticsService from "../../services/playerCosmetics.service";
import { badRequest, unauthorized } from "../errors/httpError";

function userIdOf(req: AuthenticatedRequest): string {
  const id = req.user?.user_id;
  if (!id) throw unauthorized();
  return id;
}

function parseMove(body: any) {
  const x = Number(body?.position?.x ?? body?.x);
  const y = Number(body?.position?.y ?? body?.y);
  if (typeof body?.cardId !== "string" || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw badRequest("cardId and position {x, y} are required", "RIDDLE_BAD_MOVE");
  }
  return { cardId: body.cardId as string, position: { x, y } };
}

const RiddleController = {
  async getCurrent(req: AuthenticatedRequest, res: Response) {
    res.json(await RiddleService.getCurrent(userIdOf(req)));
  },

  async startAttempt(req: AuthenticatedRequest, res: Response) {
    res.json(await RiddleService.startAttempt(userIdOf(req), parseMove(req.body)));
  },

  async finishAttempt(req: AuthenticatedRequest, res: Response) {
    // The board can be full after the reply, so the final move is optional.
    const move = req.body?.cardId ? parseMove(req.body) : null;
    res.json(await RiddleService.finishAttempt(userIdOf(req), req.params.attemptId, move));
  },

  async getLeaderboard(req: AuthenticatedRequest, res: Response) {
    const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;
    const data = await RiddleService.getLeaderboard(userIdOf(req), limit);
    await PlayerCosmeticsService.attachToRows<{ userId: string }>(
      data.rankings,
      "userId"
    );
    res.json(data);
  },

  // --- admin ---

  async adminList(req: AuthenticatedRequest, res: Response) {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
    res.json({ puzzles: await RiddleService.listPuzzles(status, limit, offset) });
  },

  async adminSetStatus(req: AuthenticatedRequest, res: Response) {
    const status = req.body?.status;
    if (!["candidate", "approved", "retired"].includes(status)) {
      throw badRequest("status must be candidate, approved or retired", "RIDDLE_BAD_STATUS");
    }
    await RiddleService.setPuzzleStatus(req.params.id, status);
    res.json({ success: true });
  },

  async adminImport(req: AuthenticatedRequest, res: Response) {
    const puzzles = req.body?.puzzles;
    if (!Array.isArray(puzzles) || !puzzles.length) throw badRequest("puzzles[] is required", "RIDDLE_BAD_IMPORT");
    res.json({ imported: await RiddleService.importCandidates(puzzles) });
  },

  async adminRotate(_req: AuthenticatedRequest, res: Response) {
    res.json({ opened: await RiddleService.rotateWeek() });
  },
};

export default RiddleController;
