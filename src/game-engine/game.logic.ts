import {
  GameState,
  BoardPosition,
  Player,
  HandChoiceEffect,
} from "../types/game.types";
import { InGameCard, TriggerMoment } from "../types/card.types";
import * as _ from "lodash";
import db from "../config/db.config"; // For direct DB access if necessary for hydration
import * as validators from "./game.validators";
import * as gameUtils from "./game.utils";
import { triggerAbilities } from "./game.utils";
import { resetTile, updateCurrentPower } from "./ability.utils";
import {
  BaseGameEvent,
  batchEvents,
  CardEvent,
  CardPlacedEvent,
  CardPowerChangedEvent,
  EVENT_TYPES,
} from "./game-events";
import {
  applyNorseDeckEffect,
  triggerTerrainDeckEffects,
  triggerCurseDeckEffects,
} from "./deck.effects";

import { v4 as uuidv4 } from "uuid";
import PowerUpService from "../services/powerUp.service";
import logger from "../utils/logger";
import { GAME_CONFIG } from "../config/constants";
import AchievementService from "../services/achievement.service";
import { simulationContext } from "./simulation.context";

import { GameStatus } from "../types";
export { GameStatus };

import {
  createOrUpdateDebuff,
  getCardTotalPower,
  getOpponentId,
  getPositionOfCardById,
} from "./ability.utils";

/**
 * Registry of abilities that trigger the generic "reveal the opponent's hand
 * and select N card(s)" interactive pause. To add a new such ability, add an
 * entry here — no changes to placeCard / resolveHandChoice / the client overlay
 * are needed (it reads everything from pending_choice).
 */
const REVEAL_HAND_ABILITIES: Record<
  string,
  {
    selectCount: number;
    promptTitle: string;
    promptText: string;
    effect: HandChoiceEffect;
  }
> = {
  frigg_bless: {
    selectCount: 1,
    promptTitle: "Fensalir's Foresight",
    promptText: "Choose an enemy card to weaken by -3.",
    effect: {
      kind: "debuff",
      amount: 3,
      label: "Fensalir's Foresight",
      animation: "light-cross-spin",
    },
  },
};

