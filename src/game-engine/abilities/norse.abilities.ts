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
  getAdjacentPositions,
  getTileAtPosition,
  setTileStatus,
  addTempDebuff,
  getAllAlliesOnBoard,
  addTempBuff,
  pullCardsIn,
  pushCardAway,
  cleanseDebuffs,
  blockTile,
  getCardHighestPower,
  getCardTotalPower,
  destroyCardAtPosition,
  getPositionOfCardById,
  createOrUpdateBuff,
  getCardsInSameColumn,
} from "../ability.utils";
import { drawCardSync, flipCard } from "../game.utils";
import { BaseGameEvent, CardEvent, EVENT_TYPES } from "../game-events";
import { v4 as uuidv4 } from "uuid";
import { TileStatus } from "../../types/game.types";

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
  "Titan Shell": (context) => {
    const { triggerCard } = context;

    if (triggerCard.base_card_data.name !== "Thor") return true;

    return false;
  },
};

export const norseAbilities: AbilityMap = {
  // Returns to your hand when defeated
  "Light Undimmed": (context) => {
    const {
      triggerCard,
      state: { board, player1, player2 },
    } = context;

    const gameEvents: BaseGameEvent[] = [];

    //remove card from the board
    const position = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      board
    );
    if (position) {
      const removeEvent = destroyCardAtPosition(
        position,
        board,
        undefined,
        triggerCard.owner
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

    return gameEvents;
  },

  // Foresight: Grant +1 to all allies on the board.
  Foresight: (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const allAllies = getAllAlliesOnBoard(board, triggerCard.owner);
    for (const ally of allAllies) {
      gameEvents.push(buff(ally, 1));
    }
    return gameEvents;
  },

  // Thunderous Push: Strike all enemies with lightning granting -1 on a random side
  "Thunderous Push": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];
    const enemyCards = getCardsByCondition(
      board,
      (card) => card.owner !== triggerCard.owner
    );

    //OWEN
    for (const enemy of enemyCards) {
      const sides = ["top", "bottom", "left", "right"] as const;
      const randomSide = sides[Math.floor(Math.random() * sides.length)];
      gameEvents.push(
        addTempDebuff(
          enemy,
          1000,
          { [randomSide]: -1 },
          {
            animation: "lightning",
            ...(getPositionOfCardById(enemy.user_card_instance_id, board) && {
              position: getPositionOfCardById(
                enemy.user_card_instance_id,
                board
              )!,
            }),
          }
        )
      );
    }

    return gameEvents;
  },

  // Mother's Blessing: Grant +1 to all adjacent allies.
  "Mother's Blessing": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );
    for (const ally of adjacentAllies) {
      gameEvents.push(buff(ally, 1));
    }

    return gameEvents;
  },

  //After 3 rounds all played cards lose -1 and grant cards in your hand +1
  "Watchman's Gate": (context) => {
    const {
      triggerCard,
      state: { board, player1, player2, hydrated_card_data_cache },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const existingBuff = triggerCard.temporary_effects.find(
      (effect) => effect.name === "Watchman's Gate"
    );
    if (existingBuff) {
      if (existingBuff.data?.rounds === 3) {
        const allCards = getCardsByCondition(board, (card) => true);
        for (const card of allCards) {
          gameEvents.push(debuff(card, -1));
        }
        const player =
          player1.user_id === triggerCard.owner ? player1 : player2;
        for (const cardId of player.hand) {
          const card = hydrated_card_data_cache?.[cardId];
          if (card) {
            gameEvents.push(addTempBuff(card, 1000, 1));
          }
        }
      } else {
        createOrUpdateBuff(triggerCard, 3, 0, "Watchman's Gate", {
          rounds: existingBuff.data?.rounds + 1,
        });
      }
    } else {
      createOrUpdateBuff(triggerCard, 3, 0, "Watchman's Gate", { rounds: 0 });
    }

    return gameEvents;
  },

  // Poet's Rhythm: Adjacent allies gain +1 for a turn.
  "Poet's Rhythm": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );
    for (const ally of adjacentAllies) {
      gameEvents.push(addTempBuff(ally, 3, 1));
    }
    return gameEvents;
  },

  // Silent Vengeance: If Odin has been defeated, gain +3 to all stats.
  "Silent Vengeance": (context) => {
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
      for (const ally of getAllAlliesOnBoard(board, triggerCard.owner)) {
        gameEvents.push(buff(ally, 3));
      }
    }
    return gameEvents;
  },

  // Avenge Baldr: Gain +1 to all stats for each ally defeated this game.
  "Avenge Baldr": (context) => {
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
  "Sea's Protection": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentSeaCards = getAdjacentCards(position, board, {
      tag: "Sea",
    });
    if (adjacentSeaCards.length > 0) {
      gameEvents.push(buff(triggerCard, 3));
    }
    return gameEvents;
  },

  // Warrior's Blessing: Grant +2 to adjacent allies for a turn.
  "Warrior's Blessing": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );
    for (const ally of adjacentAllies) {
      gameEvents.push(addTempBuff(ally, 2, 1));
    }
    return gameEvents;
  },

  // Peaceful Strength: Gain +2 if no adjacent enemies.
  "Peaceful Strength": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );
    if (adjacentEnemies.length === 0) {
      gameEvents.push(buff(triggerCard, 2));
    }
    return gameEvents;
  },

  // Winter's Grasp: Enemies in the same column lose 3 power through your next turn
  "Winter's Grasp": (context) => {
    const { position, state, triggerCard } = context;
    const gameEvents: BaseGameEvent[] = [];
    if (!position) return [];

    const enemiesInColumn = getCardsInSameColumn(
      position,
      state.board,
      triggerCard.owner
    );

    for (const enemy of enemiesInColumn) {
      gameEvents.push(
        addTempDebuff(enemy, 1000, -3, {
          name: "Winter's Grasp",
          animation: "winter-grasp",
          position: getPositionOfCardById(
            enemy.user_card_instance_id,
            state.board
          )!,
        })
      );
    }
    return gameEvents;
  },

  "Trickster's Gambit": (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    const allBoardCards = getCardsByCondition(
      state.board,
      (card) => card.user_card_instance_id !== triggerCard.user_card_instance_id
    );

    const selectedCards: InGameCard[] = [];
    const availableCards = [...allBoardCards];

    for (let i = 0; i < 4; i++) {
      if (availableCards.length === 0) break;
      const randomIndex = Math.floor(Math.random() * availableCards.length);
      selectedCards.push(availableCards.splice(randomIndex, 1)[0]);
    }

    for (const selectedCard of selectedCards) {
      const tryToFlip = Math.floor(Math.random() * 100) < 50;
      if (tryToFlip) {
        gameEvents.push(
          ...flipCard(
            state,
            getPositionOfCardById(
              selectedCard.user_card_instance_id,
              state.board
            )!,
            selectedCard,
            triggerCard
          )
        );
      }
    }

    return gameEvents;
  },

  "Soul Lock": (context) => {
    const { flippedCard } = context;

    if (flippedCard) {
      flippedCard.lockedTurns = 1000;
      // Don't create a CARD_FLIPPED event here - let flipCard handle it
      // The attack animation will be set via ability parameters
      return [];
    }
    return [];
  },

  // Primordial Force: Gain +2 to all stats if no adjacent cards.
  "Primordial Force": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentCards = getAdjacentCards(position, board);
    if (adjacentCards.length === 0) {
      gameEvents.push(buff(triggerCard, 2));
    }
    return gameEvents;
  },

  "Flames of Muspelheim": (context) => {
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
      triggerCard.owner
    );

    const allAdjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );

    if (strongestEnemy) {
      gameEvents.push({
        type: EVENT_TYPES.CARD_REMOVED_FROM_BOARD,
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: strongestEnemy.user_card_instance_id,
        reason: "Flames of Muspelheim",
        sourcePlayerId: triggerCard.owner,
      } as CardEvent);
    }

    for (const enemy of allAdjacentEnemies) {
      if (
        strongestEnemy &&
        enemy.user_card_instance_id === strongestEnemy.user_card_instance_id
      ) {
        // This enemy is already being removed, don't also debuff it.
        continue;
      }
      gameEvents.push(debuff(enemy, -1));
    }

    return gameEvents;
  },

  // Bride Demand: Gain +3 Right if adjacent to a Goddess card.
  "Bride Demand": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentGoddessCards = getAdjacentCards(position, board, {
      tag: "Goddess",
    });
    if (adjacentGoddessCards.length > 0) {
      gameEvents.push(buff(triggerCard, 3));
    }
    return gameEvents;
  },

  "Worthy Opponent": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentThorCards = getAdjacentCards(position, board, {
      name: "Thor",
    });

    if (adjacentThorCards.length > 0) {
      return [buff(triggerCard, 1)];
    }
    return [];
  },

  // Drowning Net: Pull enemy cards one tile closer before combat.

  "Drowning Net": (context) => {
    simulationContext.debugLog("Drowning Net!");
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    return pullCardsIn(position, board, triggerCard.owner);

    return gameEvents;
  },

  // Valkyrie Sisterhood: Gain +2 if adjacent to another Valkyrie.
  "Valkyrie Sisterhood": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentValkyrieCards = getAdjacentCards(position, board, {
      tag: "Valkyrie",
    });

    if (adjacentValkyrieCards.length > 0) {
      return [buff(triggerCard, 2)];
    }
    return [];
  },

  // Healing Touch: Cleanse adjacent allies of negative effects.
  "Healing Touch": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );
    for (const ally of adjacentAllies) {
      gameEvents.push(cleanseDebuffs(ally, 1000));
    }
    return gameEvents;
  },

  "Battle Cry": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );

    const gameEvents: BaseGameEvent[] = [];
    for (const ally of adjacentAllies) {
      gameEvents.push(buff(ally, 1));
    }
    return gameEvents;
  },

  // Fated Draw: Draw 1 card.
  "Fated Draw": (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];
    gameEvents.push(...drawCardSync(state, triggerCard.owner));
    return gameEvents;
  },

  //Gain +1 for each Dragon on the board
  "Dragon Slayer": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;

    const dragonsOnBoard = getCardsByCondition(board, (card) =>
      card.base_card_data.tags.includes("dragon")
    );

    if (dragonsOnBoard.length > 0) {
      const currentBuff = triggerCard.temporary_effects.find(
        (effect) => effect.name === "Dragon Slayer"
      );
      const diff = dragonsOnBoard.length * 2 - (currentBuff?.power.top ?? 0);

      return [
        createOrUpdateBuff(triggerCard, 1000, diff, "Dragon Slayer", {
          animation: "dragon-slayer",
        }),
      ];
    }
    return [];
  },

  "Venomous Presence": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const strongestEnemy = getStrongestAdjacentEnemy(
      position,
      board,
      triggerCard.owner
    );

    if (strongestEnemy) {
      return [debuff(strongestEnemy, -2)];
    }
    return [];
  },

  //Equalize all cards highest power
  "Binding Justice": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const allCards = getCardsByCondition(
      board,
      (card) => card.user_card_instance_id !== triggerCard.user_card_instance_id
    );
    const cardsHighestPowers = allCards.map(
      (card) => getCardHighestPower(card).value
    );
    const meanHighestPower = Math.floor(
      cardsHighestPowers.reduce((a, b) => a + b, 0) / cardsHighestPowers.length
    );

    for (const card of allCards) {
      const highestPower = getCardHighestPower(card);
      const diff = meanHighestPower - highestPower.value;

      if (diff > 0) {
        gameEvents.push(
          addTempBuff(
            card,
            1000,
            { [highestPower.key]: diff },
            "Binding Justice",
            {
              animation: "binding-justice",
              position: getPositionOfCardById(
                card.user_card_instance_id,
                board
              )!,
            }
          )
        );
      } else {
        gameEvents.push(
          addTempDebuff(
            card,
            1000,
            { [highestPower.key]: -diff },
            {
              animation: "binding-justice",
              position: getPositionOfCardById(
                card.user_card_instance_id,
                board
              )!,
            }
          )
        );
      }
    }
    return gameEvents;
  },

  //Destroys a weaker adjacent enemy each round, afterwards gains +1 to one side
  "Devourer's Surge": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    simulationContext.debugLog("Devourer's Surge!");
    const gameEvents: BaseGameEvent[] = [];

    const FenrirTotalPower = getCardTotalPower(triggerCard);
    const position = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      board
    );
    if (!position) return [];

    simulationContext.debugLog("FenrirTotalPower", FenrirTotalPower);
    simulationContext.debugLog("position", position);

    simulationContext.debugLog("triggerCard.owner", triggerCard.owner);
    const adjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner
    ).filter((enemy) => {
      const enemyTotalPower = getCardTotalPower(enemy);
      simulationContext.debugLog("enemyTotalPower", enemyTotalPower);
      return enemyTotalPower < FenrirTotalPower;
    });
    simulationContext.debugLog("adjacentEnemies", adjacentEnemies);

    if (adjacentEnemies.length > 0) {
      simulationContext.debugLog("adjacentEnemies", adjacentEnemies);
      const randomEnemy =
        adjacentEnemies[Math.floor(Math.random() * adjacentEnemies.length)];
      simulationContext.debugLog("randomEnemy", randomEnemy);
      const destroyEvent = destroyCardAtPosition(
        getPositionOfCardById(randomEnemy.user_card_instance_id, board)!,
        board,
        "claw",
        triggerCard.owner
      );
      simulationContext.debugLog("destroyEvent", destroyEvent);
      if (destroyEvent) {
        gameEvents.push(destroyEvent);
        //Gain +1 to a random side
        const sides = ["top", "bottom", "left", "right"] as const;
        const randomSide = sides[Math.floor(Math.random() * sides.length)];
        gameEvents.push(addTempBuff(triggerCard, 1000, { [randomSide]: 1 }));
        simulationContext.debugLog("addTempBuff", addTempBuff);
      }
    }
    return gameEvents;
  },

  // Swift Messenger: Draw 2 cards.
  "Swift Messenger": (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    // Draw a card for the card owner
    gameEvents.push(...drawCardSync(state, triggerCard.owner));
    gameEvents.push(...drawCardSync(state, triggerCard.owner));

    return gameEvents;
  },

  // Past Weaves: Gain +1 to all stats for each destroyed ally.
  "Past Weaves": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const destroyedAllies = getCardsByCondition(
      board,
      (card) => card.defeats.length > 0
    );

    for (let i = 0; i < destroyedAllies.length; i++) {
      gameEvents.push(buff(triggerCard, 1));
    }
    return gameEvents;
  },
};
