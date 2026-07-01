import { GameState } from "../types/game.types";
import { InGameCard } from "../types/card.types";

/**
 * Creates a sanitized version of the game state for a specific player.
 * This function removes sensitive information that the player should not see,
 * such as the opponent's hand.
 *
 * @param gameState The full game state object.
 * @param viewerId The ID of the user who is viewing the game.
 * @returns A sanitized game state object.
 */
export function sanitizeGameStateForPlayer(
  gameState: GameState,
  viewerId: string
): GameState {
  if (!gameState || !gameState.player1 || !gameState.player2) {
    return gameState; // or throw an error
  }

  // Strip `sourceCard` references during cloning to avoid circular structures.
  // `sourceCard` is an InGameCard reference stored on temporary_effects.data for
  // engine-side bookkeeping, but the same card is also reachable via the board /
  // hydrated_card_data_cache, which causes JSON.stringify to fail. The id is
  // already preserved separately on tile/effect metadata, so dropping the live
  // reference is safe for the client-facing snapshot.
  const sanitizedState: GameState = JSON.parse(
    JSON.stringify(gameState, (key, value) =>
      key === "sourceCard" ? undefined : value
    )
  );

  const isPlayer1 = sanitizedState.player1.user_id === viewerId;
  const isPlayer2 = sanitizedState.player2.user_id === viewerId;

  if (isPlayer1) {
    if (sanitizedState.player2) {
      sanitizedState.player2.hand = new Array(
        sanitizedState.player2.hand.length
      ).fill(null as any);
    }
  } else if (isPlayer2) {
    if (sanitizedState.player1) {
      sanitizedState.player1.hand = new Array(
        sanitizedState.player1.hand.length
      ).fill(null as any);
    }
  }

  if (sanitizedState.hydrated_card_data_cache) {
    const visibleCardIds = new Set<string>();

    // Add board cards to visible set
    for (const row of sanitizedState.board) {
      for (const cell of row) {
        if (cell.card && cell.card.user_card_instance_id) {
          visibleCardIds.add(cell.card.user_card_instance_id);
        }
      }
    }

    // Add player's own hand cards to visible set
    const playerHand = isPlayer1
      ? sanitizedState.player1.hand
      : sanitizedState.player2.hand;
    playerHand.forEach((cardId) => {
      if (cardId) visibleCardIds.add(cardId);
    });

    // Filter the cache to only include visible cards
    const filteredCache: Record<string, InGameCard> = {};
    for (const cardId of visibleCardIds) {
      if (sanitizedState.hydrated_card_data_cache[cardId]) {
        filteredCache[cardId] = sanitizedState.hydrated_card_data_cache[cardId];
      }
    }

    sanitizedState.hydrated_card_data_cache = filteredCache;
  }

  // `pending_choice` is internal coordination state. Its `choosable_card_ids`
  // are the opponent's hand — never broadcast it inside the shared game state.
  // The chooser receives the revealed hand via the dedicated
  // SERVER_CHOICE_REQUIRED payload instead. Stripping it for everyone keeps the
  // broadcast snapshot free of the hidden hand even for the chooser's cache.
  if (sanitizedState.pending_choice) {
    delete sanitizedState.pending_choice;
  }

  return sanitizedState;
}
