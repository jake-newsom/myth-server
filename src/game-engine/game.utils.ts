import {
  GameState,
  BoardPosition,
  BoardCell,
  TileEffect,
  TileTerrain,
  TileStatus,
} from "../types/game.types";
import {
  EffectType,
  InGameCard,
  PowerValues,
  TriggerMoment,
} from "../types/card.types";
import { GameStatus, GameLogic } from "./game.logic";
import * as _ from "lodash";
import { abilities, combatResolvers } from "./abilities";
import { simulationContext } from "./simulation.context";
import {
  BaseGameEvent,
  CardEvent,
  CardPowerChangedEvent,
  EVENT_TYPES,
  TriggerContext,
  COMBAT_TYPES,
} from "../types/game-engine.types";
import DailyTaskService from "../services/dailyTask.service";
import SeasonSoulsService from "../services/seasonSouls.service";
import AchievementService from "../services/achievement.service";

// Helper function to safely check if an ability has a specific trigger
function hasTrigger(ability: any, trigger: TriggerMoment): boolean {
  if (!ability) return false;

  if (!ability.triggerMoments) return false;

  // Handle PostgreSQL array format or ensure it's a JavaScript array
  let triggerMoments = ability.triggerMoments;

  // If it's a string that looks like a PostgreSQL array, parse it
  if (typeof triggerMoments === "string") {
    if (triggerMoments.startsWith("{") && triggerMoments.endsWith("}")) {
      // PostgreSQL array format: {OnPlace,OnTurnStart} or {OnPlace, OnTurnStart}
      triggerMoments = triggerMoments
        .slice(1, -1)
        .split(",")
        .map((t) => t.trim()) // Remove spaces around trigger names
        .filter((t) => t.length > 0);
    } else {
      // Single string value, convert to array
      triggerMoments = [triggerMoments];
    }
  }

  if (!Array.isArray(triggerMoments)) return false;

  return triggerMoments.includes(trigger);
}

function getAbilityId(ability?: { id?: string; ability_id?: string }): string | null {
  if (!ability) return null;
  if (typeof ability.id === "string" && ability.id.trim().length > 0) {
    return ability.id.trim();
  }
  if (
    typeof ability.ability_id === "string" &&
    ability.ability_id.trim().length > 0
  ) {
    return ability.ability_id.trim();
  }
  return null;
}

function getAbilityHandler(ability?: { id?: string; ability_id?: string }) {
  const abilityId = getAbilityId(ability);
  return abilityId ? abilities[abilityId] : undefined;
}

function getCombatResolver(ability?: { id?: string; ability_id?: string }) {
  const abilityId = getAbilityId(ability);
  return abilityId ? combatResolvers[abilityId] : undefined;
}
import { v4 as uuidv4 } from "uuid";
import {
  getPositionOfCardById,
  getCardTotalPower,
  updateCurrentPower,
  transferTileEffectToCard,
  getCardsByCondition,
  isSilenced,
} from "./ability.utils";
import { batchEvents } from "./game-events";

/**
 * Creates a new board cell from hydrated card data, transferring tile effects to card if present
 */
export function createBoardCell(
  playedCardData: InGameCard | null,
  playerId: string,
  existingTileEffect?: TileEffect
): { boardCell: BoardCell; tileEffectTransferred: boolean; curseTransferred: boolean } {
  let tileEffectTransferred = false;
  let curseTransferred = false;

  const card: InGameCard | null = playedCardData
    ? {
      ...playedCardData,
      owner: playerId,
      temporary_effects: [...playedCardData.temporary_effects], // Preserve existing temporary effects
      card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
      card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
      // Preserve the power_enhancements from the hydrated card data (includes power-ups)
      power_enhancements: playedCardData.power_enhancements,
      current_power: { ...playedCardData.base_card_data.base_power },
    }
    : null;

  // Transfer tile effect to card if present and applicable
  if (card && existingTileEffect) {
    tileEffectTransferred = transferTileEffectToCard(card, existingTileEffect);
    // Check if the transferred effect was a curse
    if (tileEffectTransferred && existingTileEffect.status === TileStatus.Cursed) {
      curseTransferred = true;
    }
  }

  // Recalculate power after potential tile effect transfer
  if (card) {
    card.current_power = updateCurrentPower(card);
  }

  // Only preserve terrain effects (water/lava) on the tile - other effects (curses, boosts) are consumed
  const preserveTileEffect = existingTileEffect?.terrain !== undefined;

  const boardCell: BoardCell = {
    card,
    tile_enabled: true,
    tile_effect: preserveTileEffect ? existingTileEffect : undefined,
  };

  return { boardCell, tileEffectTransferred, curseTransferred };
}

