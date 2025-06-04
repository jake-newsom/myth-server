import { describe, it, expect } from "jest";
import * as validators from "../../src/game-engine/game.validators";
import {
  GameState,
  BoardPosition,
  BoardCell,
} from "../../src/types/game.types";

// Mock data for testing
const createMockGameState = (): GameState => {
  const board = Array(4)
    .fill(null)
    .map(() => Array(4).fill(null));
  // Add a card to position 1,1
  board[1][1] = {
    card: {
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

describe("Game Validators", () => {
  describe("isPlayerTurn", () => {
    it("should return true when it is player's turn", () => {
      const gameState = createMockGameState();
      expect(validators.isPlayerTurn(gameState, "player1")).toBe(true);
    });

    it("should return false when it is not player's turn", () => {
      const gameState = createMockGameState();
      expect(validators.isPlayerTurn(gameState, "player2")).toBe(false);
    });
  });

  describe("isValidBoardPosition", () => {
    it("should return true for valid positions", () => {
      expect(validators.isValidBoardPosition({ x: 0, y: 0 })).toBe(true);
      expect(validators.isValidBoardPosition({ x: 3, y: 3 })).toBe(true);
      expect(validators.isValidBoardPosition({ x: 2, y: 1 })).toBe(true);
    });

    it("should return false for invalid positions", () => {
      expect(validators.isValidBoardPosition({ x: -1, y: 0 })).toBe(false);
      expect(validators.isValidBoardPosition({ x: 4, y: 3 })).toBe(false);
      expect(validators.isValidBoardPosition({ x: 2, y: 5 })).toBe(false);
    });
  });

  describe("isBoardPositionOccupied", () => {
    it("should return true when position is occupied", () => {
      const gameState = createMockGameState();
      expect(
        validators.isBoardPositionOccupied(gameState, { x: 1, y: 1 })
      ).toBe(true);
    });

    it("should return false when position is empty", () => {
      const gameState = createMockGameState();
      expect(
        validators.isBoardPositionOccupied(gameState, { x: 0, y: 0 })
      ).toBe(false);
    });
  });

  describe("isCardInPlayerHand", () => {
    it("should return true when card is in player's hand", () => {
      const gameState = createMockGameState();
      expect(
        validators.isCardInPlayerHand(gameState, "player1", "card-2")
      ).toBe(true);
    });

    it("should return false when card is not in player's hand", () => {
      const gameState = createMockGameState();
      expect(
        validators.isCardInPlayerHand(gameState, "player1", "card-6")
      ).toBe(false);
    });
  });

  describe("getPlayer", () => {
    it("should return player1 when player1's ID is provided", () => {
      const gameState = createMockGameState();
      expect(validators.getPlayer(gameState, "player1")).toEqual(
        gameState.player1
      );
    });

    it("should return player2 when player2's ID is provided", () => {
      const gameState = createMockGameState();
      expect(validators.getPlayer(gameState, "player2")).toEqual(
        gameState.player2
      );
    });
  });

  describe("isBoardFull", () => {
    it("should return false when board has empty cells", () => {
      const gameState = createMockGameState();
      expect(validators.isBoardFull(gameState.board)).toBe(false);
    });

    it("should return true when board is full", () => {
      const gameState = createMockGameState();
      // Fill the entire board with cards
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          gameState.board[y][x] = {
            card: {
              user_card_instance_id: `card-${x}-${y}`,
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
            },
            tile_status: "normal",
            player_1_turns_left: 0,
            player_2_turns_left: 0,
            animation_label: null,
          };
        }
      }
      expect(validators.isBoardFull(gameState.board)).toBe(true);
    });
  });

  describe("calculateScores", () => {
    it("should calculate correct scores based on card ownership", () => {
      const gameState = createMockGameState();
      // Add one more card for player2
      gameState.board[2][2] = {
        card: {
          user_card_instance_id: "card-10",
          base_card_id: "base-2",
          owner: "player2",
          current_power: { top: 5, right: 5, bottom: 5, left: 5 },
          level: 1,
          card_state: "normal",
          base_card_data: {
            name: "Test Card 2",
            rarity: "common",
            image_url: "test2.jpg",
            tags: ["test"],
            base_power: { top: 5, right: 5, bottom: 5, left: 5 },
            special_ability: null,
          },
        },
        tile_status: "normal",
        player_1_turns_left: 0,
        player_2_turns_left: 0,
        animation_label: null,
      };

      const { player1Score, player2Score } = validators.calculateScores(
        gameState.board,
        "player1",
        "player2"
      );

      expect(player1Score).toBe(1); // One card at position 1,1
      expect(player2Score).toBe(1); // One card at position 2,2
    });
  });

  describe("determineGameOutcome", () => {
    it("should return player1's ID when player1 has higher score", () => {
      expect(validators.determineGameOutcome(5, 3, "player1", "player2")).toBe(
        "player1"
      );
    });

    it("should return player2's ID when player2 has higher score", () => {
      expect(validators.determineGameOutcome(2, 4, "player1", "player2")).toBe(
        "player2"
      );
    });

    it("should return null when scores are equal", () => {
      expect(validators.determineGameOutcome(3, 3, "player1", "player2")).toBe(
        null
      );
    });
  });
});
