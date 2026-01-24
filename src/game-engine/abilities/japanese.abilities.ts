import { PowerValues, TileStatus } from "../../types";
import { AbilityMap, CombatResolverMap } from "../../types/game-engine.types";
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
      const enemyPosition = getPositionOfCardById(strongestEnemy.user_card_instance_id, state.board);
      if (enemyPosition) {
        gameEvents.push(debuff(strongestEnemy, -1, {
          name: "Moon's Balance",
          position: enemyPosition,
        }));
      }
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
      const allyPosition = getPositionOfCardById(weakestAlly.user_card_instance_id, state.board);
      if (allyPosition) {
        gameEvents.push(addTempBuff(weakestAlly, 1000, 1, {
          name: "Moon's Balance",
          position: allyPosition,
        }));
      }
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
      const enemyPosition = getPositionOfCardById(enemy.user_card_instance_id, board);
      if (enemyPosition) {
        gameEvents.push(addTempDebuff(enemy, 3, -1, {
          name: "Frost Row",
          animation: "snow-swirl",
          position: enemyPosition,
        }));
      }
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
      const enemyPosition = getPositionOfCardById(randomEnemy.user_card_instance_id, board);
      const triggerPosition = getPositionOfCardById(triggerCard.user_card_instance_id, board);
      
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
      if (enemyPosition) {
        gameEvents.push(
          removeBuffsByCondition(
            randomEnemy,
            (effect) => effect.name === randomBuff.name,
            enemyPosition,
            "smoke-shrink"
          )
        );
      }
      // add the buff to trigger card
      if (triggerPosition) {
        gameEvents.push(
          createOrUpdateBuff(
            triggerCard,
            1000,
            randomBuff.power,
            randomBuff.name ?? "Slipstream",
            triggerPosition,
            { ...randomBuff.data, animation: "smoke-shrink" }
          )
        );
      }
    }

    return gameEvents;
  },

  // Hunter's Mark: When an ally is defeted, grant -1 to the attacker
  "Hunter's Mark": (context) => {
    const { flippedCard, triggerCard, state: { board } } = context;

    if (flippedCard && flippedCard.owner !== triggerCard.owner) {
      const flippedPosition = getPositionOfCardById(flippedCard.user_card_instance_id, board);
      if (flippedPosition) {
        return [
          addTempDebuff(flippedCard, 1000, -1, {
            name: "Hunter's Mark",
            animation: "red-strike-grow",
            position: flippedPosition,
          }),
        ];
      }
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
      const enemyPosition = getPositionOfCardById(enemy.user_card_instance_id, board);
      if (enemyPosition) {
        gameEvents.push(
          createOrUpdateDebuff(enemy, 1000, 1, "Vengeful Bite", enemyPosition, {
            animation: "blue-purple-spurt",
          })
        );
      }
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
      return [buff(triggerCard, 2, {
        name: "Shore Fury",
        position,
      })];
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
      return [
        addTempBuff(triggerCard, 3, buffs, {
          name: "Echo Power",
          animation: "smoke-blue-flashes",
          position,
        }),
      ];
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
      const enemyPosition = getPositionOfCardById(enemy.user_card_instance_id, board);
      if (enemyPosition) {
        gameEvents.push(removeTemporaryBuffs(enemy, enemyPosition, "smoke-swirl"));
      }
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
      const allyPosition = getPositionOfCardById(ally.user_card_instance_id, board);
      if (allyPosition) {
        gameEvents.push(
          addTempBuff(ally, 3, 1, {
            name: "Allies Rally",
            animation: "purple-grow",
            position: allyPosition,
          })
        );
      }
    }

    return gameEvents;
  },

  // Benkei
  // Steadfast Guard: Gain +1 for each adjacent enemy
  "Steadfast Guard": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;

    if (!position) return [];

    const adjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );

    return [
      addTempBuff(
        triggerCard,
        1000,
        adjacentEnemies.length,
        {
          name: "Steadfast Guard",
          animation: "plasm-sphere",
          position,
        }
      ),
    ];
  },

  // Demon Bane: Gains +1 power when any demon is defeated
  "Demon Bane": (context) => {
    const { triggerCard, flippedCard, position, state: { board } } = context;

    if (flippedCard?.base_card_data.tags?.includes("demon")) {
      const triggerPosition = position || getPositionOfCardById(triggerCard.user_card_instance_id, board);
      if (triggerPosition) {
        return [
          createOrUpdateBuff(triggerCard, 1000, 1, "Demon Bane", triggerPosition, {
            animation: "red-lightning",
          }),
        ];
      }
    }
    return [];
  },

  // When played, gain +2 for each adjacent card stronger than himself
  "Beast Friend": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const adjacentCards = getAdjacentCards(position, board);

    const buffAmount =
      adjacentCards.filter(
        (enemy) => getCardTotalPower(enemy) > getCardTotalPower(triggerCard)
      ).length * 2;
    gameEvents.push(
      createOrUpdateBuff(triggerCard, 1000, buffAmount, "Beast Friend", position, {
        animation: "phoenix-right",
      })
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
      const enemyPosition = getPositionOfCardById(randomEnemy.user_card_instance_id, board);
      if (enemyPosition) {
        return [removeTemporaryBuffs(randomEnemy, enemyPosition, "lightning-explode-small")];
      }
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
      const enemyPosition = getPositionOfCardById(enemy.user_card_instance_id, board);
      if (enemyPosition) {
        gameEvents.push(
          debuff(enemy, -1, {
            name: "Piercing Shot",
            animation: "flame-drop-3",
            position: enemyPosition,
          })
        );
      }
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
        const allyPosition = getPositionOfCardById(randomAlly.user_card_instance_id, state.board);
        if (allyPosition) {
          gameEvents.push(
            addTempBuff(randomAlly, 1000, 1, {
              name: "Radiant Blessing",
              animation: "light-cross-spin",
              position: allyPosition,
            })
          );
        }
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
            "blast-up",
            triggerCard.owner
          );
          if (destroyEvent) {
            const triggerPosition = getPositionOfCardById(triggerCard.user_card_instance_id, board);
            gameEvents.push(destroyEvent);
            if (triggerPosition) {
              gameEvents.push(
                addTempBuff(triggerCard, 1000, 2, {
                  name: "Storm Breaker",
                  animation: "lightning-cloud",
                  position: triggerPosition,
                })
              );
            }
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
      const allyPosition = getPositionOfCardById(ally.user_card_instance_id, state.board);
      if (allyPosition) {
        const event = addTempBuff(ally, 1000, 1, {
          name: "Warrior's Aura",
          animation: "flame-spin-3",
          position: allyPosition,
        });
        if (event) gameEvents.push(event);
      }
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
      const enemyPosition = getPositionOfCardById(enemy.user_card_instance_id, board);
      if (enemyPosition) {
        gameEvents.push(
          debuff(enemy, -1, {
            name: "Many Heads",
            animation: "purple-slashes",
            position: enemyPosition,
          })
        );
      }
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
          ...flipCard(
            context.state,
            enemyPosition,
            enemy,
            triggerCard,
            "water-burst-2"
          )
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
      const enemyPosition = getPositionOfCardById(enemy.user_card_instance_id, board);
      if (enemyPosition) {
        gameEvents.push(
          debuff(enemy, -2, {
            name: "Bone Chill",
            animation: "red-lightning",
            position: enemyPosition,
          })
        );
      }
    }

    return gameEvents;
  },
};