/**
 * Resolves combat between the placed card and adjacent cards
 */
type CombatResult = {
  state: GameState;
  events: BaseGameEvent[];
};
export function resolveCombat(
  gameState: GameState,
  position: BoardPosition,
  playerId: string
): CombatResult {
  const events: BaseGameEvent[] = [];

  try {
    const directions: {
      dx: number;
      dy: number;
      from: keyof PowerValues;
      to: keyof PowerValues;
    }[] = [
        { dx: 0, dy: -1, from: "top", to: "bottom" }, // Card above
        { dx: 1, dy: 0, from: "right", to: "left" }, // Card to the right
        { dx: 0, dy: 1, from: "bottom", to: "top" }, // Card below
        { dx: -1, dy: 0, from: "left", to: "right" }, // Card to the left
      ];

    const placedCell = gameState.board[position.y][position.x];

    if (placedCell.card)
      events.push(
        ...triggerAbilities(TriggerMoment.BeforeCombat, {
          state: gameState,
          triggerCard: placedCell.card,
          triggerMoment: TriggerMoment.BeforeCombat,
          position,
        })
      );

    if (!placedCell || !placedCell.card) {
      return { state: gameState, events };
    }

    for (const dir of directions) {
      const nx = position.x + dir.dx;
      const ny = position.y + dir.dy;

      if (
        nx >= 0 &&
        nx < gameState.board.length && // Assuming BOARD_SIZE is 4
        ny >= 0 &&
        ny < gameState.board.length &&
        gameState.board[ny][nx] &&
        gameState.board[ny][nx]?.card &&
        gameState.board[ny][nx]?.tile_enabled === true
      ) {
        const adjacentCell = gameState.board[ny][nx]!;
        if (!adjacentCell.card) continue;

        if (adjacentCell.card.owner !== playerId) {
          const placedCardPower = placedCell.card.current_power[dir.from];
          const adjacentCardPower = adjacentCell.card.current_power[dir.to];

          if (placedCardPower > adjacentCardPower) {
            // flipCard owns all defeat-prevention logic (lockedTurns,
            // BlockDefeat effect, self-defense and ally combat resolvers).
            // It returns CARD_DEFENDED + OnDefend events when prevented.
            events.push(
              ...flipCard(
                gameState,
                position,
                adjacentCell.card,
                placedCell.card,
                undefined,
                {
                  forcedOwnerId: playerId,
                  combatType: COMBAT_TYPES.STANDARD,
                }
              )
            );
          } else {
            events.push({
              type: EVENT_TYPES.CARD_DEFENDED,
              eventId: uuidv4(),
              timestamp: Date.now(),
              sourcePlayerId: playerId,
              cardId: adjacentCell.card.user_card_instance_id,
              position: {
                x: nx,
                y: ny,
              },
              animation: "defend",
            } as CardEvent);

            events.push(
              ...triggerAbilities(TriggerMoment.OnDefend, {
                state: gameState,
                triggerCard: adjacentCell.card,
                triggerMoment: TriggerMoment.OnDefend,
                flippedCard: adjacentCell.card,
                flippedBy: placedCell.card,
                position,
              })
            );
          }
        }
      }
    }

    if (placedCell.card)
      events.push(
        ...triggerAbilities(TriggerMoment.AfterCombat, {
          state: gameState,
          triggerCard: placedCell.card,
          triggerMoment: TriggerMoment.AfterCombat,
          position,
        })
      );

    return { state: gameState, events };
  } catch (error) {
    console.error(
      `[DEBUG] Error in resolveCombat: ${error instanceof Error ? error.message : String(error)
      }`
    );
    console.error(
      `[DEBUG] Error stack: ${error instanceof Error ? error.stack : "No stack trace"
      }`
    );
    throw error;
  }
}

