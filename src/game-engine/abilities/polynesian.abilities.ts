import { TemporaryEffect, TriggerMoment } from "../../types/card.types";
import {
  AbilityMap,
  CardPowerChangedEvent,
  CombatResolverMap,
  EVENT_TYPES,
} from "../../types/game-engine.types";
import {
  BoardPosition,
  GameBoard,
  TileStatus,
  TileTerrain,
} from "../../types/game.types";
import {
  addTempBuff,
  updateCurrentPower,
  debuff,
  getCardsByCondition,
  getEnemiesAdjacentTo,
  setTileStatus,
  addTempDebuff,
  getEmptyAdjacentTiles,
  cleanseDebuffs,
  getAllAlliesOnBoard,
  pushCardAway,
  getPositionOfCardById,
  getOpponentId,
  getCardTotalPower,
  createOrUpdateBuff,
  removeBuffsByCondition,
  getTileAtPosition,
  getRandomEmptyTile,
  createOrUpdateDebuff,
  getRandomSide,
  chooseRandomCard,
  moveCardToPosition,
  isSameCard,
} from "../ability.utils";
import { BaseGameEvent } from "../game-events";
import { resolveCombat } from "../game.utils";

import { v4 as uuidv4 } from "uuid";

const fillRandomEmptyTileWithWater = (
  position: BoardPosition,
  board: GameBoard,
  ownerId: string
) => {
  const emptyAdjacentTiles = getEmptyAdjacentTiles(position, board);
  if (emptyAdjacentTiles.length > 0) {
    const { position: tilePos, tile } = emptyAdjacentTiles[0];
    return setTileStatus(tile, tilePos, {
      status: TileStatus.Normal,
      turns_left: 1000,
      animation_label: "water",
      terrain: TileTerrain.Ocean,
      effect_duration: 1000,
      applies_to_user: ownerId,
      power: { top: 1, bottom: 1, left: 1, right: 1 },
    });
  }
};

export const polynesianCombatResolvers: CombatResolverMap = {
  // Ocean's Shield: Cannot be defeated by enemies with lower total power.
  "Ocean's Shield": (context) => {
    const { triggerCard, flippedCard } = context;

    if (!flippedCard || !isSameCard(triggerCard, flippedCard))
      return { preventDefeat: false };

    const enemyTotalPower = getCardTotalPower(triggerCard);
    const myTotalPower = getCardTotalPower(flippedCard);

    if (enemyTotalPower > myTotalPower) return { preventDefeat: false };

    return { preventDefeat: true };
  },

  // Harbor Guardian: Sacrifices 3 power to protect allies from defeat
  "Harbor Guardian": (context) => {
    const { triggerCard, flippedCard, flippedBy, position } = context;

    // Only protect allies, not self
    if (
      !flippedCard ||
      !flippedBy ||
      flippedCard.user_card_instance_id === triggerCard.user_card_instance_id ||
      flippedCard.owner !== triggerCard.owner
    ) {
      return { preventDefeat: false };
    }

    // Check if Harbor Guardian has enough power to sacrifice (at least 3 power on all sides)
    if (
      triggerCard.current_power.top < 3 ||
      triggerCard.current_power.bottom < 3 ||
      triggerCard.current_power.left < 3 ||
      triggerCard.current_power.right < 3
    ) {
      return { preventDefeat: false };
    }

    // Calculate power needed to save the ally
    const attackingPower = getCardTotalPower(flippedBy);
    const defendingPower = getCardTotalPower(flippedCard);

    if (attackingPower > defendingPower) {
      return {
        preventDefeat: true,
        events: [
          createOrUpdateDebuff(triggerCard, 1000, 3, "Harbor Protection", position, {
            animation: "harbor-protection",
          }),
        ],
      };
    }

    return { preventDefeat: false };
  },
};

