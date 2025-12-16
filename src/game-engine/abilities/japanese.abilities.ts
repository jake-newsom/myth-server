import { PowerValues, TileStatus } from "../../types";
import { AbilityMap, CombatResolverMap } from "../../types/game-engine.types";
import { simulationContext } from "../simulation.context";
import {
  addTempBuff,
  buff,
  debuff,
  getAdjacentCards,
  getAlliesAdjacentTo,
  isEdge,
  getCardsByCondition,
  getEnemiesAdjacentTo,
  getAdjacentPositions,
  getTileAtPosition,
  setTileStatus,
  addTempDebuff,
  getCardTotalPower,
  getCardsInSameRow,
  getCardsInSameColumn,
  removeTemporaryBuffs,
  getOpponentId,
  getDiagonallyAdjacentCards,
  getRandomCard,
  destroyCardAtPosition,
  createOrUpdateBuff,
  removeBuffsByCondition,
  createOrUpdateDebuff,
} from "../ability.utils";
import { BaseGameEvent } from "../game-events";
import { flipCard } from "../game.utils";
import { getPositionOfCardById } from "../ability.utils";

/**
 * All japanese cards:
 * - If a Japanese card remains unflipped for 2 turns it gains +2 power
 * - If a Japanese card is not adjacent to any enemies when place it cannot be defeated next turn
 * - If a Japanese card is defeated, all adjacent tiles are cursed for 1 turn
 */

export const japaneseCombatResolvers: CombatResolverMap = {};