export class GameLogic {
  //Helper to fetch and cache details for multiple UserCardInstances
  static async hydrateCardInstances(
    instanceIds: string[],
    userIdToVerifyOwnership?: string
  ): Promise<Map<string, InGameCard>> {
    const hydratedCards = new Map<string, InGameCard>();

    if (instanceIds.length === 0) {
      return hydratedCards;
    }

    try {
      const placeholders = instanceIds
        .map((_, index) => `$${index + (userIdToVerifyOwnership ? 2 : 1)}`)
        .join(",");
      const query = `
        SELECT 
          uci.user_card_instance_id, uci.level, uci.xp, uci.is_locked, uci.user_id,
          cv.card_variant_id as base_card_id, ch.name, cv.rarity, cv.image_url, 
          ch.base_power->>'top' as base_power_top, ch.base_power->>'right' as base_power_right, 
          ch.base_power->>'bottom' as base_power_bottom, ch.base_power->>'left' as base_power_left, 
          ch.tags, ch.special_ability_id, ch.set_id, cv.attack_animation, cv.is_exclusive,
          COALESCE(cv.sound_effect, ch.sound_effect) as sound_effect,
          sa.id as ability_key, sa.name as ability_name, sa.description as ability_description,
          sa.trigger_moments as ability_triggers, sa.parameters as ability_parameters,
          sa.sound_effect as ability_sound_effect,
          cb.border_id as cb_border_id, cb.name as cb_name,
          cb.image_url as cb_image_url, cb.animation_key as cb_animation_key
        FROM "user_owned_cards" uci
        JOIN "card_variants" cv ON uci.card_variant_id = cv.card_variant_id
        JOIN "characters" ch ON cv.character_id = ch.character_id
        LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
        LEFT JOIN "card_borders" cb ON uci.equipped_border_id = cb.border_id
        WHERE uci.user_card_instance_id IN (${placeholders}) ${userIdToVerifyOwnership ? "AND uci.user_id = $1" : ""
        };
      `;

      const params = userIdToVerifyOwnership
        ? [userIdToVerifyOwnership, ...instanceIds]
        : instanceIds;

      const { rows } = await db.query(query, params);

      // Get power ups for all instances in batch
      const powerUpsMap = await PowerUpService.getPowerUpsByCardInstances(
        instanceIds
      );

      for (const row of rows) {
        const levelBonus = 0; // Keep consistent with single hydration

        const basePower = {
          top: parseInt(row.base_power_top, 10),
          right: parseInt(row.base_power_right, 10),
          bottom: parseInt(row.base_power_bottom, 10),
          left: parseInt(row.base_power_left, 10),
        };

        // Get power up data for this instance
        const powerUp = powerUpsMap.get(row.user_card_instance_id);
        const powerEnhancements = powerUp?.power_up_data || {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        };

        const currentPower = {
          top: basePower.top + levelBonus + powerEnhancements.top,
          right: basePower.right + levelBonus + powerEnhancements.right,
          bottom: basePower.bottom + levelBonus + powerEnhancements.bottom,
          left: basePower.left + levelBonus + powerEnhancements.left,
        };

        const hydratedCard: InGameCard = {
          user_card_instance_id: row.user_card_instance_id,
          base_card_id: row.base_card_id,
          base_card_data: {
            card_id: row.base_card_id,
            name: row.name,
            rarity: row.rarity,
            image_url: row.image_url,
            base_power: basePower,
            set_id: row.set_id,
            tags: row.tags,
            is_exclusive: row.is_exclusive ?? false,
            special_ability: row.ability_name
              ? {
                ability_id: row.special_ability_id,
                id: row.ability_key ?? row.special_ability_id,
                name: row.ability_name,
                description: row.ability_description,
                triggerMoments:
                  (row.ability_triggers as TriggerMoment[]) || [],
                parameters: row.ability_parameters,
                sound_effect: row.ability_sound_effect ?? null,
              }
              : null,
            ...(row.attack_animation && {
              attack_animation: row.attack_animation,
            }),
            ...(row.sound_effect && { sound_effect: row.sound_effect }),
            equipped_border: row.cb_border_id
              ? {
                  border_id: row.cb_border_id,
                  name: row.cb_name,
                  image_url: row.cb_image_url,
                  animation_key: row.cb_animation_key ?? null,
                }
              : null,
          },
          level: row.level,
          xp: row.xp,
          is_locked: row.is_locked,
          power_enhancements: powerEnhancements,
          current_power: currentPower,
          owner: row.user_id,
          original_owner: row.user_id,
          card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
          card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
          temporary_effects: [],
          lockedTurns: 0,
          lockedBy: null,
          defeats: [],
        };

        hydratedCards.set(row.user_card_instance_id, hydratedCard);
      }

      return hydratedCards;
    } catch (error) {
      logger.error(
        "Error in batch hydrateCardInstances",
        {
          instanceIds: instanceIds.length,
          userIdToVerifyOwnership,
        },
        error instanceof Error ? error : new Error(String(error))
      );
      return hydratedCards;
    }
  }

  static async initializeGame(
    player1UserCardInstanceIds: string[], // Array of UserCardInstance IDs
    player2UserCardInstanceIds: string[], // Array of UserCardInstance IDs for AI or P2
    player1UserId: string,
    player2UserId = "00000000-0000-0000-0000-000000000000",
    options: { isTutorial?: boolean } = {}
  ): Promise<GameState> {
    const shuffleDeck = (deck: string[]): string[] => _.shuffle(deck);
    const p1DeckShuffled = shuffleDeck([...player1UserCardInstanceIds]);
    const p2DeckShuffled = shuffleDeck([...player2UserCardInstanceIds]);
    const initialHandSize = 5;

    const board = Array(GAME_CONFIG.BOARD_SIZE)
      .fill(null)
      .map(() =>
        Array(GAME_CONFIG.BOARD_SIZE).fill(
          gameUtils.createBoardCell(null, "normal").boardCell
        )
      );
    const hydrated_card_data_cache: Record<string, InGameCard> = {};

    // Hydrate initial hands in batch
    const p1HandInstanceIds = p1DeckShuffled.slice(0, initialHandSize);
    const p2HandInstanceIds = p2DeckShuffled.slice(0, initialHandSize);

    // Batch hydrate all initial hand cards at once for better performance
    const allInitialCardIds = [...p1HandInstanceIds, ...p2HandInstanceIds];
    const p1CardsMap = await this.hydrateCardInstances(
      p1HandInstanceIds,
      player1UserId
    );
    const p2CardsMap = await this.hydrateCardInstances(
      p2HandInstanceIds,
      player2UserId.startsWith("AI_") ? undefined : player2UserId
    );

    // Populate cache with hydrated cards
    for (const [id, cardData] of p1CardsMap.entries()) {
      hydrated_card_data_cache[id] = cardData;
    }
    for (const [id, cardData] of p2CardsMap.entries()) {
      hydrated_card_data_cache[id] = cardData;
    }

    const player1: Player = {
      user_id: player1UserId,
      hand: p1HandInstanceIds,
      deck: p1DeckShuffled.slice(initialHandSize),
      discard_pile: [],
      score: 0,
      equipped_card_back: null,
    };

    const player2: Player = {
      user_id: player2UserId,
      hand: p2HandInstanceIds,
      deck: p2DeckShuffled.slice(initialHandSize),
      discard_pile: [],
      score: 0,
      equipped_card_back: null,
    };

    const isTutorial = options.isTutorial ?? false;

    return {
      board,
      player1,
      player2,
      current_player_id: player1UserId,
      turn_number: 1,
      status: isTutorial ? GameStatus.ACTIVE : GameStatus.MULLIGAN,
      max_cards_in_hand: 10,
      initial_cards_to_draw: initialHandSize,
      hydrated_card_data_cache,
      winner: null,
      ...(isTutorial
        ? {}
        : {
            mulligan_state: {
              player1: { committed: false, replaced_count: 0 },
              player2: { committed: false, replaced_count: 0 },
            },
          }),
    };
  }

