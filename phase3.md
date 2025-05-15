# Viking Vengeance: Server-Side Implementation

## Phase 3: Core Resource APIs (User Profile, Cards, Decks - Local)

**Objective:** Implement secure API endpoints for players to manage their profiles, view their card collections, create and manage decks, and for clients to retrieve static game card data.

**Parent Document:** Viking Vengeance: Server-Side Systems - PRD & Implementation Plan
**Prerequisites:** Phase 2 completed (Authentication system is functional, JWT protection is available).
**Version:** 1.0
**Date:** May 9, 2025

---

### 1. Prerequisites & Tools

- **Phase 2 Completion:** Functional authentication system, JWT `protect` middleware, basic Express project structure.
- **Node.js & npm/yarn:** Installed.
- **Project Folder:** `myth-server` with existing Phase 1 & 2 code.
- **Core Dependencies from Previous Phases:** `express`, `pg`, `dotenv`, `jsonwebtoken`, `bcrypt`, `cors`.
- **API Testing Tool:** Postman, Insomnia, or curl.
- **Database `myth`:** Populated with schema and static card data.
- **TypeScript Configuration:** Strict TypeScript mode is enabled in `tsconfig.json` with `"strict": true`.

### 2. No New Dependencies for this Phase

The existing dependencies should cover the needs of this phase.

### 3. Key Tasks & Technical Details

#### 3.1. Update Project Structure

- **Task:** Create new route, controller, and model files for users, cards, and decks. Ensure all files are TypeScript (`.ts`).
- **Action (`myth-server/src/` directory structure additions/updates):**
  ```
  myth-server/
  ├── src/
  │   ├── api/
  │   │   ├── controllers/
  │   │   │   ├── auth.controller.ts (Existing)
  │   │   │   ├── user.controller.ts   # Ensure .ts
  │   │   │   ├── card.controller.ts   # Ensure .ts
  │   │   │   └── deck.controller.ts   # Ensure .ts
  │   │   ├── middlewares/
  │   │   │   ├── auth.middleware.ts (Existing)
  │   │   │   └── error.middleware.ts (Existing)
  │   │   ├── routes/
  │   │   │   ├── index.ts (Existing - will be updated)
  │   │   │   ├── auth.routes.ts (Existing)
  │   │   │   ├── user.routes.ts     # Ensure .ts
  │   │   │   ├── card.routes.ts     # Ensure .ts
  │   │   │   └── deck.routes.ts     # Ensure .ts
  │   ├── models/
  │   │   ├── user.model.ts (Existing)
  │   │   ├── card.model.ts      # NEW/Updated - for UserCardInstance and static Cards. Ensure .ts
  │   │   └── deck.model.ts      # (Existing - will be significantly expanded). Ensure .ts
  │   ├── types/
  │   │   ├── database.types.ts (Updated in Phase 1)
  │   │   ├── api.types.ts     (Will be expanded)
  │   │   └── index.ts          # For exporting all types
  │   ├── openapi/
  │   │   ├── auth.openapi.yaml (Existing)
  │   │   ├── user.openapi.yaml    # NEW
  │   │   ├── card.openapi.yaml    # NEW
  │   │   └── deck.openapi.yaml    # NEW
  ```

#### 3.2. User Profile & Collection Endpoints (Protected)

