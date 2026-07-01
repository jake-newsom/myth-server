import UserModel from "../models/user.model";
import SagaSeasonModel from "../models/sagaSeason.model";
import SagaPlayerSeasonModel from "../models/sagaPlayerSeason.model";
import SagaCurrencyService from "./sagaCurrency.service";
import CardBackService from "./cardBack.service";
import BorderService from "./border.service";
import CardModel from "../models/card.model";
import db from "../config/db.config";
import {
  SagaShopItemDefinition,
  SagaShopItemView,
  SagaShopPurchaseResult,
  SagaShopView,
} from "../types/sagaShop.types";
import type { TriggerMoment } from "../types/card.types";

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function parseShopItems(raw: unknown): SagaShopItemDefinition[] {
  if (!Array.isArray(raw)) return [];
  const items: SagaShopItemDefinition[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const id = o.id ?? o.item_id;
    const type = o.type ?? o.item_type;
    const name = o.name;
    const cost = o.cost ?? o.price;
    if (typeof id !== "string" || typeof type !== "string" || typeof name !== "string") {
      continue;
    }
    if (typeof cost !== "number") continue;
    items.push({
      id,
      type: type as SagaShopItemDefinition["type"],
      name,
      cost,
      max_quantity:
        typeof o.max_quantity === "number" ? o.max_quantity : undefined,
      description: typeof o.description === "string" ? o.description : undefined,
      preview_image_url:
        typeof o.preview_image_url === "string"
          ? o.preview_image_url
          : undefined,
      metadata:
        o.metadata && typeof o.metadata === "object"
          ? (o.metadata as Record<string, unknown>)
          : undefined,
    });
  }
  return items;
}

const DEFAULT_SHOP_ITEMS: SagaShopItemDefinition[] = [
  {
    id: "seasonal_card",
    type: "seasonal_card",
    name: "Seasonal Card",
    cost: 400,
    max_quantity: 1,
    description: "Exclusive boss/event card for this season",
  },
  {
    id: "seasonal_card_back",
    type: "card_back",
    name: "Seasonal Card Back",
    cost: 100,
    max_quantity: 1,
  },
  {
    id: "seasonal_card_border",
    type: "card_border",
    name: "Seasonal Card Border",
    cost: 75,
    max_quantity: 1,
  },
  {
    id: "art_variant_1",
    type: "art_variant",
    name: "Card Art Variant",
    cost: 50,
    max_quantity: 1,
  },
  {
    id: "standard_pack",
    type: "pack",
    name: "Card Pack",
    cost: 25,
    description: "Standard pack for your main collection",
  },
];

interface ShopPreviewAbility {
  ability_id: string;
  id: string;
  name: string;
  description: string;
  triggerMoments: TriggerMoment[];
  parameters: Record<string, unknown>;
}

interface ShopPreviewCard {
  base_card_id: string;
  name: string;
  description?: string;
  tags: string[];
  rarity: string;
  image_url: string;
  base_power: { top: number; right: number; bottom: number; left: number };
  set_id: string;
  special_ability: ShopPreviewAbility | null;
  attack_animation?: string | null;
  is_exclusive: boolean;
}

