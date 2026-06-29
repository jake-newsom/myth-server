import { PowerValues, TemporaryEffect, TriggerMoment } from "../../types/card.types";
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
  getAlliesAdjacentTo,
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
  protectFromDefeat,
  resetTile,
} from "../ability.utils";
import { BaseGameEvent } from "../game-events";
import { resolveCombat } from "../game.utils";
import { randomInt } from "../simulation.rng";
import { simulationContext } from "../simulation.context";
import AchievementService from "../../services/achievement.service";

import { v4 as uuidv4 } from "uuid";

const fillRandomEmptyTileWithWater = (
  position: BoardPosition,
  board: GameBoard,
  ownerId: string,
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

const countActiveLavaTiles = (board: GameBoard): number => {
  return board
    .flat()
    .filter((tile) => tile.tile_effect?.terrain === TileTerrain.Lava).length;
};

export const polynesianCombatResolvers: CombatResolverMap = {
  // Ocean's Shield: Cannot be defeated by enemies with lower total power.
  kamohoalii_oceans_shield: (context) => {
    const { triggerCard, flippedCard, flippedBy } = context;

    // Only protect the card that actually has Ocean's Shield (self-protection only)
    if (
      !flippedCard ||
      (flippedCard.base_card_data.special_ability?.id ??
        flippedCard.base_card_data.special_ability?.ability_id) !==
        "kamohoalii_oceans_shield"
    )
      return { preventDefeat: false };

    // When invoked via ally protection, triggerCard is the protecting ally
    // (not the attacker) — the actual attacker is flippedBy.
    const attacker = flippedBy ?? triggerCard;

    const enemyTotalPower = getCardTotalPower(attacker);
    const myTotalPower = getCardTotalPower(flippedCard);

    if (enemyTotalPower >= myTotalPower) return { preventDefeat: false };

    return { preventDefeat: true };
  },

  // Harbor Guardian: Sacrifices 3 power to protect allies from defeat
  kaahupahau_harbor_guardian: (context) => {
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

    // A defeat is already confirmed by the outer resolveCombat check before this
    // resolver is invoked, so no further power comparison is needed here.
    return {
      preventDefeat: true,
      events: [
        createOrUpdateDebuff(
          triggerCard,
          1000,
          3,
          "Harbor Protection",
          position,
          {
            animation: "harbor-protection",
            actingPlayerId: triggerCard.owner,
            sourceCard: triggerCard,
            sourcePlayerId: triggerCard.owner,
            turnNumber: context.state.turn_number,
          },
        ),
      ],
    };
  },
};

export const polynesianAbilities: AbilityMap = {
  // Lava Field: Gains +1 for every card played on a lava tile.
  pele_lava_field: (context) => {
    const { position, triggerCard, state } = context;

    if (!position) return [];

    // Check if this is triggered by a card being placed
    const placedCard = context.originalTriggerCard || triggerCard;

    // Check if the placed card has a lava tile effect (transferred from the tile)
    const hasLavaEffect = placedCard.temporary_effects.some(
      (effect) =>
        effect.name === "lava" ||
        effect.data?.terrain === TileTerrain.Lava ||
        effect.data?.originalTileEffect === "lava",
    );
    // Also check if the tile still has a lava effect (fallback)
    const isOnLavaTile =
      getTileAtPosition(position, state.board)?.tile_effect?.terrain ===
      TileTerrain.Lava;

    if (!hasLavaEffect && !isOnLavaTile) return [];

    return [
      createOrUpdateBuff(triggerCard, 1000, 1, "Lava Field", position, {
        actingPlayerId: triggerCard.owner,
        sourceCard: triggerCard,
        sourcePlayerId: triggerCard.owner,
        batchId: `${triggerCard.user_card_instance_id}:${state.turn_number}:pele`,
        turnNumber: state.turn_number,
      }),
    ];
  },

  // Cleansing Hula: At the start of each round, cleanse a random ally of all curses
  hiaka_cleansing_hula: (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;

    // Hi'iaka cleanses an ally other than herself; otherwise the ability can
    // simply target the trigger card on its own (a no-op when uncursed).
    const eligibleAllies = getAllAlliesOnBoard(board, triggerCard.owner).filter(
      (ally) => !isSameCard(triggerCard, ally),
    );

    const randomAlly = chooseRandomCard(eligibleAllies);

    if (randomAlly) {
      const allyPosition = getPositionOfCardById(
        randomAlly.user_card_instance_id,
        board,
      );
      if (allyPosition) {
        return [cleanseDebuffs(randomAlly, 1000, allyPosition, "nature-swirl")];
      }
    }
    return [];
  },

  // Pure Waters: Protect adjacent allies from defeat through your next turn.
  kane_pure_waters: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const batchId = `${triggerCard.user_card_instance_id}:${context.state.turn_number}:kane`;

    if (!position) return [];

    const adjacentAllies = getAlliesAdjacentTo(
      position,
      board,
      triggerCard.owner,
    );
    for (const ally of adjacentAllies) {
      const allyPosition = getPositionOfCardById(
        ally.user_card_instance_id,
        board,
      );
      if (!allyPosition) continue;

      gameEvents.push(
        protectFromDefeat(ally, 3, allyPosition, {
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          batchId,
          turnNumber: context.state.turn_number,
        }),
      );
    }

    return gameEvents;
  },

  // Tide Ward: While in hand, grant +1 to each card you play. When played, steal his blessings back.
  kanaloa_tide_ward: (context) => {
    const {
      triggerCard,
      triggerMoment,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const originalTriggerCard = context.originalTriggerCard;

    if (
      triggerMoment === TriggerMoment.HandOnPlace &&
      originalTriggerCard &&
      originalTriggerCard.owner === triggerCard.owner &&
      originalTriggerCard.user_card_instance_id !==
        triggerCard.user_card_instance_id
    ) {
      const originalCardPosition = getPositionOfCardById(
        originalTriggerCard.user_card_instance_id,
        board,
      );
      if (originalCardPosition) {
        gameEvents.push(
          createOrUpdateBuff(
            originalTriggerCard,
            1000,
            1,
            "Tide Ward",
            originalCardPosition,
            {
              animation: "tide-ward",
              sourceCardId: triggerCard.user_card_instance_id,
            },
          ),
        );
      }
    } else if (triggerMoment === TriggerMoment.OnPlace) {
      //get cards with tideward buff
      const tideWardCards = getCardsByCondition(board, (card) =>
        card.temporary_effects.some(
          (effect) =>
            effect.name === "Tide Ward" &&
            effect.data?.sourceCardId === triggerCard.user_card_instance_id,
        ),
      );

      //buff kanaloa
      if (tideWardCards.length > 0 && position) {
        gameEvents.push(
          addTempBuff(triggerCard, 1000, tideWardCards.length, {
            name: "Tide Ward",
            animation: "bubble-swirl",
            position,
          }),
        );
      }

      //remove tideward buff from cards
      for (const card of tideWardCards) {
        const cardPosition = getPositionOfCardById(
          card.user_card_instance_id,
          board,
        );
        if (cardPosition) {
          gameEvents.push(
            removeBuffsByCondition(
              card,
              (effect: TemporaryEffect) => effect.name === "Tide Ward",
              cardPosition,
            ),
          );
        }
      }
    }

    return gameEvents;
  },

  // War Stance: Gain +1 whenever an ally is defeated up to 5. At max, attack adjacent enemies again.
  ku_war_stance: (context) => {
    const { triggerCard, originalTriggerCard, state, position } = context;
    const label = "Blood Altar";
    const gameEvents: BaseGameEvent[] = [];
    let bloodAltarBuff = triggerCard.temporary_effects.find(
      (effect) => effect.name === label,
    );
    const belowMaxPower = (bloodAltarBuff?.power.top ?? 0) < 6;

    if (
      originalTriggerCard?.owner !== triggerCard.owner &&
      position &&
      belowMaxPower
    ) {
      gameEvents.push(
        createOrUpdateBuff(triggerCard, 1000, 2, label, position, {
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          turnNumber: context.state.turn_number,
          animation: "debuff",
        }),
      );

      // createOrUpdateBuff mutates card effects in place, so re-read here to
      // allow immediate +4 -> +5 activation in the same trigger resolution.
      bloodAltarBuff = triggerCard.temporary_effects.find(
        (effect) => effect.name === label,
      );
    }

    // check buff for max value & unused attack
    const atMaxPower = (bloodAltarBuff?.power.top ?? 0) >= 6;
    const usedAttack = bloodAltarBuff?.data?.usedAttack || false;
    if (bloodAltarBuff && atMaxPower && !usedAttack) {
      const triggerPosition = getPositionOfCardById(
        triggerCard.user_card_instance_id,
        state.board,
      );
      if (triggerPosition) {
        // Ensure re-entrant triggers in this same resolution frame
        // observe the consumed bonus attack immediately.
        bloodAltarBuff.data = {
          ...(bloodAltarBuff.data ?? {}),
          usedAttack: true,
        };

        // Mark attack as consumed before resolving combat to avoid
        // re-entrant recursion when OnFlipped/Any* triggers fire mid-resolution.
        gameEvents.push(
          createOrUpdateBuff(triggerCard, 1000, 0, label, triggerPosition, {
            usedAttack: true,
            actingPlayerId: triggerCard.owner,
            sourceCard: triggerCard,
            sourcePlayerId: triggerCard.owner,
            turnNumber: context.state.turn_number,
          }),
        );

        // Resolve combat only if the card is still on board.
        const combatResult = resolveCombat(
          state,
          triggerPosition,
          triggerCard.owner,
        );
        gameEvents.push(...combatResult.events);
      }
    }

    return gameEvents;
  },

  // Fertile Ground: Each round grant +1 for one turn to allies with existing blessings
  lono_fertile_ground: (context) => {
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
          0,
        );
        return totalPowerChange > 0;
      });

      if (hasBlessing) {
        const allyPosition = getPositionOfCardById(
          ally.user_card_instance_id,
          board,
        );
        if (allyPosition) {
          gameEvents.push(
            createOrUpdateBuff(ally, 1000, 1, "Makahiki Bounty", allyPosition, {
              animation: "nature-swirl",
              actingPlayerId: ally.owner,
              sourceCard: ally,
              sourcePlayerId: ally.owner,
              turnNumber: context.state.turn_number,
            }),
          );
        }
      }
    }

    return gameEvents;
  },

  // Sun Trick: Gain +1 every round in hand, resets after combat
  maui_sun_trick: (context) => {
    const { triggerCard, position, state } = context;
    const label = "Sun Trick";

    const gameEvents: BaseGameEvent[] = [];

    // Sentinel position for cards in hand
    const HAND_POSITION: BoardPosition = { x: -1, y: -1 };

    if (context.triggerMoment === TriggerMoment.HandOnRoundEnd) {
      gameEvents.push(
        createOrUpdateBuff(triggerCard, 1000, 1, label, HAND_POSITION, {
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          turnNumber: context.state.turn_number,
        }),
      );
      // triggerCard.current_power = updateCurrentPower(triggerCard);
    } else if (context.triggerMoment === TriggerMoment.AfterCombat) {
      // The Sun Trick buff is symmetric (+1/side/round). Report the per-side
      // magnitude (e.g. "-2") rather than the four-side total (e.g. "-8"), since
      // a card's power reads per side. powerBySide carries the signed per-side
      // delta so the client shows the "all directions" indicator.
      const sunTrickBuff = triggerCard.temporary_effects.find(
        (effect) => effect.name === label,
      );
      const removedBySide: Partial<PowerValues> = {};
      let maxSideRemoved = 0;
      if (sunTrickBuff) {
        for (const side of ["top", "bottom", "left", "right"] as const) {
          const v = sunTrickBuff.power[side] || 0;
          if (v !== 0) {
            removedBySide[side] = -v;
            maxSideRemoved = Math.max(maxSideRemoved, Math.abs(v));
          }
        }
      }

      //after combat, remove the buff
      triggerCard.temporary_effects = triggerCard.temporary_effects.filter(
        (effect) => effect.name !== label,
      );
      // Update the card's current power after removing temporary effects
      triggerCard.current_power = updateCurrentPower(triggerCard);
      gameEvents.push({
        type: EVENT_TYPES.CARD_POWER_CHANGED,
        animation: "explode-swirl",
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: triggerCard.user_card_instance_id,
        powerDelta: -maxSideRemoved,
        powerBySide: removedBySide,
        effectName: label,
        position,
      } as CardPowerChangedEvent);
    }

    return gameEvents;
  },

  // Wild Shift: Create lava in a random tile every round
  kamapuaa_wild_shift: (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    const randomTile = getRandomEmptyTile(state.board);
    if (randomTile) {
      const lavaActiveCount = countActiveLavaTiles(state.board) + 1;
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
          triggerCard.owner,
          triggerCard,
          {
            turnNumber: context.state.turn_number,
            extraEventData: {
              lava_active_count: lavaActiveCount,
            },
          },
        ),
      );
    }

    return gameEvents;
  },

  // Feast or Famine: When an ally is defeated, fill their tile with water.
  ukupanipo_feast_or_famine: (context) => {
    const {
      triggerCard,
      originalTriggerCard,
      flippedCard,
      flippedBy,
      state: { board },
    } = context;

    const defeatedCard = flippedCard ?? originalTriggerCard;
    const defeatingCard = flippedBy ?? originalTriggerCard;

    if (!defeatedCard || !defeatingCard) return [];

    // Trigger only when an opponent defeats one of this card owner's allies.
    if (defeatingCard.owner === triggerCard.owner) return [];

    const defeatedPosition = getPositionOfCardById(
      defeatedCard.user_card_instance_id,
      board,
    );
    if (!defeatedPosition) return [];

    const defeatedTile = getTileAtPosition(defeatedPosition, board);
    if (!defeatedTile) return [];

    return [
      setTileStatus(
        defeatedTile,
        defeatedPosition,
        {
          status: TileStatus.Normal,
          turns_left: 1000,
          animation_label: "water",
          terrain: TileTerrain.Ocean,
          effect_duration: 1000,
          applies_to_user: triggerCard.owner,
        },
        triggerCard.owner,
        triggerCard,
        { turnNumber: context.state.turn_number },
      ),
    ];
  },

  // Sacred Spring: If in water, grant +1 to a random card in your hand at the end of each round
  mooinanea_sacred_spring: (context) => {
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
      const randomIndex = randomInt(player.hand.length);
      const randomCard = hydrated_card_data_cache?.[player.hand[randomIndex]];
      if (randomCard) {
        // Card is in hand, use sentinel position
        const HAND_POSITION: BoardPosition = { x: -1, y: -1 };
        gameEvents.push(
          addTempBuff(randomCard, 1000, 1, {
            name: "Sacred Spring",
            animation: "bubble-swirl-in",
            position: HAND_POSITION,
          }),
        );
      }
    }
    return gameEvents;
  },

  // Icy Presence: Before combat, remove all LAVA tiles, granting +2 to allies
  // standing in LAVA and -1 to enemies standing in LAVA.
  poliahu_icy_presence: (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) {
        const tile = board[y][x];
        if (tile.tile_effect?.terrain !== TileTerrain.Lava) continue;

        const tilePosition: BoardPosition = { x, y };
        const card = tile.card;

        if (card) {
          if (card.owner === triggerCard.owner) {
            gameEvents.push(
              addTempBuff(card, 1000, 2, {
                name: "Icy Presence",
                animation: "icicle",
                position: tilePosition,
                data: {
                  actingPlayerId: triggerCard.owner,
                  sourceCard: triggerCard,
                  sourcePlayerId: triggerCard.owner,
                  turnNumber: context.state.turn_number,
                },
              }),
            );
          } else {
            gameEvents.push(
              debuff(card, -1, {
                name: "Icy Presence",
                animation: "icicle",
                position: tilePosition,
                data: {
                  actingPlayerId: triggerCard.owner,
                  sourceCard: triggerCard,
                  sourcePlayerId: triggerCard.owner,
                  turnNumber: context.state.turn_number,
                },
              }),
            );
          }
        }

        // Remove the lava tile.
        gameEvents.push(resetTile(tile, tilePosition));
      }
    }

    return gameEvents;
  },

  // Gale Aura: Push adjacent enemies away 1 tile.
  laamaomao_gale_aura: (context) => {
    const {
      triggerCard,
      position,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    let pushedCount = 0;

    if (!position) return [];

    const adjacentEnemies = getEnemiesAdjacentTo(
      position,
      board,
      triggerCard.owner,
    );
    for (const enemy of adjacentEnemies) {
      const pushEvents = pushCardAway(enemy, position, board);
      pushedCount += pushEvents.filter(
        (e) => e.type === EVENT_TYPES.CARD_MOVED,
      ).length;
      gameEvents.push(...pushEvents);
    }

    if (pushedCount > 0 && !simulationContext.isInSimulation()) {
      AchievementService.triggerAchievementEvent({
        userId: triggerCard.owner,
        eventType: "power_buff_applied",
        eventData: {
          source_card_id: triggerCard.user_card_instance_id,
          source_card_name: triggerCard.base_card_data?.name ?? null,
          source_ability_id: "laamaomao_gale_aura",
          turn_number: context.state.turn_number,
          power_delta: pushedCount,
        },
      }).catch(() => {});
    }

    return gameEvents;
  },

  // Rain's Blessing: Fill an empty tile with water. Allies placed after her gain +1 to a random side.
  hauwahine_rains_blessing: (context) => {
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
        triggerCard.owner,
      );
      if (waterTileEvent) gameEvents.push(waterTileEvent);
    } else if (triggerMoment === TriggerMoment.AnyOnPlace) {
      const { originalTriggerCard } = context;
      if (originalTriggerCard?.owner === triggerCard.owner) {
        const cardPosition = getPositionOfCardById(
          originalTriggerCard.user_card_instance_id,
          board,
        );
        if (cardPosition) {
          const randomSide = getRandomSide();
          gameEvents.push(
            addTempBuff(
              originalTriggerCard,
              1000,
              { [randomSide]: 1 },
              {
                name: "Koolau Mist",
                animation: "bubbles-centered",
                position: cardPosition,
              },
            ),
          );
        }
      }
    }

    return gameEvents;
  },

  // Spirit Bind: Any card that flips Milu loses 2 power permanently.
  milu_spirit_bind: (context) => {
    const {
      flippedBy,
      state: { board },
    } = context;

    if (flippedBy) {
      const flippedByPosition = getPositionOfCardById(
        flippedBy.user_card_instance_id,
        board,
      );
      if (flippedByPosition) {
        return [
          debuff(flippedBy, -5, {
            name: "Spirit Bind",
            animation: "smoke-shrink",
            position: flippedByPosition,
            data: {
              actingPlayerId: context.triggerCard.owner,
              sourceCard: context.triggerCard,
              sourcePlayerId: context.triggerCard.owner,
              turnNumber: context.state.turn_number,
              targetTotalPowerBefore: getCardTotalPower(flippedBy),
              targetMaxSidePowerBefore: Math.max(
                flippedBy.current_power.top,
                flippedBy.current_power.right,
                flippedBy.current_power.bottom,
                flippedBy.current_power.left,
              ),
            },
          }),
        ];
      }
    }

    return [];
  },

  // Dread Aura: At the end of every round move to an adjacent empty tile and curse the previous tile.
  nightmarchers_dread_aura: (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    const position = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      state.board,
    );
    if (!position) return [];

    const adjacentEmptyTiles = getEmptyAdjacentTiles(position, state.board);
    if (adjacentEmptyTiles.length > 0) {
      //pick random adjacent empty tile
      const randomAdjacentEmptyTile =
        adjacentEmptyTiles[randomInt(adjacentEmptyTiles.length)];
      //move to random adjacent empty tile
      gameEvents.push(
        ...moveCardToPosition(
          triggerCard,
          randomAdjacentEmptyTile.position,
          position,
          state.board,
        ),
      );
      //curse previous tile
      const previousTile = getTileAtPosition(position, state.board);
      if (previousTile) {
        gameEvents.push(
          setTileStatus(
            previousTile,
            position,
            {
              status: TileStatus.Cursed,
              turns_left: 1000,
              animation_label: "cursed",
              power: { top: -1, bottom: -1, left: -1, right: -1 },
              effect_duration: 1000,
              applies_to_user: getOpponentId(triggerCard.owner, state),
            },
            triggerCard.owner,
            triggerCard,
            { turnNumber: context.state.turn_number },
          ),
        );
      }
    }

    return gameEvents;
  },

  // Hex Field: At end of your turn, curse all empty adjacent tiles for 1 turn.
  kapo_hex_field: (context) => {
    const { position, state, triggerCard } = context;
    const gameEvents: BaseGameEvent[] = [];

    if (!position) return [];

    const emptyAdjacentTiles = getEmptyAdjacentTiles(position, state.board);
    for (const { position: tilePos, tile } of emptyAdjacentTiles) {
      if (!tile || tile.card) {
        continue;
      }
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
          triggerCard.owner,
        ),
      );
    }

    return gameEvents;
  },

  kanehekili_thunderous_omen: (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;

    const allEnemies = getCardsByCondition(
      board,
      (card) => card.owner !== triggerCard.owner,
    );
    if (allEnemies.length === 0) return [];

    const randomEnemy = allEnemies[randomInt(allEnemies.length)];

    const enemyPosition = getPositionOfCardById(
      randomEnemy.user_card_instance_id,
      board,
    );

    if (!enemyPosition) return [];

    const batchId = uuidv4();

    const event = addTempDebuff(
      randomEnemy,
      1000,
      -1,
      {
        name: "Thunderous Omen",
        animation: "lightning-2",
        position: enemyPosition,
        data: {
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          batchId,
          turnNumber: context.state.turn_number,
        },
      },
    );

    return [event];
  },

  // Dual Aspect: Grant -1 to a random enemy for each water tile on the board
  kupua_dual_aspect: (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const batchId = uuidv4();

    const waterTileCount = board
      .flat()
      .filter((tile) => tile.tile_effect?.terrain === TileTerrain.Ocean).length;
    if (waterTileCount === 0) return [];

    const enemies = getCardsByCondition(
      board,
      (card) => card.owner !== triggerCard.owner,
    );
    if (enemies.length === 0) return [];

    for (let i = 0; i < waterTileCount; i++) {
      const randomEnemy = chooseRandomCard(enemies);
      const enemyPosition = getPositionOfCardById(
        randomEnemy.user_card_instance_id,
        board,
      );
      if (enemyPosition) {
        gameEvents.push(
          addTempDebuff(randomEnemy, 1000, -2, {
            name: "Dual Aspect",
            animation: "water-circles-few",
            position: enemyPosition,
            data: {
              actingPlayerId: triggerCard.owner,
              sourceCard: triggerCard,
              sourcePlayerId: triggerCard.owner,
              batchId,
              turnNumber: context.state.turn_number,
            },
          }),
        );
      }
    }
    return gameEvents;
  },
};
