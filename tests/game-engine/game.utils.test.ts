import { describe, it, expect } from "jest";
import * as gameUtils from "../../src/game-engine/game.utils";
import {
  GameState,
  BoardPosition,
  BoardCell,
  InGameCard,
} from "../../src/types/game.types";

// Mock data for testing
const createMockGameState = (): GameState => {
  const board = Array(4)
    .fill(null)
    .map(() => Array(4).fill(null));
  // Add a card to position 1,1
  board[1][1] = {
    user_card_instance_id: "card-1",
    base_card_id: "base-1",
    owner: "player1",
    current_power: { top: 5, right: 5, bottom: 5, left: 5 },
    level: 1,
    card_state: "normal",
    base_card_data: {
      name: "Test Card",
      rarity: "common",
      image_url: "test.jpg",
      tags: ["test"],
      base_power: { top: 5, right: 5, bottom: 5, left: 5 },
      special_ability: null,
    },
    tile_status: "normal",
    player_1_turns_left: 0,
    player_2_turns_left: 0,
    animation_label: null,
  };

  return {
    board,
    player1: {
      user_id: "player1",
      hand: ["card-2", "card-3"],
      deck: ["card-4", "card-5"],
      discard_pile: [],
      score: 1,
    },
    player2: {
      user_id: "player2",
      hand: ["card-6", "card-7"],
      deck: ["card-8", "card-9"],
      discard_pile: [],
      score: 0,
    },
    current_player_id: "player1",
    turn_number: 1,
    status: "active",
    max_cards_in_hand: 5,
    initial_cards_to_draw: 5,
    hydrated_card_data_cache: {},
  };
};

const createMockHydratedCard = (id: string): InGameCard => {
  return {
    user_card_instance_id: id,
    base_card_id: "base-card-1",
    name: "Test Card",
    rarity: "common",
    image_url: "test.jpg",
    current_power: { top: 5, right: 5, bottom: 5, left: 5 },
    base_power: { top: 4, right: 4, bottom: 4, left: 4 },
    level: 2,
    xp: 100,
    tags: ["test"],
    special_ability: null,
  };
};

