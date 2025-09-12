import { AbilityMap } from "../../types/game-engine.types";
import { InGameCard } from "../../types/card.types";
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
} from "../ability.utils";
import { BaseGameEvent, CardEvent, EVENT_TYPES } from "../game-events";
import { v4 as uuidv4 } from "uuid";
import { TileStatus } from "../../types/game.types";

export const norseAbilities: AbilityMap = {
  // Foresight: Grant +1 to all allies on the board.
  // Thunderous Push: Push all adjacent enemies away 1 space after combat.
  // Mother's Blessing: Grant +1 to all adjacent allies.
  // Light Undimmed: Cannot be defeated by special abilities.
  "Watchman's Gate": (context) => {
    const {
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const adjacentPositions = getAdjacentPositions(position, board.length);
    for (const pos of adjacentPositions) {
      const tile = getTileAtPosition(pos, board);
      if (tile) {
        gameEvents.push(
          setTileStatus(tile, pos, {
            status: TileStatus.Blocked,
            turns_left: 2,
            animation_label: "frozen",
          })
        );
      }
    }

    return gameEvents;
  },

  // Poet's Rhythm: Adjacent allies gain +1 for a turn.
  // Silent Vengeance: If Odin has been defeated, gain +3 to all stats.
  // Avenge Baldr: Gain +1 to all stats for each ally defeated this game.
  // Sea's Protection: Gain +3 if adjacent to a Sea card.
  // Warrior's Blessing: Grant +2 to adjacent allies for a turn.
  // Peaceful Strength: Gain +2 if no adjacent enemies.
  // Winter's Grasp: Freeze one adjacent tile for 1 turn.

  "Winter's Grasp": (context) => {
    console.log("Winter's Grasp");
    const { position, state } = context;
    const gameEvents: BaseGameEvent[] = [];
    if (!position) return [];

    const adjacentPositions = getAdjacentPositions(
      position,
      state.board.length
    ).filter((pos) => getTileAtPosition(pos, state.board)?.card === null);
    console.log("adjacentPositions", adjacentPositions);

    if (adjacentPositions.length > 0) {
      const randomIndex = Math.floor(Math.random() * adjacentPositions.length);
      const tile = getTileAtPosition(
        adjacentPositions[randomIndex],
        state.board
      );
      console.log("tile", tile);
      if (tile)
        gameEvents.push(
          setTileStatus(tile, adjacentPositions[randomIndex], {
            status: TileStatus.Blocked,
            turns_left: 2,
            animation_label: "frozen",
          })
        );
    }

    return gameEvents;
  },

  "Trickster's Gambit": (context) => {
    const {
      triggerCard,
      state: { board, player1, player2 },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const allBoardCards = getCardsByCondition(
      board,
      (card) => card.user_card_instance_id !== triggerCard.user_card_instance_id
    );
    const cardsToSelectCount = Math.min(4, allBoardCards.length);

    const selectedCards: InGameCard[] = [];
    const availableCards = [...allBoardCards];

    for (let i = 0; i < cardsToSelectCount; i++) {
      if (availableCards.length === 0) break;
      const randomIndex = Math.floor(Math.random() * availableCards.length);
      selectedCards.push(availableCards.splice(randomIndex, 1)[0]);
    }

    for (const selectedCard of selectedCards) {
      let newOwnerId;
      if (selectedCard.owner === player1.user_id) {
        newOwnerId = player2.user_id;
      } else {
        newOwnerId = player1.user_id;
      }

      selectedCard.owner = newOwnerId;

      gameEvents.push({
        type: EVENT_TYPES.CARD_FLIPPED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        sourcePlayerId: triggerCard.owner,
        cardId: selectedCard.user_card_instance_id,
      } as CardEvent);
    }

    return gameEvents;
  },

  "Soul Lock": (context) => {
    const { triggerCard, flippedCard } = context;

    if (flippedCard) {
      flippedCard.lockedTurns = 1000;

      return [
        {
          type: EVENT_TYPES.CARD_FLIPPED,
          eventId: uuidv4(),
          timestamp: Date.now(),
          sourcePlayerId: triggerCard.owner,
          cardId: flippedCard?.user_card_instance_id,
          action: "soul-lock",
        } as CardEvent,
      ];
    }
    return [];
  },

  // Titan Shell: Can only be defeated by Thor.
  // Primordial Force: Gain +2 to all stats if no adjacent cards.
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

  "Dragon Slayer": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentSeaCards = getAdjacentCards(position, board, {
      tag: "dragon",
    });

    if (adjacentSeaCards.length > 0) {
      return [buff(triggerCard, 3)];
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

  "Binding Justice": (context) => {
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
      return [addTempDebuff(strongestEnemy, 1, -2)];
    }
    return [];
  },

  "Devourer's Surge": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );

    return [buff(triggerCard, adjacentEnemies.length)];
  },

  // Swift Messenger: Draw 2 cards.
  // Past Weaves: Gain +1 to all stats for each destroyed ally.
};