  /**
   * Validates current players turn, current player owns the card, card is in their hand, and the card can be placed
   * on the tile they chose. If all passes, card placed on tile, transfers any tile effects it should, resolves
   * combat and returns game state + array of events.
   *
   * @param currentGameState
   * @param playerId
   * @param userCardInstanceId
   * @param position
   * @returns
   */
  static async placeCard(
    currentGameState: GameState,
    playerId: string,
    userCardInstanceId: string, // Now expects the ID of the UserCardInstance
    position: BoardPosition,
    // Player-chosen target for targeted OnPlace abilities. Undefined for
    // AI/timeout plays — those abilities self-select a target.
    targetPosition?: BoardPosition
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    const events: BaseGameEvent[] = [];

    try {
      let newState = _.cloneDeep(currentGameState);
      const player = validators.getPlayer(newState, playerId);

      if (!validators.isPlayerTurn(newState, playerId))
        throw new Error("not player's turn.");

      const cardIndexInHand = validators.getCardIndexInHand(
        newState,
        playerId,
        userCardInstanceId
      );
      const playedCardData =
        newState.hydrated_card_data_cache?.[userCardInstanceId];
      if (!playedCardData) throw new Error(`Card data does not exist`);
      if (playedCardData.owner !== player.user_id)
        throw new Error(`card does not belong to player`);
      if (cardIndexInHand === -1) throw new Error(`card not in player's hand`);

      const { canPlace, errorMessage } = validators.canPlaceOnTile(
        newState,
        position
      );
      if (!canPlace) throw new Error(errorMessage);

      // Get existing tile effect before placing the card
      const existingTileEffect =
        newState.board[position.y][position.x]?.tile_effect;

      const { boardCell: newBoardCell, tileEffectTransferred, curseTransferred } =
        gameUtils.createBoardCell(playedCardData, playerId, existingTileEffect);
      player.hand.splice(cardIndexInHand, 1);

      // A card was successfully played — reset the consecutive-pass counter
      newState.consecutive_passes = 0;

      if (tileEffectTransferred) {
        // Calculate power delta from tile effect
        const tileEffectPowerDelta = existingTileEffect?.power
          ? (existingTileEffect.power.top || 0) + (existingTileEffect.power.bottom || 0) +
          (existingTileEffect.power.left || 0) + (existingTileEffect.power.right || 0)
          : 0;

        events.push({
          type: EVENT_TYPES.CARD_POWER_CHANGED,
          eventId: uuidv4(),
          timestamp: Date.now(),
          cardId: playedCardData.user_card_instance_id,
          position,
          powerDelta: tileEffectPowerDelta,
          effectName: existingTileEffect?.animation_label || "Tile Effect",
        } as CardPowerChangedEvent);
      }

      // Trigger Japanese deck effect if a curse was transferred to the card
      if (curseTransferred) {
        events.push(...triggerCurseDeckEffects(newState));
      }

      newState.board[position.y][position.x] = newBoardCell;
      events.push({
        type: EVENT_TYPES.CARD_PLACED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: playedCardData.user_card_instance_id,
        originalOwner: playedCardData.owner,
        delayAfterMs: 500,
        position,
      } as CardPlacedEvent);

      // Minamoto achievement: only when card is played and the Demon Bane
      // temporary effect has reached +10 (all sides are symmetric for this buff).
      const playedAbilityId =
        newBoardCell.card?.base_card_data?.special_ability?.id ??
        newBoardCell.card?.base_card_data?.special_ability?.ability_id;
      const demonBaneEffect = newBoardCell.card?.temporary_effects?.find(
        (effect) => effect.name === "Demon Bane"
      );
      if (
        playedAbilityId === "minamoto_demon_bane" &&
        demonBaneEffect &&
        (demonBaneEffect.power.left ?? 0) >= 10
      ) {
        AchievementService.triggerAchievementEvent({
          userId: playerId,
          eventType: "power_buff_applied",
          eventData: {
            source_ability_id: "minamoto_played_with_demon_bane_10",
            source_card_id: newBoardCell.card?.user_card_instance_id ?? null,
            turn_number: newState.turn_number,
            power_delta: 1,
          },
        }).catch(() => {});
      }

      // Maui achievement: only when card is played and Sun Trick has
      // at least +5 on the left stat modifier.
      const sunTrickEffect = newBoardCell.card?.temporary_effects?.find(
        (effect) => effect.name === "Sun Trick"
      );
      if (
        playedAbilityId === "maui_sun_trick" &&
        sunTrickEffect &&
        (sunTrickEffect.power.left ?? 0) >= 5
      ) {
        AchievementService.triggerAchievementEvent({
          userId: playerId,
          eventType: "power_buff_applied",
          eventData: {
            source_ability_id: "maui_played_with_sun_trick_5",
            source_card_id: newBoardCell.card?.user_card_instance_id ?? null,
            turn_number: newState.turn_number,
            power_delta: 1,
          },
        }).catch(() => {});
      }

      // Track events before abilities to detect terrain additions
      const eventsBeforeAbilities = events.length;

      events.push(
        ...triggerAbilities(TriggerMoment.OnPlace, {
          state: newState,
          triggerCard: newBoardCell.card!,
          triggerMoment: TriggerMoment.OnPlace,
          position,
          targetPosition,
        })
      );

      // Check if any abilities added terrain effects (for Polynesian deck effect)
      const abilityEvents = events.slice(eventsBeforeAbilities);
      const terrainAdded = abilityEvents.some(
        (e) =>
          e.type === EVENT_TYPES.TILE_STATE_CHANGED &&
          (e as any).tile?.tile_effect?.terrain !== undefined
      );
      if (terrainAdded) {
        events.push(...triggerTerrainDeckEffects(newState));
      }

      let sightBlessingTriggered = false;
      if (newState.saga_context) {
        const {
          applyFirstProtectionOnPlace,
          applyUnderdogOnPlace,
          refreshDynamicBlessings,
          hasSightBlessingOnPlacedCard,
        } = await import("./sagaBattle.mechanics");
        const firstResult = applyFirstProtectionOnPlace(newState, position, playerId);
        newState = firstResult.state;
        events.push(...firstResult.events);

        const preCombatBlessings = refreshDynamicBlessings(newState);
        newState = preCombatBlessings.state;
        events.push(...preCombatBlessings.events);

        const underdogResult = applyUnderdogOnPlace(newState, position, playerId);
        newState = underdogResult.state;
        events.push(...underdogResult.events);
        sightBlessingTriggered = hasSightBlessingOnPlacedCard(
          newState,
          position,
          playerId
        );
      }

      // Resolve combat with adjacent cards
      const eventsBeforeCombat = events.length;
      const combatResult = gameUtils.resolveCombat(
        newState,
        position,
        playerId
      );
      newState = combatResult.state;
      events.push(...combatResult.events);

      if (newState.saga_context) {
        const {
          applySlayerOnDefeat,
          applyThornsOnFlips,
          applyWorldsEndAfterFlips,
          countFlipEvents,
          refreshDynamicBlessings,
        } = await import("./sagaBattle.mechanics");

        // Defeat-driven blessings must see every flip this placement caused,
        // not just standard combat. Special abilities (e.g. ryujin_tidal_sweep)
        // fire during the OnPlace trigger above and flip enemies via flipCard,
        // emitting CARD_FLIPPED events with sourceCardId/sourcePlayerId set.
        // Include those so Slayer/Thorns/World's End trigger on ability defeats.
        const defeatEvents = [...abilityEvents, ...combatResult.events];

        const slayerResult = applySlayerOnDefeat(newState, defeatEvents, playerId);
        newState = slayerResult.state;
        events.push(...slayerResult.events);

        const thorns = applyThornsOnFlips(newState, defeatEvents);
        newState = thorns.state;
        events.push(...thorns.events);

        const flipCount = countFlipEvents(defeatEvents);
        const worldsEnd = applyWorldsEndAfterFlips(newState, flipCount);
        newState = worldsEnd.state;
        events.push(...worldsEnd.events);

        const postCombatBlessings = refreshDynamicBlessings(newState);
        newState = postCombatBlessings.state;
        events.push(...postCombatBlessings.events);
      }

      // Check if any combat/flip abilities added terrain effects (for Polynesian deck effect)
      // This catches abilities like "Feast or Famine" that trigger on flip
      const combatEvents = events.slice(eventsBeforeCombat);
      const terrainAddedDuringCombat = combatEvents.some(
        (e) =>
          e.type === EVENT_TYPES.TILE_STATE_CHANGED &&
          (e as any).tile?.tile_effect?.terrain !== undefined
      );
      if (terrainAddedDuringCombat) {
        events.push(...triggerTerrainDeckEffects(newState));
      }

      const scores = validators.calculateScores(
        newState.board,
        newState.player1.user_id,
        newState.player2.user_id
      );
      newState.player1.score = scores.player1Score;
      newState.player2.score = scores.player2Score;

      // Interactive pause point (after combat/scoring, before draw + endTurn).
      // Reveal-hand abilities (e.g. Frigg) show the opponent's hand and wait for
      // the placing player to select card(s). We pause here, set pending_choice,
      // and return the events so far; the deferred tail (draw + endTurn) runs in
      // resolveHandChoice once the selection arrives (or times out).
      //
      // Safe in saga battles: all saga post-combat mechanics (slayer/thorns/
      // world's-end/dynamic blessings) and scoring above have already run by this
      // point, so the pause only defers the draw + endTurn tail — the same tail
      // resolveHandChoice runs. The saga opponent is AI, and submitAIAction
      // auto-resolves the choice when the AI itself plays a reveal-hand card.
      const revealConfig = playedAbilityId
        ? REVEAL_HAND_ABILITIES[playedAbilityId]
        : undefined;
      console.log("[reveal-hand debug]", {
        playedAbilityId,
        hasRevealConfig: !!revealConfig,
        sourceCardStillPlaced: !!newBoardCell.card,
      });
      if (
        revealConfig &&
        newBoardCell.card // card may have been flipped/removed during combat
      ) {
        const opponentId = getOpponentId(playerId, newState);
        const opponent = validators.getPlayer(newState, opponentId);
        const sourceStillOnBoard = getPositionOfCardById(
          newBoardCell.card.user_card_instance_id,
          newState.board
        );
        console.log("[reveal-hand debug] inner", {
          opponentId,
          opponentHandLen: opponent.hand.length,
          sourceStillOnBoard: !!sourceStillOnBoard,
        });
        // Only pause if there is actually a hand to choose from and the source
        // card survived its own placement combat (a removed card can't anchor VFX).
        if (opponent.hand.length > 0 && sourceStillOnBoard) {
          newState.pending_choice = {
            type: "reveal_hand_select",
            chooser_id: playerId,
            source_card_id: newBoardCell.card.user_card_instance_id,
            source_position: sourceStillOnBoard,
            choosable_card_ids: [...opponent.hand],
            // Can't select more cards than the opponent actually holds.
            select_count: Math.min(
              revealConfig.selectCount,
              opponent.hand.length
            ),
            prompt_title: revealConfig.promptTitle,
            prompt_text: revealConfig.promptText,
            effect: revealConfig.effect,
            turn_number: newState.turn_number,
          };
          return { state: newState, events };
        }
      }

      const finished = await GameLogic.finishPlacement(
        newState,
        playerId,
        sightBlessingTriggered
      );
      newState = finished.state;
      events.push(...finished.events);

      return { state: newState, events };
    } catch (error) {
      if (!simulationContext.isInSimulation()) {
        logger.error(
          "Error in placeCard",
          {
            playerId,
            position: position ? `${position.x},${position.y}` : "unknown",
            userCardInstanceId,
          },
          error instanceof Error ? error : new Error(String(error))
        );
      }
      throw error;
    }
  }

