import CardBackModel, {
  CardBackInput,
  CardBackUpdate,
  OwnedCardBackRow,
} from "../models/cardBack.model";
import { CardBack } from "../types/database.types";
import logger from "../utils/logger";

const ACTIVE_CACHE_KEY = "card-backs:active";
const ACTIVE_CACHE_TTL_SECONDS = 60 * 30;

// Reuse redis cache pattern used in border service.
import { redisCache } from "./redis.cache.service";

const CardBackService = {
  async getActiveCatalog(): Promise<CardBack[]> {
    const cached = await redisCache.get<CardBack[]>(ACTIVE_CACHE_KEY);
    if (cached) return cached;
    const backs = await CardBackModel.listActive();
    await redisCache.set(ACTIVE_CACHE_KEY, backs, ACTIVE_CACHE_TTL_SECONDS);
    return backs;
  },

  async getFullCatalog(): Promise<CardBack[]> {
    return CardBackModel.listAll();
  },

  async getById(backId: string): Promise<CardBack | null> {
    return CardBackModel.findById(backId);
  },

  async getByCodeKey(codeKey: string): Promise<CardBack | null> {
    return CardBackModel.findByCodeKey(codeKey);
  },

  async getUserOwnedCardBacks(userId: string): Promise<OwnedCardBackRow[]> {
    return CardBackModel.listOwnedWithDetails(userId);
  },

  async validateDeckCardBackSelection(
    userId: string,
    backId: string | null | undefined
  ): Promise<{ valid: boolean; error?: string }> {
    if (backId === undefined || backId === null) {
      return { valid: true };
    }

    const [back, owns] = await Promise.all([
      CardBackModel.findById(backId),
      CardBackModel.userOwnsBack(userId, backId),
    ]);

    if (!back) return { valid: false, error: "Card back not found" };
    if (!back.is_active) return { valid: false, error: "Card back is not active" };
    if (!owns) {
      return { valid: false, error: "User does not own this card back" };
    }

    return { valid: true };
  },

  async createCardBack(input: CardBackInput): Promise<CardBack> {
    const back = await CardBackModel.create(input);
    await this.invalidateCatalogCache();
    return back;
  },

  async updateCardBack(
    backId: string,
    updates: CardBackUpdate
  ): Promise<CardBack | null> {
    const back = await CardBackModel.update(backId, updates);
    await this.invalidateCatalogCache();
    return back;
  },

  async deactivateCardBack(backId: string): Promise<CardBack | null> {
    const back = await CardBackModel.softDelete(backId);
    await this.invalidateCatalogCache();
    return back;
  },

  async grantCardBack(userId: string, backId: string): Promise<boolean> {
    return CardBackModel.grantToUser(userId, backId);
  },

  async grantCardBackByCodeKey(
    userId: string,
    codeKey: string
  ): Promise<boolean> {
    const back = await CardBackModel.findByCodeKey(codeKey);
    if (!back || !back.is_active) {
      return false;
    }
    return CardBackModel.grantToUser(userId, back.back_id);
  },

  async revokeCardBack(userId: string, backId: string): Promise<boolean> {
    return CardBackModel.revokeFromUser(userId, backId);
  },

  async invalidateCatalogCache(): Promise<void> {
    try {
      await redisCache.delete(ACTIVE_CACHE_KEY);
    } catch (error) {
      logger.error(
        "Failed to invalidate card-back cache",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
    }
  },
};

export default CardBackService;