describe("Game Utils", () => {
  describe("createBoardCell", () => {
    it("should create a board cell with correct properties", () => {
      const hydratedCard = createMockHydratedCard("card-10");
      const playerId = "player1";

      const { boardCell } = gameUtils.createBoardCell(hydratedCard, playerId);

      expect(boardCell.card).toBeDefined();
      expect(boardCell.card!.user_card_instance_id).toBe("card-10");
      expect(boardCell.card!.owner).toBe("player1");
      expect(boardCell.card!.current_power).toEqual({
        top: 5,
        right: 5,
        bottom: 5,
        left: 5,
      });
      expect(boardCell.card!.level).toBe(2);
      expect(boardCell.tile_enabled).toBe(true);
    });

    it("should apply tile effect power bonuses when creating board cell", () => {
      const hydratedCard = createMockHydratedCard("card-10");
      const playerId = "player1";
      const tileEffect = {
        status: "boosted" as any,
        turns_left: 5,
        power: { top: 2, right: 1, bottom: 2, left: 1 },
      };

      const { boardCell, tileEffectTransferred } = gameUtils.createBoardCell(
        hydratedCard,
        playerId,
        tileEffect
      );

      expect(boardCell.card).toBeDefined();
      expect(boardCell.card!.current_power).toEqual({
        top: 7, // 5 + 2 from tile effect
        right: 6, // 5 + 1 from tile effect
        bottom: 7, // 5 + 2 from tile effect
        left: 6, // 5 + 1 from tile effect
      });
      expect(tileEffectTransferred).toBe(true);
      expect(boardCell.tile_effect).toBeUndefined(); // Tile effect should be removed after transfer
      expect(boardCell.card!.temporary_effects).toHaveLength(1);
      expect(boardCell.card!.temporary_effects[0].duration).toBe(5); // max(3, 5)
    });

    it("should not transfer tile effect when applies_to_user doesn't match card owner", () => {
      const hydratedCard = createMockHydratedCard("card-10");
      const playerId = "player1";
      const tileEffect = {
        status: "boosted" as any,
        turns_left: 5,
        power: { top: 2, right: 1, bottom: 2, left: 1 },
        applies_to_user: "player2", // Different user
      };

      const { boardCell, tileEffectTransferred } = gameUtils.createBoardCell(
        hydratedCard,
        playerId,
        tileEffect
      );

      expect(boardCell.card).toBeDefined();
      expect(boardCell.card!.current_power).toEqual({
        top: 5, // No bonus applied
        right: 5,
        bottom: 5,
        left: 5,
      });
      expect(tileEffectTransferred).toBe(false);
      expect(boardCell.tile_effect).toEqual(tileEffect); // Tile effect remains
      expect(boardCell.card!.temporary_effects).toHaveLength(0);
    });
  });

  describe("resolveCombat", () => {
    it("should flip opponent cards when placed card has higher power", () => {
      // Setup game state with adjacent cards
      const gameState = createMockGameState();

      // Setup: Place a player2 card with lower power adjacent to where we'll place our test card
      gameState.board[0][0] = {
        user_card_instance_id: "card-weak",
        base_card_id: "base-2",
        owner: "player2",
        current_power: { top: 3, right: 3, bottom: 3, left: 3 }, // Lower power
        level: 1,
        card_state: "normal",
        base_card_data: {
          name: "Weak Card",
          rarity: "common",
          image_url: "weak.jpg",
          tags: ["test"],
          base_power: { top: 3, right: 3, bottom: 3, left: 3 },
          special_ability: null,
        },
        tile_status: "normal",
        player_1_turns_left: 0,
        player_2_turns_left: 0,
        animation_label: null,
      };

      // Place our test card adjacent to the weak card (which should get flipped)
      gameState.board[0][1] = {
        user_card_instance_id: "card-strong",
        base_card_id: "base-3",
        owner: "player1",
        current_power: { top: 6, right: 6, bottom: 6, left: 6 }, // Higher power
        level: 1,
        card_state: "normal",
        base_card_data: {
          name: "Strong Card",
          rarity: "common",
          image_url: "strong.jpg",
          tags: ["test"],
          base_power: { top: 6, right: 6, bottom: 6, left: 6 },
          special_ability: null,
        },
        tile_status: "normal",
        player_1_turns_left: 0,
        player_2_turns_left: 0,
        animation_label: null,
      };

      const position: BoardPosition = { x: 1, y: 0 }; // Position of our strong card
      const playerId = "player1";

      const newGameState = gameUtils.resolveCombat(
        gameState,
        position,
        playerId
      );

      // The weak card should be flipped and now owned by player1
      expect(newGameState.board[0][0]!.owner).toBe("player1");
    });

    it("should not flip cards when placed card has lower power", () => {
      // Setup game state with adjacent cards
      const gameState = createMockGameState();

      // Setup: Place a player2 card with higher power adjacent to where we'll place our test card
      gameState.board[0][0] = {
        user_card_instance_id: "card-strong",
        base_card_id: "base-2",
        owner: "player2",
        current_power: { top: 8, right: 8, bottom: 8, left: 8 }, // Higher power
        level: 1,
        card_state: "normal",
        base_card_data: {
          name: "Strong Card",
          rarity: "common",
          image_url: "strong.jpg",
          tags: ["test"],
          base_power: { top: 8, right: 8, bottom: 8, left: 8 },
          special_ability: null,
        },
        tile_status: "normal",
        player_1_turns_left: 0,
        player_2_turns_left: 0,
        animation_label: null,
      };

      // Place our test card adjacent to the strong card (which should not get flipped)
      gameState.board[0][1] = {
        user_card_instance_id: "card-weak",
        base_card_id: "base-3",
        owner: "player1",
        current_power: { top: 4, right: 4, bottom: 4, left: 4 }, // Lower power
        level: 1,
        card_state: "normal",
        base_card_data: {
          name: "Weak Card",
          rarity: "common",
          image_url: "weak.jpg",
          tags: ["test"],
          base_power: { top: 4, right: 4, bottom: 4, left: 4 },
          special_ability: null,
        },
        tile_status: "normal",
        player_1_turns_left: 0,
        player_2_turns_left: 0,
        animation_label: null,
      };

      const position: BoardPosition = { x: 1, y: 0 }; // Position of our weak card
      const playerId = "player1";

      const newGameState = gameUtils.resolveCombat(
        gameState,
        position,
        playerId
      );

      // The strong card should not be flipped and still owned by player2
      expect(newGameState.board[0][0]!.owner).toBe("player2");
    });
  });

  describe("moveAllBoardCardsToDiscardPiles", () => {
    it("should move all cards from board to their owners' discard piles", () => {
      const gameState = createMockGameState();

      // Add a few cards to the board
      gameState.board[0][0] = {
        user_card_instance_id: "card-p1-1",
        base_card_id: "base-1",
        owner: "player1",
        current_power: { top: 5, right: 5, bottom: 5, left: 5 },
        level: 1,
        card_state: "normal",
        base_card_data: {
          name: "P1 Card 1",
          rarity: "common",
          image_url: "test.jpg",
          tags: ["test"],
          base_power: { top: 5, right: 5, bottom: 5, left: 5 },
          special_ability: null,
        },
        tile_status: "normal",
        player_1_turns_left: 0,
        player_2_turns_left: 0,
        animation_label: null,
      };

      gameState.board[0][1] = {
        user_card_instance_id: "card-p2-1",
        base_card_id: "base-2",
        owner: "player2",
        current_power: { top: 5, right: 5, bottom: 5, left: 5 },
        level: 1,
        card_state: "normal",
        base_card_data: {
          name: "P2 Card 1",
          rarity: "common",
          image_url: "test.jpg",
          tags: ["test"],
          base_power: { top: 5, right: 5, bottom: 5, left: 5 },
          special_ability: null,
        },
        tile_status: "normal",
        player_1_turns_left: 0,
        player_2_turns_left: 0,
        animation_label: null,
      };

      const newGameState = gameUtils.moveAllBoardCardsToDiscardPiles(gameState);

      // Board should be empty
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          expect(newGameState.board[y][x]).toBeNull();
        }
      }

      // Cards should be in the discard piles of their respective owners
      expect(newGameState.player1.discard_pile).toContain("card-p1-1");
      expect(newGameState.player2.discard_pile).toContain("card-p2-1");
      expect(newGameState.player1.discard_pile.length).toBe(1);
      expect(newGameState.player2.discard_pile.length).toBe(1);
    });
  });

  describe("switchTurn", () => {
    it("should switch turn to the opponent and increment turn number", () => {
      const gameState = createMockGameState();
      gameState.current_player_id = "player1";
      gameState.turn_number = 3;

      const newGameState = gameUtils.switchTurn(gameState);

      expect(newGameState.current_player_id).toBe("player2");
      expect(newGameState.turn_number).toBe(4);
    });
  });
});