export function flipCard(
  state: GameState,
  position: BoardPosition,
  target: InGameCard,
  source: InGameCard,
  customAttackAnimation?: string,
  metadata?: {
    achievementBatchId?: string;
    forcedOwnerId?: string;
    overrideProtection?: boolean;
    combatType?: (typeof COMBAT_TYPES)[keyof typeof COMBAT_TYPES];
  }
): BaseGameEvent[] {
  const defeatingPlayerId = metadata?.forcedOwnerId ?? state.current_player_id;
  const targetPosition = getPositionOfCardById(
    target.user_card_instance_id,
    state.board
  );

  // Helper to build the events emitted when a flip is prevented. Includes
  // CARD_DEFENDED + OnDefend trigger so all prevention paths behave consistently.
  // protectingCard is the card whose ability prevented the defeat (e.g. the ally
  // Harbor Guardian, or the target itself for self-defense). When provided, its
  // ability sound_effect is stamped onto the CARD_DEFENDED event so the client
  // can play it — the defend event is born outside triggerAbilities, so the
  // normal sound-stamping path never reaches it.
  const buildDefendedEvents = (
    preventionEvents: BaseGameEvent[] = [],
    protectingCard?: InGameCard
  ): BaseGameEvent[] => {
    const out: BaseGameEvent[] = [...preventionEvents];
    if (!targetPosition) return out;
    // Prefer the explicit protector's ability sound; otherwise fall back to a
    // sound stashed on a BlockDefeat effect (e.g. Kane's Pure Waters applies the
    // protection earlier and records its sound on the effect).
    const blockDefeatSound = target.temporary_effects.find(
      (effect) => effect.type === EffectType.BlockDefeat
    )?.data?.soundEffect as string | undefined | null;
    const defendSoundEffect =
      protectingCard?.base_card_data?.special_ability?.sound_effect ??
      blockDefeatSound ??
      undefined;
    out.push({
      type: EVENT_TYPES.CARD_DEFENDED,
      eventId: uuidv4(),
      timestamp: Date.now(),
      sourcePlayerId: defeatingPlayerId,
      cardId: target.user_card_instance_id,
      position: targetPosition,
      animation: "defend",
      ...(defendSoundEffect ? { soundEffect: defendSoundEffect } : {}),
    } as CardEvent);
    out.push(
      ...triggerAbilities(TriggerMoment.OnDefend, {
        state,
        triggerCard: target,
        triggerMoment: TriggerMoment.OnDefend,
        flippedCard: target,
        flippedBy: source,
        position: targetPosition,
      })
    );
    return out;
  };

  // preFlipEvents holds events emitted by self-defense resolvers that didn't
  // prevent the flip — they still need to surface alongside the flip events
  // (matching prior resolveCombat behavior).
  const preFlipEvents: BaseGameEvent[] = [];

  // Trickster's Gambit and any other caller that should bypass all defenses
  // can set overrideProtection to skip the checks below.
  if (!metadata?.overrideProtection) {
    if (target.lockedTurns > 0) {
      return buildDefendedEvents();
    }

    if (
      target.temporary_effects.find(
        (effect) => effect.type === EffectType.BlockDefeat
      )
    ) {
      if (!simulationContext.isInSimulation()) {
        AchievementService.triggerAchievementEvent({
          userId: target.owner,
          eventType: "power_buff_applied",
          eventData: {
            source_ability_id: "kane_pure_waters",
            turn_number: state.turn_number,
            target_card_id: target.user_card_instance_id,
            power_delta: 0,
            defeat_prevented_by_protection: true,
          },
        }).catch(() => {});
      }
      return buildDefendedEvents();
    }

    const combatType = metadata?.combatType ?? COMBAT_TYPES.STANDARD;

    // 1. Self-defense combat resolver (e.g. Ocean's Shield, Jormungandr's Shell).
    // Self-resolvers may emit side-effect events even when they don't prevent
    // defeat (matching prior resolveCombat behavior), so collect them and
    // only surface them once we know whether the flip proceeds.
    const selfResolver = isSilenced(target)
      ? undefined
      : getCombatResolver(target.base_card_data.special_ability ?? undefined);
    if (selfResolver) {
      const selfResult = selfResolver({
        flippedCard: target,
        triggerCard: source,
        triggerMoment: TriggerMoment.OnCombat,
        position: targetPosition ?? position,
        state,
        combatType,
      });
      if (selfResult.events) {
        preFlipEvents.push(...selfResult.events);
      }
      if (selfResult.preventDefeat) {
        return buildDefendedEvents(preFlipEvents, target);
      }
    }

    // 2. Ally protection (e.g. Harbor Guardian). A silenced ally cannot protect.
    const allyCombatResolvers = getCardsByCondition(
      state.board,
      (card: InGameCard) => {
        if (card.user_card_instance_id === target.user_card_instance_id) {
          return false;
        }
        if (card.owner !== target.owner) return false;
        if (isSilenced(card)) return false;
        return !!getCombatResolver(
          card.base_card_data.special_ability ?? undefined
        );
      }
    );

    for (const ally of allyCombatResolvers) {
      const allyResolver = getCombatResolver(
        ally.base_card_data.special_ability ?? undefined
      );
      if (!allyResolver) continue;

      const allyResult = allyResolver({
        flippedCard: target,
        triggerCard: ally,
        flippedBy: source,
        triggerMoment: TriggerMoment.OnCombat,
        position: targetPosition ?? position,
        state,
        combatType,
      });

      if (allyResult.preventDefeat) {
        const allyEvents = allyResult.events ?? [];
        return buildDefendedEvents([...preFlipEvents, ...allyEvents], ally);
      }
    }
  }

  const events: BaseGameEvent[] = [...preFlipEvents];
  const sourceTotalPowerBefore = getCardTotalPower(source);
  const targetTotalPowerBefore = getCardTotalPower(target);

  events.push(
    ...triggerAbilities(TriggerMoment.OnFlip, {
      state,
      triggerCard: source,
      triggerMoment: TriggerMoment.OnFlip,
      flippedCard: target,
      position,
    })
  );
  target.owner = metadata?.forcedOwnerId ?? state.current_player_id;
  target.defeats.push({
    user_card_instance_id: source.user_card_instance_id,
    base_card_id: source.base_card_id,
    name: source.base_card_data.name,
  });

  if (!targetPosition) return events;

  // Check if the source card has a custom attack animation
  const attackAnimation =
    customAttackAnimation || source.base_card_data.attack_animation;

  events.push({
    type: EVENT_TYPES.CARD_FLIPPED,
    eventId: uuidv4(),
    timestamp: Date.now(),
    sourcePlayerId: defeatingPlayerId,
    sourceCardId: source.user_card_instance_id,
    cardId: target.user_card_instance_id,
    position: targetPosition,
    animation: attackAnimation || "attack",
  } as CardEvent);

  events.push(
    ...triggerAbilities(TriggerMoment.OnFlipped, {
      state,
      triggerCard: target,
      triggerMoment: TriggerMoment.OnFlipped,
      flippedBy: source,
      position: targetPosition,
    })
  );

  // Track daily progress, fail silently
  if (!simulationContext.isInSimulation()) {
    try {
      const setId = source.base_card_data?.set_id;

      setImmediate(() => {
        DailyTaskService.trackDefeat(defeatingPlayerId).catch(() => { });
        DailyTaskService.trackDefeatWithMythology(
          defeatingPlayerId,
          setId!
        ).catch(() => { });
        SeasonSoulsService.trackDefeat(defeatingPlayerId);
        AchievementService.triggerAchievementEvent({
          userId: defeatingPlayerId,
          eventType: "card_flipped",
          eventData: {
            turn_number: state.turn_number,
            source_card_id: source.user_card_instance_id,
            batch_id: metadata?.achievementBatchId ?? null,
            source_card_name: source.base_card_data?.name ?? null,
            source_ability_id: getAbilityId(
              source.base_card_data?.special_ability ?? undefined
            ),
            source_original_owner: source.original_owner,
        source_total_power_before: sourceTotalPowerBefore,
        target_total_power_before: targetTotalPowerBefore,
            target_card_id: target.user_card_instance_id,
            target_card_name: target.base_card_data?.name ?? null,
            target_tags: target.base_card_data?.tags ?? [],
          },
        }).catch(() => {});
      });
    } catch { }
  }

  return events;
}

