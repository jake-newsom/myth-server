import {
  EffectType,
  TemporaryEffect,
  TriggerMoment,
} from "../../types/card.types";
import {
  AbilityMap,
  CardEvent,
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
  getAlliesAdjacentTo,
  getCardsByCondition,
  getEnemiesAdjacentTo,
  setTileStatus,
  addTempDebuff,
  getCardsInSameRow,
  getEmptyAdjacentTiles,
  cleanseDebuffs,
  getAllAlliesOnBoard,
  pushCardAway,
  disableAbilities,
  addTileBlessing,
  protectFromDefeat,
  getPositionOfCardById,
  getOpponentId,
  cardAtPosition,
  getCardTotalPower,
  createOrUpdateBuff,
  removeBuffsByCondition,
  getTileAtPosition,
  getRandomEmptyTile,
  createOrUpdateDebuff,
  getRandomSide,
  chooseRandomCard,
  moveCardToPosition,
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

    if (!flippedCard) return true;

    const enemyTotalPower = getCardTotalPower(triggerCard);
    const myTotalPower = getCardTotalPower(flippedCard);

    if (enemyTotalPower > myTotalPower) return true;

    return false;
  },

  // Harbor Guardian: Sacrifices 3 power to protect allies from defeat
  "Harbor Guardian": (context) => {
    const { triggerCard, flippedCard, flippedBy } = context;

    // Only protect allies, not self
    if (
      !flippedCard ||
      !flippedBy ||
      flippedCard.user_card_instance_id === triggerCard.user_card_instance_id ||
      flippedCard.owner !== triggerCard.owner
    ) {
      return false;
    }

    // Check if Harbor Guardian has enough power to sacrifice (at least 3 power on all sides)
    if (
      triggerCard.current_power.top < 3 ||
      triggerCard.current_power.bottom < 3 ||
      triggerCard.current_power.left < 3 ||
      triggerCard.current_power.right < 3
    ) {
      return false;
    }

    // Calculate power needed to save the ally
    const attackingPower = getCardTotalPower(flippedBy);
    const defendingPower = getCardTotalPower(flippedCard);

    if (attackingPower > defendingPower) {
      return {
        preventDefeat: true,
        events: [
          createOrUpdateDebuff(triggerCard, 1000, 3, "Harbor Protection", {
            animation: "harbor-protection",
          }),
        ],
      };
    }

    return false;
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

    return [createOrUpdateBuff(triggerCard, 1000, 1, "Lava Field")];
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
      return [cleanseDebuffs(randomAlly, 1000)];
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
      gameEvents.push(cleanseDebuffs(ally, 1000));
    }

    return gameEvents;
  },

  // Tide Ward: While in hand, grant +1 to each card you play. When played, steal his blessings back.
  "Tide Ward": (context) => {
    const {
      triggerCard,
      triggerMoment,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (
      triggerMoment === TriggerMoment.HandOnPlace &&
      context.originalTriggerCard!.owner === triggerCard.owner &&
      context.originalTriggerCard!.user_card_instance_id !==
        triggerCard.user_card_instance_id
    ) {
      gameEvents.push(
        createOrUpdateBuff(context.originalTriggerCard!, 1000, 1, "Tide Ward", {
          animation: "tide-ward",
          sourceCardId: triggerCard.user_card_instance_id,
        })
      );
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
      if (tideWardCards.length > 0) {
        gameEvents.push(
          addTempBuff(triggerCard, 1000, tideWardCards.length, "Tide Ward", {
            animation: "tide-ward",
          })
        );
      }

      //remove tideward buff from cards
      for (const card of tideWardCards) {
        gameEvents.push(
          removeBuffsByCondition(
            card,
            (effect: TemporaryEffect) => effect.name === "Tide Ward"
          )
        );
      }
    }

    return gameEvents;
  },

  // War Stance: Gain +1 whenever an ally is defeated up to 5. At max, attack adjacent enemies again.
  "War Stance": (context) => {
    const { triggerCard, originalTriggerCard, position, state } = context;
    const label = "War Stance";
    const gameEvents: BaseGameEvent[] = [];

    if (originalTriggerCard?.owner !== triggerCard.owner) {
      gameEvents.push(createOrUpdateBuff(triggerCard, 1000, 1, label));
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

  // Fertile Ground: Each round grant +1 to allies with blessings.
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

      if (
        hasBlessing &&
        !ally.temporary_effects.some(
          (effect) => effect.name === "Fertile Ground"
        )
      ) {
        gameEvents.push(createOrUpdateBuff(ally, 1000, 1, "Fertile Ground"));
      }
    }

    return gameEvents;
  },

  // Sun Trick: Gain +1 every round in hand, resets after combat
  "Sun Trick": (context) => {
    const { triggerCard } = context;
    const label = "Sun Trick";

    console.log("Sun Trick", context.triggerMoment);

    const gameEvents: BaseGameEvent[] = [];

    if (context.triggerMoment === TriggerMoment.HandOnRoundEnd) {
      gameEvents.push(createOrUpdateBuff(triggerCard, 1000, 1, label));
      // triggerCard.current_power = updateCurrentPower(triggerCard);
    } else if (context.triggerMoment === TriggerMoment.AfterCombat) {
      //after combat, remove the buff
      triggerCard.temporary_effects = triggerCard.temporary_effects.filter(
        (effect) => effect.name !== label
      );
      // Update the card's current power after removing temporary effects
      triggerCard.current_power = updateCurrentPower(triggerCard);
      gameEvents.push({
        type: EVENT_TYPES.CARD_POWER_CHANGED,
        animation: "buff-removed",
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: triggerCard.user_card_instance_id,
      } as CardEvent);
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
        setTileStatus(randomTile.tile, randomTile.position, {
          status: TileStatus.Cursed,
          turns_left: 1000,
          terrain: TileTerrain.Lava,
          animation_label: "lava",
          effect_duration: 1000,
          applies_to_user: getOpponentId(triggerCard.owner, state), // Only affect enemy cards
          power: { top: -1, bottom: -1, left: -1, right: -1 },
        }, triggerCard.owner)
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

  // Sacred Spring: If in water, bless a random ally and cleanse adjacent allies of 1 curse at the start of each round
  "Sacred Spring": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    if (
      getTileAtPosition(position, board)?.tile_effect?.terrain !==
      TileTerrain.Ocean
    ) {
      return [];
    }

    // Cleanse adjacent allies (this should trigger each turn)
    getAlliesAdjacentTo(position, board, triggerCard.owner).map((ally) =>
      gameEvents.push(cleanseDebuffs(ally, 1))
    );

    // Bless a random ally
    const randomAlly = chooseRandomCard(
      getAllAlliesOnBoard(board, triggerCard.owner)
    );
    gameEvents.push(createOrUpdateBuff(randomAlly, 1000, 1, "Sacred Spring"));

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
      gameEvents.push(debuff(enemy, -1));
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

    // TODO: Need to implement "placed after" tracking system
    // This requires tracking card placement order and applying effects to future placements

    return gameEvents;
  },

  // Spirit Bind: Any card that flips Milu loses 1 power permanently.
  "Spirit Bind": (context) => {
    const { flippedBy } = context;

    if (flippedBy) {
      return [debuff(flippedBy, -1)];
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
        setTileStatus(getTileAtPosition(position, state.board)!, position, {
          status: TileStatus.Cursed,
          turns_left: 1000,
          animation_label: "cursed",
          power: { top: -1, bottom: -1, left: -1, right: -1 },
          effect_duration: 1000,
          applies_to_user: getOpponentId(triggerCard.owner, state),
        }, triggerCard.owner)
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
        setTileStatus(tile, tilePos, {
          status: TileStatus.Cursed,
          turns_left: 3,
          animation_label: "cursed",
          power: { top: -1, bottom: -1, left: -1, right: -1 },
          effect_duration: 1000,
          applies_to_user: getOpponentId(triggerCard.owner, state),
        }, triggerCard.owner)
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

    const sides = ["top", "bottom", "left", "right"] as const;
    const randomSide = sides[Math.floor(Math.random() * sides.length)];

    const event = addTempDebuff(
      randomEnemy,
      1000,
      { [randomSide]: -1 },
      {
        animation: "lightning",
        ...(enemyPosition && { position: enemyPosition }),
      }
    );

    return [event];
  },

  // Dual Aspect: Grant -1 on one side of a random enemy for each water tile on the board
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
      const randomSide = getRandomSide();
      gameEvents.push(addTempDebuff(randomEnemy, 1000, { [randomSide]: -1 }));
    }
    return gameEvents;
  },
};
