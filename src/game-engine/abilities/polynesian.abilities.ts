import { AbilityMap, CombatResolverMap } from "../../types/game-engine.types";
import {
  BoardPosition,
  GameBoard,
  TileStatus,
  TileTerrain,
} from "../../types/game.types";
import {
  addTempBuff,
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
} from "../ability.utils";
import { BaseGameEvent } from "../game-events";

const fillRandomEmptyTileWithWater = (
  position: BoardPosition,
  board: GameBoard
) => {
  const card = cardAtPosition(position, board);
  const emptyAdjacentTiles = getEmptyAdjacentTiles(position, board);
  if (emptyAdjacentTiles.length > 0) {
    const { position: tilePos, tile } = emptyAdjacentTiles[0];
    return setTileStatus(tile, tilePos, {
      status: TileStatus.Normal,
      turns_left: 1000,
      animation_label: "water",
      terrain: TileTerrain.Ocean,
      effect_duration: 1000,
      applies_to_user: card!.owner,
      power: { top: 1, bottom: 1, left: 1, right: 1 },
    });
  }
};

export const polynesianCombatResolvers: CombatResolverMap = {};

export const polynesianAbilities: AbilityMap = {
  // Lava Field: Fill empty adjacent tiles with lava. Enemy cards placed on lava lose 1 power.
  "Lava Field": (context) => {
    const { position, triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const emptyAdjacentTiles = getEmptyAdjacentTiles(position, state.board);
    for (const { position: tilePos, tile } of emptyAdjacentTiles) {
      gameEvents.push(
        setTileStatus(tile, tilePos, {
          status: TileStatus.Cursed,
          turns_left: 1000,
          animation_label: "lava",
          power: { top: -1, bottom: -1, left: -1, right: -1 },
          effect_duration: 1000,
          terrain: TileTerrain.Lava,
          applies_to_user: getOpponentId(triggerCard.owner, state),
        })
      );
    }

    return gameEvents;
  },

  // Cleansing Hula: Each of your turns, cleanse adjacent allies of one curse.
  "Cleansing Hula": (context) => {
    const {
      triggerCard,
      position,
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
      gameEvents.push(cleanseDebuffs(ally, 1));
    }

    return gameEvents;
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
    const waterTileEvent = fillRandomEmptyTileWithWater(position, board);
    if (waterTileEvent) gameEvents.push(waterTileEvent);

    const allAllies = getAllAlliesOnBoard(board, triggerCard.owner);
    for (const ally of allAllies) {
      gameEvents.push(cleanseDebuffs(ally, 1000));
    }

    return gameEvents;
  },

  // Tide Ward: Fill an empty tile with water. Protect adjacent allies from curses.
  "Tide Ward": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    // Fill one empty adjacent tile with water
    const waterTileEvent = fillRandomEmptyTileWithWater(position, board);
    if (waterTileEvent) gameEvents.push(waterTileEvent);

    // TODO: Need to implement curse protection system - this requires tracking protection status on cards
    // For now, we'll cleanse existing curses on adjacent allies
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );
    for (const ally of adjacentAllies) {
      gameEvents.push(cleanseDebuffs(ally, 1));
    }

    return gameEvents;
  },

  // War Stance: Allies in the same row gain +1 to top side.
  "War Stance": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const alliesInRow = getCardsInSameRow(
      position,
      board,
      triggerCard.owner
    ).filter(
      (card) =>
        card.owner === triggerCard.owner &&
        card.user_card_instance_id !== triggerCard.user_card_instance_id
    );

    for (const ally of alliesInRow) {
      gameEvents.push(addTempBuff(ally, 1000, { top: 1 }));
    }

    return gameEvents;
  },

  // Fertile Ground: Bless adjacent empty titles with +1 for Allies.
  "Fertile Ground": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const emptyAdjacentTiles = getEmptyAdjacentTiles(position, board);
    for (const { position: tilePos } of emptyAdjacentTiles) {
      gameEvents.push(addTileBlessing(tilePos, 3, triggerCard.owner));
    }

    return gameEvents;
  },

  // Sun Trick: Each turn, alternate between +1 to left/right and top/bottom.
  "Sun Trick": (context) => {
    const { triggerCard, state } = context;
    const label = "Sun Trick";

    const existingBuff = triggerCard.temporary_effects.find(
      (effect) => effect.name === label
    );

    const startTurn = existingBuff?.data?.startTurn ?? state.turn_number;

    const turnsSinceStart = state.turn_number - startTurn;
    if (turnsSinceStart % 2 !== 0) return [];

    // remove existing buff
    triggerCard.temporary_effects = triggerCard.temporary_effects.filter(
      (effect) => effect.name !== label
    );

    const isVertical = turnsSinceStart % 4 === 0;
    const buffStats = isVertical
      ? { top: 1, bottom: 1 }
      : { left: 1, right: 1 };

    return [addTempBuff(triggerCard, 3, buffStats, label, { startTurn })];
  },

  // Wild Shift: Each turn, alternate between +2 top and +2 bottom.
  "Wild Shift": (context) => {
    const { triggerCard, state } = context;
    const label = "Wild Shift";

    const existingBuff = triggerCard.temporary_effects.find(
      (effect) => effect.name === label
    );

    const startTurn = existingBuff?.data?.startTurn ?? state.turn_number;

    const turnsSinceStart = state.turn_number - startTurn;
    if (turnsSinceStart % 2 !== 0) return [];

    // remove existing buff
    triggerCard.temporary_effects = triggerCard.temporary_effects.filter(
      (effect) => effect.name !== label
    );

    const isVertical = turnsSinceStart % 4 === 0;
    const buffStats = isVertical ? { top: 2 } : { bottom: 2 };

    return [addTempBuff(triggerCard, 3, buffStats, label, { startTurn })];
  },

  // Ocean's Shield: Fill an empty tile with water. Prevents allies in water from defeat.
  "Ocean's Shield": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    // Fill one empty adjacent tile with water
    const waterTileEvent = fillRandomEmptyTileWithWater(position, board);
    if (waterTileEvent) gameEvents.push(waterTileEvent);

    // TODO: Need to implement defeat prevention system - this requires game logic changes
    // to check tile status before card removal

    return gameEvents;
  },

  // Feast or Famine: Each of your turns, reduce one random side of an adjacent enemy by 1 (temporary).
  "Feast or Famine": (context) => {
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
    if (adjacentEnemies.length === 0) return [];

    const randomEnemy =
      adjacentEnemies[Math.floor(Math.random() * adjacentEnemies.length)];
    const sides = ["top", "bottom", "left", "right"] as const;
    const randomSide = sides[Math.floor(Math.random() * sides.length)];

    return [addTempDebuff(randomEnemy, 1, { [randomSide]: -1 })];
  },

  // Sacred Spring: Fill an empty tile with water. Each of your turns, cleanse adjacent allies of one curse.
  "Sacred Spring": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    // Fill one empty adjacent tile with water
    const waterTileEvent = fillRandomEmptyTileWithWater(position, board);
    if (waterTileEvent) gameEvents.push(waterTileEvent);

    // Cleanse adjacent allies (this should trigger each turn)
    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );
    for (const ally of adjacentAllies) {
      gameEvents.push(cleanseDebuffs(ally, 1));
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
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    // Fill one empty adjacent tile with water
    const waterTileEvent = fillRandomEmptyTileWithWater(position, board);
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

  // Dread Aura: Enemy abilities are disabled next turn.
  "Dread Aura": (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    const allEnemies = getCardsByCondition(
      board,
      (card) => card.owner !== triggerCard.owner
    );
    for (const enemy of allEnemies) {
      gameEvents.push(disableAbilities(enemy, 1));
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
        })
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

  // Harbor Guardian: Fill an empty tile with water. Adjacent allies are protected from defeat for 1 turn.
  "Harbor Guardian": (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const waterTileEvent = fillRandomEmptyTileWithWater(position, board);
    if (waterTileEvent) gameEvents.push(waterTileEvent);

    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner
    );
    for (const ally of adjacentAllies) {
      gameEvents.push(protectFromDefeat(ally, 1));
    }

    return gameEvents;
  },

  // Dual Aspect: Each turn, alternate between +2 left/right and +2 top/bottom.
  "Dual Aspect": (context) => {
    const { triggerCard, state } = context;
    const label = "Dual Aspect";

    const existingBuff = triggerCard.temporary_effects.find(
      (effect) => effect.name === label
    );

    const startTurn = existingBuff?.data?.startTurn ?? state.turn_number;

    const turnsSinceStart = state.turn_number - startTurn;
    if (turnsSinceStart % 2 !== 0) return [];

    // remove existing buff
    triggerCard.temporary_effects = triggerCard.temporary_effects.filter(
      (effect) => effect.name !== label
    );

    const isVertical = turnsSinceStart % 4 === 0;
    const buffStats = isVertical
      ? { top: 2, bottom: 2 }
      : { left: 2, right: 2 };

    return [addTempBuff(triggerCard, 3, buffStats, label, { startTurn })];
  },
};