/**
 * Stamp DB-sourced ability metadata onto the events an ability just produced:
 *   • soundEffect – fill from the ability's sound_effect when the event doesn't
 *     already carry one, so the client can play it. Filled (not overwritten) so
 *     an ability that sets a per-event sound wins.
 *   • effectName  – on CARD_POWER_CHANGED events ONLY, overwrite with the
 *     ability's DB name so floating-text labels always reflect the database
 *     (abilities set hardcoded options.name strings that can drift).
 *
 * Mutates the events in place. No-op fields are left untouched.
 */
function stampAbilityMetadata(
  events: BaseGameEvent[],
  ability: { name?: string; sound_effect?: string | null }
): void {
  for (const event of events) {
    if (ability.sound_effect && !event.soundEffect) {
      event.soundEffect = ability.sound_effect;
    }
    if (event.type === EVENT_TYPES.CARD_POWER_CHANGED && ability.name) {
      (event as CardPowerChangedEvent).effectName = ability.name;
    }
  }
}

export function triggerAbilities(
  trigger: TriggerMoment,
  context: Omit<TriggerContext, "triggerCard"> & { triggerCard?: InGameCard }
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];
  const { state } = context;

  // check the specific card
  if (context.triggerCard && !isSilenced(context.triggerCard)) {
    const triggerCard = context.triggerCard;
    if (triggerCard.base_card_data.special_ability) {
      const ability = triggerCard.base_card_data.special_ability;
      const abilityFunction = getAbilityHandler(ability);
      if (hasTrigger(ability, trigger) && abilityFunction) {
        // Create a properly typed context with required triggerCard
        const contextWithTrigger: TriggerContext = {
          ...context,
          triggerCard,
          triggerMoment: trigger,
        };
        const abilityEvents = abilityFunction(contextWithTrigger);
        stampAbilityMetadata(abilityEvents, ability);
        events.push(...abilityEvents);
        updateAllBoardCards(state);
      }
    }
  }

  events.push(...triggerIndirectAbilities(trigger, context));

  return batchEvents(events, 100);
}

