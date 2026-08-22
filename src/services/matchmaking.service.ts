import db from "../config/db.config";
import { default as DeckModel } from "../models/deck.model";
import { default as UserModel } from "../models/user.model";
import { GameLogic } from "../game-engine/game.logic";
import DeckService from "./deck.service";

/**
 * Creates the `games` row for a matched pair of players.
 *
 * Extracted verbatim from the inline `// --- Create Game ---` block that used to
 * live in matchmaking.controller.joinQueue. Both the PvP hardening plan and the
 * matchmaking plan call this extraction their shared prerequisite: the queue
 * matcher needs to create games from a scheduler tick, where there is no HTTP
 * request to hang the logic off.
 *
 * Behaviour is intentionally unchanged from the controller version, including
 * the convention that player1 (the player who triggered the match) moves first.
 */

export interface CreatedPvpGame {
  gameId: string;
  player1Username: string;
  player2Username: string;
}

export class DeckLookupError extends Error {
  constructor(message = "Error retrieving deck information.") {
    super(message);
    this.name = "DeckLookupError";
  }
}

const MatchmakingService = {
  /**
   * Build and persist a PvP game for two players who have already been paired.
   *
   * Throws DeckLookupError if either deck can no longer be read, so the caller
   * decides how to surface it (HTTP 400 from the controller, re-queue from the
   * matcher).
   */
  async createPvpGame(
    player1Id: string,
    player1DeckId: string,
    player2Id: string,
    player2DeckId: string
  ): Promise<CreatedPvpGame> {
    const player1Deck = await DeckModel.findDeckWithInstanceDetails(
      player1DeckId,
      player1Id
    );
    const player2Deck = await DeckModel.findDeckWithInstanceDetails(
      player2DeckId,
      player2Id
    );

    if (!player1Deck || !player2Deck) {
      throw new DeckLookupError();
    }

    // Each card in the deck is an instance, so we add it once.
    const p1DeckCardIds = player1Deck.cards.reduce((acc: string[], card) => {
      if (card.user_card_instance_id) {
        acc.push(card.user_card_instance_id);
      }
      return acc;
    }, []);

    const p2DeckCardIds = player2Deck.cards.reduce((acc: string[], card) => {
      if (card.user_card_instance_id) {
        acc.push(card.user_card_instance_id);
      }
      return acc;
    }, []);

    const initialGameState = await GameLogic.initializeGame(
      p1DeckCardIds,
      p2DeckCardIds,
      player1Id,
      player2Id
    );

    // Player who initiated the match goes first.
    initialGameState.current_player_id = player1Id;

    // Attach deck effects based on mythology composition.
    const [p1DeckEffect, p2DeckEffect] = await Promise.all([
      DeckService.getDeckEffect(player1DeckId),
      DeckService.getDeckEffect(player2DeckId),
    ]);

    if (p1DeckEffect) {
      initialGameState.player1.deck_effect = p1DeckEffect;
      initialGameState.player1.deck_effect_state = { last_triggered_round: 0 };
    }
    if (p2DeckEffect) {
      initialGameState.player2.deck_effect = p2DeckEffect;
      initialGameState.player2.deck_effect_state = { last_triggered_round: 0 };
    }
    initialGameState.player1.equipped_card_back =
      player1Deck.equipped_card_back ?? null;
    initialGameState.player2.equipped_card_back =
      player2Deck.equipped_card_back ?? null;

    const gameResult = await db.query(
      `
        INSERT INTO "games" (player1_id, player2_id, player1_deck_id, player2_deck_id, game_mode, game_status, board_layout, game_state, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING game_id;
      `,
      [
        player1Id,
        player2Id,
        player1DeckId,
        player2DeckId,
        "pvp",
        "active",
        "4x4",
        JSON.stringify(initialGameState),
      ]
    );

    const newGameId = gameResult.rows[0].game_id;

    // Display names for both players, for the caller's response/event payloads.
    const [player2User, player1User] = await Promise.all([
      UserModel.findById(player2Id),
      UserModel.findById(player1Id),
    ]);

    return {
      gameId: newGameId,
      player1Username: player1User ? player1User.username : "Opponent",
      player2Username: player2User ? player2User.username : "Opponent",
    };
  },
};

export default MatchmakingService;