  /**
   * The tail end of a card placement: draw-if-needed (+ saga sight-blessing
   * bonus draw) and switch the turn to the opponent. Extracted so the normal
   * placement path and the interactive resume path (resolveFriggChoice) run an
   * identical, single end-of-move sequence.
   */
  private static async finishPlacement(
    state: GameState,
    playerId: string,
    sightBlessingTriggered: boolean
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    const events: BaseGameEvent[] = [];
    let newState = state;
    const player = validators.getPlayer(newState, playerId);

    if (validators.shouldDrawCard(player, newState.max_cards_in_hand)) {
      const drawCardResult = await this.drawCard(newState, playerId);
      newState = drawCardResult.state;
      events.push(...drawCardResult.events);
    }

    if (sightBlessingTriggered) {
      const refreshedPlayer = validators.getPlayer(newState, playerId);
      if (validators.shouldDrawCard(refreshedPlayer, newState.max_cards_in_hand)) {
        const bonusDrawResult = await this.drawCard(newState, playerId);
        newState = bonusDrawResult.state;
        events.push(...bonusDrawResult.events);
      }
    }

    // Switch turn to opponent. endTurn() checks for full-board game over
    // as its final step, after turn effects have ticked down.
    const endTurnResult = await GameLogic.endTurn(newState, playerId);
    newState = endTurnResult.state;
    events.push(...endTurnResult.events);

    return { state: newState, events };
  }