export function triggerIndirectAbilities(
  trigger: TriggerMoment,
  context: Omit<TriggerContext, "triggerCard"> & { triggerCard?: InGameCard }
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];
  const { state, triggerCard = null } = context;

  let playerOrder = [];
  if (state.current_player_id === state.player1.user_id) {
    playerOrder = [state.player1, state.player2];
  } else {
    playerOrder = [state.player2, state.player1];
  }

  // Check in-hand variants
  for (const player of playerOrder) {
    for (const cardId of player.hand) {
      const card = state.hydrated_card_data_cache?.[cardId];
      if (card && card.base_card_data.special_ability) {
        const ability = card.base_card_data.special_ability;
        if (hasTrigger(ability, `Hand${trigger}` as TriggerMoment)) {
          const abilityFunction = getAbilityHandler(ability);
          if (!abilityFunction) continue;
          const contextWithTrigger: TriggerContext = {
            ...context,
            triggerCard: card,
            triggerMoment: `Hand${trigger}` as TriggerMoment,
          };
          if (triggerCard) {
            contextWithTrigger.originalTriggerCard = triggerCard;
          }
          const handAbilityEvents = abilityFunction(contextWithTrigger);
          stampAbilityMetadata(handAbilityEvents, ability);
          events.push(...handAbilityEvents);
        }
      }
    }
  }

  // Update all hand cards after processing hand abilities
  updateAllHandCards(state);

  // Check for "Any" variants
  const lifecycleTriggers = [
    TriggerMoment.OnRoundStart,
    TriggerMoment.OnRoundEnd,
    TriggerMoment.OnTurnStart,
    TriggerMoment.OnTurnEnd,
  ];

  // Collect all cards that need to be triggered BEFORE processing any of them.
  // This prevents cards from being processed multiple times if they move during iteration.
  const cardsToTrigger: Array<{
    card: InGameCard;
    position: BoardPosition;
    triggerMoment: TriggerMoment;
  }> = [];
  const processedCardIds = new Set<string>();

  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board[y].length; x++) {
      const cell = state.board[y][x];
      if (
        cell.card &&
        cell.card.base_card_data.special_ability &&
        !isSilenced(cell.card)
      ) {
        const cardId = cell.card.user_card_instance_id;
        // Skip if we've already collected this card (prevents duplicates)
        if (processedCardIds.has(cardId)) continue;

        const ability = cell.card.base_card_data.special_ability;

        const isLifecycleTrigger = lifecycleTriggers.includes(trigger);
        const matches = isLifecycleTrigger
          ? hasTrigger(ability, trigger)
          : hasTrigger(ability, `Any${trigger}` as TriggerMoment);

        if (matches) {
          cardsToTrigger.push({
            card: cell.card,
            position: { x, y },
            triggerMoment: isLifecycleTrigger
              ? trigger
              : (`Any${trigger}` as TriggerMoment),
          });
          processedCardIds.add(cardId);
        }
      }
    }
  }

  // Now process all collected cards
  for (const { card, position, triggerMoment } of cardsToTrigger) {
    const ability = card.base_card_data.special_ability;
    if (!ability) continue; // Safety check (shouldn't happen, but TypeScript needs it)

    const anyContext: TriggerContext = {
      ...context,
      triggerCard: card,
      triggerMoment,
      position,
    };

    if (triggerCard) {
      anyContext.originalTriggerCard = triggerCard;
    }

    const abilityEvents = getAbilityHandler(ability)?.(anyContext);
    if (abilityEvents) {
      stampAbilityMetadata(abilityEvents, ability);
      events.push(...abilityEvents);
    }
  }
  return batchEvents(events, 100);
}