export const japaneseAbilities: AbilityMap = {
  // Moon's Balance: Each round drain the strongest enemy for -1 and grant +1 to the weakest ally
  "Moon's Balance": (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    const enemies = getCardsByCondition(
      state.board,
      (card) => card.owner !== triggerCard.owner
    );
    if (enemies.length === 0) return [];

    const strongestEnemy = enemies.reduce((strongest, current) => {
      return getCardTotalPower(current) > getCardTotalPower(strongest)
        ? current
        : strongest;
    });

    if (strongestEnemy) {
      gameEvents.push(debuff(strongestEnemy, -1));
    }

    const allies = getCardsByCondition(
      state.board,
      (card) => card.owner === triggerCard.owner
    );
    const weakestAlly = allies.reduce((weakest, current) => {
      return getCardTotalPower(current) < getCardTotalPower(weakest)
        ? current
        : weakest;
    });

    if (weakestAlly) {
      gameEvents.push(addTempBuff(weakestAlly, 1000, 1));
    }

    return gameEvents;
  },

  // Frost Row: Enemies in the same row lose 1 power this turn.
  "Frost Row": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const enemiesInRow = getCardsInSameRow(position, board, triggerCard.owner);

    for (const enemy of enemiesInRow) {
      gameEvents.push(addTempDebuff(enemy, 3, -1));
    }

    return gameEvents;
  },

  // Web Curse: Adjacent tiles are cursed for 1 turn; new enemies have 0 power on the next turn.
  "Web Curse": (context) => {
    const { position, state, triggerCard } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const adjacentPositions = getAdjacentPositions(
      position,
      state.board.length
    );
    for (const pos of adjacentPositions) {
      const tile = getTileAtPosition(pos, state.board);
      if (tile) {
        gameEvents.push(
          setTileStatus(
            tile,
            pos,
            {
              status: TileStatus.Cursed,
              turns_left: 5,
              animation_label: "web-curse",
              power: { top: -2, bottom: -2, left: -2, right: -2 },
              effect_duration: 3,
              applies_to_user: getOpponentId(triggerCard.owner, state),
            },
            triggerCard.owner
          )
        );
      }
    }

    return gameEvents;
  },

  // Slipstream: Each round steals a blessing from a random enemy
  Slipstream: (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;

    const gameEvents: BaseGameEvent[] = [];

    const enemies = getCardsByCondition(
      board,
      (card) => card.owner !== triggerCard.owner
    ).filter((card) => {
      card.temporary_effects.length > 0 &&
        card.temporary_effects.some((effect) => {
          const totalPower = Object.values(effect.power).reduce(
            (sum, val) => sum + val,
            0
          );
          return totalPower > 0;
        });
    });
    if (enemies.length === 0) return [];

    const randomEnemy = enemies[Math.floor(Math.random() * enemies.length)];
    if (randomEnemy) {
      //select a random buff from the enemy
      const buffs = randomEnemy.temporary_effects.filter((effect) => {
        const totalPower = Object.values(effect.power).reduce(
          (sum, val) => sum + val,
          0
        );
        return totalPower > 0;
      });
      const randomBuff = buffs[Math.floor(Math.random() * buffs.length)];
      //remove the buff from the enemy
      gameEvents.push(
        removeBuffsByCondition(
          randomEnemy,
          (effect) => effect.name === randomBuff.name
        )
      );
      // add the buff to trigger card
      gameEvents.push(
        createOrUpdateBuff(
          triggerCard,
          1000,
          randomBuff.power,
          randomBuff.name ?? "Slipstream",
          randomBuff.data
        )
      );
    }

    return gameEvents;
  },

  // Hunter's Mark: When an ally is defeted, grant -1 to the attacker
  "Hunter's Mark": (context) => {
    const { flippedCard, triggerCard } = context;

    if (flippedCard && flippedCard.owner !== triggerCard.owner) {
      return [addTempDebuff(flippedCard, 1000, -1, { name: "Hunter's Mark" })];
    }

    return [];
  },

  // Vengeful Bite: -1 to all adjacent enemies at the end of each round
  "Vengeful Bite": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const position = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      board
    );
    if (!position) return [];

    const adjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );

    for (const enemy of adjacentEnemies) {
      gameEvents.push(createOrUpdateDebuff(enemy, 1000, 1, "Vengeful Bite"));
    }

    return gameEvents;
  },

  // Shore Fury: Gains +2 power if placed on an edge.
  "Shore Fury": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;

    if (!position) return [];

    if (isEdge(position, board.length)) {
      return [buff(triggerCard, 2)];
    }

    return [];
  },

  // Echo Power: Matches the highest adjacent card's power this turn.
  "Echo Power": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;

    if (!position) return [];

    const adjacentCards = getAdjacentCards(position, board);
    if (adjacentCards.length === 0) return [];

    const myPowers = triggerCard.current_power;
    const buffs: PowerValues = {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    };

    for (const key of Object.keys(myPowers) as Array<keyof PowerValues>) {
      for (const card of adjacentCards) {
        const cardPowers = card.current_power;
        if (cardPowers[key] > myPowers[key]) {
          const powerDifference = cardPowers[key] - myPowers[key];
          if (powerDifference > buffs[key]) {
            buffs[key] = powerDifference;
          }
        }
      }
    }

    if (Object.values(buffs).some((value) => value > 0)) {
      return [addTempBuff(triggerCard, 3, buffs)];
    }

    return [];
  },

  // Erase Face: Remove all buffs from adjacent enemies.
  "Erase Face": (context) => {
    const {
      position,
      triggerCard,
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
      gameEvents.push(removeTemporaryBuffs(enemy));
    }

    return gameEvents;
  },

  // Allies Rally: Adjacent allies gain +1 power this turn.
  "Allies Rally": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

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

  // Benkei
  // Steadfast Guard: Gain +1 for each adjacent enemy
  // OLD: adjacent allies gain +1 power if attacked but not defeated.
  "Steadfast Guard": (context) => {
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

    return [addTempBuff(triggerCard, 1000, adjacentEnemies.length)];

    // const benkeiPosition = getPositionOfCardById(
    //   triggerCard.user_card_instance_id,
    //   board
    // );
    // if (!benkeiPosition) return [];

    // const allies = getAlliesAdjacentTo(
    //   benkeiPosition,
    //   board,
    //   triggerCard.owner
    // );
    // const allieIds = allies.map((ally) => ally.user_card_instance_id);

    // if (flippedCard && allieIds.includes(flippedCard.user_card_instance_id)) {
    //   gameEvents.push(addTempBuff(flippedCard, 1000, 1));
    // }
  },

  // Demon Bane: Gains +1 power when any demon is defeated
  "Demon Bane": (context) => {
    const { triggerCard, flippedCard } = context;

    if (flippedCard?.base_card_data.tags?.includes("demon")) {
      return [createOrUpdateBuff(triggerCard, 1000, 1, "Demon Bane")];
    }
    return [];
  },

  // When played, gain +1 for each adjacent card stronger than himself
  "Beast Friend": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const adjacentCards = getAdjacentCards(position, board);

    const buffAmount = adjacentCards.filter(
      (enemy) => getCardTotalPower(enemy) > getCardTotalPower(triggerCard)
    ).length;
    gameEvents.push(
      createOrUpdateBuff(triggerCard, 1000, buffAmount, "Beast Friend")
    );

    return gameEvents;
  },

  // Time Shift: Remove all temporary buffs from a random enemy in the same column.
  "Time Shift": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;

    if (!position) return [];

    const enemiesInColumn = getCardsInSameColumn(
      position,
      board,
      triggerCard.owner
    ).filter((enemy) => {
      return enemy.temporary_effects.some((effect) => {
        return (
          (effect.power.top ?? 0) > 0 ||
          (effect.power.bottom ?? 0) > 0 ||
          (effect.power.left ?? 0) > 0 ||
          (effect.power.right ?? 0) > 0
        );
      });
    });

    if (enemiesInColumn.length > 0) {
      const randomEnemy =
        enemiesInColumn[Math.floor(Math.random() * enemiesInColumn.length)];
      return [removeTemporaryBuffs(randomEnemy)];
    }

    return [];
  },

  // Piercing Shot: Enemies in the same column permanently lose 1 power.
  "Piercing Shot": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const enemiesInColumn = getCardsInSameColumn(
      position,
      board,
      triggerCard.owner
    );

    for (const enemy of enemiesInColumn) {
      gameEvents.push(debuff(enemy, -1));
    }

    return gameEvents;
  },

  // Radiant Blessing: Grant +1 to a random ally when an ally is defeated
  "Radiant Blessing": (context) => {
    const { originalTriggerCard, triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (originalTriggerCard?.owner !== triggerCard.owner) {
      const randomAlly = getRandomCard(state.board, {
        ownerId: triggerCard.owner,
      });
      if (randomAlly) {
        gameEvents.push(addTempBuff(randomAlly, 1000, 1));
      }
    }

    return gameEvents;
  },

  // Storm Breaker: Destroy the strongest enemy BEAST or DRAGON, gain +2 after.
  "Storm Breaker": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;

    const gameEvents: BaseGameEvent[] = [];

    const enemyBeastsAndDragons = getCardsByCondition(
      board,
      (card) =>
        (card.base_card_data.tags?.includes("beast") ||
          card.base_card_data.tags?.includes("dragon")) &&
        card.owner !== triggerCard.owner
    );

    if (enemyBeastsAndDragons.length > 0) {
      const strongestEnemy = enemyBeastsAndDragons.reduce(
        (strongest, current) => {
          return getCardTotalPower(current) > getCardTotalPower(strongest)
            ? current
            : strongest;
        }
      );
      if (strongestEnemy) {
        const enemyPosition = getPositionOfCardById(
          strongestEnemy.user_card_instance_id,
          board
        );
        if (enemyPosition) {
          const destroyEvent = destroyCardAtPosition(
            enemyPosition,
            board,
            "destroy",
            triggerCard.owner
          );
          if (destroyEvent) {
            gameEvents.push(destroyEvent);
            gameEvents.push(addTempBuff(triggerCard, 1000, 2));
          }
        }
      }
    }

    return gameEvents;
  },

  // Warrior's Aura: Allies in the same row gain +1 every turn
  "Warrior's Aura": (context) => {
    const { position, triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const alliesInRow = getCardsInSameRow(
      position,
      state.board,
      getOpponentId(triggerCard.owner, state)
    );

    for (const ally of alliesInRow) {
      const event = addTempBuff(ally, 1000, 1);
      if (event) gameEvents.push({ ...event, animation: "warrior-aura" });
    }

    return gameEvents;
  },

  // Many Heads: Gains +1 power for each adjacent enemy.
  // -1 power to enemies in the same row and column
  "Many Heads": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    if (!position) return [];

    const adjacentEnemiesInRow = getCardsInSameRow(
      position,
      board,
      triggerCard.owner
    );
    const adjacentEnemiesInColumn = getCardsInSameColumn(
      position,
      board,
      triggerCard.owner
    );

    const adjacentEnemies = [
      ...adjacentEnemiesInRow,
      ...adjacentEnemiesInColumn,
    ];
    for (const enemy of adjacentEnemies) {
      gameEvents.push(debuff(enemy, -1));
    }

    return gameEvents;
  },

  // Tidal Sweep: Defeats enemies diagonally if they have lower total power
  "Tidal Sweep": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const enemies = getDiagonallyAdjacentCards(position, board, {
      owner: "enemy",
      playerId: triggerCard.owner,
    });
    for (const enemy of enemies) {
      if (getCardTotalPower(enemy) < getCardTotalPower(triggerCard)) {
        const enemyPosition = getPositionOfCardById(
          enemy.user_card_instance_id,
          board
        );
        if (!enemyPosition) continue;

        gameEvents.push(
          ...flipCard(context.state, enemyPosition, enemy, triggerCard)
        );
      }
    }

    return gameEvents;
  },

  // Bone Chill: All adjacent enemies lose 1 power.
  "Bone Chill": (context) => {
    const {
      position,
      triggerCard,
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
      gameEvents.push(
        debuff(enemy, -2, "Bone Chill", {
          animation: "bone-chill",
          position: getPositionOfCardById(enemy.user_card_instance_id, board)!,
        })
      );
    }

    return gameEvents;
  },
};

/**
  ## DEFEAT STRONGEST ENEMY IN THE SAME ROW 
    const {
      position,
      triggerCard,
      state: { board },
    } = context;

    if (!position) return [];

    const enemiesInRow = getCardsInSameRow(position, board, triggerCard.owner);

    if (enemiesInRow.length > 0) {
      const strongestEnemy = enemiesInRow.reduce((strongest, current) => {
        return getCardTotalPower(current) > getCardTotalPower(strongest)
          ? current
          : strongest;
      });

      // Find the position of the strongest enemy to flip it
      for (let x = 0; x < board.length; x++) {
        const cell = board[position.y][x];
        if (
          cell?.card?.user_card_instance_id ===
          strongestEnemy.user_card_instance_id
        ) {
          return flipCard(
            context.state,
            { x, y: position.y },
            strongestEnemy,
            triggerCard
          );
        }
      }
    }
  
 */
