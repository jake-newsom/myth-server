import {
  addTempBuff,
  addTempDebuff,
  buff,
  debuff,
  getAdjacentCards,
  isSurrounded,
  isFlankedByEnemies,
  isCorner,
  getAlliesAdjacentTo,
  isBottomRow,
  isEdge,
  isTopRow,
  getStrongestAdjacentEnemy,
  getCardsByCondition,
  getEnemiesAdjacentTo,
  getAdjacentPositions,
  getTileAtPosition,
  setTileStatus,
  destroyCardAtPosition,
} from "./ability.utils";
import { BaseGameEvent, CardEvent, EVENT_TYPES } from "./game-events";
import { TriggerContext } from "./game.utils";
import { v4 as uuidv4 } from "uuid";

export const abilities: Record<
  string,
  (context: TriggerContext) => BaseGameEvent[]
> = {
  "Shieldmaidens Unite": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;

    const adjacentCards = getAdjacentCards(position, board);
    const hasShieldMaidenAdjacent = adjacentCards.some(
      (card) => card.base_card_data.name === "Shield Maiden"
    );

    if (hasShieldMaidenAdjacent) {
      return [buff(triggerCard, 1)];
    }

    return [];
  },
  "Inspiring Song": (context) => {
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

    for (const allyCard of adjacentAllies) {
      return [addTempBuff(allyCard, 1, 1)];
    }

    return [];
  },
  "Watery Depths": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentSeaCards = getAdjacentCards(position, board, {
      tag: "Sea",
    });

    if (adjacentSeaCards.length > 0) {
      return [buff(triggerCard, { top: 0, bottom: 2, left: 0, right: 0 })];
    }
    return [];
  },
  "Boatman's Bonus": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentCards = getAdjacentCards(position, board);

    let foundQualifyingCard = false;
    for (const adjCard of adjacentCards) {
      const tags = adjCard?.base_card_data?.tags || [];
      if (tags.includes("boat") || tags.includes("sea creature")) {
        foundQualifyingCard = true;
        break;
      }
    }

    if (foundQualifyingCard) {
      return [buff(triggerCard, { top: 0, bottom: 0, left: 0, right: 2 })];
    }
    return [];
  },
  "Corner Light": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    if (isCorner(position, board.length)) {
      return [buff(triggerCard, 1)];
    }
    return [];
  },
  "Cunning Flank": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    // Use triggerCard.owner as the playerId for isFlankedByEnemies
    if (isFlankedByEnemies(position, board, triggerCard.owner)) {
      return [buff(triggerCard, 1)];
    }
    return [];
  },
  "Swarm Tactics": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    if (isSurrounded(position, board)) {
      return [buff(triggerCard, 2)];
    }
    return [];
  },
  "Young Fury": (context) => {
    const { triggerCard } = context;
    return [buff(triggerCard, { top: 2, bottom: 0, left: 0, right: 0 })];
  },
  "Grave Vengeance": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    // 50% chance to activate
    if (Math.random() < 0.5) {
      // Ensure Draugr's position is valid (it should be if context is from its defeat)
      if (position) {
        const strongestEnemy = getStrongestAdjacentEnemy(
          position,
          board,
          triggerCard.owner // Draugr's owner, to identify enemies
        );

        if (strongestEnemy) {
          strongestEnemy.owner = triggerCard.owner;
          gameEvents.push({
            type: EVENT_TYPES.CARD_FLIPPED,
            eventId: uuidv4(),
            timestamp: Date.now(),
            cardId: strongestEnemy.user_card_instance_id,
            action: "grave-vengeance",
            sourcePlayerId: triggerCard.owner,
          } as CardEvent);
        }
      }
    }
    return gameEvents;
  },
  "Hunt Charge": (context) => {
    const { triggerCard } = context;
    return [buff(triggerCard, { top: 0, bottom: 0, left: 0, right: 3 })];
  },
  "Runic Aura": (context) => {
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
    for (const allyCard of adjacentAllies) {
      gameEvents.push(buff(allyCard, 1));
    }

    return gameEvents;
  },
  "Devour Essence": (context) => {
    const { triggerCard } = context;
    return [buff(triggerCard, 1)];
  },
  "Totem Empower": (context) => {
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

    for (const allyCard of adjacentAllies) {
      const tags = allyCard.base_card_data.tags || [];
      if (tags.includes("Beast")) {
        gameEvents.push(
          buff(allyCard, { top: 1, bottom: 1, left: 0, right: 0 })
        );
      }
    }

    return gameEvents;
  },
  "Frost Roots": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    if (isBottomRow(position, board.length)) {
      return [buff(triggerCard, 2)];
    }
    return [];
  },
  "Ice Line Bonus": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentCards = getAdjacentCards(position, board);

    const isAdjacentToWaterBased = adjacentCards.some((adjCard) => {
      const tags = adjCard.base_card_data.tags || [];
      return tags.includes("water-based");
    });

    if (isAdjacentToWaterBased) {
      return [buff(triggerCard, { top: 0, bottom: 2, left: 0, right: 0 })];
    }

    return [];
  },
  "Sea's Protection": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const adjacentSeaCards = getAdjacentCards(position, board, {
      tag: "Sea",
    });

    if (adjacentSeaCards.length > 0) {
      return [buff(triggerCard, 3)];
    }
    return [];
  },
  "Golden Hair": (context) => {
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

    for (const allyCard of adjacentAllies) {
      gameEvents.push(buff(allyCard, { top: 0, bottom: 0, left: 1, right: 1 }));
    }

    return gameEvents;
  },
  "Winter's Aim": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    if (isEdge(position, board.length)) {
      return [buff(triggerCard, { top: 2, bottom: 2, left: 0, right: 0 })];
    }
    return [];
  },
  "Hoofed Escape": (context) => {
    return [];
  },
  "Heaven's Wrath": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (position && isTopRow(position, board.length)) {
      const strongestEnemy = getStrongestAdjacentEnemy(
        position,
        board,
        triggerCard.owner
      );

      if (strongestEnemy) {
        // Mark for defeat by generating an event
        // The actual removal from board and hand will be handled by the game engine processing this event
        gameEvents.push({
          type: EVENT_TYPES.CARD_REMOVED_FROM_BOARD,
          eventId: uuidv4(),
          timestamp: Date.now(),
          cardId: strongestEnemy.user_card_instance_id,
          reason: "Heaven's Wrath",
          sourcePlayerId: triggerCard.owner, // Optional: Indicate who triggered this
          position: position,
        } as CardEvent);
        // Potentially, an event to remove from hand if it goes there after defeat
        // gameEvents.push({
        //   type: EVENT_TYPES.CARD_REMOVED_FROM_HAND,
        //   eventId: uuidv4(),
        //   timestamp: Date.now(),
        //   cardId: strongestEnemy.user_card_instance_id,
        //   reason: "Heaven's Wrath",
        //   sourcePlayerId: triggerCard.owner,
        // });
      }
    }

    return gameEvents;
  },
  "Ragnarok Blast": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const adjacentPositions = getAdjacentPositions(position, board.length);

    for (const pos of adjacentPositions) {
      const tile = getTileAtPosition(pos, board);
      if (tile?.card) {
        const event = destroyCardAtPosition(pos, board, "ragnarok");

        if (event) {
          gameEvents.push(event);
        }
      }
    }

    return gameEvents;
  },
  Switcheroo: (context) => {
    const {
      triggerCard,
      state: { board, player1, player2 },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const allBoardCards = getCardsByCondition(board, () => true);
    const cardsToSelectCount = Math.min(3, allBoardCards.length);

    const selectedCards: any[] = []; // Using any[] to avoid type issues with InGameCard if it's complex
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
        // Add newOwnerId to the event if the event schema supports it,
        // or ensure CARD_STATE_CHANGED event also fires if owner change needs separate tracking.
        // For now, following provided event structure.
      } as CardEvent);
    }

    return gameEvents;
  },
  "World Tree's Blessing": (context) => {
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

    for (const allyCard of adjacentAllies) {
      gameEvents.push(buff(allyCard, 2)); // Buff all stats by +2
    }

    return gameEvents;
  },
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
        gameEvents.push(setTileStatus(tile, pos, "blocked", 2, "frozen"));
      }
    }

    return gameEvents;
  },
  "Rainbow Bridge": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    // 1. Find all ally cards on the board
    const allAlliesOnBoard = getCardsByCondition(
      board,
      (card) => card.owner === triggerCard.owner
    );

    // 2. Find all ally cards adjacent to the triggerCard (Bifrost Gate)
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );

    // 3. Determine the set of ally cards that are on the board but NOT adjacent
    const adjacentAllyIds = new Set(
      adjacentAllies.map((card) => card.user_card_instance_id)
    );

    const nonAdjacentAllies = allAlliesOnBoard.filter(
      (card) => !adjacentAllyIds.has(card.user_card_instance_id)
    );

    // 4. For each card in this resulting set, buff all their stats by +1
    for (const allyCard of nonAdjacentAllies) {
      // Ensure not to buff Bifrost Gate itself if it somehow ends up in this list
      // (e.g. if getCardsByCondition included the triggerCard and it has no adjacent allies)
      if (
        allyCard.user_card_instance_id !== triggerCard.user_card_instance_id
      ) {
        gameEvents.push(buff(allyCard, 1));
      }
    }

    return gameEvents; // Return an empty array of game events
  },
  "Mother's Blessing": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const allAllyCardsOnBoard = getCardsByCondition(
      board,
      (card) => card.owner === triggerCard.owner
    );

    for (const allyCard of allAllyCardsOnBoard) {
      gameEvents.push(buff(allyCard, 1)); // Buff all stats by +1
    }

    return gameEvents;
  },
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

    for (const allyCard of adjacentAllies) {
      // Apply +2 to all stats, duration 2 (until start of owner's next turn)
      gameEvents.push(addTempBuff(allyCard, 2, 2));
    }

    return gameEvents;
  },
  Bloodlust: (context) => {
    const { triggerCard, flippedCard } = context; // Fenrir is triggerCard

    if (flippedCard) {
      flippedCard.lockedTurns = 1000;

      return [
        {
          type: EVENT_TYPES.CARD_FLIPPED,
          eventId: uuidv4(),
          timestamp: Date.now(),
          sourcePlayerId: triggerCard.owner, // Fenrir's owner
          cardId: flippedCard?.user_card_instance_id, // The card that was converted
          action: "bloodlust", // Custom property for context
        } as CardEvent,
      ];
    }
    return [];
  },
  "Soul Lock": (context) => {
    const { triggerCard, flippedCard } = context; // Fenrir is triggerCard

    if (flippedCard) {
      flippedCard.lockedTurns = 1000;

      return [
        {
          type: EVENT_TYPES.CARD_FLIPPED,
          eventId: uuidv4(),
          timestamp: Date.now(),
          sourcePlayerId: triggerCard.owner, // Fenrir's owner
          cardId: flippedCard?.user_card_instance_id, // The card that was converted
          action: "bloodlust", // Custom property for context
        } as CardEvent,
      ];
    }
    return [];
  },
  "Icy Grasp": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;

    if (position) {
      // Ensure Ice Wraith has a position
      const strongestEnemy = getStrongestAdjacentEnemy(
        position,
        board,
        triggerCard.owner // Ice Wraith's owner, to identify enemies
      );

      if (strongestEnemy) {
        // TODO: This debuff should ideally be temporary (e.g., for the current combat or turn).
        // The current `debuff` function applies a permanent debuff.
        // A system for temporary status effects would be needed for true "for combat" effects.
        return [debuff(strongestEnemy, 2)];
      }
    }

    return []; // No game events returned for this direct debuff as per subtask
  },
  "Storm Strike": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;

    if (position) {
      const strongestEnemy = getStrongestAdjacentEnemy(
        position,
        board,
        triggerCard.owner
      );

      if (strongestEnemy) {
        // Using addTempBuff with a negative value as a stand-in for a temporary debuff.
        // Ideally, a dedicated applyTemporaryDebuff function would exist.
        // Also, note that addTempBuff itself is currently a stub.
        addTempBuff(strongestEnemy, -2, 1); // Reduce all stats by 2 for 1 turn
      }
    }
    return [];
  },
  "Flame Touch": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;

    if (position) {
      const strongestEnemy = getStrongestAdjacentEnemy(
        position,
        board,
        triggerCard.owner
      );

      if (strongestEnemy) {
        // TODO: This debuff should ideally be temporary (e.g., for the current combat or turn).
        // The current `debuff` function applies a permanent debuff.
        // A system for temporary status effects would be needed for true "for combat" effects.
        debuff(strongestEnemy, 1); // Debuff by 1
      }
    }

    return [];
  },
  "Mjölnir Shock": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;

    if (position) {
      const strongestEnemy = getStrongestAdjacentEnemy(
        position,
        board,
        triggerCard.owner
      );

      if (strongestEnemy) {
        // Using addTempBuff with a negative value as a stand-in for a temporary debuff.
        // Ideally, a dedicated applyTemporaryDebuff function would exist.
        // Also, note that addTempBuff itself is currently a stub.
        addTempBuff(strongestEnemy, -2, 1); // Reduce all stats by 2 for 1 turn
      }
    }
    return [];
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
      debuff(enemy, 1); // Debuff all other adjacent enemies by 1
    }

    return gameEvents;
  },
};