const SagaShopService = {
  async getShopView(playerId: string, seasonId?: string): Promise<SagaShopView> {
    const season = seasonId
      ? await SagaSeasonModel.findById(seasonId)
      : await SagaSeasonModel.findActive();
    if (!season) throw httpError(404, "No active saga season");

    const progress = await SagaPlayerSeasonModel.getOrCreate(
      playerId,
      season.season_id
    );
    const balance = await SagaCurrencyService.getBalance(playerId, season.season_id);
    const catalog = parseShopItems(season.shop_items);
    const items = catalog.length > 0 ? catalog : DEFAULT_SHOP_ITEMS;

    const currencyLabel = "Echoes";

    const borderIds = new Set<string>();
    const variantIds = new Set<string>();

    for (const item of items) {
      if (item.type === "card_back") {
        const codeKey =
          typeof item.metadata?.card_back_code_key === "string"
            ? item.metadata.card_back_code_key
            : item.id;
      }
      if (item.type === "card_border") {
        const borderId =
          typeof item.metadata?.border_id === "string"
            ? item.metadata.border_id
            : null;
        if (borderId) borderIds.add(borderId);
      }
      if (item.type === "seasonal_card" || item.type === "art_variant") {
        const variantId =
          typeof item.metadata?.card_variant_id === "string"
            ? item.metadata.card_variant_id
            : null;
        if (variantId) variantIds.add(variantId);
      }
    }

    const [ownedCardBacks, ownedBorderIds, ownedVariantRows] = await Promise.all([
      CardBackService.getUserOwnedCardBacks(playerId),
      BorderService.getUserOwnedBorderIds(playerId),
      variantIds.size > 0
        ? db.query(
            `SELECT DISTINCT card_variant_id
             FROM user_owned_cards
             WHERE user_id = $1 AND card_variant_id = ANY($2::uuid[])`,
            [playerId, Array.from(variantIds)]
          )
        : Promise.resolve({ rows: [] as Array<{ card_variant_id: string }> }),
    ]);
    const ownedCardBackCodeKeys = new Set(
      ownedCardBacks.map((back) => back.code_key)
    );
    const ownedBorderIdSet = new Set(ownedBorderIds);
    const ownedVariantIdSet = new Set(
      ownedVariantRows.rows.map((row) => row.card_variant_id)
    );

    const variantPreviewById = new Map<string, ShopPreviewCard>();
    if (variantIds.size > 0) {
      const { rows } = await db.query(
        `SELECT
           cv.card_variant_id,
           cv.rarity,
           cv.image_url,
           cv.attack_animation,
           cv.is_exclusive,
           ch.name,
           ch.description,
           ch.tags,
           ch.base_power,
           ch.set_id,
           sa.ability_id AS special_ability_id,
           sa.id AS ability_key,
           sa.name AS ability_name,
           sa.description AS ability_description,
           sa.trigger_moments AS ability_trigger_moments,
           sa.parameters AS ability_parameters
         FROM card_variants cv
         JOIN characters ch ON cv.character_id = ch.character_id
         LEFT JOIN special_abilities sa ON ch.special_ability_id = sa.ability_id
         WHERE cv.card_variant_id = ANY($1::uuid[])`,
        [Array.from(variantIds)]
      );

      for (const row of rows as Array<Record<string, any>>) {
        const ability: ShopPreviewAbility | null = row.ability_name
          ? {
              ability_id: row.special_ability_id,
              id: row.ability_key ?? row.special_ability_id,
              name: row.ability_name,
              description: row.ability_description ?? "",
              triggerMoments: row.ability_trigger_moments ?? [],
              parameters: row.ability_parameters ?? {},
            }
          : null;

        variantPreviewById.set(row.card_variant_id, {
          base_card_id: row.card_variant_id,
          name: row.name,
          description: row.description ?? undefined,
          tags: Array.isArray(row.tags) ? row.tags : [],
          rarity: row.rarity,
          image_url: row.image_url,
          base_power: row.base_power,
          set_id: row.set_id,
          special_ability: ability,
          attack_animation: row.attack_animation ?? null,
          is_exclusive: row.is_exclusive ?? false,
        });
      }
    }

    const itemViews: SagaShopItemView[] = items.map((item) => {
      const purchasedCount = progress.purchased_item_ids.filter(
        (id) => id === item.id
      ).length;
      const maxQty = item.max_quantity ?? (item.type === "pack" ? Infinity : 1);
      const seasonalOwned = maxQty !== Infinity && purchasedCount >= maxQty;
      let inventoryOwned = false;
      if (item.type === "card_back") {
        const codeKey =
          typeof item.metadata?.card_back_code_key === "string"
            ? item.metadata.card_back_code_key
            : item.id;
        inventoryOwned = ownedCardBackCodeKeys.has(codeKey);
      } else if (item.type === "card_border") {
        const borderId =
          typeof item.metadata?.border_id === "string"
            ? item.metadata.border_id
            : null;
        inventoryOwned = borderId ? ownedBorderIdSet.has(borderId) : false;
      } else if (item.type === "seasonal_card" || item.type === "art_variant") {
        const variantId =
          typeof item.metadata?.card_variant_id === "string"
            ? item.metadata.card_variant_id
            : null;
        inventoryOwned = variantId ? ownedVariantIdSet.has(variantId) : false;
      }
      const owned = seasonalOwned || inventoryOwned;
      const canAfford = balance >= item.cost;
      const variantId =
        item.type === "seasonal_card" || item.type === "art_variant"
          ? typeof item.metadata?.card_variant_id === "string"
            ? item.metadata.card_variant_id
            : null
          : null;
      const previewCard = variantId ? variantPreviewById.get(variantId) : undefined;
      const metadata: Record<string, unknown> = {
        ...(item.metadata ?? {}),
      };
      if (previewCard) {
        metadata.preview_card = previewCard;
      }
      const isCardReward =
        item.type === "seasonal_card" || item.type === "art_variant";
      return {
        ...item,
        description:
          isCardReward
            ? previewCard?.special_ability?.description ??
              previewCard?.description ??
              item.description
            : item.description,
        preview_image_url: item.preview_image_url ?? previewCard?.image_url,
        metadata,
        owned,
        purchased_count: purchasedCount,
        can_purchase: canAfford && !owned,
      };
    });

    return {
      season_id: season.season_id,
      season_name: season.season_name,
      currency_label: currencyLabel,
      currency_balance: balance,
      items: itemViews,
    };
  },

  async purchase(
    playerId: string,
    seasonId: string,
    itemId: string
  ): Promise<SagaShopPurchaseResult> {
    const view = await this.getShopView(playerId, seasonId);
    const item = view.items.find((i) => i.id === itemId);
    if (!item) throw httpError(404, "Shop item not found");
    if (item.owned) throw httpError(400, "You already own this item");
    if (!item.can_purchase) {
      throw httpError(400, "Not enough currency for this purchase");
    }

    const progress = await SagaPlayerSeasonModel.getOrCreate(
      playerId,
      seasonId
    );
    const purchased = [...progress.purchased_item_ids, itemId];
    const activeRunId = await this.findActiveRunId(playerId, seasonId);
    const balance = await SagaCurrencyService.spend(
      playerId,
      seasonId,
      item.cost,
      activeRunId
    );

    await SagaPlayerSeasonModel.update(playerId, seasonId, {
      purchased_item_ids: purchased,
    });

    if (item.type === "pack") {
      const packQty =
        typeof item.metadata?.quantity === "number" ? item.metadata.quantity : 1;
      await UserModel.addPacks(playerId, packQty);
    }

    if (item.type === "card_back") {
      const codeKey =
        typeof item.metadata?.card_back_code_key === "string"
          ? item.metadata.card_back_code_key
          : item.id;
      await CardBackService.grantCardBackByCodeKey(playerId, codeKey);
    }

    if (item.type === "card_border") {
      const borderId =
        typeof item.metadata?.border_id === "string" ? item.metadata.border_id : "";
      if (!borderId) {
        throw httpError(400, "Shop border item missing border_id metadata");
      }
      await BorderService.grantBorder(playerId, borderId);
    }

    if (item.type === "seasonal_card" || item.type === "art_variant") {
      const variantId =
        typeof item.metadata?.card_variant_id === "string"
          ? item.metadata.card_variant_id
          : "";
      if (!variantId) {
        throw httpError(400, "Shop card item missing card_variant_id metadata");
      }
      await CardModel.addCardToUser(playerId, variantId);
    }

    if (activeRunId) {
      await SagaCurrencyService.syncRunDisplayCurrency(
        activeRunId,
        playerId,
        seasonId
      );
    }

    return {
      item_id: itemId,
      cost: item.cost,
      currency_balance: balance,
      purchased_item_ids: purchased,
    };
  },

  async findActiveRunId(
    playerId: string,
    seasonId: string
  ): Promise<string | undefined> {
    const run = await import("../models/sagaRun.model").then((m) =>
      m.default.findActiveByPlayerAndSeason(playerId, seasonId)
    );
    return run?.run_id;
  },
};

export default SagaShopService;