export function updateAllBoardCards(gameState: GameState) {
  //Update board card's current powers
  const size = gameState.board.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = gameState.board[y][x];
      if (!cell?.card) continue;

      cell.card.current_power = updateCurrentPower(cell.card);

      const cachedCard =
        gameState.hydrated_card_data_cache?.[cell.card.user_card_instance_id];
      if (cachedCard) {
        cachedCard.current_power = cell.card.current_power;
      }
    }
  }
}

export function updateAllHandCards(gameState: GameState) {
  // Update player1's hand cards
  for (const cardId of gameState.player1.hand) {
    const card = gameState.hydrated_card_data_cache?.[cardId];
    if (card) {
      card.current_power = updateCurrentPower(card);
    }
  }

  // Update player2's hand cards
  for (const cardId of gameState.player2.hand) {
    const card = gameState.hydrated_card_data_cache?.[cardId];
    if (card) {
      card.current_power = updateCurrentPower(card);
    }
  }
}

/**
 * Handles game over logic
 */
export function handleGameOver(gameState: GameState): GameState {
  const newState = _.cloneDeep(gameState);

  // Determine winner based on scores
  if (newState.player1.score > newState.player2.score) {
    newState.status = GameStatus.COMPLETED;
    newState.winner = newState.player1.user_id;
  } else if (newState.player2.score > newState.player1.score) {
    newState.status = GameStatus.COMPLETED;
    newState.winner = newState.player2.user_id;
  } else {
    newState.status = GameStatus.COMPLETED;
    newState.winner = null; // Draw
  }

  return newState;
}