  /**
   * Applies a pending reveal-hand choice's effect to each selected card, clears
   * pending_choice, then runs the deferred placement tail (draw + endTurn). Used
   * by both the player's explicit choice and the turn-timeout AI fallback.
   *
   * The caller MUST validate that a pending_choice exists and that every id in
   * chosenCardIds is one of choosable_card_ids before calling (the socket/HTTP
   * layers do this and hold the per-game action lock to prevent racing the
   * timeout fallback).
   */
  static async resolveHandChoice(
    currentGameState: GameState,
    chosenCardIds: string[]
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    const events: BaseGameEvent[] = [];
    const newState = _.cloneDeep(currentGameState);
    const pending = newState.pending_choice;

    if (!pending || pending.type !== "reveal_hand_select") {
      throw new Error("No pending hand choice to resolve");
    }
    // De-dupe and validate membership.
    const uniqueIds = [...new Set(chosenCardIds)];
    if (uniqueIds.length !== pending.select_count) {
      throw new Error(
        `Expected ${pending.select_count} selection(s), got ${uniqueIds.length}`
      );
    }
    if (!uniqueIds.every((id) => pending.choosable_card_ids.includes(id))) {
      throw new Error("A chosen card is not a valid target");
    }

    const chooserId = pending.chooser_id;
    const effect = pending.effect;
    const sourceCard =
      newState.hydrated_card_data_cache?.[pending.source_card_id];
    const HAND_POSITION: BoardPosition = { x: -1, y: -1 };

    for (const chosenCardId of uniqueIds) {
      const chosenCard = newState.hydrated_card_data_cache?.[chosenCardId];
      if (!chosenCard) continue;

      if (effect.kind === "debuff") {
        events.push(
          createOrUpdateDebuff(
            chosenCard,
            1000,
            effect.amount,
            effect.label,
            HAND_POSITION,
            {
              animation: effect.animation,
              actingPlayerId: chooserId,
              sourceCard,
              sourcePlayerId: chooserId,
              turnNumber: newState.turn_number,
              targetTotalPowerBefore: getCardTotalPower(chosenCard),
            }
          )
        );
      }

      // createOrUpdateDebuff mutates current_power in place; the hand card is the
      // same reference held in the cache, but write back explicitly to match the
      // tsukuyomi_moons_balance hand-debuff pattern.
      if (newState.hydrated_card_data_cache?.[chosenCardId]) {
        newState.hydrated_card_data_cache[chosenCardId] = chosenCard;
      }
    }

    // Choice consumed — clear the pause before running the deferred tail so the
    // resumed move (and any reconnect) no longer sees a pending choice.
    newState.pending_choice = undefined;

    const finished = await GameLogic.finishPlacement(newState, chooserId, false);
    return { state: finished.state, events: [...events, ...finished.events] };
  }

