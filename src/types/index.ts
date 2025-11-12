// myth-server/src/types/index.ts

// Export database types
export * from "./database.types";

// Export API types
export * from "./api.types";

// Export card types
export * from "./card.types";

// Export game types
export * from "./game.types";

// Export socket types
export * from "./socket.types";

// Export middleware types
export * from "./middleware.types";

// Export service types (excluding conflicting ones)
export type {
  // Friends Service Types
  FriendRequestInput,
  FriendRequestResponse,
  FriendsListResponse,
  FriendRequestsResponse,
  UserSearchResponse,

  // Game Service Types
  GameRecord,
  SanitizedGame,
  CreateGameResponse,
  UpdatedGameResponse,

  // Game Rewards Service Types
  GameCompletionResult_Legacy,
  CurrencyRewards,
  GameRewards,
  GameCompletionResult,

  // XP Service Types
  XpReward,
  XpTransferResult,
  SacrificeResult,
  SacrificeExtrasResult,
  ApplyXpResult,

  // Pack Service Types
  CardWithAbility,
  PackOpenResult,

  // Mail Service Types
  MailFilters,
  PaginationOptions,
  ClaimRewardsResult,
  ClaimMultipleRewardsResult,

  // Leaderboard Service Types
  LeaderboardResponse,
  RankingStatsResponse,
  UserRankingResponse,

  // Achievement Service Types
  AchievementProgressEvent,
  AchievementCompletionResult,
  ClaimAchievementRewardsResult,

  // Deck Service Types
  DeckServiceInterface,

  // Model Types
  UserCreateInput,
  SetCreateInput,
  CreateMailInput,

  // FatePick Types
  FatePick,
  FatePickWithDetails,
  FatePickParticipation,

  // Power Up Service Types
  ApplyPowerUpRequest,
  ApplyPowerUpResult,
  PowerUpValidationResult,
} from "./service.types";

// Export game engine types
export * from "./game-engine.types";

// Export story mode types
export * from "./story-mode.types";
