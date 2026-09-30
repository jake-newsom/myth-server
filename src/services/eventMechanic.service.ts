// myth-server/src/services/eventMechanic.service.ts

import EventService from "./event.service";
import {
  battleMechanicRegistry,
  initializeBattleMechanics,
  validateBattleMechanics,
} from "../game-engine/battleMechanics";
import { GameState } from "../types/game.types";
import { BaseGameEvent } from "../types/game-engine.types";
import { BattleMechanicConfig } from "../types/battleMechanic.types";
import logger from "../utils/logger";
import {
  ActiveEvent,
  GLOBAL_MECHANIC_EXCLUDED_MODES,
} from "../types/event.types";

/**
 * Event Mechanic Service
 *
 * Resolves an event's `mechanic_key` + `mechanic_config` into the
 * `BattleMechanicConfig[]` the existing engine registry already understands.
 *
 * This deliberately does NOT introduce a second mechanic system. The engine
 * already has one (`game-engine/battleMechanics.ts`) that is serializable,
 * simulation-safe, and shared with saga; an event simply *selects* from it,
 * exactly as the docs prescribe ("Mode services select config rather than
 * implementing rules"). Adding a new event mechanic therefore means adding a
 * registry definition — no migration, and no enum value an old client could
 * receive and fail to parse.
 *
 * ## Config shapes accepted
 *
 * `mechanic_config` may be either:
 *   - `{ "mechanics": [ {...}, {...} ] }` — the full list form, or
 *   - `{ ...configFields }` — the short form, combined with `mechanic_key`
 *     as the id (e.g. key "haunted" + `{"tile_count": 5}`).
 *
 * ## Failure behavior
 *
 * An invalid or unknown config yields `[]` — a completely ordinary match.
 * A misconfigured event must never be able to prevent games from starting.
 */

const EventMechanicService = {
  /** Resolve one event's mechanic configuration. Returns [] when it has none. */
  resolveMechanics(event: ActiveEvent): BattleMechanicConfig[] {
    if (!event.mechanic_key) return [];

    try {
      const raw = event.mechanic_config ?? {};
      let configs: BattleMechanicConfig[];

      if (Array.isArray((raw as any).mechanics)) {
        configs = (raw as any).mechanics as BattleMechanicConfig[];
      } else {
        // Short form: the key names the mechanic, the object supplies its fields.
        configs = [
          { ...(raw as Record<string, unknown>), id: event.mechanic_key } as BattleMechanicConfig,
        ];
      }

      // Reject anything the engine wouldn't accept, rather than letting it
      // throw later at game-creation time.
      validateBattleMechanics(configs);
      return configs;
    } catch (error) {
      logger.error(
        "Event mechanic config is invalid; starting an ordinary match",
        { eventKey: event.event_key, mechanicKey: event.mechanic_key },
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  },

  /** True when the key names a mechanic the engine actually implements. */
  isKnownMechanic(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(battleMechanicRegistry, key);
  },

  /**
   * Game modes that NEVER receive an event's global mechanic.
   *
   * Re-exported from the types module, which is where it now lives so
   * EventService can report it to the client without an import cycle. Kept as
   * a member so existing callers and tests are unchanged.
   */
  GLOBAL_MECHANIC_EXCLUDED_MODES,

  /**
   * The mechanic that should apply to an ORDINARY game of `gameMode` started
   * by this user, because an event is currently active for them.
   *
   * This is what makes an event's mechanic global: every creation path calls
   * it, and it returns [] whenever no event applies — which is the exact
   * pre-events behaviour, and the flag-off path.
   *
   * Never throws. An event lookup failure, an invalid config, or an excluded
   * mode all yield [], so a broken event can never stop games from starting.
   */
  async resolveGlobalMechanics(
    userId: string | null | undefined,
    gameMode: string
  ): Promise<{ mechanics: BattleMechanicConfig[]; eventId: string | null; mechanicKey: string | null }> {
    const none = { mechanics: [], eventId: null, mechanicKey: null };
    try {
      if (!userId) return none;
      if (this.GLOBAL_MECHANIC_EXCLUDED_MODES.has(gameMode)) return none;

      const events = await EventService.getEventsForUser(userId);
      for (const event of events) {
        if (!event.mechanic_key) continue;
        const mechanics = this.resolveMechanics(event);
        if (mechanics.length > 0) {
          return {
            mechanics,
            eventId: event.id,
            mechanicKey: event.mechanic_key,
          };
        }
      }
      return none;
    } catch (error) {
      logger.error(
        "Global event mechanic lookup failed; starting an ordinary match",
        { userId, gameMode },
        error instanceof Error ? error : new Error(String(error))
      );
      return none;
    }
  },

  /**
   * PvP variant: apply the event mechanic if it is active for EITHER player.
   *
   * Both sides play on one board, so the mechanic cannot be per-user. Using
   * "either" rather than "both" means a preview-flagged tester still gets the
   * themed board against a non-flagged opponent — and once the event is live
   * the distinction disappears, since it resolves for everyone.
   */
  async applyGlobalMechanicsForMatch(
    state: GameState,
    userIds: (string | null | undefined)[],
    gameMode: string
  ): Promise<{
    events: BaseGameEvent[];
    eventContext?: { eventId: string; mechanicKey: string | null };
  }> {
    for (const userId of userIds) {
      const applied = await this.applyGlobalMechanics(state, userId, gameMode);
      if (applied.eventContext) return applied;
    }
    return { events: [] };
  },

  /**
   * Apply the active event's mechanic to a freshly-built game state, in place.
   *
   * Returns the events the mechanic emitted (to be forwarded to the client)
   * plus the event context for the games row. A no-op when no event applies.
   *
   * MUST be called before the state is persisted or broadcast, and only once
   * per game — `initializeBattleMechanics` throws if mechanics already exist,
   * which is why this checks `state.mechanics` first: the event tile path
   * already initialised them explicitly.
   */
  async applyGlobalMechanics(
    state: GameState,
    userId: string | null | undefined,
    gameMode: string
  ): Promise<{
    events: BaseGameEvent[];
    eventContext?: { eventId: string; mechanicKey: string | null };
  }> {
    try {
      // Already initialised (e.g. the event's own game-mode tile) — leave it.
      if (state.mechanics !== undefined) return { events: [] };

      const resolved = await this.resolveGlobalMechanics(userId, gameMode);
      if (resolved.mechanics.length === 0 || !resolved.eventId) {
        return { events: [] };
      }

      const events = initializeBattleMechanics(state, resolved.mechanics);
      return {
        events,
        eventContext: {
          eventId: resolved.eventId,
          mechanicKey: resolved.mechanicKey,
        },
      };
    } catch (error) {
      logger.error(
        "Failed to apply event mechanic; continuing without it",
        { userId, gameMode },
        error instanceof Error ? error : new Error(String(error))
      );
      return { events: [] };
    }
  },

  /**
   * Resolve the mechanics for an event the user is allowed to play right now.
   * Returns null when the event is not accessible, so callers can reject the
   * request rather than silently starting a normal game the player didn't ask
   * for.
   */
  async resolveForUserEvent(
    userId: string,
    eventId: string
  ): Promise<{ event: ActiveEvent; mechanics: BattleMechanicConfig[] } | null> {
    const event = await EventService.assertEventAccessible(userId, eventId);
    if (!event) return null;
    return { event, mechanics: this.resolveMechanics(event) };
  },
};

export default EventMechanicService;
