import { buff, debuff, getAdjacentCards, isSurrounded, isFlankedByEnemies, isCorner, getAlliesAdjacentTo, isBottomRow, isEdge, applyTemporaryBuff, isTopRow, getStrongestAdjacentEnemy, getCardsByCondition, getEnemiesAdjacentTo } from "./ability.utils";
import { BaseGameEvent, EVENT_TYPES } from "./game-events";
import { TriggerContext } from "./game.utils";
import { v4 as uuidv4 } from "uuid";

export const abilities: Record<
  string,
  (context: TriggerContext) => BaseGameEvent[]
> = {
  "Shieldmaidens Unite": (context) => {
    const { triggerCard, board } = context;
    const adjacentCards = getAdjacentCards(triggerCard.position, board);
    const hasShieldMaidenAdjacent = adjacentCards.some(
      (card) => card.base_card_data.name === "Shield Maiden"
    );

    if (hasShieldMaidenAdjacent) {
      buff(triggerCard, 1);
    }

    return [];
  },
  "Inspiring Song": (context) => {
    const { triggerCard, board } = context;
    const adjacentAllies = getAlliesAdjacentTo(
      triggerCard.position,
      board,
      triggerCard.owner
    );

    for (const allyCard of adjacentAllies) {
      applyTemporaryBuff(allyCard, 1, 1); // Apply +1 to all stats for 1 turn
    }

    return [];
  },
  "Watery Depths": (context) => {
    const { triggerCard, board } = context;
    const adjacentSeaCards = getAdjacentCards(triggerCard.position, board, {
      tag: "Sea",
    });

    if (adjacentSeaCards.length > 0) {
      buff(triggerCard, { top: 0, bottom: 2, left: 0, right: 0 });
    }
    return [];
  },
  "Boatman's Bonus": (context) => {
    const { triggerCard, board } = context;
    const adjacentCards = getAdjacentCards(triggerCard.position, board);

    let foundQualifyingCard = false;
    for (const adjCard of adjacentCards) {
      const tags = adjCard.base_card_data.tags || [];
      if (tags.includes("boat") || tags.includes("sea creature")) {
        foundQualifyingCard = true;
        break;
      }
    }

    if (foundQualifyingCard) {
      buff(triggerCard, { top: 0, bottom: 0, left: 0, right: 2 });
    }
    return [];
  },
  "Corner Light": (context) => {
    const { triggerCard, board } = context;
    if (isCorner(triggerCard.position, board.length)) {
      buff(triggerCard, 1);
    }
    return [];
  },
  "Cunning Flank": (context) => {
    const { triggerCard, board } = context;
    // Use triggerCard.owner as the playerId for isFlankedByEnemies
    if (isFlankedByEnemies(triggerCard.position, board, triggerCard.owner)) {
      buff(triggerCard, 1);
    }
    return [];
  },
  "Swarm Tactics": (context) => {
    const { triggerCard, board } = context;
    if (isSurrounded(triggerCard.position, board)) {
      buff(triggerCard, 2);
    }
    return [];
  },
  "Young Fury": (context) => {
    const { triggerCard } = context;
    // Assume didDefeatEnemyThisTurn is a flag set by the game engine
    if (triggerCard.didDefeatEnemyThisTurn) {
      buff(triggerCard, { top: 2, bottom: 0, left: 0, right: 0 });
    }
    return [];
  },
  "Grave Vengeance": (context) => {
    const { triggerCard, board } = context;
    const gameEvents: BaseGameEvent[] = [];

    // 50% chance to activate
    if (Math.random() < 0.5) {
      // Ensure Draugr's position is valid (it should be if context is from its defeat)
      if (triggerCard.position) {
        const strongestEnemy = getStrongestAdjacentEnemy(
          triggerCard.position,
          board,
          triggerCard.owner // Draugr's owner, to identify enemies
        );

        if (strongestEnemy) {
          gameEvents.push({
            type: EVENT_TYPES.CARD_REMOVED_FROM_BOARD,
            eventId: uuidv4(),
            timestamp: Date.now(),
            cardId: strongestEnemy.user_card_instance_id,
            reason: "Grave Vengeance",
            sourcePlayerId: triggerCard.owner,
          });
        }
      }
    }
    return gameEvents;
  },
  "Hunt Charge": (context) => {
    const { triggerCard } = context;
    // Assume didDefeatEnemyThisTurn is a flag set by the game engine
    if (triggerCard.didDefeatEnemyThisTurn) {
      buff(triggerCard, { top: 0, bottom: 0, left: 0, right: 3 });
    }
    return [];
  },
  "Runic Aura": (context) => {
    const { triggerCard, board } = context;
    const adjacentAllies = getAlliesAdjacentTo(
      triggerCard.position,
      board,
      triggerCard.owner
    );

    for (const allyCard of adjacentAllies) {
      buff(allyCard, 1);
    }

    return [];
  },
  "Devour Essence": (context) => {
    const { triggerCard } = context;
    // Assume enemiesDefeatedCount is available on triggerCard and is a number
    const enemiesDefeatedCount = triggerCard.enemiesDefeatedCount || 0;

    if (enemiesDefeatedCount > 0) {
      buff(triggerCard, enemiesDefeatedCount);
    }

    return [];
  },
  "Totem Empower": (context) => {
    const { triggerCard, board } = context;
    const adjacentAllies = getAlliesAdjacentTo(
      triggerCard.position,
      board,
      triggerCard.owner
    );

    for (const allyCard of adjacentAllies) {
      const tags = allyCard.base_card_data.tags || [];
      if (tags.includes("Beast")) {
        buff(allyCard, { top: 1, bottom: 1, left: 0, right: 0 });
      }
    }

    return [];
  },
  "Frost Roots": (context) => {
    const { triggerCard, board } = context;
    if (isBottomRow(triggerCard.position, board.length)) {
      buff(triggerCard, 2);
    }
    return [];
  },
  "Ice Line Bonus": (context) => {
    const { triggerCard, board } = context;
    const adjacentCards = getAdjacentCards(triggerCard.position, board);

    const isAdjacentToWaterBased = adjacentCards.some((adjCard) => {
      const tags = adjCard.base_card_data.tags || [];
      return tags.includes("water-based");
    });

    if (isAdjacentToWaterBased) {
      buff(triggerCard, { top: 0, bottom: 2, left: 0, right: 0 });
    }

    return [];
  },
  "Sea's Protection": (context) => {
    const { triggerCard, board } = context;
    const adjacentSeaCards = getAdjacentCards(triggerCard.position, board, {
      tag: "Sea",
    });

    if (adjacentSeaCards.length > 0) {
      buff(triggerCard, 3);
    }
    return [];
  },
  "Golden Hair": (context) => {
    const { triggerCard, board } = context;
    const adjacentAllies = getAlliesAdjacentTo(
      triggerCard.position,
      board,
      triggerCard.owner
    );

    for (const allyCard of adjacentAllies) {
      buff(allyCard, { top: 0, bottom: 0, left: 1, right: 1 });
    }

    return [];
  },
  "Winter's Aim": (context) => {
    const { triggerCard, board } = context;
    if (isEdge(triggerCard.position, board.length)) {
      buff(triggerCard, { top: 2, bottom: 2, left: 0, right: 0 });
    }
    return [];
  },
  "Hoofed Escape": (context) => {
    const { triggerCard } = context;
    // Assuming a 4-column board (indices 0, 1, 2, 3)
    // Center columns are x=1 or x=2
    if (
      triggerCard.position &&
      (triggerCard.position.x === 1 || triggerCard.position.x === 2)
    ) {
      buff(triggerCard, 1);
    }
    return [];
  },
  "Heaven's Wrath": (context) => {
    const { triggerCard, board } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (triggerCard.position && isTopRow(triggerCard.position, board.length)) {
      const strongestEnemy = getStrongestAdjacentEnemy(
        triggerCard.position,
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
        });
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
  "Switcheroo": (context) => {
    const { triggerCard, board, state } = context;
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
      if (selectedCard.owner === state.player1.user_id) {
        newOwnerId = state.player2.user_id;
      } else {
        newOwnerId = state.player1.user_id;
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
      });
    }

    return gameEvents;
  },
  "World Tree's Blessing": (context) => {
    const { triggerCard, board } = context;
    const adjacentAllies = getAlliesAdjacentTo(
      triggerCard.position,
      board,
      triggerCard.owner
    );

    for (const allyCard of adjacentAllies) {
      buff(allyCard, 2); // Buff all stats by +2
    }

    return [];
  },
  "Rainbow Bridge": (context) => {
    const { triggerCard, board } = context;

    // 1. Find all ally cards on the board
    const allAlliesOnBoard = getCardsByCondition(
      board,
      (card) => card.owner === triggerCard.owner
    );

    // 2. Find all ally cards adjacent to the triggerCard (Bifrost Gate)
    const adjacentAllies = getAlliesAdjacentTo(
      triggerCard.position,
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
      if (allyCard.user_card_instance_id !== triggerCard.user_card_instance_id) {
        buff(allyCard, 1);
      }
    }

    return []; // Return an empty array of game events
  },
  "Mother's Blessing": (context) => {
    const { triggerCard, board } = context;

    const allAllyCardsOnBoard = getCardsByCondition(
      board,
      (card) => card.owner === triggerCard.owner
    );

    for (const allyCard of allAllyCardsOnBoard) {
      buff(allyCard, 1); // Buff all stats by +1
    }

    return [];
  },
  "Warrior's Blessing": (context) => {
    const { triggerCard, board } = context;
    const adjacentAllies = getAlliesAdjacentTo(
      triggerCard.position,
      board,
      triggerCard.owner
    );

    for (const allyCard of adjacentAllies) {
      // Apply +2 to all stats, duration 2 (until start of owner's next turn)
      applyTemporaryBuff(allyCard, 2, 2);
    }

    return [];
  },
  "Bloodlust": (context) => {
    const { triggerCard, defeatedCard } = context; // Fenrir is triggerCard
    const gameEvents: BaseGameEvent[] = [];

    if (
      defeatedCard &&
      triggerCard.owner &&
      defeatedCard.owner !== triggerCard.owner
    ) {
      // Change owner
      defeatedCard.owner = triggerCard.owner;

      // Conceptually, remove "defeated" status.
      // The actual mechanism for this (e.g., changing a status field on defeatedCard,
      // or the game engine handling this upon processing CARD_FLIPPED for a card
      // that was in a 'defeated' zone) depends on broader game logic.
      // For now, we'll assume the CARD_FLIPPED event is the primary signal.
      // If defeatedCard had a status property, it would be reset here, e.g.:
      // if (defeatedCard.hasOwnProperty('status')) {
      //   defeatedCard.status = 'active'; // or whatever the normal status is
      // }

      gameEvents.push({
        type: EVENT_TYPES.CARD_FLIPPED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        sourcePlayerId: triggerCard.owner, // Fenrir's owner
        cardId: defeatedCard.user_card_instance_id, // The card that was converted
        reason: "Bloodlust", // Custom property for context
      });
    }

    return gameEvents;
  },
  "Soul Lock": (context) => {
    const { triggerCard, defeatedCard } = context; // Hel is triggerCard
    const gameEvents: BaseGameEvent[] = [];

    if (
      defeatedCard &&
      triggerCard.owner &&
      defeatedCard.owner !== triggerCard.owner
    ) {
      // Change owner
      defeatedCard.owner = triggerCard.owner;

      // Conceptually, remove "defeated" status.
      // The game engine would handle restoring the card to an active state
      // based on the CARD_FLIPPED event and its new ownership.
      // e.g., if (defeatedCard.hasOwnProperty('status')) {
      //   defeatedCard.status = 'active';
      // }

      gameEvents.push({
        type: EVENT_TYPES.CARD_FLIPPED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        sourcePlayerId: triggerCard.owner, // Hel's owner
        cardId: defeatedCard.user_card_instance_id, // The card that was converted
        reason: "Soul Lock", // Custom property for context
      });
    }

    return gameEvents;
  },
  "Icy Grasp": (context) => {
    const { triggerCard, board } = context;

    if (triggerCard.position) { // Ensure Ice Wraith has a position
      const strongestEnemy = getStrongestAdjacentEnemy(
        triggerCard.position,
        board,
        triggerCard.owner // Ice Wraith's owner, to identify enemies
      );

      if (strongestEnemy) {
        // TODO: This debuff should ideally be temporary (e.g., for the current combat or turn).
        // The current `debuff` function applies a permanent debuff.
        // A system for temporary status effects would be needed for true "for combat" effects.
        debuff(strongestEnemy, 2);
      }
    }

    return []; // No game events returned for this direct debuff as per subtask
  },
  "Storm Strike": (context) => {
    const { triggerCard, board } = context;

    if (triggerCard.position) {
      const strongestEnemy = getStrongestAdjacentEnemy(
        triggerCard.position,
        board,
        triggerCard.owner
      );

      if (strongestEnemy) {
        // Using applyTemporaryBuff with a negative value as a stand-in for a temporary debuff.
        // Ideally, a dedicated applyTemporaryDebuff function would exist.
        // Also, note that applyTemporaryBuff itself is currently a stub.
        applyTemporaryBuff(strongestEnemy, -2, 1); // Reduce all stats by 2 for 1 turn
      }
    }
    return [];
  },
  "Flame Touch": (context) => {
    const { triggerCard, board } = context;

    if (triggerCard.position) {
      const strongestEnemy = getStrongestAdjacentEnemy(
        triggerCard.position,
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
    const { triggerCard, board } = context;

    if (triggerCard.position) {
      const strongestEnemy = getStrongestAdjacentEnemy(
        triggerCard.position,
        board,
        triggerCard.owner
      );

      if (strongestEnemy) {
        // Using applyTemporaryBuff with a negative value as a stand-in for a temporary debuff.
        // Ideally, a dedicated applyTemporaryDebuff function would exist.
        // Also, note that applyTemporaryBuff itself is currently a stub.
        applyTemporaryBuff(strongestEnemy, -2, 1); // Reduce all stats by 2 for 1 turn
      }
    }
    return [];
  },
  "Mjölnir Shock": (context) => { // Note: Same name as "Storm Strike" but for Mjölnir card
    const { triggerCard, board } = context;

    if (triggerCard.position) {
      const strongestEnemy = getStrongestAdjacentEnemy(
        triggerCard.position,
        board,
        triggerCard.owner
      );

      if (strongestEnemy) {
        // Using applyTemporaryBuff with a negative value as a stand-in for a temporary debuff.
        // Ideally, a dedicated applyTemporaryDebuff function would exist.
        // Also, note that applyTemporaryBuff itself is currently a stub.
        applyTemporaryBuff(strongestEnemy, -2, 1); // Reduce all stats by 2 for 1 turn
      }
    }
    return [];
  },
  "Flames of Muspelheim": (context) => {
    const { triggerCard, board } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!triggerCard.position) {
      return []; // Should not happen if card is on board
    }

    const strongestEnemy = getStrongestAdjacentEnemy(
      triggerCard.position,
      board,
      triggerCard.owner
    );

    const allAdjacentEnemies = getEnemiesAdjacentTo(
      triggerCard.position,
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
      });
    }

    for (const enemy of allAdjacentEnemies) {
      if (strongestEnemy && enemy.user_card_instance_id === strongestEnemy.user_card_instance_id) {
        // This enemy is already being removed, don't also debuff it.
        continue;
      }
      debuff(enemy, 1); // Debuff all other adjacent enemies by 1
    }

    return gameEvents;
  },
};