  /**
   * Picks the N strongest cards (by total power) among a pending choice's
   * candidates — the AI/timeout fallback when the chooser doesn't respond in
   * time. N is the choice's select_count. Returns [] if there is no pending
   * choice (caller should then just resume / clear).
   */
  static pickStrongestPendingChoiceCards(state: GameState): string[] {
    const pending = state.pending_choice;
    if (!pending || pending.choosable_card_ids.length === 0) return [];

    const ranked = [...pending.choosable_card_ids].sort((a, b) => {
      const pa = state.hydrated_card_data_cache?.[a];
      const pb = state.hydrated_card_data_cache?.[b];
      const powerA = pa ? getCardTotalPower(pa) : -Infinity;
      const powerB = pb ? getCardTotalPower(pb) : -Infinity;
      return powerB - powerA;
    });

    // select_count is already clamped to the hand size when the choice is raised.
    return ranked.slice(0, pending.select_count);
  }

  /**
   * Draws a card from the specified player's deck and adds it to their hand.
   * Also hydrates the card data if not already cached.
   */
  static async drawCard(
    currentGameState: GameState,
    playerId: string
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    const events: BaseGameEvent[] = [];
    const newState = _.cloneDeep(currentGameState);

    // Get the drawn card from the correct player's deck in the game state
    const player = validators.getPlayer(newState, playerId);
    const drawnInstanceId = player.deck.shift()!;
    player.hand.push(drawnInstanceId);

    // Hydrate the drawn card if it isn't already in the cache. This is
    // best-effort: a hydration failure shouldn't prevent the draw event.
    if (!newState.hydrated_card_data_cache?.[drawnInstanceId]) {
      try {
        const cardData = (
          await this.hydrateCardInstances(
            [drawnInstanceId],
            newState.saga_context ? undefined : player.user_id
          )
        ).get(drawnInstanceId);
        if (cardData && newState.hydrated_card_data_cache) {
          newState.hydrated_card_data_cache[drawnInstanceId] = cardData;
        }
      } catch (err) {
        console.error(
          `[DEBUG] Error during drawn card hydration: ${err instanceof Error ? err.message : String(err)
          }`
        );
        // Continue even if this fails, it's not critical
      }
    }

    // Always emit CARD_DRAWN, regardless of whether hydration was needed.
    // Previously this lived inside the hydration block, so a draw of an
    // already-cached card silently produced no event (and thus no client
    // draw sound / animation).
    events.push({
      type: EVENT_TYPES.CARD_DRAWN,
      eventId: uuidv4(),
      timestamp: Date.now(),
      sourcePlayerId: player.user_id,
      cardId: drawnInstanceId,
    } as CardEvent);

    return { state: newState, events: batchEvents(events, 50) };
  }