- **Model (`myth-server/src/models/card.model.ts` - for user's card instances and static cards):**

  ```typescript
  // myth-server/src/models/card.model.ts
  import db from "../config/db.config";
  import {
    UserCardInstance,
    Card as BaseCard,
    SpecialAbility,
  } from "../types/database.types";
  import { CardResponse } from "../types/api.types"; // For formatting output

  // Helper to combine base card data with instance data and derive power
  const formatUserCardInstanceResponse = (
    baseCard: BaseCard,
    instance: UserCardInstance,
    ability: SpecialAbility | null
  ): CardResponse => {
    // Basic power derivation: For now, let's assume each level adds +1 to all power stats.
    // This should be a more sophisticated formula in a real application.
    const levelBonus = instance.level - 1;
    return {
      user_card_instance_id: instance.user_card_instance_id,
      base_card_id: baseCard.card_id,
      name: baseCard.name,
      rarity: baseCard.rarity,
      image_url: baseCard.image_url,
      power: {
        // Derived power
        top: baseCard.power.top + levelBonus,
        right: baseCard.power.right + levelBonus,
        bottom: baseCard.power.bottom + levelBonus,
        left: baseCard.power.left + levelBonus,
      },
      level: instance.level,
      xp: instance.xp,
      tags: baseCard.tags,
      special_ability_id: baseCard.special_ability_id,
      ability_name: ability?.name || null,
      ability_description: ability?.description || null,
      ability_triggerMoment: ability?.triggerMoment || null,
      ability_parameters: ability?.parameters || null,
    };
  };

  const CardModel = {
    async findInstancesByUserId(userId: string): Promise<CardResponse[]> {
      const query = `
        SELECT
          uci.user_card_instance_id, uci.user_id, uci.card_id AS base_card_id, uci.level, uci.xp,
          c.name, c.rarity, c.image_url,
          c.power_top AS base_power_top, c.power_right AS base_power_right, 
          c.power_bottom AS base_power_bottom, c.power_left AS base_power_left,
          c.special_ability_id, c.tags,
          sa.name as ability_name, sa.description as ability_description, 
          sa.trigger_moment as ability_trigger, sa.parameters as ability_parameters
        FROM "UserCardInstances" uci
        JOIN "Cards" c ON uci.card_id = c.card_id
        LEFT JOIN "SpecialAbilities" sa ON c.special_ability_id = sa.ability_id
        WHERE uci.user_id = $1
        ORDER BY c.name, uci.level DESC;
      `;
      const { rows } = await db.query(query, [userId]);
      return rows.map((row) => {
        const baseCard: BaseCard = {
          card_id: row.base_card_id,
          name: row.name,
          rarity: row.rarity,
          image_url: row.image_url,
          power: {
            top: row.base_power_top,
            right: row.base_power_right,
            bottom: row.base_power_bottom,
            left: row.base_power_left,
          },
          special_ability_id: row.special_ability_id,
          tags: row.tags,
        };
        const instance: UserCardInstance = {
          user_card_instance_id: row.user_card_instance_id,
          user_id: row.user_id,
          card_id: row.base_card_id,
          level: row.level,
          xp: row.xp,
        };
        const ability: SpecialAbility | null = row.special_ability_id
          ? {
              ability_id: row.special_ability_id, // Assuming ability_id is the FK
              id: row.ability_id_string || "", // If you have a string id like 'gungnir_strike'
              name: row.ability_name,
              description: row.ability_description,
              triggerMoment: row.ability_trigger,
              parameters: row.ability_parameters,
            }
          : null;
        return formatUserCardInstanceResponse(baseCard, instance, ability);
      });
    },

    async findBaseCardById(cardId: string): Promise<BaseCard | null> {
      const query = `SELECT card_id, name, rarity, image_url, power_top, power_right, power_bottom, power_left, special_ability_id, tags FROM "Cards" WHERE card_id = $1;`;
      const { rows } = await db.query(query, [cardId]);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        card_id: row.card_id,
        name: row.name,
        rarity: row.rarity,
        image_url: row.image_url,
        power: {
          top: row.power_top,
          right: row.power_right,
          bottom: row.power_bottom,
          left: row.power_left,
        },
        special_ability_id: row.special_ability_id,
        tags: row.tags,
      };
    },

    async findInstanceById(
      instanceId: string,
      userId: string
    ): Promise<CardResponse | null> {
      const query = `
        SELECT
          uci.user_card_instance_id, uci.user_id, uci.card_id AS base_card_id, uci.level, uci.xp,
          c.name, c.rarity, c.image_url,
          c.power_top AS base_power_top, c.power_right AS base_power_right, 
          c.power_bottom AS base_power_bottom, c.power_left AS base_power_left,
          c.special_ability_id, c.tags,
          sa.name as ability_name, sa.description as ability_description, 
          sa.trigger_moment as ability_trigger, sa.parameters as ability_parameters
        FROM "UserCardInstances" uci
        JOIN "Cards" c ON uci.card_id = c.card_id
        LEFT JOIN "SpecialAbilities" sa ON c.special_ability_id = sa.ability_id
        WHERE uci.user_card_instance_id = $1 AND uci.user_id = $2;
      `;
      const { rows } = await db.query(query, [instanceId, userId]);
      if (rows.length === 0) return null;
      const row = rows[0];
      const baseCard: BaseCard = {
        /* ... map row to BaseCard ... */ card_id: row.base_card_id,
        name: row.name,
        rarity: row.rarity,
        image_url: row.image_url,
        power: {
          top: row.base_power_top,
          right: row.base_power_right,
          bottom: row.base_power_bottom,
          left: row.base_power_left,
        },
        special_ability_id: row.special_ability_id,
        tags: row.tags,
      };
      const instance: UserCardInstance = {
        /* ... map row to UserCardInstance ... */ user_card_instance_id:
          row.user_card_instance_id,
        user_id: row.user_id,
        card_id: row.base_card_id,
        level: row.level,
        xp: row.xp,
      };
      const ability: SpecialAbility | null = row.special_ability_id
        ? {
            /* ... map row to SpecialAbility ... */ ability_id:
              row.special_ability_id,
            id: row.ability_id_string || "",
            name: row.ability_name,
            description: row.ability_description,
            triggerMoment: row.ability_trigger,
            parameters: row.ability_parameters,
          }
        : null;
      return formatUserCardInstanceResponse(baseCard, instance, ability);
    },

    // Static card data methods
    async findAllStatic(
      filters: { rarity?: string; name?: string; tag?: string } = {},
      page = 1,
      limit = 20
    ): Promise<{
      data: BaseCard[];
      total: number;
      page: number;
      limit: number;
    }> {
      const { rarity, name, tag } = filters;
      const offset = (page - 1) * limit;
      let queryParams: any[] = [limit, offset];
      let whereClauses: string[] = [];
      let paramIndex = 3;

      if (rarity) {
        whereClauses.push(`c.rarity = $${paramIndex++}`);
        queryParams.push(rarity);
      }
      if (name) {
        whereClauses.push(`c.name ILIKE $${paramIndex++}`);
        queryParams.push(`%${name}%`);
      }
      if (tag) {
        whereClauses.push(`$${paramIndex++} = ANY(c.tags)`);
        queryParams.push(tag);
      }

      const whereString =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const dataQuery = `
        SELECT
          c.card_id, c.name, c.rarity, c.image_url, 
          c.power_top, c.power_right, c.power_bottom, c.power_left,
          c.special_ability_id, c.tags,
          sa.name as ability_name, sa.description as ability_description, sa.trigger_moment as ability_trigger, sa.parameters as ability_parameters
        FROM "Cards" c
        LEFT JOIN "SpecialAbilities" sa ON c.special_ability_id = sa.ability_id
        ${whereString}
        ORDER BY c.name
        LIMIT $1 OFFSET $2;
      `;
      // Count query needs to adjust parameters if tag is used.
      const countQueryParams = queryParams.slice(2);
      const countQuery = `SELECT COUNT(*) FROM "Cards" c ${whereString};`;

      const dataResult = await db.query(dataQuery, queryParams);
      const countResult = await db.query(countQuery, countQueryParams);

      const formattedData = dataResult.rows.map((row) => ({
        card_id: row.card_id,
        name: row.name,
        rarity: row.rarity,
        image_url: row.image_url,
        power: {
          top: row.power_top,
          right: row.power_right,
          bottom: row.power_bottom,
          left: row.power_left,
        },
        special_ability_id: row.special_ability_id,
        tags: row.tags,
        // also include ability details if needed in static response
        ability_name: row.ability_name,
        ability_description: row.ability_description,
        ability_triggerMoment: row.ability_trigger,
        ability_parameters: row.ability_parameters,
      }));

      return {
        data: formattedData,
        total: parseInt(countResult.rows[0].count, 10),
        page,
        limit,
      };
    },

    async findStaticByIdWithAbility(
      cardId: string
    ): Promise<
      | (BaseCard & {
          ability_name?: string;
          ability_description?: string;
          ability_triggerMoment?: string;
          ability_parameters?: any;
        })
      | null
    > {
      const query = `
        SELECT
          c.card_id, c.name, c.rarity, c.image_url, 
          c.power_top, c.power_right, c.power_bottom, c.power_left,
          c.special_ability_id, c.tags,
          sa.name as ability_name, sa.description as ability_description, sa.trigger_moment as ability_trigger, sa.parameters as ability_parameters
        FROM "Cards" c
        LEFT JOIN "SpecialAbilities" sa ON c.special_ability_id = sa.ability_id
        WHERE c.card_id = $1;
      `;
      const { rows } = await db.query(query, [cardId]);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        card_id: row.card_id,
        name: row.name,
        rarity: row.rarity,
        image_url: row.image_url,
        power: {
          top: row.power_top,
          right: row.power_right,
          bottom: row.power_bottom,
          left: row.power_left,
        },
        special_ability_id: row.special_ability_id,
        tags: row.tags,
        ability_name: row.ability_name,
        ability_description: row.ability_description,
        ability_triggerMoment: row.ability_trigger,
        ability_parameters: row.ability_parameters,
      };
    },
  };
  export default CardModel;
  ```

- **Controller (`myth-server/src/api/controllers/user.controller.ts`):**

  ```typescript
  // myth-server/src/api/controllers/user.controller.ts
  import UserModel from "../../models/user.model";
  import CardModel from "../../models/card.model";
  import DeckModel from "../../models/deck.model";
  import { Request, Response, NextFunction } from "express"; // Assuming Express types

  interface AuthenticatedRequest extends Request {
    user?: { user_id: string /* other user props */ };
  }

  const UserController = {
    async getMyProfile(
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) {
      try {
        if (!req.user)
          return res
            .status(401)
            .json({ error: { message: "User not authenticated." } });
        const userProfile = await UserModel.findById(req.user.user_id); // Ensure UserModel.findById is updated if needed
        if (!userProfile) {
          return res
            .status(404)
            .json({ error: { message: "User not found." } });
        }
        res.status(200).json(userProfile);
      } catch (error) {
        next(error);
      }
    },

    async getMyCardInstances(
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) {
      try {
        if (!req.user)
          return res
            .status(401)
            .json({ error: { message: "User not authenticated." } });
        const ownedCardInstances = await CardModel.findInstancesByUserId(
          req.user.user_id
        );
        res.status(200).json(ownedCardInstances);
      } catch (error) {
        next(error);
      }
    },

    async getMyDecks(
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) {
      try {
        if (!req.user)
          return res
            .status(401)
            .json({ error: { message: "User not authenticated." } });
        const userDecks = await DeckModel.findAllByUserId(req.user.user_id); // This will return summaries
        res.status(200).json(userDecks);
      } catch (error) {
        next(error);
      }
    },

    async getMyDeckById(
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) {
      try {
        if (!req.user)
          return res
            .status(401)
            .json({ error: { message: "User not authenticated." } });
        const { deckId } = req.params;
        const deck = await DeckModel.findDeckWithInstanceDetails(
          deckId,
          req.user.user_id
        );
        if (!deck) {
          return res.status(404).json({
            error: { message: "Deck not found or not owned by user." },
          });
        }
        res.status(200).json(deck);
      } catch (error) {
        next(error);
      }
    },
  };
  export default UserController;
  ```

- **Routes (`myth-server/src/api/routes/user.routes.ts`):**

  ```typescript
  // myth-server/src/api/routes/user.routes.ts
  import express from "express";
  import UserController from "../controllers/user.controller";
  import { protect } from "../middlewares/auth.middleware"; // Assuming protect middleware exists

  const router = express.Router();

  router.use(protect);

  router.get("/me", UserController.getMyProfile);
  router.get("/me/cards", UserController.getMyCardInstances); // Updated to get instances
  router.get("/me/decks", UserController.getMyDecks);
  router.get("/me/decks/:deckId", UserController.getMyDeckById);

  export default router;
  ```

#### 3.3. Static Card Data Endpoints

- **Controller (`myth-server/src/api/controllers/card.controller.ts`):**

  ```typescript
  // myth-server/src/api/controllers/card.controller.ts
  import CardModel from "../../models/card.model";
  import { Request, Response, NextFunction } from "express";

  const CardController = {
    async getAllStaticCards(req: Request, res: Response, next: NextFunction) {
      try {
        const {
          page = "1",
          limit = "20",
          rarity,
          name,
          tag,
        } = req.query as {
          page?: string;
          limit?: string;
          rarity?: string;
          name?: string;
          tag?: string;
        };
        const filters = { rarity, name, tag }; // Removed 'type'
        const result = await CardModel.findAllStatic(
          filters,
          parseInt(page, 10),
          parseInt(limit, 10)
        );
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },

    async getStaticCardById(req: Request, res: Response, next: NextFunction) {
      try {
        const { cardId } = req.params;
        const card = await CardModel.findStaticByIdWithAbility(cardId); // Get base card with ability
        if (!card) {
          return res
            .status(404)
            .json({ error: { message: "Card not found." } });
        }
        res.status(200).json(card);
      } catch (error) {
        next(error);
      }
    },
  };
  export default CardController;
  ```

- **Routes (`myth-server/src/api/routes/card.routes.ts`):** (No change needed here other than ensuring it uses the .ts controller)

#### 3.4. Deck Management Endpoints (Protected)

- **Model (`myth-server/src/models/deck.model.ts` - expand existing):**

  ```typescript
  // myth-server/src/models/deck.model.ts
  import { PoolClient } from "pg";
  import db from "../config/db.config";
  import {
    Deck,
    DeckCard,
    UserCardInstance,
    Card as BaseCard,
    SpecialAbility,
  } from "../types/database.types";
  import { DeckDetailResponse, CardResponse } from "../types/api.types"; // For formatting output
  import CardModel from "./card.model"; // For fetching base card details for validation

  // Helper to format card instances for deck response (similar to the one in CardModel)
  const formatDeckCardInstanceResponse = (
    baseCard: BaseCard,
    instance: UserCardInstance,
    ability: SpecialAbility | null
  ): CardResponse => {
    const levelBonus = instance.level - 1;
    return {
      user_card_instance_id: instance.user_card_instance_id,
      base_card_id: baseCard.card_id,
      name: baseCard.name,
      rarity: baseCard.rarity,
      image_url: baseCard.image_url,
      power: {
        top: baseCard.power.top + levelBonus,
        right: baseCard.power.right + levelBonus,
        bottom: baseCard.power.bottom + levelBonus,
        left: baseCard.power.left + levelBonus,
      },
      level: instance.level,
      xp: instance.xp,
      tags: baseCard.tags,
      special_ability_id: baseCard.special_ability_id,
      ability_name: ability?.name || null,
      ability_description: ability?.description || null,
      ability_triggerMoment: ability?.triggerMoment || null,
      ability_parameters: ability?.parameters || null,
    };
  };

  const DeckModel = {
    // createWithClient from Phase 2, now expects userCardInstanceIds
    async createWithClient(
      client: PoolClient,
      userId: string,
      deckName: string,
      userCardInstanceIds: string[]
    ): Promise<DeckDetailResponse> {
      const deckQuery = `
        INSERT INTO "Decks" (user_id, name, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        RETURNING deck_id, name, user_id, created_at, updated_at;
      `;
      const deckResult = await client.query(deckQuery, [userId, deckName]);
      const deck = deckResult.rows[0];

      if (userCardInstanceIds && userCardInstanceIds.length > 0) {
        const cardInsertPromises = userCardInstanceIds.map((instanceId) => {
          const deckCardQuery = `
            INSERT INTO "DeckCards" (deck_id, user_card_instance_id)
            VALUES ($1, $2);
          `;
          return client.query(deckCardQuery, [deck.deck_id, instanceId]);
        });
        await Promise.all(cardInsertPromises);
      }
      return this.findDeckWithInstanceDetails(deck.deck_id, userId, client);
    },

    async findAllByUserId(userId: string): Promise<Deck[]> {
      // Returns basic deck info
      const query = `
        SELECT d.deck_id, d.name, d.user_id, d.created_at, d.updated_at, COUNT(dc.user_card_instance_id) as card_count
        FROM "Decks" d
        LEFT JOIN "DeckCards" dc ON d.deck_id = dc.deck_id
        WHERE d.user_id = $1
        GROUP BY d.deck_id
        ORDER BY d.updated_at DESC;
      `;
      const { rows } = await db.query(query, [userId]);
      return rows.map((row) => ({
        ...row,
        card_count: parseInt(row.card_count, 10),
      }));
    },

    async findDeckWithInstanceDetails(
      deckId: string,
      userId: string,
      client: PoolClient | typeof db = db
    ): Promise<DeckDetailResponse | null> {
      const deckQuery = `
        SELECT deck_id, name, user_id, created_at, updated_at
        FROM "Decks"
        WHERE deck_id = $1 AND user_id = $2;
      `;
      const deckResult = await client.query(deckQuery, [deckId, userId]);
      if (deckResult.rows.length === 0) {
        return null;
      }
      const deckInfo = deckResult.rows[0];

      const cardsQuery = `
        SELECT
          dc.user_card_instance_id,
          uci.level, uci.xp, uci.card_id AS base_card_id,
          c.name, c.rarity, c.image_url,
          c.power_top AS base_power_top, c.power_right AS base_power_right, 
          c.power_bottom AS base_power_bottom, c.power_left AS base_power_left,
          c.special_ability_id, c.tags,
          sa.name as ability_name, sa.description as ability_description, 
          sa.trigger_moment as ability_trigger, sa.parameters as ability_parameters
        FROM "DeckCards" dc
        JOIN "UserCardInstances" uci ON dc.user_card_instance_id = uci.user_card_instance_id
        JOIN "Cards" c ON uci.card_id = c.card_id
        LEFT JOIN "SpecialAbilities" sa ON c.special_ability_id = sa.ability_id
        WHERE dc.deck_id = $1 AND uci.user_id = $2 -- Ensure instances belong to the user
        ORDER BY c.name;
      `;
      const cardsResult = await client.query(cardsQuery, [deckId, userId]);

      const cardDetails = cardsResult.rows.map((row) => {
        const baseCard: BaseCard = {
          card_id: row.base_card_id,
          name: row.name,
          rarity: row.rarity,
          image_url: row.image_url,
          power: {
            top: row.base_power_top,
            right: row.base_power_right,
            bottom: row.base_power_bottom,
            left: row.base_power_left,
          },
          special_ability_id: row.special_ability_id,
          tags: row.tags,
        };
        const instance: UserCardInstance = {
          user_card_instance_id: row.user_card_instance_id,
          user_id: userId,
          card_id: row.base_card_id,
          level: row.level,
          xp: row.xp,
        };
        const ability: SpecialAbility | null = row.special_ability_id
          ? {
              ability_id: row.special_ability_id,
              id: row.ability_id_string || "",
              name: row.ability_name,
              description: row.ability_description,
              triggerMoment: row.ability_trigger,
              parameters: row.ability_parameters,
            }
          : null;
        return formatDeckCardInstanceResponse(baseCard, instance, ability);
      });

      return { ...deckInfo, cards: cardDetails };
    },

    async updateWithClient(
      client: PoolClient,
      deckId: string,
      userId: string,
      deckName: string | undefined,
      userCardInstanceIds: string[] | undefined
    ): Promise<DeckDetailResponse | null> {
      const ownerCheck = await client.query(
        'SELECT user_id FROM "Decks" WHERE deck_id = $1;',
        [deckId]
      );
      if (
        ownerCheck.rows.length === 0 ||
        ownerCheck.rows[0].user_id !== userId
      ) {
        const error: any = new Error(
          "Deck not found or user does not own this deck."
        );
        error.statusCode = 404;
        throw error;
      }

      if (deckName !== undefined) {
        await client.query(
          'UPDATE "Decks" SET name = $1, updated_at = NOW() WHERE deck_id = $2;',
          [deckName, deckId]
        );
      } else {
        await client.query(
          'UPDATE "Decks" SET updated_at = NOW() WHERE deck_id = $1;',
          [deckId]
        );
      }

      if (userCardInstanceIds) {
        // If new set of instances is provided, replace old ones
        await client.query('DELETE FROM "DeckCards" WHERE deck_id = $1;', [
          deckId,
        ]);
        if (userCardInstanceIds.length > 0) {
          const cardInsertPromises = userCardInstanceIds.map((instanceId) => {
            return client.query(
              'INSERT INTO "DeckCards" (deck_id, user_card_instance_id) VALUES ($1, $2);',
              [deckId, instanceId]
            );
          });
          await Promise.all(cardInsertPromises);
        }
      }
      return this.findDeckWithInstanceDetails(deckId, userId, client);
    },

    async deleteByIdAndUserId(
      deckId: string,
      userId: string,
      client: PoolClient | typeof db = db
    ): Promise<boolean> {
      // Cascading delete on "DeckCards" should be set up in DB schema.
      const result = await client.query(
        'DELETE FROM "Decks" WHERE deck_id = $1 AND user_id = $2 RETURNING deck_id;',
        [deckId, userId]
      );
      return result.rowCount > 0;
    },
  };
  export default DeckModel;
  ```

- **Controller (`myth-server/src/api/controllers/deck.controller.ts`):** Updated with new deck rules.

  ```typescript
  // myth-server/src/api/controllers/deck.controller.ts
  import DeckModel from "../../models/deck.model";
  import CardModel from "../../models/card.model"; // For fetching instance details to check base card rarity
  import db from "../../config/db.config";
  import { PoolClient } from "pg";
  import { Request, Response, NextFunction } from "express";
  import { CreateDeckRequest, UpdateDeckRequest } from "../../types/api.types";

  interface AuthenticatedRequest extends Request {
    user?: { user_id: string /* other user props */ };
  }

  // Helper function for new deck rule validation
  async function validateDeckComposition(
    userId: string,
    instanceIds: string[],
    client: PoolClient
  ): Promise<void> {
    const DECK_SIZE = 20;
    const MAX_IDENTICAL_BASE_CARDS = 2;
    const MAX_LEGENDARY_CARDS = 2;

    if (instanceIds.length !== DECK_SIZE) {
      throw {
        statusCode: 400,
        message: `Deck must contain exactly ${DECK_SIZE} cards. Found: ${instanceIds.length}.`,
      };
    }

    let legendaryCount = 0;
    const baseCardCounts = new Map<string, number>(); // To count instances of the same base card

    for (const instanceId of instanceIds) {
      // Fetch instance details to get its base_card_id and then base card rarity
      // This query is inefficient if done one by one in a loop.
      // A better approach would be to fetch all instance details in one go.
      const instanceQuery = `
        SELECT uci.card_id as base_card_id, c.rarity 
        FROM "UserCardInstances" uci 
        JOIN "Cards" c ON uci.card_id = c.card_id
        WHERE uci.user_card_instance_id = $1 AND uci.user_id = $2;
      `;
      const instanceRes = await client.query(instanceQuery, [
        instanceId,
        userId,
      ]);
      if (instanceRes.rows.length === 0) {
        throw {
          statusCode: 400,
          message: `Card instance ${instanceId} not found or not owned by user.`,
        };
      }
      const { base_card_id, rarity } = instanceRes.rows[0];

      // Count legendary cards
      if (rarity === "legendary") {
        legendaryCount++;
      }

      // Count identical base cards
      baseCardCounts.set(
        base_card_id,
        (baseCardCounts.get(base_card_id) || 0) + 1
      );
    }

    if (legendaryCount > MAX_LEGENDARY_CARDS) {
      throw {
        statusCode: 400,
        message: `Deck cannot contain more than ${MAX_LEGENDARY_CARDS} Legendary cards. Found: ${legendaryCount}.`,
      };
    }

    for (const [cardId, count] of baseCardCounts.entries()) {
      if (count > MAX_IDENTICAL_BASE_CARDS) {
        // Need card name for better error message, could fetch it.
        throw {
          statusCode: 400,
          message: `Deck cannot contain more than ${MAX_IDENTICAL_BASE_CARDS} copies of the same base card (Card ID: ${cardId}). Found: ${count}.`,
        };
      }
    }
  }

  const DeckController = {
    async createDeck(
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) {
      const client: PoolClient = await db.getClient();
      try {
        const { name, user_card_instance_ids } = req.body as CreateDeckRequest;
        const userId = req.user!.user_id;

        if (!name || !user_card_instance_ids) {
          return res
            .status(400)
            .json({
              error: {
                message: "Deck name and user_card_instance_ids are required.",
              },
            });
        }

        await client.query("BEGIN");
        await validateDeckComposition(userId, user_card_instance_ids, client); // Pass client for DB queries
        const newDeck = await DeckModel.createWithClient(
          client,
          userId,
          name,
          user_card_instance_ids
        );
        await client.query("COMMIT");

        res.status(201).json(newDeck);
      } catch (error: any) {
        await client.query("ROLLBACK");
        if (error.statusCode) {
          return res
            .status(error.statusCode)
            .json({ error: { message: error.message } });
        }
        next(error);
      } finally {
        client.release();
      }
    },

    async updateDeck(
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) {
      const client: PoolClient = await db.getClient();
      try {
        const { deckId } = req.params;
        const { name, user_card_instance_ids } = req.body as UpdateDeckRequest;
        const userId = req.user!.user_id;

        if (name === undefined && user_card_instance_ids === undefined) {
          return res
            .status(400)
            .json({
              error: {
                message:
                  "Either name or user_card_instance_ids must be provided.",
              },
            });
        }

        await client.query("BEGIN");
        if (user_card_instance_ids) {
          // Validate only if instances are being updated
          await validateDeckComposition(userId, user_card_instance_ids, client);
        }
        const updatedDeck = await DeckModel.updateWithClient(
          client,
          deckId,
          userId,
          name,
          user_card_instance_ids
        );
        await client.query("COMMIT");

        if (!updatedDeck) {
          // Should be caught by DeckModel if deck not found/owned
          return res
            .status(404)
            .json({
              error: { message: "Deck not found or not owned by user." },
            });
        }
        res.status(200).json(updatedDeck);
      } catch (error: any) {
        await client.query("ROLLBACK");
        if (error.statusCode) {
          return res
            .status(error.statusCode)
            .json({ error: { message: error.message } });
        }
        next(error);
      } finally {
        client.release();
      }
    },

    async deleteDeck(
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) {
      // ... (delete logic remains similar, ensure it uses client for transaction if needed) ...
      const client: PoolClient = await db.getClient();
      try {
        const { deckId } = req.params;
        const userId = req.user!.user_id;

        await client.query("BEGIN");
        const success = await DeckModel.deleteByIdAndUserId(
          deckId,
          userId,
          client
        );
        await client.query("COMMIT");

        if (!success) {
          return res
            .status(404)
            .json({
              error: { message: "Deck not found or not owned by user." },
            });
        }
        res.status(204).send();
      } catch (error) {
        await client.query("ROLLBACK");
        next(error);
      } finally {
        client.release();
      }
    },
  };
  export default DeckController;
  ```

- **Routes (`myth-server/src/api/routes/deck.routes.ts`):** (No change needed here other than ensuring it uses the .ts controller)

#### 3.6. Extend API Type Definitions

- **Task:** Add/Update type definitions for user, card, and deck endpoints in `api.types.ts`.
- **Action (Update `myth-server/src/types/api.types.ts`):**

  ```typescript
  // myth-server/src/types/api.types.ts
  import {
    UserCardInstance as DBUserCardInstance,
    Card as DBCard,
    Deck as DBDeck,
    SpecialAbility as DBSpecialAbility,
  } from "./database.types";

  // Authentication types (from Phase 2, ensure they are here)
  export interface RegisterRequest {
    /* ... */
  }
  export interface LoginRequest {
    /* ... */
  }
  export interface AuthResponse {
    /* ... */
  }
  export interface ErrorResponse {
    /* ... */
  }

  // User profile types
  export interface UserProfile {
    user_id: string;
    username: string;
    email: string;
    in_game_currency: number;
    created_at: string; // ISO Date string
    last_login: string; // ISO Date string
  }

  // Card types for API responses
  export interface CardResponse {
    // Represents a card instance with its current (possibly leveled) stats
    user_card_instance_id?: string; // Present if it's a user's specific instance
    base_card_id: string; // ID of the base card definition
    name: string;
    rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
    image_url: string;
    power: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
    level?: number; // Present for user instances
    xp?: number; // Present for user instances
    tags: string[];
    special_ability_id: string | null;
    ability_name: string | null;
    ability_description: string | null;
    ability_triggerMoment: string | null; // Use consistent naming
    ability_parameters: Record<string, any> | null;
  }

  export interface StaticCardCollectionResponse {
    // For /api/cards (list of base cards)
    data: CardResponse[]; // Here, CardResponse will not have user_card_instance_id, level, xp
    total: number;
    page: number;
    limit: number;
  }

  // Deck types
  export interface DeckSummary {
    // For listing multiple decks
    deck_id: string;
    name: string;
    created_at: string; // ISO Date string
    last_updated: string; // ISO Date string
    card_count: number; // Total number of card instances in the deck
  }

  export interface DeckDetailResponse {
    // For a single deck view
    deck_id: string;
    name: string;
    user_id: string;
    created_at: string; // ISO Date string
    last_updated: string; // ISO Date string
    cards: CardResponse[]; // Array of detailed card instances in the deck
  }

  export interface CreateDeckRequest {
    name: string;
    user_card_instance_ids: string[]; // Array of UserCardInstance IDs
  }

  export interface UpdateDeckRequest {
    name?: string;
    user_card_instance_ids?: string[]; // Array of UserCardInstance IDs
  }
  ```

#### 3.7. Create/Update OpenAPI Specifications

    *   Update `user.openapi.yaml` to reflect `CardResponse` for `/me/cards` and `DeckDetailResponse` for `/me/decks/:deckId`.
    *   Update `card.openapi.yaml` to reflect `StaticCardCollectionResponse` and remove `type` filter, ensure `power` is nested.
    *   Update `deck.openapi.yaml` for `CreateDeckRequest` and `UpdateDeckRequest` to use `user_card_instance_ids`. Deck responses should align with `DeckDetailResponse`.

### 4. Testing Points for Phase 3 (Updated)

- **User Profile Endpoints (all require valid JWT):**
  - [ ] **`GET /api/users/me`**: Returns 200 OK with correct user profile data (id, username, email, currency).
  - [ ] **`GET /api/users/me/cards`**: Returns 200 OK with an array of `CardResponse` objects (user's card instances), including level, XP, and derived power.
  - [ ] **`GET /api/users/me/decks`**: Returns 200 OK with an array of deck summaries (id, name, created/updated dates) owned by the user. Returns empty array if no decks.
  - [ ] **`GET /api/users/me/decks/{deckId}`**:
    - [ ] Returns 200 OK with full deck details (including array of card objects within the deck with their quantities) if deck exists and is owned by user.
    - [ ] Returns 404 Not Found if deck ID is invalid or not owned by the user.
- **Static Card Data Endpoints:**
  - [ ] **`GET /api/cards`**:
    - [ ] Returns 200 OK with `StaticCardCollectionResponse` (base cards). `type` filter is removed, `tag` filter can be used. `power` is nested.
  - [ ] **`GET /api/cards/{cardId}`**:
    - [ ] Returns 200 OK with full details of the specified card if ID exists.
    - [ ] Returns 404 Not Found if card ID is invalid.
- **Deck Management Endpoints (all require valid JWT):**
  - [ ] **`POST /api/decks`**:
    - [ ] Successful creation (201 Created) with valid name and an array of 20 `user_card_instance_ids`.
    - [ ] Deck rules are enforced by `validateDeckComposition`:
      - [ ] Exactly 20 cards.
      - [ ] Max 2 instances of the same base card.
      - [ ] Max 2 legendary cards (based on the base card's rarity).
    - [ ] Fails (400 Bad Request) if `user_card_instance_ids` are not owned by user or do not exist.
  - [ ] **`PUT /api/decks/{deckId}`**:
    - [ ] Successful update (200 OK) of deck name and/or `user_card_instance_ids`.
    - [ ] Deck rules are enforced if `user_card_instance_ids` are provided.
    - [ ] Fails (404 Not Found) if deck ID is invalid or not owned by user.
    - [ ] Fails (400 Bad Request) if trying to update with invalid card data or rule violations.
    - [ ] Updating only name works. Updating only cards works. Updating both works.
  - [ ] **`DELETE /api/decks/{deckId}`**:
    - [ ] Successful deletion (204 No Content) if deck exists and is owned by user.
    - [ ] Associated `DeckCards` entries are also deleted (CASCADE).
    - [ ] Fails (404 Not Found) if deck ID is invalid or not owned by user.
- **Transactions:** For deck creation/update, verify that if part of the operation fails (e.g., a card insertion into `DeckCards`), the whole transaction is rolled back (e.g., the `Decks` entry is not created/partially updated).

---

### 5. Next Steps

Upon successful completion of Phase 3, the project will have a functional user, card, and deck management system. The next phase (Phase 4) will focus on implementing the server-side game logic for playing matches.

**Important Development Standards:**

1. **Strict TypeScript:** All TypeScript code must continue to use strict mode, as configured in `tsconfig.json`.
2. **Type Definitions:** Maintain all shared type definitions (including `UserCardInstance`, updated `DeckCard`, and API response types like `CardResponse`, `DeckDetailResponse`) in the separate `src/types` directory files.
3. **OpenAPI Documentation:** Maintain and update OpenAPI specifications for all API endpoints in the `src/openapi` directory.
4. **Code Documentation:** Use JSDoc comments to document all important functions, classes, and interfaces.
