// myth-server/src/api/controllers/event.controller.ts

import { Response } from "express";
import { AuthenticatedRequest } from "../../types/middleware.types";
import EventService from "../../services/event.service";
import EventShopService from "../../services/eventShop.service";
import LoginSequenceService from "../../services/loginSequence.service";
import EventMilestoneService from "../../services/eventMilestone.service";

/**
 * GET /api/events
 *
 * Every event currently visible to the caller (live, or previewable via their
 * feature flag). Returns an empty list rather than an error when there are
 * none, so the client can call this unconditionally.
 */
export const getEvents = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const events = await EventService.getEventsForUser(userId);
    const summaries = await Promise.all(
      events.map((event) => EventService.toSummary(userId, event))
    );

    res.status(200).json({ success: true, events: summaries });
  } catch (error) {
    console.error("Error getting events:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/** GET /api/events/:eventId — one event, 404 when not visible to this user. */
export const getEvent = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const event = await EventService.assertEventAccessible(
      userId,
      req.params.eventId
    );
    if (!event) {
      res.status(404).json({ success: false, error: "Event not found" });
      return;
    }

    res.status(200).json({
      success: true,
      event: await EventService.toSummary(userId, event),
    });
  } catch (error) {
    console.error("Error getting event:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/** GET /api/events/:eventId/shop */
export const getEventShop = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const event = await EventService.assertEventAccessible(
      userId,
      req.params.eventId
    );
    if (!event) {
      res.status(404).json({ success: false, error: "Event not found" });
      return;
    }

    const offerings = await EventShopService.getShop(userId, event.id);
    const balance = event.currency_id
      ? await EventService.getBalance(userId, event.currency_id)
      : 0;

    res.status(200).json({
      success: true,
      offerings,
      currency: event.currency ? { ...event.currency, balance } : null,
    });
  } catch (error) {
    console.error("Error getting event shop:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/** POST /api/events/:eventId/shop/:offeringId/purchase */
export const purchaseEventShopItem = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const quantity = Number(req.body?.quantity ?? 1);
    const result = await EventShopService.purchase(
      userId,
      req.params.eventId,
      req.params.offeringId,
      quantity
    );

    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.status(200).json({ success: true, items: result.items });
  } catch (error) {
    console.error("Error purchasing event shop item:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/**
 * GET /api/events/:eventId/login-sequence
 *
 * Credits today's login as a side effect, so simply opening the event screen
 * advances the ladder. Crediting is idempotent per UTC day.
 */
export const getEventLoginSequence = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const event = await EventService.assertEventAccessible(
      userId,
      req.params.eventId
    );
    if (!event || !event.login_sequence_id) {
      res.status(404).json({ success: false, error: "No login sequence" });
      return;
    }

    await LoginSequenceService.creditLogin(userId, event.login_sequence_id);
    const status = await LoginSequenceService.getStatus(
      userId,
      event.login_sequence_id
    );

    res.status(200).json({ success: true, status });
  } catch (error) {
    console.error("Error getting event login sequence:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/** POST /api/events/:eventId/login-sequence/claim */
export const claimEventLoginSequence = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const event = await EventService.assertEventAccessible(
      userId,
      req.params.eventId
    );
    if (!event || !event.login_sequence_id) {
      res.status(404).json({ success: false, error: "No login sequence" });
      return;
    }

    // Credit first: a player who opens the app straight to "claim" should not
    // have to make a separate read call to earn today's rung.
    await LoginSequenceService.creditLogin(userId, event.login_sequence_id);

    const result = await LoginSequenceService.claimPending(
      userId,
      event.login_sequence_id,
      event.currency_id
    );
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.status(200).json({
      success: true,
      claimed_days: result.claimed_days,
      items: result.items,
      event_currency_granted: result.event_currency_granted,
    });
  } catch (error) {
    console.error("Error claiming event login sequence:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/** GET /api/events/:eventId/milestones — the ladder plus this user's progress. */
export const getEventMilestones = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const event = await EventService.assertEventAccessible(
      userId,
      req.params.eventId
    );
    if (!event) {
      res.status(404).json({ success: false, error: "Event not found" });
      return;
    }

    const { milestones, lifetime_earned } =
      await EventMilestoneService.getMilestones(userId, event.id);

    res.status(200).json({
      success: true,
      milestones,
      lifetime_earned,
      currency: event.currency,
    });
  } catch (error) {
    console.error("Error getting event milestones:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/** POST /api/events/:eventId/milestones/claim — collect all unlocked rungs. */
export const claimEventMilestones = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const result = await EventMilestoneService.claimAvailable(
      userId,
      req.params.eventId
    );
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.status(200).json({
      success: true,
      claimed: result.claimed,
      items: result.items,
    });
  } catch (error) {
    console.error("Error claiming event milestones:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};
