import UserModel from "../models/user.model";
import { GameMode, isHumanVsHumanMode } from "../types/database.types";
import { resolveDraftXpTargets } from "../game-engine/draftBattle.hydration";
import XpService from "./xp.service";
import { XpReward } from "../types/service.types";
import { GameState } from "../types/game.types";
import db from "../config/db.config";
import LeaderboardService from "./leaderboard.service";
import AchievementService from "./achievement.service";
import DailyTaskService from "./dailyTask.service";
import DeckService from "./deck.service";
import CardModel from "../models/card.model";
/** Extra card XP awarded for cards played in online (PvP) games. */
const PVP_XP_BONUS_MULTIPLIER = 1.10;
/** Ranked draft pays standard XP + 10% (see calculateCardXpRewards). */
const RANKED_DRAFT_XP_BONUS_MULTIPLIER = 1.2;

/**
 * XP targets for a finished ranked draft.
 *
 * Reads the drafted variants out of the game's own card cache (the synthetic
 * instances carry their originating card_variant_id as base_card_id) and maps
 * them to real owned instances.
 */
async function resolveDraftXpTargetsForGame(
  gameState: GameState,
  userId: string
): Promise<{ card_id: string; card_name: string }[]> {
  const cache = gameState.hydrated_card_data_cache ?? {};
  const variantIds = new Set<string>();
  for (const card of Object.values(cache)) {
    // `original_owner` ONLY — `owner` is reassigned when a card is flipped
    // (game.utils.ts createBoardCell), so matching on it would credit a player
    // for the opponent's drafted cards that they happened to capture.
    if (card.original_owner === userId) {
      variantIds.add(card.base_card_id);
    }
  }
  return resolveDraftXpTargets(userId, [...variantIds]);
}


export interface GameResult {
  winner: string | null;
  final_scores: { player1: number; player2: number };
  game_duration_seconds: number;
}

export interface CurrencyRewards {
  gems: number;
}

export interface RareCardReward {
  user_card_instance_id: string;
  card_variant_id: string;
  name: string;
  rarity: string;
  image_url: string;
}

export interface GameRewards {
  currency: CurrencyRewards;
  card_xp_rewards: XpReward[];
  rare_card_drop?: RareCardReward;
}

export interface GameCompletionResult {
  game_result: GameResult;
  rewards: GameRewards;
  /**
   * False when this game was started with no embers, meaning it awarded no card
   * XP and its souls were excluded from the season total. Absent on results
   * that predate embers; treat absent as funded.
   */
  ember_funded?: boolean;
  updated_currencies: {
    gems: number;
    total_xp: number;
  };
  win_streak_info?: {
    multiplier_applied: number;
    new_multiplier: number;
  };
}