/**
 * Synchronous version of drawCard for use in abilities.
 * Only handles state modification, not card hydration.
 * Returns events to indicate card was drawn.
 * NOTE: Cards drawn via this function need to be hydrated separately
 * using hydrateGameStateCards() before sending to client.
 */
export function drawCardSync(
  gameState: GameState,
  playerId: string
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];

  // Get the player's deck and hand
  const player =
    gameState.player1.user_id === playerId
      ? gameState.player1
      : gameState.player2;

  // Check if player can draw a card
  if (
    player.deck.length === 0 ||
    player.hand.length >= gameState.max_cards_in_hand
  ) {
    return events; // Cannot draw
  }

  // Draw the card
  const drawnInstanceId = player.deck.shift()!;
  player.hand.push(drawnInstanceId);

  // Create draw event
  events.push({
    type: EVENT_TYPES.CARD_DRAWN,
    eventId: uuidv4(),
    timestamp: Date.now(),
    sourcePlayerId: playerId,
    cardId: drawnInstanceId,
  } as CardEvent);

  return events;
}

export function discardCardSync(
  gameState: GameState,
  playerId: string,
  cardIndex: number | null = null
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];
  const player =
    gameState.player1.user_id === playerId
      ? gameState.player1
      : gameState.player2;

  if (cardIndex === null) {
    cardIndex = _.random(0, player.hand.length - 1);
  }

  if (cardIndex < 0 || cardIndex >= player.hand.length) {
    return events; // Invalid index
  }

  const discardedCardId = player.hand.splice(cardIndex, 1)[0];
  player.discard_pile.push(discardedCardId);

  events.push({
    type: EVENT_TYPES.CARD_DISCARDED,
    eventId: uuidv4(),
    timestamp: Date.now(),
    sourcePlayerId: playerId,
    cardId: discardedCardId,
  } as CardEvent);

  return events;
}

/**
 * Hydrates any missing cards in the game state's hydrated_card_data_cache.
 * This should be called after abilities that use drawCardSync to ensure
 * all cards in hands are available for the frontend to display.
 */
export async function hydrateGameStateCards(
  gameState: GameState
): Promise<void> {
  if (!gameState.hydrated_card_data_cache) {
    gameState.hydrated_card_data_cache = {};
  }

  const missingCardIds = new Set<string>();

  // Check player1's hand for missing cards
  for (const cardId of gameState.player1.hand) {
    if (!gameState.hydrated_card_data_cache[cardId]) {
      missingCardIds.add(cardId);
    }
  }

  // Check player2's hand for missing cards
  for (const cardId of gameState.player2.hand) {
    if (!gameState.hydrated_card_data_cache[cardId]) {
      missingCardIds.add(cardId);
    }
  }

  // Check board cards for missing cards
  for (const row of gameState.board) {
    for (const cell of row) {
      if (cell.card && cell.card.user_card_instance_id) {
        const cardId = cell.card.user_card_instance_id;
        if (!gameState.hydrated_card_data_cache[cardId]) {
          missingCardIds.add(cardId);
        }
      }
    }
  }

  // Hydrate all missing cards in a single batched query
  const ids = Array.from(missingCardIds);
  if (ids.length === 0) {
    return;
  }

  try {
    const hydratedMap = await GameLogic.hydrateCardInstances(ids);
    for (const [cardId, cardData] of hydratedMap) {
      gameState.hydrated_card_data_cache![cardId] = cardData;
    }
  } catch (error) {
    console.error(`Failed to hydrate cards ${ids.join(", ")}:`, error);
  }
}
