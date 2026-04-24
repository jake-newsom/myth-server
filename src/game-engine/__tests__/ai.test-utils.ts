import { InGameCard, PowerValues, TriggerMoment } from "../../types/card.types";
import { GameStatus } from "../game.logic";
import { BoardCell, BoardPosition, GameState } from "../../types/game.types";

function createBoardCell(): BoardCell {
  return {
    card: null,
    tile_enabled: true,
    tile_effect: undefined,
  };
}

export function createEmptyBoard(size = 4): BoardCell[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => createBoardCell())
  );
}

export function createTestCard(params: {
  id: string;
  owner: string;
  abilityId?: string;
  tags?: string[];
  power?: PowerValues;
}): InGameCard {
  const power = params.power ?? { top: 4, right: 4, bottom: 4, left: 4 };
  return {
    user_card_instance_id: params.id,
    base_card_id: `base-${params.id}`,
    base_card_data: {
      card_id: `base-${params.id}`,
      name: params.id,
      tags: params.tags ?? [],
      rarity: "rare",
      image_url: "",
      base_power: power,
      set_id: "test-set",
      special_ability: params.abilityId
        ? {
            ability_id: params.abilityId,
            id: params.abilityId,
            name: params.abilityId,
            description: params.abilityId,
            parameters: {},
            triggerMoments: [TriggerMoment.OnPlace],
          }
        : null,
      attack_animation: "slash",
    },
    level: 1,
    xp: 0,
    is_locked: false,
    power_enhancements: { top: 0, right: 0, bottom: 0, left: 0 },
    card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
    card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
    temporary_effects: [],
    current_power: power,
    owner: params.owner,
    original_owner: params.owner,
    lockedTurns: 0,
    defeats: [],
  };
}

export function createTestGameState(params: {
  board?: BoardCell[][];
  player1Id?: string;
  player2Id?: string;
  player1Hand?: string[];
  player2Hand?: string[];
  hydrated?: Record<string, InGameCard>;
  turnNumber?: number;
}): GameState {
  return {
    board: params.board ?? createEmptyBoard(),
    player1: {
      user_id: params.player1Id ?? "p1",
      hand: params.player1Hand ?? [],
      deck: [],
      discard_pile: [],
      score: 0,
    },
    player2: {
      user_id: params.player2Id ?? "p2",
      hand: params.player2Hand ?? [],
      deck: [],
      discard_pile: [],
      score: 0,
    },
    current_player_id: params.player1Id ?? "p1",
    turn_number: params.turnNumber ?? 1,
    status: GameStatus.ACTIVE,
    max_cards_in_hand: 5,
    initial_cards_to_draw: 5,
    winner: null,
    hydrated_card_data_cache: params.hydrated ?? {},
  };
}

export function placeCardOnBoard(
  board: BoardCell[][],
  position: BoardPosition,
  card: InGameCard
): void {
  board[position.y][position.x] = {
    card,
    tile_enabled: true,
    tile_effect: board[position.y][position.x]?.tile_effect,
  };
}
