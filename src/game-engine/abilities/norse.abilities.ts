import {
  TriggerMoment,
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
} from "../ability.utils";
import { drawCardSync, flipCard } from "../game.utils";
import { BaseGameEvent, CardEvent, EVENT_TYPES } from "../game-events";
import { v4 as uuidv4 } from "uuid";
import { TileStatus, TileTerrain } from "../../types/game.types";
import { randomChance, randomInt } from "../simulation.rng";
import AchievementService from "../../services/achievement.service";

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

export const norseAbilities: AbilityMap = {
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
                turns_left: 2, // Lasts through one full round (both players' turns)
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

    if (triggerMoment === TriggerMoment.OnRoundStart) {
      const HAND_POSITION = { x: -1, y: -1 };
      const allHands = [...state.player1.hand, ...state.player2.hand];

      for (const cardId of allHands) {
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

    const player =
      triggerCard.original_owner === player1.user_id ? player1 : player2;
    player.hand.push(triggerCard.user_card_instance_id);

    gameEvents.push({
      type: EVENT_TYPES.CARD_DRAWN,
      eventId: uuidv4(),
      timestamp: Date.now(),
      cardId: triggerCard.user_card_instance_id,
      sourcePlayerId: triggerCard.original_owner,
    } as CardEvent);

    if (!simulationContext.isInSimulation()) {
      AchievementService.triggerAchievementEvent({
        userId: triggerCard.original_owner,
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
  odin_foresight: (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const allAllies = getAllAlliesOnBoard(board, triggerCard.owner);
    for (const ally of allAllies) {
      const allyPosition = getPositionOfCardById(
        ally.user_card_instance_id,
        board,
      );
      if (allyPosition) {
        gameEvents.push(
          buff(ally, 1, {
            name: "Eye of Mimir",
            animation: "red-lightning",
            position: allyPosition,
          }),
        );
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

  // Mother's Blessing: Grant +1 to all adjacent allies.
  frigg_bless: (context) => {
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
          buff(ally, 1, {
            name: "Fensalir's Grace",
            animation: "light-cross-spin",
            position: allyPosition,
          }),
        );
      }
    }

    return gameEvents;
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

  // Silent Vengeance: If Odin has been defeated, gain +3 to all stats.
  vidar_vengeance: (context) => {
    const {
      triggerCard,
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
    if (odinDefeated) {
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
      const triggerCardPosition = getPositionOfCardById(
        triggerCard.user_card_instance_id,
        board,
      );
      if (triggerCardPosition) {
        gameEvents.push(
          buff(triggerCard, 5, {
            name: "The Iron Shoe",
            animation: "triangle-shield",
            position: triggerCardPosition,
          }),
        );
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
          name: "Nóatún’s Guard",
          animation: "splash-up-down",
          position,
        }),
      );
    }
    return gameEvents;
  },

  // Warrior's Blessing: Grant +2 to adjacent allies for a turn.
  freyja_bless: (context) => {
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
          addTempBuff(ally, 2, 2, {
            name: "Warrior's Blessing",
            animation: "light-cross-spin",
            position: allyPosition,
          }),
        );
      }
    }
    return gameEvents;
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

    for (const enemy of enemiesInColumn) {
      const enemyPosition = getPositionOfCardById(
        enemy.user_card_instance_id,
        state.board,
      );
      if (!enemyPosition) continue;

      gameEvents.push(
        addTempDebuff(enemy, 3, -2, {
          name: "Winter's Step",
          animation: "winter-grasp",
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

  loki_flip: (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];
    const batchId = uuidv4();

    const allBoardCards = getCardsByCondition(
      state.board,
      (card) =>
        card.user_card_instance_id !== triggerCard.user_card_instance_id,
    );

    const selectedCards: InGameCard[] = [];
    const availableCards = [...allBoardCards];

    for (let i = 0; i < 4; i++) {
      if (availableCards.length === 0) break;
      const randomIndex = randomInt(availableCards.length);
      selectedCards.push(availableCards.splice(randomIndex, 1)[0]);
    }

    for (const selectedCard of selectedCards) {
      const tryToFlip = randomChance(50);
      if (tryToFlip) {
        const selectedCardPosition = getPositionOfCardById(
          selectedCard.user_card_instance_id,
          state.board,
        );
        if (!selectedCardPosition) continue;

        gameEvents.push(
          ...flipCard(
            state,
            selectedCardPosition,
            selectedCard,
            triggerCard,
            "trickster-gambit",
            {
              achievementBatchId: batchId,
              // Loki flips should always invert card ownership, including allied cards.
              forcedOwnerId: getOpponentId(selectedCard.owner, state),
              // Trickster's Gambit ignores all defeat-prevention abilities
              // (Ocean's Shield, Jormungandr's Shell, Harbor Guardian, etc.).
              overrideProtection: true,
              combatType: COMBAT_TYPES.SPECIAL,
            },
          ),
        );
      }
    }

    return gameEvents;
  },

  // Soul Lock: Hel binds the soul of every enemy she flips, locking that
  // card so it cannot be flipped back. Locks persist as long as Hel is on
  // the board; if Hel is later DESTROYED (removed from the board, not just
  // flipped), `releaseLocksAppliedBy` in `destroyCardAtPosition` clears
  // every soul she had bound.
  hel_soul: (context) => {
    const { flippedCard, triggerCard } = context;

    if (flippedCard) {
      flippedCard.lockedTurns = 1000;
      flippedCard.lockedBy = triggerCard.user_card_instance_id;
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

    const allAdjacentEnemies = getEnemiesAdjacentTo(
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

    for (const enemy of allAdjacentEnemies) {
      if (
        strongestEnemy &&
        enemy.user_card_instance_id === strongestEnemy.user_card_instance_id
      ) {
        // This enemy is already being removed, don't also debuff it.
        continue;
      }
      const enemyPosition = getPositionOfCardById(
        enemy.user_card_instance_id,
        board,
      );
      if (enemyPosition) {
        gameEvents.push(
          debuff(enemy, -1, {
            name: "Flames of Muspelheim",
            animation: "flames",
            position: enemyPosition,
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

    return events.map((event) => {
      event.animation = "pull"; //currently the same but we may change it later
      return event;
    });
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
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

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
            animation: "triangle-shield-down",
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
            animation: "triangle-shield",
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

    const adjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner,
    ).filter((enemy) => {
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