  static async discardCard(
    currentGameState: GameState,
    playerId: string,
    cardIndex: number | null = null
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    const events: BaseGameEvent[] = [];
    const newState = _.cloneDeep(currentGameState);
    const player = validators.getPlayer(newState, playerId);

    if (cardIndex === null) {
      cardIndex = _.random(0, player.hand.length - 1);
    }

    player.discard_pile.push(player.hand[cardIndex]);
    player.hand.splice(cardIndex, 1);

    return { state: newState, events: batchEvents(events, 50) };
  }

  // Additional methods like endTurn, surrender, etc. can be implemented here
  static async endTurn(
    currentGameState: GameState,
    playerId: string
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    if (!validators.isPlayerTurn(currentGameState, playerId)) {
      throw new Error("Not current player's turn to end.");
    }

    let events: BaseGameEvent[] = [];

    const newState = _.cloneDeep(currentGameState);

    // Process temporary effects
    for (const [y, row] of newState.board.entries()) {
      for (const [x, cell] of row.entries()) {
        if (cell.tile_effect?.turns_left && cell.tile_effect.turns_left > 0) {
          cell.tile_effect.turns_left -= 1;

          if (cell.tile_effect.turns_left === 0) {
            events.push(resetTile(cell, { x, y }));
          }
        }
        if (cell?.card) {
          cell.card.temporary_effects = cell.card.temporary_effects.filter(
            (effect) => {
              effect.duration -= 1;
              return effect.duration > 0;
            }
          );
          cell.card.current_power = updateCurrentPower(cell.card);
          if (newState.hydrated_card_data_cache) {
            newState.hydrated_card_data_cache[cell.card.user_card_instance_id] =
              cell.card;
          }
        }
      }
    }

    events = batchEvents(events, 300);

    // Switch turns
    newState.current_player_id =
      newState.current_player_id === newState.player1.user_id
        ? newState.player2.user_id
        : newState.player1.user_id;

    // Start-of-turn Norse deck effect: if behind, buff a random card in hand.
    events.push(...applyNorseDeckEffect(newState, newState.current_player_id));

    // Start-of-turn abilities (e.g. Tyr's Binding Justice). The turn has just
    // flipped to newState.current_player_id; these events ride the same batch as
    // the rest of endTurn so the client can animate them — there is no separate
    // turn-start round-trip to carry them otherwise. triggerAbilities fires every
    // board card with OnTurnStart regardless of owner, so any "start of YOUR
    // turn" ability must itself gate on triggerCard.owner === current_player_id.
    events.push(
      ...gameUtils.triggerAbilities(TriggerMoment.OnTurnStart, {
        state: newState,
        triggerMoment: TriggerMoment.OnTurnStart,
        position: { x: 0, y: 0 },
      })
    );

    // Track events to detect terrain additions for deck effects
    const eventsBeforeTurnEnd = events.length;

    events.push(
      ...gameUtils.triggerIndirectAbilities(TriggerMoment.OnTurnEnd, {
        state: newState,
        triggerMoment: TriggerMoment.OnTurnEnd,
        position: { x: 0, y: 0 },
      })
    );

    events.push({
      type: EVENT_TYPES.TURN_END,
      eventId: uuidv4(),
      delayAfterMs: 500,
      timestamp: Date.now(),
      sourcePlayerId: playerId,
    });

    if (newState.turn_number % 2 === 0) {
      events.push(
        ...gameUtils.triggerAbilities(TriggerMoment.OnRoundEnd, {
          state: newState,
          triggerMoment: TriggerMoment.OnRoundEnd,
          position: { x: 0, y: 0 },
        })
      );
      events.push(
        ...gameUtils.triggerAbilities(TriggerMoment.OnRoundStart, {
          state: newState,
          triggerMoment: TriggerMoment.OnRoundStart,
          position: { x: 0, y: 0 },
        })
      );
    }

    // Check if any abilities added terrain effects (for Polynesian deck effect)
    const turnEndEvents = events.slice(eventsBeforeTurnEnd);
    const terrainAddedDuringTurn = turnEndEvents.some(
      (e) =>
        e.type === EVENT_TYPES.TILE_STATE_CHANGED &&
        (e as any).tile?.tile_effect?.terrain !== undefined
    );
    if (terrainAddedDuringTurn) {
      events.push(...triggerTerrainDeckEffects(newState));
    }

    newState.turn_number++;

    // Final step: if no playable empty tiles remain, the game is over.
    // Run this last so tile effects (e.g. heimdall_block) have already
    // ticked down and cleared before we check for a full board.
    if (!validators.hasPlayableEmptyTiles(newState.board)) {
      const scores = validators.calculateScores(
        newState.board,
        newState.player1.user_id,
        newState.player2.user_id
      );
      newState.player1.score = scores.player1Score;
      newState.player2.score = scores.player2Score;

      const winnerId = validators.determineGameOutcome(
        newState.player1.score,
        newState.player2.score,
        newState.player1.user_id,
        newState.player2.user_id
      );

      newState.status = GameStatus.COMPLETED;
      newState.winner = winnerId;

      events.push({
        type: EVENT_TYPES.GAME_OVER,
        eventId: uuidv4(),
        timestamp: Date.now(),
        sourcePlayerId: playerId,
      });
    }

    return { state: newState, events };
  }

