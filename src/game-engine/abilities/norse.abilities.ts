import {
  TriggerMoment,
  RarityUtils,
  EffectType,
} from "../../types/card.types";
import {
  AbilityMap,
  COMBAT_TYPES,
  CombatResolverMap,
} from "../../types/game-engine.types";
import { InGameCard } from "../../types/card.types";
import { simulationContext } from "../simulation.context";
import {
  buff,
  debuff,
  getAdjacentCards,
  getAlliesAdjacentTo,
  getStrongestAdjacentEnemy,
  getCardsByCondition,
  getEnemiesAdjacentTo,
  setTileStatus,
  addTempDebuff,
  getAllAlliesOnBoard,
  addTempBuff,
  pullCardsIn,
  cleanseDebuffs,
  getCardHighestPower,
  getCardTotalPower,
  destroyCardAtPosition,
  getPositionOfCardById,
  createOrUpdateBuff,
  createOrUpdateDebuff,
  getCardsInSameColumn,
  getSurroundingTiles,
  getRandomSide,
  isSameCard,
  getOpponentId,
  blockTile,
  getAdjacentPositions,
  getTileAtPosition,
  updateCurrentPower,
} from "../ability.utils";
import { drawCardSync, flipCard, resolveCombat } from "../game.utils";
import {
  BaseGameEvent,
  CardEvent,
  CardPowerChangedEvent,
  EVENT_TYPES,
} from "../game-events";
import { v4 as uuidv4 } from "uuid";
import { BoardPosition, TileStatus, TileTerrain } from "../../types/game.types";
import { randomChance, randomInt } from "../simulation.rng";
import AchievementService from "../../services/achievement.service";
import { GAMEPLAY_FLAGS } from "../../config/constants";

/**
 * All norse cards:
 * - When placed, if losing, gain +1 to all sides
 *
 *
 * Ragnarok:
 * - Every 3 cards that are defeated make a random tile "ruined" and blocked
 */

export const norseCombatResolvers: CombatResolverMap = {
  // Titan Shell: Can only be defeated by Thor.
  jormungandr_shell: (context) => {
    const { triggerCard, flippedCard, flippedBy } = context;

    // Only protect the card that actually has Titan Shell (self-protection only)
    if (
      !flippedCard ||
      (flippedCard.base_card_data.special_ability?.id ??
        flippedCard.base_card_data.special_ability?.ability_id) !==
        "jormungandr_shell"
    ) {
      return { preventDefeat: false };
    }

    // When invoked via ally protection, triggerCard is the protecting ally
    // (not the attacker) — the actual attacker is flippedBy.
    const attacker = flippedBy ?? triggerCard;

    if (attacker.base_card_data.name !== "Thor") {
      if (!simulationContext.isInSimulation()) {
        AchievementService.triggerAchievementEvent({
          userId: flippedCard.owner,
          eventType: "power_buff_applied",
          eventData: {
            source_card_id: flippedCard.user_card_instance_id,
            source_card_name: flippedCard.base_card_data?.name ?? null,
            source_ability_id: "jormungandr_shell",
            power_delta: 1,
          },
        }).catch(() => {});
      }
      return { preventDefeat: true };
    }

    return {
      preventDefeat: false,
    };
  },
};

/**
 * +1 per card in play carrying `tag`, applied to the placed card itself.
 *
 * Shared by the "On Play: gain +1 for each X in play" abilities (Hel/
 * UNDERWORLD, Jörmungandr/SEA). Counts BOTH players' cards — the wording is
 * "in play", not "allied" — and includes the placed card itself when it
 * carries the tag, which is intentional: Hel is an UNDERWORLD card and counts
 * toward her own total.
 */
function buffPerTagInPlay(
  context: Parameters<AbilityMap[string]>[0],
  tag: string,
  effectName: string,
  animation: string,
): BaseGameEvent[] {
  const {
    triggerCard,
    position,
    state: { board },
  } = context;
  if (!position) return [];

  const matching = getCardsByCondition(board, (card) =>
    (card.base_card_data.tags ?? []).some(
      (t) => String(t).toLowerCase() === tag,
    ),
  );
  if (matching.length === 0) return [];

  return [
    createOrUpdateBuff(
      triggerCard,
      1000,
      matching.length,
      effectName,
      position,
      {
        animation,
        actingPlayerId: triggerCard.owner,
        sourceCard: triggerCard,
        sourcePlayerId: triggerCard.owner,
        turnNumber: context.state.turn_number,
      },
    ),
  ];
}

