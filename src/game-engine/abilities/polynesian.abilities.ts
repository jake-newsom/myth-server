import { InGameCard, PowerValues, TemporaryEffect, TriggerMoment } from "../../types/card.types";
import {
  AbilityMap,
  CardPowerChangedEvent,
  COMBAT_TYPES,
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
  chooseRandomCard,
  moveCardToPosition,
  isSameCard,
  protectFromDefeat,
  resetTile,
} from "../ability.utils";
import { BaseGameEvent } from "../game-events";
import { flipCard, resolveCombat } from "../game.utils";
import { randomInt } from "../simulation.rng";
import { simulationContext } from "../simulation.context";
import AchievementService from "../../services/achievement.service";

import { v4 as uuidv4 } from "uuid";

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
    const { triggerCard, flippedCard, flippedBy, state } = context;

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

    // The -3 sacrifice lands on Harbor Guardian herself, so the floating text
    // must show on HER tile — not the protected card's tile (context.position
    // points at the flipped ally, see flipCard's ally-protection branch).
    const guardianPosition = getPositionOfCardById(
      triggerCard.user_card_instance_id,
      state.board,
    );
    if (!guardianPosition) {
      return { preventDefeat: true };
    }

    // A defeat is already confirmed by the outer resolveCombat check before this
    // resolver is invoked, so no further power comparison is needed here.
    return {
      preventDefeat: true,
      // Shield VFX plays on the DEFENDED ally's card (via the CARD_DEFENDED
      // event), not on Harbor Guardian.
      defendAnimation: "harbor-protection",
      events: [
        // The -3 sacrifice shows as a plain floating "-3 / Harbor Protection"
        // label on Harbor Guardian herself, with no VFX (animation: null).
        createOrUpdateDebuff(
          triggerCard,
          1000,
          3,
          "Pu'uloa Guard",
          guardianPosition,
          {
            animation: null,
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
  // Aumakua's Path (OnDefend half): grant +2 to a random SEA card in your hand.
  // The "cannot be DEFEATED by enemies with lower total power" passive lives in
  // the combat resolver above.
  //
  // NOTE: OnDefend fires on EVERY prevented defeat, both when this card's own
  // resolver shields it and when the attacker simply wasn't strong enough
  // (resolveCombat's plain-defend branch). Nothing in the context distinguishes
  // the two, so this intentionally rewards any successful defend.
  kamohoalii_oceans_shield: (context) => {
    const { triggerCard, state } = context;
    const HAND_POSITION: BoardPosition = { x: -1, y: -1 };

    const owner =
      state.player1.user_id === triggerCard.owner ? state.player1 : state.player2;

    const seaHandCards = owner.hand
      .map((id) => state.hydrated_card_data_cache?.[id])
      .filter((card): card is InGameCard => !!card)
      .filter((card) =>
        (card.base_card_data.tags ?? []).some(
          (tag) => String(tag).toLowerCase() === "sea",
        ),
      );

    if (seaHandCards.length === 0) return [];

    const target = seaHandCards[randomInt(seaHandCards.length)];
    const events: BaseGameEvent[] = [
      addTempBuff(target, 1000, 2, {
        name: "Aumakua's Path",
        animation: "bubble-swirl-in",
        position: HAND_POSITION,
        data: {
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          turnNumber: state.turn_number,
        },
      }),
    ];

    target.current_power = updateCurrentPower(target);
    if (state.hydrated_card_data_cache) {
      state.hydrated_card_data_cache[target.user_card_instance_id] = target;
    }

    return events;
  },

  // Lava Field: in hand or in play, gain +1 for every LAVA tile added to the
  // board. Driven by OnTerrain, so it counts tiles as they are CREATED rather
  // than cards played onto them.
  //
  // Per-tile, not per-batch: Ragnarök lava-fills every empty tile in one go and
  // Pele gains once for each.
  pele_lava_field: (context) => {
    const { triggerCard, terrainEvents, state } = context;
    const HAND_POSITION: BoardPosition = { x: -1, y: -1 };

    const lavaAdded = (terrainEvents ?? []).filter(
      (event) => event.tile?.tile_effect?.terrain === TileTerrain.Lava,
    ).length;
    if (lavaAdded === 0) return [];

    // Pele buffs HERSELF — her own tile once on the board, else the in-hand
    // sentinel. Never a tile position from terrainEvents, which would leak her
    // floating text onto whichever tile happened to change (see Demon Bane).
    const buffPosition =
      getPositionOfCardById(triggerCard.user_card_instance_id, state.board) ??
      HAND_POSITION;

    return [
      createOrUpdateBuff(
        triggerCard,
        1000,
        lavaAdded,
        "Lava Field",
        buffPosition,
        {
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          batchId: `${triggerCard.user_card_instance_id}:${state.turn_number}:pele`,
          turnNumber: state.turn_number,
        },
      ),
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
        return [cleanseDebuffs(randomAlly, 1000, allyPosition, "bloom")];
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
            animation: "tide-ward-back",
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
          animation: "blood-altar",
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
  // Makahiki Bounty: On play, grant +1 to each NATURE card in your hand and
  // protect allied NATURE cards on the board for 1 round.
  lono_fertile_ground: (context) => {
    const {
      triggerCard,
      state,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];
    const HAND_POSITION: BoardPosition = { x: -1, y: -1 };

    const isNature = (card: InGameCard) =>
      (card.base_card_data.tags ?? []).some(
        (tag) => String(tag).toLowerCase() === "nature",
      );

    // +1 to every NATURE card in the owner's hand.
    const owner =
      state.player1.user_id === triggerCard.owner ? state.player1 : state.player2;

    for (const cardId of owner.hand) {
      const handCard = state.hydrated_card_data_cache?.[cardId];
      if (!handCard || !isNature(handCard)) continue;

      gameEvents.push(
        addTempBuff(handCard, 1000, 1, {
          name: "Makahiki Bounty",
          animation: "nature-swirl",
          position: HAND_POSITION,
          data: {
            actingPlayerId: triggerCard.owner,
            sourceCard: triggerCard,
            sourcePlayerId: triggerCard.owner,
            turnNumber: state.turn_number,
          },
        }),
      );
      handCard.current_power = updateCurrentPower(handCard);
      if (state.hydrated_card_data_cache) {
        state.hydrated_card_data_cache[handCard.user_card_instance_id] = handCard;
      }
    }

    // Protect allied NATURE cards already on the board for 1 round (2 turn
    // ticks — the temporary-effect lifecycle decrements once per turn end).
    for (const ally of getAllAlliesOnBoard(board, triggerCard.owner)) {
      if (!isNature(ally)) continue;
      const allyPosition = getPositionOfCardById(
        ally.user_card_instance_id,
        board,
      );
      if (!allyPosition) continue;

      gameEvents.push(
        protectFromDefeat(ally, 2, allyPosition, {
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          turnNumber: state.turn_number,
        }),
      );
    }

    return gameEvents;
  },

  // Sun Trick: in hand, gain +1 at the end of each round. In play, grant +1 to
  // a random TRICKSTER in your hand at the end of each round.
  //
  // The old "resets after combat" half is gone: the buff now accumulates for as
  // long as Maui is held, so there is no AfterCombat branch and no strip.
  maui_sun_trick: (context) => {
    const { triggerCard, state } = context;
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
      return gameEvents;
    }

    // In play (OnRoundEnd): buff a random TRICKSTER in the owner's hand.
    const owner =
      state.player1.user_id === triggerCard.owner ? state.player1 : state.player2;
    const tricksters = owner.hand
      .map((id) => state.hydrated_card_data_cache?.[id])
      .filter((card): card is InGameCard => !!card)
      .filter((card) =>
        (card.base_card_data.tags ?? []).some(
          (tag) => String(tag).toLowerCase() === "trickster",
        ),
      );

    if (tricksters.length > 0) {
      const target = tricksters[randomInt(tricksters.length)];
      gameEvents.push(
        addTempBuff(target, 1000, 1, {
          name: label,
          animation: "sun-trick",
          position: HAND_POSITION,
          data: {
            actingPlayerId: triggerCard.owner,
            sourceCard: triggerCard,
            sourcePlayerId: triggerCard.owner,
            turnNumber: state.turn_number,
          },
        }),
      );
      target.current_power = updateCurrentPower(target);
      if (state.hydrated_card_data_cache) {
        state.hydrated_card_data_cache[target.user_card_instance_id] = target;
      }
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
  // Shark God's Wake: while in play, grant -3 power to non-SEA ENEMIES that
  // enter WATER -- either played onto it (AnyOnPlace) or moved onto it
  // (AnyOnMove: pushed, pulled or self-moved).
  //
  // Placement and movement are separate engine events, so the ability carries a
  // trigger from each family and normalises them here into "which cards just
  // arrived somewhere".
  ukupanipo_feast_or_famine: (context) => {
    const {
      triggerCard,
      originalTriggerCard,
      moveEvents,
      triggerMoment,
      state,
      state: { board },
    } = context;

    // Only while Ukupanipo is on the board -- this is a "while in play" passive.
    if (!getPositionOfCardById(triggerCard.user_card_instance_id, board)) {
      return [];
    }

    // Normalise both entry paths to a list of arrived cards.
    const arrivals: InGameCard[] =
      triggerMoment === TriggerMoment.AnyOnMove ||
      triggerMoment === TriggerMoment.OnMove
        ? (moveEvents ?? [])
            .map((event) => state.hydrated_card_data_cache?.[event.cardId])
            .filter((card): card is InGameCard => !!card)
        : originalTriggerCard
          ? [originalTriggerCard]
          : [];

    const events: BaseGameEvent[] = [];

    for (const arrival of arrivals) {
      // Enemies only, and never Ukupanipo himself.
      if (arrival.owner === triggerCard.owner) continue;
      if (arrival.user_card_instance_id === triggerCard.user_card_instance_id) {
        continue;
      }

      // SEA cards swim free.
      const isSea = (arrival.base_card_data.tags ?? []).some(
        (tag) => String(tag).toLowerCase() === "sea",
      );
      if (isSea) continue;

      // Read the tile the card is standing on NOW, rather than trusting the
      // event's toPosition: a move can be followed by further relocation within
      // the same batch, and placement gives no toPosition at all.
      const arrivalPosition = getPositionOfCardById(
        arrival.user_card_instance_id,
        board,
      );
      if (!arrivalPosition) continue;

      const tile = getTileAtPosition(arrivalPosition, board);
      if (tile?.tile_effect?.terrain !== TileTerrain.Ocean) continue;

      events.push(
        createOrUpdateDebuff(
          arrival,
          1000,
          3,
          "Shark God's Wake",
          arrivalPosition,
          {
            animation: "bubble-swirl-in",
            actingPlayerId: triggerCard.owner,
            sourceCard: triggerCard,
            sourcePlayerId: triggerCard.owner,
            turnNumber: state.turn_number,
          },
        ),
      );
    }

    return events;
  },

  // Sacred Spring: If in water, grant +1 to a random card in your hand at the end of each round
  mooinanea_sacred_spring: (context) => {
    const {
      triggerCard,
      position,
      state,
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
          addTempBuff(randomCard, 1000, 2, {
            name: "Sacred Spring",
            animation: "bubble-swirl-in",
            position: HAND_POSITION,
            data: {
              actingPlayerId: triggerCard.owner,
              sourceCard: triggerCard,
              sourcePlayerId: triggerCard.owner,
              turnNumber: state.turn_number,
            },
          }),
        );
        randomCard.current_power = updateCurrentPower(randomCard);
        if (hydrated_card_data_cache) {
          hydrated_card_data_cache[randomCard.user_card_instance_id] =
            randomCard;
        }
      }
    }
    return gameEvents;
  },

  // Icy Presence: Convert all LAVA to WATER, then grant +2 to allies and -1 to
  // enemies standing in WATER.
  //
  // Order matters: the conversion runs FIRST, so the buff/debuff pass sees the
  // freshly converted tiles as water. It also sees tiles that were ALREADY
  // water, which is intended — the effect reads "in WATER", not "in converted
  // water".
  poliahu_icy_presence: (context) => {
    const {
      triggerCard,
      state: { board },
    } = context;
    const gameEvents: BaseGameEvent[] = [];

    // Pass 1: Lava -> Ocean. The new tile carries no `power` payload, matching
    // Ukupanipo's water, so a card arriving LATER picks up plain water terrain
    // rather than an Icy Presence bonus. The +2/-1 below is a one-time effect
    // on the cards standing there now, deliberately not baked into the tile.
    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) {
        const tile = board[y][x];
        if (tile.tile_effect?.terrain !== TileTerrain.Lava) continue;

        gameEvents.push(
          setTileStatus(
            tile,
            { x, y },
            {
              status: TileStatus.Normal,
              turns_left: 1000,
              animation_label: "water",
              terrain: TileTerrain.Ocean,
              effect_duration: 1000,
              applies_to_user: triggerCard.owner,
              power: { top: 1, bottom: 1, left: 1, right: 1 },
            },
            triggerCard.owner,
            triggerCard,
            { turnNumber: context.state.turn_number },
          ),
        );
      }
    }

    // Pass 2: every card now standing in water. Cards already on the tile never
    // run transferTileEffectToCard (it only fires at placement), so this is the
    // only thing that reaches them.
    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) {
        const tile = board[y][x];
        if (tile.tile_effect?.terrain !== TileTerrain.Ocean) continue;

        const card = tile.card;
        if (!card) continue;

        const tilePosition: BoardPosition = { x, y };
        const effectData = {
          actingPlayerId: triggerCard.owner,
          sourceCard: triggerCard,
          sourcePlayerId: triggerCard.owner,
          turnNumber: context.state.turn_number,
        };

        if (card.owner === triggerCard.owner) {
          gameEvents.push(
            addTempBuff(card, 1000, 2, {
              name: "Icy Presence",
              animation: "ice-spike",
              position: tilePosition,
              data: effectData,
            }),
          );
        } else {
          gameEvents.push(
            debuff(card, -1, {
              name: "Icy Presence",
              animation: "ice-spike",
              position: tilePosition,
              data: effectData,
            }),
          );
        }
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

  // Rain's Blessing: Each round, flood a random empty tile with water that
  // grants +1 to your cards standing on it (mirrors Kamapua'a's Wild Shift,
  // but a friendly water tile instead of a hostile lava tile).
  hauwahine_rains_blessing: (context) => {
    const { triggerCard, state } = context;
    const gameEvents: BaseGameEvent[] = [];

    const randomTile = getRandomEmptyTile(state.board);
    if (randomTile) {
      gameEvents.push(
        setTileStatus(
          randomTile.tile,
          randomTile.position,
          {
            status: TileStatus.Normal,
            turns_left: 1000,
            terrain: TileTerrain.Ocean,
            animation_label: "water",
            effect_duration: 1000,
            applies_to_user: triggerCard.owner, // Only buff this card owner's cards
            power: { top: 1, bottom: 1, left: 1, right: 1 },
          },
          triggerCard.owner,
          triggerCard,
          { turnNumber: context.state.turn_number },
        ),
      );
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

      // Captured BEFORE the move: afterwards `position` is vacated and this
      // would report the neighbours of an empty tile.
      const previouslyAdjacent = new Set(
        getEnemiesAdjacentTo(position, state.board, triggerCard.owner).map(
          (card) => card.user_card_instance_id,
        ),
      );
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

      // Attack any HUMAN enemy that the move brought it next to. "New" is
      // measured against the tile it came FROM: an enemy already adjacent
      // before the move is not newly adjacent and is left alone.
      const newHumanNeighbours = getEnemiesAdjacentTo(
        randomAdjacentEmptyTile.position,
        state.board,
        triggerCard.owner,
      ).filter(
        (enemy) =>
          !previouslyAdjacent.has(enemy.user_card_instance_id) &&
          (enemy.base_card_data.tags ?? []).some(
            (tag) => String(tag).toLowerCase() === "human",
          ),
      );

      for (const human of newHumanNeighbours) {
        const humanPosition = getPositionOfCardById(
          human.user_card_instance_id,
          state.board,
        );
        if (!humanPosition) continue;

        gameEvents.push(
          ...flipCard(
            state,
            humanPosition,
            human,
            triggerCard,
            "dread-aura",
            {
              forcedOwnerId: triggerCard.owner,
              combatType: COMBAT_TYPES.SPECIAL,
            },
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