const GameRewardsService = {
  // Calculate game result statistics
  calculateGameResult(
    gameState: GameState,
    gameStartTime: Date,
    player1Id: string,
    player2Id: string
  ): GameResult {
    const gameEndTime = new Date();
    const gameDurationMs = gameEndTime.getTime() - gameStartTime.getTime();
    const gameDurationSeconds = Math.floor(gameDurationMs / 1000);

    // Calculate scores based on controlled tiles
    let player1Score = 0;
    let player2Score = 0;

    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        const tile = gameState.board[x][y];
        if (tile && tile.card) {
          // Count cards controlled by each player
          const cardOwnerId = tile.card.owner;
          if (cardOwnerId === player1Id) {
            player1Score++;
          } else if (cardOwnerId === player2Id) {
            player2Score++;
          }
        }
      }
    }

    return {
      winner: gameState.winner,
      final_scores: { player1: player1Score, player2: player2Score },
      game_duration_seconds: gameDurationSeconds,
    };
  },

  // Calculate currency rewards based on game outcome
  // Game rewards only include gems (no gold, no fate coins)
  // isForfeit: true if game ended via surrender/disconnect (loser gets nothing)
  calculateCurrencyRewards(
    userId: string,
    winnerId: string | null,
    gameMode: GameMode,
    gameDurationSeconds: number,
    winStreakMultiplier: number = 1.0,
    isForfeit: boolean = false
  ): CurrencyRewards {
    let gemsReward = 0;

    if (winnerId === userId) {
      // Victory rewards - gems only
      if (gameMode === "solo") {
        // Base gem reward for solo victory
        gemsReward = 5;
        // Bonus for quick victory (under 3 minutes)
        if (gameDurationSeconds < 180) {
          gemsReward += 2;
        }
      } else if (isHumanVsHumanMode(gameMode)) {
        // Higher gem reward for a win against another player.
        gemsReward = 10;
        // Bonus for quick victory
        if (gameDurationSeconds < 180) {
          gemsReward += 3;
        }
        // Apply win streak multiplier for PvP games only
        gemsReward = Math.floor(gemsReward * winStreakMultiplier);
      }
    } else if (winnerId === null) {
      // Tie/draw rewards (smaller participation reward)
      gemsReward = gameMode === "solo" ? 2 : 3;
      // Apply win streak multiplier for PvP draws as well
      if (isHumanVsHumanMode(gameMode)) {
        gemsReward = Math.floor(gemsReward * winStreakMultiplier);
      }
    } else {
      // Loss rewards
      if (isForfeit) {
        // Forfeit (surrender/disconnect): loser gets nothing
        gemsReward = 0;
      } else {
        // Normal completion: loser gets participation reward
        gemsReward = gameMode === "solo" ? 1 : 5;
      }
      // No multiplier applied to losses
    }

    return {
      gems: gemsReward,
    };
  },

  // Calculate XP rewards for individual cards used in the game
  // isForfeit: true if game ended via surrender/disconnect (loser gets no XP)
  calculateCardXpRewards(
    userId: string,
    winnerId: string | null,
    gameMode: GameMode,
    playerDeckCards: { card_id: string; card_name: string }[],
    isForfeit: boolean = false
  ): { card_id: string; card_name: string; xp_gained: number }[] {
    const xpRewards = [];

    // If this is a forfeit and user is the loser, no XP
    if (isForfeit && winnerId !== userId && winnerId !== null) {
      return [];
    }

    for (const card of playerDeckCards) {
      let baseXp = 20; // Base XP for cards used in games

      // Victory bonus
      if (winnerId === userId) {
        baseXp += 5; // Extra 5 XP if player wins
      }

      // Online bonus on top of the base + victory total. Rounded so the
      // awarded value stays an integer (xp_gained is an int column).
      //
      // These are deliberately mutually exclusive branches rather than one
      // widened condition: ranked draft pays MORE than unranked, and an
      // `else if` makes it structurally impossible for the two multipliers to
      // compound if someone later widens the "pvp" test.
      if (gameMode === "pvp") {
        // +5%: at the current 20/25 base this yields 21/26.
        baseXp = Math.round(baseXp * PVP_XP_BONUS_MULTIPLIER);
      } else if (gameMode === "ranked_draft") {
        // +10%: drafting is the harder, higher-commitment mode.
        baseXp = Math.round(baseXp * RANKED_DRAFT_XP_BONUS_MULTIPLIER);
      }

      xpRewards.push({
        card_id: card.card_id,
        card_name: card.card_name,
        xp_gained: baseXp,
      });
    }

    return xpRewards;
  },

  // Get player's deck cards for XP calculation
  async getPlayerDeckCards(
    deckId: string
  ): Promise<{ card_id: string; card_name: string }[]> {
    const query = `
      SELECT uoc.user_card_instance_id as card_id, ch.name as card_name
      FROM "deck_cards" dc
      JOIN "user_owned_cards" uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE dc.deck_id = $1
    `;

    const { rows } = await db.query(query, [deckId]);
    return rows;
  },

  // Get cards that were actually used by a player during the game
  getCardsUsedInGame(
    gameState: GameState,
    playerId: string
  ): { card_id: string; card_name: string }[] {
    const usedCards: { card_id: string; card_name: string }[] = [];
    const seenCardIds = new Set<string>();

    // Get cards from the board that were originally owned by this player
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        const tile = gameState.board[x][y];
        if (tile && tile.card && tile.card.original_owner === playerId) {
          const cardId = tile.card.user_card_instance_id;
          if (!seenCardIds.has(cardId)) {
            seenCardIds.add(cardId);
            usedCards.push({
              card_id: cardId,
              card_name: tile.card.base_card_data.name,
            });
          }
        }
      }
    }

    // Get cards from the player's discard pile
    const player =
      playerId === gameState.player1.user_id
        ? gameState.player1
        : gameState.player2;
    for (const cardId of player.discard_pile) {
      if (!seenCardIds.has(cardId)) {
        const cardData = gameState.hydrated_card_data_cache?.[cardId];
        if (cardData) {
          seenCardIds.add(cardId);
          usedCards.push({
            card_id: cardId,
            card_name: cardData.base_card_data.name,
          });
        }
      }
    }

    return usedCards;
  },

  // Main method to process game completion and award rewards
  // Optimized to parallelize independent operations for faster response times
  // isForfeit: true if game ended via surrender/disconnect (loser gets nothing)
  // aiDeckId: For solo games, the AI deck ID (used for rare card drop chance)
  async processGameCompletion(
    userId: string,
    gameState: GameState,
    gameMode: GameMode,
    gameStartTime: Date,
    player1Id: string,
    player2Id: string,
    playerDeckId: string,
    gameId?: string,
    isForfeit: boolean = false,
    aiDeckId?: string,
    skipCurrency: boolean = false
  ): Promise<GameCompletionResult> {
    try {
      // === IDEMPOTENCY GATE (multiplayer only) ===
      // Claim the reward slot before touching any user state. If the row already
      // exists (double-completion race or retry), skip out immediately so gems/XP
      // are never granted twice (hardening plan 0.3).
      //
      // Ranked draft MUST be covered here: it has the same double-completion
      // races as unranked PvP, and omitting it would double-grant every reward.
      if (isHumanVsHumanMode(gameMode) && gameId) {
        const { rowCount } = await db.query(
          `INSERT INTO game_rewards_granted (game_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [gameId, userId]
        );
        if (rowCount === 0) {
          console.warn(
            `[GameRewards] Duplicate reward attempt skipped for user=${userId} game=${gameId}`
          );
          return null as unknown as GameCompletionResult;
        }
      }

      // === PHASE 1: Sequential calculations (sync, no DB) ===
      const gameResult = this.calculateGameResult(
        gameState,
        gameStartTime,
        player1Id,
        player2Id
      );

      // Which cards earn XP.
      //
      // Normally: the cards actually played. For ranked draft that would not
      // work at all — the instance ids in a draft game are synthetic
      // ("draft-<variant>-<n>") and match no row in user_owned_cards, so
      // XpService would filter them all out and silently award nothing.
      // Instead, resolve the CHARACTERS the player drafted back to their own
      // owned copies, which is also what the mode promises ("XP to the
      // characters you choose"). Characters they don't own are skipped.
      const usedCards =
        gameMode === "ranked_draft"
          ? await resolveDraftXpTargetsForGame(gameState, userId)
          : this.getCardsUsedInGame(gameState, userId);

      // === PHASE 2: Get win streak multiplier (needed for reward calculation) ===
      // Win streaks stay an unranked-PvP concept: ranked draft has its own
      // Elo ladder as its progression signal, and stacking a streak multiplier
      // on top would compound two reward curves.
      let winStreakMultiplier = 1.0;
      if (gameMode === "pvp") {
        winStreakMultiplier = await UserModel.getWinStreakMultiplier(userId);
      }

      // Calculate currency rewards (sync, depends on multiplier)
      // Tower games handle their own currency via TowerService
      const currencyRewards = skipCurrency
        ? { gems: 0 }
        : this.calculateCurrencyRewards(
          userId,
          gameResult.winner,
          gameMode,
          gameResult.game_duration_seconds,
          winStreakMultiplier,
          isForfeit
        );

      // Calculate XP rewards (sync).
      //
      // A solo or tower game started on an empty ember balance earns no card
      // XP. Read from the state rather than re-querying the games row: the
      // state is the same object the engine played with, and the row may
      // already have been rewritten by the time we get here.
      //
      // Absent means funded, so PvP, ranked draft, Sagas and every game that
      // predates embers are unaffected.
      const emberFunded = (gameState as { ember_funded?: boolean })
        .ember_funded !== false;

      const cardXpRewards = emberFunded
        ? this.calculateCardXpRewards(
          userId,
          gameResult.winner,
          gameMode,
          usedCards,
          isForfeit
        )
        : [];

      // === PHASE 3: Award core rewards (must complete before response) ===
      // These operations modify user data and must complete

      // Parallelize win streak update and gem award
      const coreRewardPromises: Promise<any>[] = [];

      if (currencyRewards.gems > 0) {
        coreRewardPromises.push(UserModel.updateGems(userId, currencyRewards.gems));
      }

      // Update win streak multiplier for PvP games only
      if (gameMode === "pvp" && player1Id !== player2Id) {
        if (gameResult.winner === userId) {
          coreRewardPromises.push(UserModel.incrementWinStreakMultiplier(userId));
        } else if (gameResult.winner !== null && gameResult.winner !== userId) {
          coreRewardPromises.push(UserModel.resetWinStreakMultiplier(userId));
        }
      }

      // Award XP directly to individual cards (this is now batched internally)
      coreRewardPromises.push(
        XpService.awardDirectCardXp(userId, cardXpRewards)
      );

      // Wait for core rewards to complete
      const coreResults = await Promise.all(coreRewardPromises);

      // Extract XP results (last item in the array)
      const xpResults = coreResults[coreResults.length - 1] as XpReward[];

      // === PHASE 3.5: Rare card drop for solo game wins (1/1000 chance) ===
      let rareCardDrop: RareCardReward | undefined;
      if (
        gameMode === "solo" &&
        gameResult.winner === userId &&
        aiDeckId &&
        !isForfeit &&
        !skipCurrency
      ) {
        // Roll for 1/500 chance
        const dropRoll = Math.random();
        if (dropRoll < 0.002) {
          try {
            // Get rare variant cards (+/++/+++) from the AI deck
            const rareCards =
              await DeckService.getRareVariantCardsFromDeck(aiDeckId);

            if (rareCards.length > 0) {
              // Pick a random rare card from the AI deck
              const randomIndex = Math.floor(Math.random() * rareCards.length);
              const selectedCard = rareCards[randomIndex];

              // Award the card to the user
              const awardedCard = await CardModel.addCardToUser(
                userId,
                selectedCard.card_variant_id
              );

              rareCardDrop = {
                user_card_instance_id: awardedCard.user_card_instance_id,
                card_variant_id: selectedCard.card_variant_id,
                name: selectedCard.name,
                rarity: selectedCard.rarity,
                image_url: selectedCard.image_url,
              };

              console.log(
                `[GameRewards] Rare card drop! User ${userId} received ${selectedCard.name} (${selectedCard.rarity}) from AI deck ${aiDeckId}`
              );
            }
          } catch (error) {
            console.error("Error processing rare card drop:", error);
            // Don't fail the entire reward process for rare card drop errors
          }
        }
      }

      // === PHASE 4: Parallel non-blocking operations ===
      // These operations don't affect the response data and can run in parallel
      const parallelOps: Promise<any>[] = [];

      // Leaderboard update. Ranked draft is included but scores against its
      // own ladder — LeaderboardService picks the season from the game mode.
      if (isHumanVsHumanMode(gameMode) && gameId && player1Id !== player2Id) {
        parallelOps.push(
          LeaderboardService.processGameCompletion(
            gameId,
            player1Id,
            player2Id,
            gameResult.winner,
            gameMode,
            gameResult.game_duration_seconds
          ).catch((error) => {
            console.error("Error updating leaderboard rankings:", error);
          })
        );
      }

      // Game completion achievement (always)
      parallelOps.push(
        AchievementService.triggerAchievementEvent({
          userId,
          eventType: "game_completion",
          eventData: {
            gameMode,
            winnerId: gameResult.winner,
            gameDurationSeconds: gameResult.game_duration_seconds,
            cardsUsed: usedCards,
          },
        }).catch((error) => {
          console.error("Error processing game_completion achievement:", error);
        })
      );

      // Game victory achievement and daily task (winners only)
      if (gameResult.winner === userId) {
        const winnerScore =
          gameResult.winner === player1Id
            ? gameResult.final_scores.player1
            : gameResult.final_scores.player2;
        const loserScore =
          gameResult.winner === player1Id
            ? gameResult.final_scores.player2
            : gameResult.final_scores.player1;

        parallelOps.push(
          AchievementService.triggerAchievementEvent({
            userId,
            eventType: "game_victory",
            eventData: {
              gameMode,
              isWinStreak: false,
              winStreakCount: 0,
              winnerScore,
              loserScore,
              gameDurationSeconds: gameResult.game_duration_seconds,
            },
          }).catch((error) => {
            console.error("Error processing game_victory achievement:", error);
          })
        );

        parallelOps.push(
          DailyTaskService.trackWin(userId).catch((error) => {
            console.error("Error tracking win for daily task:", error);
          })
        );
      }

      // Get updated user currencies (needed for response)
      parallelOps.push(UserModel.findById(userId));

      // Wait for all parallel operations
      const parallelResults = await Promise.all(parallelOps);

      // Extract updated user (last item in the array)
      const updatedUser = parallelResults[parallelResults.length - 1];

      // Prepare win streak info for PvP games
      let winStreakInfo = undefined;
      if (gameMode === "pvp") {
        winStreakInfo = {
          multiplier_applied: winStreakMultiplier,
          new_multiplier: updatedUser?.win_streak_multiplier || 1.0,
        };
      }

      return {
        game_result: gameResult,
        ember_funded: emberFunded,
        rewards: {
          currency: currencyRewards,
          card_xp_rewards: xpResults,
          rare_card_drop: rareCardDrop,
        },
        updated_currencies: {
          gems: updatedUser?.gems || 0,
          total_xp: updatedUser?.total_xp || 0,
        },
        win_streak_info: winStreakInfo,
      };
    } catch (error) {
      console.error("Error processing game completion rewards:", error);

      // Return minimal result if reward processing fails
      const gameResult = this.calculateGameResult(
        gameState,
        gameStartTime,
        player1Id,
        player2Id
      );

      return {
        game_result: gameResult,
        rewards: {
          currency: { gems: 0 },
          card_xp_rewards: [],
        },
        updated_currencies: {
          gems: 0,
          total_xp: 0,
        },
        win_streak_info: undefined,
      };
    }
  },

  /**
   * Fire achievement events for a completed SAGA battle.
   *
   * Saga games never reach processGameCompletion — the controller takes a
   * dedicated branch that calls SagaBattleService.processBattleCompletion and
   * hand-builds its result — so until this existed no achievement of any kind
   * tracked in saga mode.
   *
   * Saga has its own separate currency economy (SagaCurrencyService), which is
   * why it bypasses the normal reward path. Achievements grant independently
   * through RewardService on claim, so triggering them here cannot double-grant
   * saga currency or gems.
   *
   * gameMode is deliberately NOT passed as "solo" even though saga rows are
   * stored with game_mode = 'solo'. handleGameVictory branches on it to
   * increment solo_wins / solo_master, and saga battles should not inflate solo
   * ladder counts. Passing "saga" means the mode-agnostic achievements
   * (first_victory, perfect_game, score-margin ones) track, and the mode-gated
   * ones correctly do not.
   *
   * Never throws: a failure here must not break saga battle completion.
   */
  async processSagaAchievements(
    userId: string,
    gameState: GameState,
    winnerId: string | null
  ): Promise<void> {
    try {
      const player1Id = gameState.player1?.user_id;
      const won = !!winnerId && winnerId === userId;

      await AchievementService.triggerAchievementEvent({
        userId,
        eventType: "game_completion",
        eventData: {
          gameMode: "saga",
          winnerId,
        },
      });

      if (!won) return;

      const isPlayer1 = userId === player1Id;
      const winnerScore = isPlayer1
        ? gameState.player1.score
        : gameState.player2.score;
      const loserScore = isPlayer1
        ? gameState.player2.score
        : gameState.player1.score;

      await AchievementService.triggerAchievementEvent({
        userId,
        eventType: "game_victory",
        eventData: {
          gameMode: "saga",
          isWinStreak: false,
          winStreakCount: 0,
          winnerScore,
          loserScore,
        },
      });
    } catch (error) {
      console.error("Error processing saga achievement events:", error);
    }
  },
};

export default GameRewardsService;