export const norseAbilities: AbilityMap = {
  // Titan Shell (On Play half): +1 for each SEA card in play. The defeat
  // immunity itself lives in norseCombatResolvers above.
  jormungandr_shell: (context) =>
    buffPerTagInPlay(context, "sea", "Titan Shell", "bubble-swirl-in"),

  // World's End: the actual tile-destruction cadence is driven by saga battle
  // mechanics. This ability entry keeps the card ability ID wired to the Norse map.
  ragnarok_worlds_end: (context) => {
    const { triggerCard, state, triggerMoment } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (triggerMoment === TriggerMoment.OnPlace) {
      for (let y = 0; y < state.board.length; y++) {
        for (let x = 0; x < state.board[y].length; x++) {
          const cell = state.board[y][x];
          if (cell.card) continue;
          gameEvents.push(
            setTileStatus(
              cell,
              { x, y },
              {
                status: TileStatus.Cursed,
                turns_left: 3, // Lasts through one full round (both players' turns)
                terrain: TileTerrain.Lava,
                animation_label: "lava",
                effect_duration: 1000,
                applies_to_user: getOpponentId(triggerCard.owner, state), // Only affect enemy cards
                power: { top: -1, bottom: -1, left: -1, right: -1 },
              },
              triggerCard.owner,
              triggerCard,
              { turnNumber: context.state.turn_number }
            )
          );
        }
      }
      return gameEvents;
    }

    // GOD cards in the ENEMY's hand lose 1 power at the end of Ragnarök's
    // owner's turn (triggerIndirectAbilities only fires the ending player's
    // cards). "Enemy" is resolved relative to Ragnarök's owner, so it is
    // always the opponent's hand that loses power.
    if (triggerMoment === TriggerMoment.OnTurnEnd) {
      const HAND_POSITION = { x: -1, y: -1 };
      const opponentId = getOpponentId(triggerCard.owner, state);
      const opponent =
        state.player1.user_id === opponentId ? state.player1 : state.player2;

      for (const cardId of opponent.hand) {
        const handCard = state.hydrated_card_data_cache?.[cardId];
        if (!handCard) continue;
        const tags = handCard.base_card_data.tags ?? [];
        const isGodCard = tags.some(
          (tag) => String(tag).toLowerCase() === "god" || String(tag).toLowerCase() === "goddess"
        );
        if (!isGodCard) continue;

        gameEvents.push(
          createOrUpdateDebuff(
            handCard,
            1000,
            1,
            "World's End",
            HAND_POSITION,
            {
              actingPlayerId: triggerCard.owner,
              sourceCard: triggerCard,
              sourcePlayerId: triggerCard.owner,
              turnNumber: context.state.turn_number,
            }
          )
        );
      }
    }

    return gameEvents;
  },

  // Returns to your hand when defeated
  baldr_immune: (context) => {
    const {
      triggerCard,
      state: { board, player1, player2 },
    } = context;

    const gameEvents: BaseGameEvent[] = [];

    //remove card from the board
    const position = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      board,
    );
    if (position) {
      const removeEvent = destroyCardAtPosition(
        position,
        board,
        "baldr-return",
        triggerCard.owner,
      );
      if (removeEvent) {
        gameEvents.push(removeEvent);
      }
    }

    // Baldr bounces to whoever controlled him at the moment he was defeated,
    // which is not necessarily his original owner: if he is silenced when
    // defeated this ability never fires, so he stays on the board and flips to
    // the attacker — and a later defeat must return him to that new controller.
    //
    // `triggerCard.owner` is NOT that player: resolveCombat reassigns it to the
    // attacker before OnFlipped fires. `defeatedOriginalOwner` is captured
    // pre-flip for exactly this reason.
    const returnToPlayerId =
      context.defeatedOriginalOwner ?? triggerCard.original_owner;

    const player = returnToPlayerId === player1.user_id ? player1 : player2;
    player.hand.push(triggerCard.user_card_instance_id);

    // The hand holds only ids; the playable card is read back out of
    // hydrated_card_data_cache, and placeCard rebuilds the board copy from that
    // entry. The board copy is what carried the buffs, so write its state back
    // or the bounce silently wipes them.
    const cached =
      context.state.hydrated_card_data_cache?.[
        triggerCard.user_card_instance_id
      ];
    if (cached) {
      // Deep-copy: a shallow spread would leave `power` (and `data`) shared
      // with the discarded board card, so later mutations would leak in.
      cached.temporary_effects = triggerCard.temporary_effects
        ? structuredClone(triggerCard.temporary_effects)
        : [];
      cached.power_enhancements = { ...triggerCard.power_enhancements };
      cached.current_power = { ...triggerCard.current_power };
      // The defeat that triggered this bounce was recorded on the BOARD copy by
      // flipCard. Carry it across or the record dies with that copy: the cached
      // entry keeps its original empty list, and anything asking "has Baldr been
      // defeated?" (Frigg's Fensalir's Foresight) reads the cache and sees no.
      cached.defeats = triggerCard.defeats
        ? structuredClone(triggerCard.defeats)
        : [];
      // placeCard rejects a card whose cached owner is not the player placing
      // it, so a captured Baldr would be stuck in hand otherwise.
      cached.owner = returnToPlayerId;
    }

    gameEvents.push({
      type: EVENT_TYPES.CARD_DRAWN,
      eventId: uuidv4(),
      timestamp: Date.now(),
      cardId: triggerCard.user_card_instance_id,
      sourcePlayerId: returnToPlayerId,
    } as CardEvent);

    if (!simulationContext.isInSimulation()) {
      AchievementService.triggerAchievementEvent({
        userId: returnToPlayerId,
        eventType: "power_buff_applied",
        eventData: {
          source_card_id: triggerCard.user_card_instance_id,
          source_card_name: triggerCard.base_card_data?.name ?? null,
          source_ability_id: "baldr_immune",
          turn_number: context.state.turn_number,
          power_delta: 1,
        },
      }).catch(() => {});
    }

    return gameEvents;
  },

  // Foresight: Grant +1 to all allies on the board.
  // Eye of Mimir: On play, grant +2 to every card in YOUR HAND (not the board).
  // Buffs are pointed at HAND_POSITION so the client renders them in the hand
  // rather than leaking floating text onto a board tile.
  odin_foresight: (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];
    const HAND_POSITION: BoardPosition = { x: -1, y: -1 };

    const owner =
      state.player1.user_id === triggerCard.owner ? state.player1 : state.player2;

    for (const cardId of owner.hand) {
      const handCard = state.hydrated_card_data_cache?.[cardId];
      if (!handCard) continue;

      gameEvents.push(
        addTempBuff(handCard, 1000, 2, {
          name: "Eye of Mimir",
          animation: "red-lightning",
          position: HAND_POSITION,
          data: {
            actingPlayerId: triggerCard.owner,
            sourceCard: triggerCard,
            sourcePlayerId: triggerCard.owner,
            turnNumber: state.turn_number,
          },
        }),
      );
      handCard.current_power = updateCurrentPower(handCard);
      if (state.hydrated_card_data_cache) {
        state.hydrated_card_data_cache[handCard.user_card_instance_id] = handCard;
      }
    }

    return gameEvents;
  },

  // Thunderous Push: Strike all enemies with lightning granting -2 to their strongest side
  thor_push: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const batchId = uuidv4();

    if (!position) return [];
    const enemyCards = getCardsByCondition(
      board,
      (card) => card.owner !== triggerCard.owner,
    );

    //OWEN
    for (const enemy of enemyCards) {
      const enemyPosition = getPositionOfCardById(
        enemy.user_card_instance_id,
        board,
      );
      if (enemyPosition) {
        const strongestSide = getCardHighestPower(enemy).key;
        gameEvents.push(
          addTempDebuff(
            enemy,
            1000,
            { [strongestSide]: -2 },
            {
              name: "Thunderous Push",
              animation: "lightning-6",
              position: enemyPosition,
              data: {
                actingPlayerId: triggerCard.owner,
                sourceCard: triggerCard,
                sourcePlayerId: triggerCard.owner,
                batchId,
                turnNumber: context.state.turn_number,
              },
            },
          ),
        );
      }
    }

    return gameEvents;
  },

  // Fensalir's Foresight (interactive): when Frigg is played, the placing
  // player is shown the opponent's hand and chooses one card to debuff by -3.
  // The pause/reveal/choice orchestration lives in GameLogic.placeCard +
  // resolveFriggChoice (it must wait on async player input, which an ability
  // function cannot do). This handler is intentionally a no-op marker — the
  // ability id is what placeCard keys off of to raise the pending choice.
  // The +3 "if Baldr has been defeated" half DOES live here — only the reveal
  // and the -3 choice are deferred to placeCard.
  frigg_bless: (context) => {
    const { triggerCard, position, state } = context;
    if (!position) return [];

    // A card records who defeated it in `defeats`, so a non-empty list means
    // that Baldr has been defeated at least once this game. Checked across the
    // board AND both hands: Baldr's own ability bounces him back to hand when
    // defeated, so a board-only scan would miss the very case this rewards.
    const baldrs: InGameCard[] = [
      ...getCardsByCondition(state.board, () => true),
      ...[...state.player1.hand, ...state.player2.hand]
        .map((id) => state.hydrated_card_data_cache?.[id])
        .filter((card): card is InGameCard => !!card),
    ].filter((card) => card.base_card_data.name === "Baldr");

    const baldrDefeated = baldrs.some((card) => (card.defeats?.length ?? 0) > 0);
    if (!baldrDefeated) return [];

    return [
      createOrUpdateBuff(
        triggerCard,
        1000,
        3,
        "Fensalir's Foresight",
        position,
        {
          animation: "light-cross-spin",
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          turnNumber: state.turn_number,
        },
      ),
    ];
  },

  heimdall_block: (context) => {
    const {
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const adjacentPositions = getAdjacentPositions(position, board.length);
    const emptyAdjacentTiles = adjacentPositions.filter((pos) => {
      const tile = getTileAtPosition(pos, board);
      return (
        tile && !tile.card && tile.tile_effect?.status !== TileStatus.Blocked
      );
    });

    for (const pos of emptyAdjacentTiles) {
      const event = blockTile(pos, board, 2, "heimdall_gate");
      if (event) {
        gameEvents.push(event);
      }
    }

    return gameEvents;
  },

  // When played, bless all surrounding tiles with +1 through your next turn.
  bragi_inspire: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const surroundingTiles = getSurroundingTiles(position, board);

    for (const tile of surroundingTiles) {
      if (tile.tile.card) continue;
      gameEvents.push(
        setTileStatus(
          tile.tile,
          tile.position,
          {
            status: TileStatus.Boosted,
            turns_left: 3,
            animation_label: "poets-rhythm",
            effect_duration: 1000,
            power: { top: 1, bottom: 1, left: 1, right: 1 },
            applies_to_user: triggerCard.owner,
          },
          triggerCard.owner,
        ),
      );
    }

    return gameEvents;
  },

  // Silent Vengeance: If Odin has been defeated, gain +3 to all stats. On
  // placement this is a one-time check; whenever any card is later flipped
  // (AnyOnFlipped), Vidar avenges Odin by also retriggering combat from his
  // tile. The "The Iron Shoe" buff is the once-per-game guard for both paths.
  vidar_vengeance: (context) => {
    const {
      triggerCard,
      triggerMoment,
      state,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    // Loop over all cards on the board and check for Odin
    let odinDefeated = false;
    for (let row of board) {
      for (let tile of row) {
        if (
          tile &&
          tile.card &&
          tile.card.base_card_data.name === "Odin" &&
          tile.card.defeats.length > 0
        ) {
          odinDefeated = true;
          break;
        }
      }
      if (odinDefeated) break;
    }
    if (!odinDefeated) return gameEvents;

    const label = "The Iron Shoe";
    const ironShoeBuff = triggerCard.temporary_effects.find(
      (effect) => effect.name === label,
    );

    const triggerCardPosition = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      board,
    );
    if (!triggerCardPosition) return gameEvents;

    // Grant the +3 once per game (guarded by the buff's presence).
    if (!ironShoeBuff) {
      if (!simulationContext.isInSimulation()) {
        AchievementService.triggerAchievementEvent({
          userId: triggerCard.owner,
          eventType: "power_buff_applied",
          eventData: {
            source_card_id: triggerCard.user_card_instance_id,
            source_card_name: triggerCard.base_card_data?.name ?? null,
            source_ability_id: "vidar_vengeance",
            turn_number: context.state.turn_number,
            power_delta: 1,
          },
        }).catch(() => {});
      }

      gameEvents.push(
        buff(triggerCard, 3, {
          name: label,
          animation: "triangle-shield",
          position: triggerCardPosition,
        }),
      );
    }

    // Avenge Odin: only the AnyOnFlipped path retriggers combat. OnPlace is a
    // passive +3 check with no extra attack. resolveCombat can flip cards and
    // re-fire AnyOnFlipped on Vidar; guard with usedAttack (set before the
    // resolveCombat call) so the bonus attack happens once, not on every flip.
    if (triggerMoment === TriggerMoment.AnyOnFlipped) {
      // Re-read the buff — buff() above mutates temporary_effects in place.
      const currentBuff =
        ironShoeBuff ??
        triggerCard.temporary_effects.find((effect) => effect.name === label);
      if (currentBuff && !currentBuff.data?.usedAttack) {
        currentBuff.data = {
          ...(currentBuff.data ?? {}),
          usedAttack: true,
        };

        const combatResult = resolveCombat(
          state,
          triggerCardPosition,
          triggerCard.owner,
        );
        gameEvents.push(...combatResult.events);
      }
    }

    return gameEvents;
  },

  // Avenge Baldr: Gain +1 to all stats for each ally defeated this game.
  vali_revenge: (context) => {
    const {
      triggerCard,
      // state: { board },
    } = context;
    simulationContext.debugLog("Avenge Baldr: ", triggerCard);
    const gameEvents: BaseGameEvent[] = [];
    // const defeatedAllies = getCardsByCondition(
    //   board,
    //   (card) =>
    //     card.defeats.length > 0 && card.original_owner === triggerCard.owner
    // );
    // for (const ally of defeatedAllies) {
    //   gameEvents.push(buff(ally, 1));
    // }
    return gameEvents;
  },

  // Sea's Protection: Gain +3 if adjacent to a Sea card.
  njord_sea: (context) => {
    const {
      triggerCard,
      position,
      state,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    if (!position) return [];

    const adjacentSeaCards = getAdjacentCards(position, board, {
      tag: "sea",
    });
    if (adjacentSeaCards.length > 0) {
      gameEvents.push(
        buff(triggerCard, 3, {
          name: "Noatun’s Guard",
          animation: "splash-up-down",
          position,
        }),
      );
    }

    // Flood Njord's whole row with WATER, occupied tiles included. setTileStatus
    // writes the terrain under a card just as happily as onto an empty tile, and
    // deliberately so here: the water is meant to appear beneath enemies already
    // standing there, not just on the gaps.
    //
    // It does NOT debuff or buff those sitting cards. transferTileEffectToCard
    // only runs when a card ARRIVES (placement or move), so an occupant is
    // unaffected until it leaves and returns — which is what makes this a board
    // state play rather than a damage effect. Ukupanipo is the card that
    // punishes non-SEA enemies standing in water; Njord just supplies the water.
    for (let x = 0; x < board.length; x++) {
      const tilePosition: BoardPosition = { x, y: position.y };
      const tile = getTileAtPosition(tilePosition, board);
      if (!tile) continue;

      // Don't overwrite the terrain Njord himself is standing on if it is
      // already water — setTileStatus would replace the effect wholesale and
      // reset its duration for no visible gain.
      if (tile.tile_effect?.terrain === TileTerrain.Ocean) continue;

      gameEvents.push(
        setTileStatus(
          tile,
          tilePosition,
          {
            status: TileStatus.Normal,
            turns_left: 1000,
            animation_label: "water",
            terrain: TileTerrain.Ocean,
            effect_duration: 1000,
            applies_to_user: triggerCard.owner,
            power: { top: 1, bottom: 1, left: 1, right: 1 } 
          },
          triggerCard.owner,
          triggerCard,
          { turnNumber: state.turn_number },
        ),
      );
    }

    return gameEvents;
  },

  // Warrior's Blessing: While in hand, Freyja gains +1 power whenever any
  // common card (standard/+/++/+++) is played on the board — ally or enemy.
  freyja_bless: (context) => {
    const {
      triggerCard,
      originalTriggerCard,
      flippedCard,
      triggerMoment,
      state: { board },
    } = context;
    const HAND_POSITION: BoardPosition = { x: -1, y: -1 };

    // Freyja buffs HERSELF. Point the buff at her own tile once she is on the
    // board, else the in-hand sentinel. Never context.position — on a flip
    // trigger that is the *flipped card's* tile, which leaks her floating text
    // onto another card (the Demon Bane bug).
    const buffPosition =
      getPositionOfCardById(triggerCard.user_card_instance_id, board) ??
      HAND_POSITION;

    const gain = () =>
      createOrUpdateBuff(
        triggerCard,
        1000,
        1,
        "Warrior's Blessing",
        buffPosition,
        {
          animation: "light-cross-spin",
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          turnNumber: context.state.turn_number,
        },
      );

    const isCommon = (card: InGameCard | null | undefined) =>
      !!card &&
      RarityUtils.getBaseRarity(card.base_card_data.rarity) === "common";

    // A COMMON card was DEFEATED: +1, but only on a 50% roll. Uses the seeded
    // RNG so the AI lookahead re-simulating this move sees the same outcome as
    // the real resolution.
    if (
      triggerMoment === TriggerMoment.HandOnFlip ||
      triggerMoment === TriggerMoment.AnyOnFlip
    ) {
      if (!isCommon(flippedCard)) return [];
      return randomChance(50) ? [gain()] : [];
    }

    // A COMMON card was PLAYED: +1, always.
    if (!isCommon(originalTriggerCard)) return [];
    return [gain()];
  },

  // Peaceful Strength: Gain +2 if no adjacent enemies.
  freyr_peace: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    if (!position) return [];

    const adjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner,
    );
    if (adjacentEnemies.length === 0) {
      gameEvents.push(
        buff(triggerCard, 2, {
          name: "Alfheim's Truce",
          position,
        }),
      );
    }
    return gameEvents;
  },

  // Winter's Grasp: Enemies in the same column lose 3 power through your next turn
  skadi_freeze: (context) => {
    const { position, state, triggerCard } = context;
    const gameEvents: BaseGameEvent[] = [];
    const batchId = uuidv4();
    if (!position) return [];

    const enemiesInColumn = getCardsInSameColumn(
      position,
      state.board,
      triggerCard.owner,
    );

    // One vertical ice beam stands up Skadi's whole column (row 0 → row 3),
    // centered on her tile — the client resolves the column span and rotation
    // from this single event's position. powerDelta 0 + no effectName means
    // VFX only, no floating label; the per-enemy debuffs below carry the numbers.
    gameEvents.push({
      type: EVENT_TYPES.CARD_POWER_CHANGED,
      animation: "winter-step-beam",
      eventId: uuidv4(),
      timestamp: Date.now(),
      cardId: triggerCard.user_card_instance_id,
      powerDelta: 0,
      position,
    } as CardPowerChangedEvent);

    for (const enemy of enemiesInColumn) {
      const enemyPosition = getPositionOfCardById(
        enemy.user_card_instance_id,
        state.board,
      );
      if (!enemyPosition) continue;

      gameEvents.push(
        addTempDebuff(enemy, 3, -2, {
          name: "Winter's Step",
          animation: "winter-step",
          position: enemyPosition,
          data: {
            actingPlayerId: triggerCard.owner,
            sourceCard: triggerCard,
            sourcePlayerId: triggerCard.owner,
            batchId,
            turnNumber: context.state.turn_number,
          },
        }),
      );
    }
    return gameEvents;
  },

  // Trickster's Gambit: for every TRICKSTER you control (Loki included),
  // defeat a random enemy with a 65% chance. One roll (and at most one defeat)
  // per TRICKSTER.
  loki_flip: (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];
    const batchId = uuidv4();
    const DEFEAT_CHANCE = 65;

    // Only tricksters Loki's owner controls count. Loki himself is a TRICKSTER
    // and is already on the board at OnPlace, so he always gets at least one roll.
    const tricksterCount = getCardsByCondition(
      state.board,
      (card) =>
        card.owner === triggerCard.owner &&
        (card.base_card_data.tags ?? []).some(
          (t) => String(t).toLowerCase() === "trickster",
        ),
    ).length;

    // Re-read the enemy list each iteration: a card defeated by an earlier roll
    // has flipped to Loki's side and must not be targeted twice.
    for (let i = 0; i < tricksterCount; i++) {
      if (!randomChance(DEFEAT_CHANCE)) continue;

      const enemies = getCardsByCondition(
        state.board,
        (card) =>
          card.owner !== triggerCard.owner &&
          card.user_card_instance_id !== triggerCard.user_card_instance_id,
      );
      if (enemies.length === 0) break;

      const target = enemies[randomInt(enemies.length)];
      const targetPosition = getPositionOfCardById(
        target.user_card_instance_id,
        state.board,
      );
      if (!targetPosition) continue;

      gameEvents.push(
        ...flipCard(
          state,
          targetPosition,
          target,
          triggerCard,
          "trickster-gambit",
          {
            achievementBatchId: batchId,
            forcedOwnerId: triggerCard.owner,
            // Trickster's Gambit ignores all defeat-prevention abilities
            // (Ocean's Shield, Jormungandr's Shell, Harbor Guardian, etc.).
            overrideProtection: true,
            combatType: COMBAT_TYPES.SPECIAL,
          },
        ),
      );
    }

    return gameEvents;
  },

  // Soul Lock: Hel binds the soul of every enemy she flips, locking that
  // card so it cannot be flipped back. Locks persist as long as Hel is on
  // the board; if Hel is later DESTROYED (removed from the board, not just
  // flipped), `releaseLocksAppliedBy` in `destroyCardAtPosition` clears
  // every soul she had bound.
  hel_soul: (context) => {
    const { flippedCard, triggerCard, triggerMoment } = context;

    // On Play: +1 for each UNDERWORLD card in play. Separate branch from the
    // soul lock below, which fires on OnFlip.
    if (triggerMoment === TriggerMoment.OnPlace) {
      return buffPerTagInPlay(
        context,
        "underworld",
        "Soul Lock",
        "purple-grow",
      );
    }

    if (flippedCard) {
      flippedCard.lockedTurns = 1000;
      flippedCard.lockedBy = triggerCard.user_card_instance_id;
      // Mirror the lock as a BlockDefeat effect so silence-suppression logic
      // in flipCard applies uniformly. lockedTurns/lockedBy are still used for
      // the destruction-release path (releaseLocksAppliedBy).
      if (!flippedCard.temporary_effects) flippedCard.temporary_effects = [];
      flippedCard.temporary_effects.push({
        power: { top: 0, bottom: 0, left: 0, right: 0 },
        duration: 1000,
        type: EffectType.BlockDefeat,
        sourceCardInstanceId: triggerCard.user_card_instance_id,
        data: { sourceAbilityId: "hel_soul", soundEffect: triggerCard.base_card_data?.special_ability?.sound_effect ?? null },
      });
      if (!simulationContext.isInSimulation()) {
        AchievementService.triggerAchievementEvent({
          userId: triggerCard.owner,
          eventType: "power_buff_applied",
          eventData: {
            source_card_id: triggerCard.user_card_instance_id,
            source_card_name: triggerCard.base_card_data?.name ?? null,
            source_ability_id: "hel_soul",
            turn_number: context.state.turn_number,
            target_card_id: flippedCard.user_card_instance_id,
            power_delta: 1,
          },
        }).catch(() => {});
      }
      // Don't create a CARD_FLIPPED event here - let flipCard handle it
      // The attack animation will be set via ability parameters
      return [];
    }
    return [];
  },

  // Primordial Force: Gain +2 to all stats if no adjacent cards.
  ymir_isolation: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    if (!position) return [];

    const adjacentCards = getAdjacentCards(position, board);
    if (adjacentCards.length === 0) {
      gameEvents.push(
        buff(triggerCard, 2, {
          name: "Aurgelmir’s Flesh",
          position,
        }),
      );
    }
    return gameEvents;
  },

  surtr_flames: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) {
      return []; // Should not happen if card is on board
    }

    const strongestEnemy = getStrongestAdjacentEnemy(
      position,
      board,
      triggerCard.owner,
    );

    if (strongestEnemy) {
      const strongestEnemyPosition = getPositionOfCardById(
        strongestEnemy.user_card_instance_id,
        board,
      );
      if (strongestEnemyPosition) {
        const destroyedEvent = destroyCardAtPosition(
          strongestEnemyPosition,
          board,
          "flame-pillar",
          triggerCard.owner,
          triggerCard,
        );
        if (destroyedEvent) {
          gameEvents.push(destroyedEvent);
        }
      }
    }

    // Create -1 LAVA on every adjacent side. The tile carries the power payload
    // and applies_to_user so any card that LATER lands there picks up the -1
    // via transferTileEffectToCard (which only runs at placement).
    for (const adjacentPosition of getAdjacentPositions(
      position,
      board.length,
    )) {
      const tile = getTileAtPosition(adjacentPosition, board);
      if (!tile) continue;

      gameEvents.push(
        setTileStatus(
          tile,
          adjacentPosition,
          {
            status: TileStatus.Cursed,
            turns_left: 2, // one full round (both players' turns)
            terrain: TileTerrain.Lava,
            animation_label: "lava",
            effect_duration: 1000,
            applies_to_user: getOpponentId(triggerCard.owner, context.state),
            power: { top: -1, bottom: -1, left: -1, right: -1 },
          },
          triggerCard.owner,
          triggerCard,
          { turnNumber: context.state.turn_number },
        ),
      );

      // A card ALREADY standing on the tile never runs the placement transfer,
      // so the lava would be purely cosmetic for it. Apply the -1 directly.
      // Skipped for the card being destroyed above (it is leaving the board)
      // and for Surtr's own allies, matching applies_to_user.
      const occupant = tile.card;
      if (
        occupant &&
        occupant.owner !== triggerCard.owner &&
        occupant.user_card_instance_id !==
          strongestEnemy?.user_card_instance_id
      ) {
        gameEvents.push(
          addTempDebuff(occupant, 2, -1, {
            name: "Flames of Muspelheim",
            animation: "flames",
            position: adjacentPosition,
            data: {
              actingPlayerId: triggerCard.owner,
              sourceCard: triggerCard,
              sourcePlayerId: triggerCard.owner,
              turnNumber: context.state.turn_number,
            },
          }),
        );
      }
    }

    return gameEvents;
  },

  // Bride Demand: Gain +3 Right if adjacent to a Goddess card.
  thrym_demand: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    if (!position) return [];

    const adjacentGoddessCards = getAdjacentCards(position, board, {
      tag: "goddess",
    });
    if (adjacentGoddessCards.length > 0) {
      gameEvents.push(
        buff(triggerCard, 3, {
          name: "Bride Demand",
          position,
        }),
      );
    }
    return gameEvents;
  },

  hrungnir_worthy: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    if (!position) return [];

    const adjacentThorCards = getAdjacentCards(position, board, {
      name: "Thor",
    });

    if (adjacentThorCards.length > 0) {
      return [
        buff(triggerCard, 1, {
          name: "Worthy Opponent",
          position,
        }),
      ];
    }
    return [];
  },

  // Drowning Net: Pull enemy cards one tile closer before combat.

  ran_pull: (context) => {
    simulationContext.debugLog("Drowning Net!");
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const events = pullCardsIn(position, board, triggerCard.owner);

    const gameEvents: BaseGameEvent[] = events.map((event) => {
      event.animation = "pull"; //currently the same but we may change it later
      return event;
    });

    if (gameEvents.length > 0) {
      // Rán's undertow plays on her own tile (behind the card on the client);
      // powerDelta 0 with no effectName means VFX only.
      gameEvents.unshift({
        type: EVENT_TYPES.CARD_POWER_CHANGED,
        animation: "ran_pull",
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: triggerCard.user_card_instance_id,
        powerDelta: 0,
        position,
      } as CardPowerChangedEvent);
    }

    return gameEvents;
  },

  // Valkyrie Sisterhood: Gain +2 if adjacent to another Valkyrie.
  brynhildr_valk: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    if (!position) return [];

    const adjacentValkyrieCards = getAdjacentCards(position, board, {
      tag: "valkyrie",
    });

    if (adjacentValkyrieCards.length > 0) {
      return [
        buff(triggerCard, 2, {
          name: "Valkyrie Sisterhood",
          position,
        }),
      ];
    }
    return [];
  },

  // Healing Touch: Cleanse adjacent allies of negative effects.
  eir_heal: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner,
    );
    for (const ally of adjacentAllies) {
      const allyPosition = getPositionOfCardById(
        ally.user_card_instance_id,
        board,
      );
      if (allyPosition) {
        gameEvents.push(
          cleanseDebuffs(ally, 1000, allyPosition, "light-purple-swirls"),
        );
      }
    }
    return gameEvents;
  },

  gunnr_war: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner,
    );

    const gameEvents: BaseGameEvent[] = [];
    for (const ally of adjacentAllies) {
      const allyPosition = getPositionOfCardById(
        ally.user_card_instance_id,
        board,
      );
      if (allyPosition) {
        gameEvents.push(
          buff(ally, 1, {
            name: "Battle Cry",
            position: allyPosition,
          }),
        );
      }
    }
    return gameEvents;
  },

  // Fated Draw: Draw 1 card.
  verdandi_present: (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];
    gameEvents.push(...drawCardSync(state, triggerCard.owner));
    return gameEvents;
  },

  // Gain +2 when a dragon card is placed.
  sigurd_slayer: (context) => {
    const { triggerCard, originalTriggerCard } = context;
    const HAND_POSITION = { x: -1, y: -1 };

    if (!originalTriggerCard?.base_card_data.tags.includes("dragon")) return [];

    return [
      createOrUpdateBuff(triggerCard, 1000, 2, "Gram's Edge", HAND_POSITION, {
        animation: "dragon-slayer",
        actingPlayerId: triggerCard.owner,
        sourceCard: triggerCard,
        sourcePlayerId: triggerCard.owner,
        turnNumber: context.state.turn_number,
      }),
    ];
  },

  fafnir_venom: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const strongestEnemy = getStrongestAdjacentEnemy(
      position,
      board,
      triggerCard.owner,
    );

    if (strongestEnemy) {
      const enemyPosition = getPositionOfCardById(
        strongestEnemy.user_card_instance_id,
        board,
      );
      if (enemyPosition) {
        return [
          debuff(strongestEnemy, -2, {
            name: "Venomous Presence",
            position: enemyPosition,
          }),
        ];
      }
    }
    return [];
  },

  // Binding Justice: At the start of your turn, grant -2 to the strongest enemy
  // and +2 to the weakest ally on the board.
  tyr_binding_justice: (context) => {
    const {
      triggerCard,
      state,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    // "At the start of YOUR turn" — OnTurnStart fires for every board card
    // regardless of owner, so only act when it's this card owner's turn.
    if (triggerCard.owner !== state.current_player_id) return gameEvents;

    const enemies = getCardsByCondition(
      board,
      (card) => card.owner !== triggerCard.owner,
    );
    if (enemies.length > 0) {
      const strongestEnemy = enemies.reduce((strongest, current) =>
        getCardTotalPower(current) > getCardTotalPower(strongest)
          ? current
          : strongest,
      );
      const enemyPosition = getPositionOfCardById(
        strongestEnemy.user_card_instance_id,
        board,
      );
      if (enemyPosition) {
        gameEvents.push(
          debuff(strongestEnemy, -2, {
            name: "Binding Justice",
            animation: "binding-justice",
            position: enemyPosition,
            data: {
              actingPlayerId: triggerCard.owner,
              sourceCard: triggerCard,
              sourcePlayerId: triggerCard.owner,
              turnNumber: context.state.turn_number,
            },
          }),
        );
      }
    }

    const allies = getAllAlliesOnBoard(board, triggerCard.owner);
    if (allies.length > 0) {
      const weakestAlly = allies.reduce((weakest, current) =>
        getCardTotalPower(current) < getCardTotalPower(weakest)
          ? current
          : weakest,
      );
      const allyPosition = getPositionOfCardById(
        weakestAlly.user_card_instance_id,
        board,
      );
      if (allyPosition) {
        gameEvents.push(
          buff(weakestAlly, 2, {
            name: "Binding Justice",
            animation: "binding-justice",
            position: allyPosition,
          }),
        );
      }
    }

    return gameEvents;
  },

  //Destroys a weaker adjacent enemy each round, afterwards gains +1 to one side
  fenrir_devourer_surge: (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const FenrirTotalPower = getCardTotalPower(triggerCard);
    const position = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      board,
    );
    if (!position) return [];

    const adjacentEnemyCards = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner,
    );

    // Týr binds the wolf: while an enemy Týr is adjacent, Fenrir's ability is
    // suppressed entirely. Implemented as a guard here rather than as a real
    // Silence effect on Týr's side, so it needs no re-application when either
    // card moves — the check is simply re-evaluated each time Fenrir triggers.
    const boundByTyr = adjacentEnemyCards.some(
      (enemy) => enemy.base_card_data.name === "Tyr",
    );
    if (boundByTyr) return [];

    const adjacentEnemies = adjacentEnemyCards.filter((enemy) => {
      const enemyTotalPower = getCardTotalPower(enemy);
      return enemyTotalPower < FenrirTotalPower;
    });

    if (adjacentEnemies.length > 0) {
      const randomEnemy = adjacentEnemies[randomInt(adjacentEnemies.length)];
      const randomEnemyPosition = getPositionOfCardById(
        randomEnemy.user_card_instance_id,
        board,
      );
      if (randomEnemyPosition) {
        const destroyEvent = destroyCardAtPosition(
          randomEnemyPosition,
          board,
          "claw",
          triggerCard.owner,
          triggerCard,
        );
        if (destroyEvent) {
          gameEvents.push(destroyEvent);
          const side = getRandomSide();
          gameEvents.push(
            addTempBuff(
              triggerCard,
              1000,
              { [side]: 1 },
              {
                name: "Devourer's Surge",
                animation: "magic-up",
                position,
              },
            ),
          );
        }
      }
    }
    return gameEvents;
  },

  // Swift Messenger: Draw 2 cards.
  sleipnir_swift_messenger: (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    // Draw a card for the card owner
    gameEvents.push(...drawCardSync(state, triggerCard.owner));
    gameEvents.push(...drawCardSync(state, triggerCard.owner));

    return gameEvents;
  },

  // Past Weaves: Gain +1 to all stats for each destroyed ally.
  urd_past_weaves: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    if (!position) return [];

    const destroyedAllies = getCardsByCondition(
      board,
      (card) => card.defeats.length > 0,
    );

    for (let i = 0; i < destroyedAllies.length; i++) {
      gameEvents.push(
        buff(triggerCard, 1, {
          name: "Past Weaves",
          position,
        }),
      );
    }
    return gameEvents;
  },
};