export const polynesianAbilities: AbilityMap = {
  // Lava Field: Gains +1 for every card played on a lava tile.
  "Lava Field": (context) => {
    const { position, triggerCard, state } = context;

    if (!position) return [];

    // Check if this is triggered by a card being placed
    const placedCard = context.originalTriggerCard || triggerCard;

    // Check if the placed card has a lava tile effect (transferred from the tile)
    const hasLavaEffect = placedCard.temporary_effects.some(
      (effect) =>
        effect.name === "lava" ||
        effect.data?.terrain === TileTerrain.Lava ||
        effect.data?.originalTileEffect === "lava"
    );
    // Also check if the tile still has a lava effect (fallback)
    const isOnLavaTile =
      getTileAtPosition(position, state.board)?.tile_effect?.terrain ===
      TileTerrain.Lava;

    if (!hasLavaEffect && !isOnLavaTile) return [];

    return [createOrUpdateBuff(triggerCard, 1000, 1, "Lava Field", position)];
  },

  // Cleansing Hula: At the start of each round, cleanse a random ally of all curses
  "Cleansing Hula": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;

    const randomAlly = chooseRandomCard(
      getAllAlliesOnBoard(board, triggerCard.owner)
    );

    if (randomAlly) {
      const allyPosition = getPositionOfCardById(randomAlly.user_card_instance_id, board);
      if (allyPosition) {
        return [cleanseDebuffs(randomAlly, 1000, allyPosition, "nature-swirl")];
      }
    }
    return [];
  },

  // Pure Waters: Fill an empty tile with water. Cleanse all allies when played.
  "Pure Waters": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    // Fill one empty adjacent tile with water
    const waterTileEvent = fillRandomEmptyTileWithWater(
      position,
      board,
      triggerCard.owner
    );
    if (waterTileEvent) gameEvents.push(waterTileEvent);

    const allAllies = getAllAlliesOnBoard(board, triggerCard.owner);
    for (const ally of allAllies) {
      const allyPosition = getPositionOfCardById(ally.user_card_instance_id, board);
      if (allyPosition) {
        gameEvents.push(cleanseDebuffs(ally, 1000, allyPosition, "rain"));
      }
    }

    return gameEvents;
  },

  // Tide Ward: While in hand, grant +1 to each card you play. When played, steal his blessings back.
  "Tide Ward": (context) => {
    const {
      triggerCard,
      triggerMoment,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (
      triggerMoment === TriggerMoment.HandOnPlace &&
      context.originalTriggerCard!.owner === triggerCard.owner &&
      context.originalTriggerCard!.user_card_instance_id !==
        triggerCard.user_card_instance_id
    ) {
      const originalCardPosition = getPositionOfCardById(
        context.originalTriggerCard!.user_card_instance_id,
        board
      );
      if (originalCardPosition) {
        gameEvents.push(
          createOrUpdateBuff(context.originalTriggerCard!, 1000, 1, "Tide Ward", originalCardPosition, {
            animation: "tide-ward",
            sourceCardId: triggerCard.user_card_instance_id,
          })
        );
      }
    } else if (triggerMoment === TriggerMoment.OnPlace) {
      //get cards with tideward buff
      const tideWardCards = getCardsByCondition(board, (card) =>
        card.temporary_effects.some(
          (effect) =>
            effect.name === "Tide Ward" &&
            effect.data?.sourceCardId === triggerCard.user_card_instance_id
        )
      );
      console.log("Tide Ward cards", tideWardCards);

      //buff kanaloa
      if (tideWardCards.length > 0 && position) {
        gameEvents.push(
          addTempBuff(triggerCard, 1000, tideWardCards.length, {
            name: "Tide Ward",
            animation: "bubble-swirl",
            position,
          })
        );
      }

      //remove tideward buff from cards
      for (const card of tideWardCards) {
        const cardPosition = getPositionOfCardById(card.user_card_instance_id, board);
        if (cardPosition) {
          gameEvents.push(
            removeBuffsByCondition(
              card,
              (effect: TemporaryEffect) => effect.name === "Tide Ward",
              cardPosition
            )
          );
        }
      }
    }

    return gameEvents;
  },

  // War Stance: Gain +1 whenever an ally is defeated up to 5. At max, attack adjacent enemies again.
  "War Stance": (context) => {
    const { triggerCard, originalTriggerCard, state, position } = context;
    const label = "War Stance";
    const gameEvents: BaseGameEvent[] = [];

    if (originalTriggerCard?.owner !== triggerCard.owner && position) {
      gameEvents.push(createOrUpdateBuff(triggerCard, 1000, 1, label, position));
    }

    //check buff for max value
    if (
      triggerCard.temporary_effects.find((effect) => effect.name === label)
        ?.power.top === 5
    ) {
      //resolve combat?
      const combatResult = resolveCombat(
        state,
        getPositionOfCardById(triggerCard.user_card_instance_id, state.board)!,
        triggerCard.owner
      );
      gameEvents.push(...combatResult.events);
    }

    return gameEvents;
  },

  // Fertile Ground: Each round grant +1 for one turn to allies with existing blessings
  "Fertile Ground": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const allAllies = getAllAlliesOnBoard(board, triggerCard.owner);
    for (const ally of allAllies) {
      const hasBlessing = ally.temporary_effects.some((effect) => {
        const totalPowerChange = Object.values(effect.power).reduce(
          (sum, val) => sum + (val || 0),
          0
        );
        return totalPowerChange > 0;
      });

      if (hasBlessing) {
        const allyPosition = getPositionOfCardById(ally.user_card_instance_id, board);
        if (allyPosition) {
          gameEvents.push(
            addTempBuff(ally, 3, 1, {
              name: "Fertile Ground",
              animation: "nature-swirl",
              position: allyPosition,
            })
          );
        }
      }
    }

    return gameEvents;
  },

  // Sun Trick: Gain +1 every round in hand, resets after combat
  "Sun Trick": (context) => {
    const { triggerCard, position, state } = context;
    const label = "Sun Trick";

    const gameEvents: BaseGameEvent[] = [];

    // Sentinel position for cards in hand
    const HAND_POSITION: BoardPosition = { x: -1, y: -1 };

    if (context.triggerMoment === TriggerMoment.HandOnRoundEnd) {
      gameEvents.push(createOrUpdateBuff(triggerCard, 1000, 1, label, HAND_POSITION));
      // triggerCard.current_power = updateCurrentPower(triggerCard);
    } else if (context.triggerMoment === TriggerMoment.AfterCombat) {
      // Calculate power being removed
      const sunTrickBuff = triggerCard.temporary_effects.find(
        (effect) => effect.name === label
      );
      const powerRemoved = sunTrickBuff
        ? (sunTrickBuff.power.top || 0) + (sunTrickBuff.power.bottom || 0) +
          (sunTrickBuff.power.left || 0) + (sunTrickBuff.power.right || 0)
        : 0;

      //after combat, remove the buff
      triggerCard.temporary_effects = triggerCard.temporary_effects.filter(
        (effect) => effect.name !== label
      );
      // Update the card's current power after removing temporary effects
      triggerCard.current_power = updateCurrentPower(triggerCard);
      gameEvents.push({
        type: EVENT_TYPES.CARD_POWER_CHANGED,
        animation: "explode-swirl",
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: triggerCard.user_card_instance_id,
        powerDelta: -powerRemoved,
        effectName: label,
        position,
      } as CardPowerChangedEvent);
    }

    return gameEvents;
  },

  // Wild Shift: Create lava in a random tile every round
  "Wild Shift": (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    const randomTile = getRandomEmptyTile(state.board);
    if (randomTile) {
      gameEvents.push(
        setTileStatus(
          randomTile.tile,
          randomTile.position,
          {
            status: TileStatus.Cursed,
            turns_left: 1000,
            terrain: TileTerrain.Lava,
            animation_label: "lava",
            effect_duration: 1000,
            applies_to_user: getOpponentId(triggerCard.owner, state), // Only affect enemy cards
            power: { top: -1, bottom: -1, left: -1, right: -1 },
          },
          triggerCard.owner
        )
      );
    }

    return gameEvents;
  },

  // Feast or Famine: When an ally is defeated, fill their tile with water.
  "Feast or Famine": (context) => {
    const {
      triggerCard,
      originalTriggerCard,
      state: { board },
    } = context;

    if (!originalTriggerCard) return [];

    if (originalTriggerCard.owner !== triggerCard.owner) {
      const position = getPositionOfCardById(
        originalTriggerCard.user_card_instance_id,
        board
      );
      return [
        setTileStatus(getTileAtPosition(position!, board)!, position!, {
          status: TileStatus.Normal,
          turns_left: 1000,
          animation_label: "water",
          terrain: TileTerrain.Ocean,
          effect_duration: 1000,
          applies_to_user: triggerCard.owner,
        }),
      ];
    }

    return [];
  },

  // Sacred Spring: If in water, grant +1 to a random card in your hand at the end of each round
  "Sacred Spring": (context) => {
    const {
      triggerCard,
      position,
      state: { board, player1, player2, hydrated_card_data_cache },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    if (
      getTileAtPosition(position, board)?.tile_effect?.terrain !==
      TileTerrain.Ocean
    ) {
      return [];
    }

    //get player's hand
    const player = triggerCard.owner === player1.user_id ? player1 : player2;

    if (player.hand.length > 0) {
      const randomIndex = Math.floor(Math.random() * player.hand.length);
      const randomCard = hydrated_card_data_cache?.[player.hand[randomIndex]];
      if (randomCard) {
        // Card is in hand, use sentinel position
        const HAND_POSITION: BoardPosition = { x: -1, y: -1 };
        gameEvents.push(
          addTempBuff(randomCard, 1000, 1, {
            name: "Sacred Spring",
            animation: "bubble-swirl-in",
            position: HAND_POSITION,
          })
        );
      }
    }
    return gameEvents;
  },

  // Icy Presence: Adjacent enemies lose 1 power.
  "Icy Presence": (context) => {
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
      triggerCard.owner
    );
    for (const enemy of adjacentEnemies) {
      const enemyPosition = getPositionOfCardById(enemy.user_card_instance_id, board);
      if (enemyPosition) {
        gameEvents.push(
          debuff(enemy, -1, {
            name: "Icy Presence",
            animation: "icicle",
            position: enemyPosition,
          })
        );
      }
    }

    return gameEvents;
  },

  // Gale Aura: Push adjacent enemies away 1 tile.
  "Gale Aura": (context) => {
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
      triggerCard.owner
    );
    for (const enemy of adjacentEnemies) {
      const pushEvents = pushCardAway(enemy, position, board);
      gameEvents.push(...pushEvents);
    }

    return gameEvents;
  },

  // Rain's Blessing: Fill an empty tile with water. Allies placed after her gain +1 to a random side.
  "Rain's Blessing": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
      triggerMoment,
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (triggerMoment === TriggerMoment.OnPlace) {
      if (!position) return [];

      // Fill one empty adjacent tile with water
      const waterTileEvent = fillRandomEmptyTileWithWater(
        position,
        board,
        triggerCard.owner
      );
      if (waterTileEvent) gameEvents.push(waterTileEvent);
    } else if (triggerMoment === TriggerMoment.AnyOnPlace) {
      const { originalTriggerCard } = context;
      if (originalTriggerCard?.owner === triggerCard.owner) {
        const cardPosition = getPositionOfCardById(
          originalTriggerCard.user_card_instance_id,
          board
        );
        if (cardPosition) {
          const randomSide = getRandomSide();
          gameEvents.push(
            addTempBuff(
              originalTriggerCard,
              1000,
              { [randomSide]: 1 },
              {
                name: "Rain's Blessing",
                animation: "bubbles-centered",
                position: cardPosition,
              }
            )
          );
        }
      }
    }

    return gameEvents;
  },

  // Spirit Bind: Any card that flips Milu loses 2 power permanently.
  "Spirit Bind": (context) => {
    const { flippedBy, state: { board } } = context;

    if (flippedBy) {
      const flippedByPosition = getPositionOfCardById(flippedBy.user_card_instance_id, board);
      if (flippedByPosition) {
        return [
          debuff(flippedBy, -2, {
            name: "Spirit Bind",
            animation: "smoke-shrink",
            position: flippedByPosition,
          }),
        ];
      }
    }

    return [];
  },

  // Dread Aura: At the end of every round move to an adjacent empty tile and curse the previous tile.
  "Dread Aura": (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    const position = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      state.board
    );
    if (!position) return [];

    const adjacentEmptyTiles = getEmptyAdjacentTiles(position, state.board);
    if (adjacentEmptyTiles.length > 0) {
      //pick random adjacent empty tile
      const randomAdjacentEmptyTile =
        adjacentEmptyTiles[
          Math.floor(Math.random() * adjacentEmptyTiles.length)
        ];
      //move to random adjacent empty tile
      gameEvents.push(
        ...moveCardToPosition(
          triggerCard,
          randomAdjacentEmptyTile.position,
          position,
          state.board
        )
      );
      //curse previous tile
      gameEvents.push(
        setTileStatus(
          getTileAtPosition(position, state.board)!,
          position,
          {
            status: TileStatus.Cursed,
            turns_left: 1000,
            animation_label: "cursed",
            power: { top: -1, bottom: -1, left: -1, right: -1 },
            effect_duration: 1000,
            applies_to_user: getOpponentId(triggerCard.owner, state),
          },
          triggerCard.owner
        )
      );
    }

    return gameEvents;
  },

  // Hex Field: At end of your turn, curse all empty adjacent tiles for 1 turn.
  "Hex Field": (context) => {
    const { position, state, triggerCard } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const emptyAdjacentTiles = getEmptyAdjacentTiles(position, state.board);
    for (const { position: tilePos, tile } of emptyAdjacentTiles) {
      gameEvents.push(
        setTileStatus(
          tile,
          tilePos,
          {
            status: TileStatus.Cursed,
            turns_left: 3,
            animation_label: "cursed",
            power: { top: -3, bottom: -3, left: -3, right: -3 },
            effect_duration: 1000,
            applies_to_user: getOpponentId(triggerCard.owner, state),
          },
          triggerCard.owner
        )
      );
    }

    return gameEvents;
  },

  "Thunderous Omen": (context) => {
    const {
      triggerCard,
      state: { board, turn_number },
    } = context;

    if (turn_number % 2 === 0) return [];

    const allEnemies = getCardsByCondition(
      board,
      (card) => card.owner !== triggerCard.owner
    );
    if (allEnemies.length === 0) return [];

    const randomEnemy =
      allEnemies[Math.floor(Math.random() * allEnemies.length)];

    const enemyPosition = getPositionOfCardById(
      randomEnemy.user_card_instance_id,
      board
    );

    if (!enemyPosition) return [];

    const randomSide = getRandomSide();

    const event = addTempDebuff(
      randomEnemy,
      1000,
      { [randomSide]: -2 },
      {
        name: "Thunderous Omen",
        animation: "lightning",
        position: enemyPosition,
      }
    );

    return [event];
  },

  // Dual Aspect: Grant -1 to a random enemy for each water tile on the board
  "Dual Aspect": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const waterTiles = getCardsByCondition(board, (card) =>
      card.temporary_effects.some((effect) => effect.name === "water")
    );
    if (waterTiles.length === 0) return [];

    const enemies = getCardsByCondition(
      board,
      (card) => card.owner !== triggerCard.owner
    );
    if (enemies.length === 0) return [];

    for (let i = 0; i < waterTiles.length; i++) {
      const randomEnemy = chooseRandomCard(enemies);
      const enemyPosition = getPositionOfCardById(randomEnemy.user_card_instance_id, board);
      if (enemyPosition) {
        gameEvents.push(
          addTempDebuff(randomEnemy, 1000, -1, {
            name: "Dual Aspect",
            animation: "water-circles-few",
            position: enemyPosition,
          })
        );
      }
    }
    return gameEvents;
  },
};