  static async surrender(
    currentGameState: GameState,
    playerId: string
  ): Promise<GameState> {
    let newState = _.cloneDeep(currentGameState);

    // Set winner to the opponent of the player who surrendered
    newState.status = GameStatus.COMPLETED;
    newState.winner =
      playerId === newState.player1.user_id
        ? newState.player2.user_id
        : newState.player1.user_id;

    return newState;
  }

  /**
   * Called when a player has no cards in hand and cannot play.
   * Increments the consecutive-pass counter and ends the turn.
   * If both players pass consecutively (counter reaches 2), the game ends
   * immediately with the current board scores determining the winner.
   */
  static async forcePass(
    currentGameState: GameState,
    playerId: string
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    if (!validators.isPlayerTurn(currentGameState, playerId)) {
      throw new Error("Not current player's turn.");
    }

    const player = validators.getPlayer(currentGameState, playerId);
    if (validators.canPlayerPlay(player)) {
      throw new Error("Player still has cards to play and cannot force-pass.");
    }

    let newState = _.cloneDeep(currentGameState);
    const events: BaseGameEvent[] = [];

    newState.consecutive_passes = (newState.consecutive_passes ?? 0) + 1;

    events.push({
      type: EVENT_TYPES.FORCED_PASS,
      eventId: uuidv4(),
      timestamp: Date.now(),
      sourcePlayerId: playerId,
    });

    if (newState.consecutive_passes >= 2) {
      // Both players are out of cards — end the game on current board scores
      const scores = validators.calculateScores(
        newState.board,
        newState.player1.user_id,
        newState.player2.user_id
      );
      newState.player1.score = scores.player1Score;
      newState.player2.score = scores.player2Score;

      const winnerId = validators.determineGameOutcome(
        scores.player1Score,
        scores.player2Score,
        newState.player1.user_id,
        newState.player2.user_id
      );

      newState.status = GameStatus.COMPLETED;
      newState.winner = winnerId;

      events.push({
        type: EVENT_TYPES.GAME_OVER,
        eventId: uuidv4(),
        timestamp: Date.now(),
        sourcePlayerId: playerId,
      });

      return { state: newState, events };
    }

    // Only one player has passed so far — end the turn and let the opponent play
    const endTurnResult = await GameLogic.endTurn(newState, playerId);
    return {
      state: endTurnResult.state,
      events: [...events, ...endTurnResult.events],
    };
  }
}
