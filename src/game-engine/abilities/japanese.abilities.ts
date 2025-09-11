import { PowerValues, TileStatus } from "../../types";
import { AbilityMap } from "../../types/game-engine.types";
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
} from "../ability.utils";
import { BaseGameEvent } from "../game-events";
import { flipCard } from "../game.utils";
import { getPositionOfCardById } from "../ability.utils";

export const japaneseAbilities: AbilityMap = {
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
          setTileStatus(tile, pos, {
            status: TileStatus.Cursed,
            turns_left: 3,
            animation_label: "web-curse",
            power: { top: -1000, bottom: -1000, left: -1000, right: -1000 },
            effect_duration: 3,
            applies_to_user: getOpponentId(triggerCard.owner, state),
          })
        );
      }
    }

    return gameEvents;
  },

  // Slipstream: Gains +1 power if placed next to an already defeated card.
  Slipstream: (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;

    if (!position) return [];

    const adjacentCards = getAdjacentCards(position, board);
    const hasAdjacentDefeated = adjacentCards.some(
      (card) => card.defeats.length > 0
    );

    if (hasAdjacentDefeated) {
      return [addTempBuff(triggerCard, 1000, 1)];
    }

    return [];
  },

  // Hunter's Mark: Gains +1 power for each defeated enemy.
  "Hunter's Mark": (context) => {
    const { triggerCard } = context;

    // This should get called once for each card that is flipped by the trigger card,
    // so just buff by 1
    return [buff(triggerCard, 1)];
  },

  // Vengeful Bite: When defeated, the attacker loses 1 power permanently.
  "Vengeful Bite": (context) => {
    const { flippedBy } = context;

    if (flippedBy) {
      return [debuff(flippedBy, -1)];
    }

    return [];
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

  // Pull enemy cards one tile closer before combat.
  "Drowning Net": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    // const adjacentEnemies = getEnemiesAdjacentTo(
    //   position,
    //   board,
    //   triggerCard.owner
    // );
    // for (const enemy of adjacentEnemies) {
    //   const pushEvent = pushCardAway(enemy, position, board);
    //   if (pushEvent) gameEvents.push(pushEvent);
    // }

    return gameEvents;
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

  // Steadfast Guard: Adjacent allies gain +1 power if attacked but not defeated.
  "Steadfast Guard": (context) => {
    const {
      triggerCard,
      flippedCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const benkeiPosition = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      board
    );
    if (!benkeiPosition) return [];

    const allies = getAlliesAdjacentTo(
      benkeiPosition,
      board,
      triggerCard.owner
    );
    const allieIds = allies.map((ally) => ally.user_card_instance_id);

    if (flippedCard && allieIds.includes(flippedCard.user_card_instance_id)) {
      gameEvents.push(addTempBuff(flippedCard, 1000, 1));
    }

    return gameEvents;
  },

  // Demon Bane: Gains +2 power if adjacent to a YOKAI.
  "Demon Bane": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;

    if (!position) return [];

    const adjacentYokai = getAdjacentCards(position, board, { tag: "yokai" });

    if (adjacentYokai.length > 0) {
      return [addTempBuff(triggerCard, 1000, 2)];
    }

    return [];
  },

  // Beast Friend: All ally BEAST cards gain +1 power.
  "Beast Friend": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const allyBeasts = getCardsByCondition(
      board,
      (card) =>
        card.owner === triggerCard.owner &&
        card.base_card_data.tags?.includes("beast")
    );

    for (const beast of allyBeasts) {
      gameEvents.push(addTempBuff(beast, 1000, 1));
    }

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

  // Radiant Blessing: Adjacent allies gain +1 power for one turn.
  "Radiant Blessing": (context) => {
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
      gameEvents.push(addTempBuff(ally, 2, 1));
    }

    return gameEvents;
  },

  // Storm Breaker: Defeat strongest enemy in the same row regardless of power.
  "Storm Breaker": (context) => {
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

    return [];
  },

  // Warrior's Aura: Adjacent friendly cards gain +1 power.
  "Warrior's Aura": (context) => {
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
      gameEvents.push(addTempBuff(ally, 1000, 1));
    }

    return gameEvents;
  },

  // Many Heads: Gains +1 power for each adjacent enemy.
  "Many Heads": (context) => {
    const {
      position,
      triggerCard,
      state: { board },
    } = context;

    if (!position) return [];

    const adjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );

    if (adjacentEnemies.length > 0) {
      return [addTempBuff(triggerCard, 1000, adjacentEnemies.length)];
    }

    return [];
  },

  // Tidal Sweep: Enemies in the same column lose 1 power this turn.
  "Tidal Sweep": (context) => {
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
      gameEvents.push(addTempDebuff(enemy, 3, -1));
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
      gameEvents.push(debuff(enemy, -1));
    }

    return gameEvents;
  },
};
