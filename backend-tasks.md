# Viking Vengeance Backend API - Feature Status & Usage Guide

This document provides a clear overview of backend API requirements, their current implementation status, and usage examples for completed features.

## 📋 QUICK STATUS OVERVIEW

| Feature Category | Status      | Endpoints | Ready for Client? |
| ---------------- | ----------- | --------- | ----------------- |
| Authentication   | ✅ Complete | 2         | ✅ Yes            |
| User Profile     | ✅ Complete | 2         | ✅ Yes            |
| Card Collection  | ✅ Complete | 3         | ✅ Yes            |
| Deck Management  | ✅ Complete | 2         | ✅ Yes            |
| Pack System      | ✅ Complete | 2         | ✅ Yes            |
| Currency System  | ✅ Complete | 4         | ✅ Yes            |
| XP & Leveling    | ✅ Complete | 6         | ✅ Yes            |
| Solo Gameplay    | ✅ Complete | 4         | ✅ Yes            |
| Multiplayer      | 🔄 Partial  | 3         | ⚠️ Basic Only     |
| Friends System   | ✅ Complete | 9         | ✅ Yes            |
| Leaderboards     | ✅ Complete | 7         | ✅ Yes            |
| Achievements     | ✅ Complete | 7         | ✅ Yes            |
| Fate Picks       | ✅ Complete | 6         | ✅ Yes            |
| Mail System      | ✅ Complete | 11        | ✅ Yes            |

**Total API Endpoints:** 67 implemented

---

## 📋 FEATURE DETAILS & USAGE

### 1. Authentication System

**Status:** ✅ **COMPLETE** - Ready for production  
**Original Requirement:** User registration, login, JWT authentication

#### Available Endpoints:

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User authentication

#### Usage Examples:

**Register New User:**

```bash
POST /api/auth/register
Content-Type: application/json

{
  "username": "thor_hammer",
  "email": "thor@asgard.com",
  "password": "mjolnir123"
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "user_id": "uuid",
    "username": "thor_hammer",
    "email": "thor@asgard.com",
    "gold": 100,
    "gems": 0,
    "fate_coins": 3,
    "total_xp": 0
  }
}
```

**Login:**

```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "thor@asgard.com",
  "password": "mjolnir123"
}
```

---

### 2. User Profile Management

**Status:** ✅ **COMPLETE** - Full profile and active games tracking  
**Original Requirement:** Get user profile, track active games

#### Available Endpoints:

- `GET /api/users/me` - Get user profile
- `GET /api/users/me/active-games` - Get user's active games

#### Usage Examples:

**Get User Profile:**

```bash
GET /api/users/me
Authorization: Bearer your_jwt_token
```

**Response:**

```json
{
  "user_id": "uuid",
  "username": "thor_hammer",
  "email": "thor@asgard.com",
  "gold": 150,
  "gems": 5,
  "fate_coins": 2,
  "total_xp": 450,
  "pack_count": 3
}
```

---

### 3. Card Collection Management

**Status:** ✅ **COMPLETE** - Full collection with levels/XP  
**Original Requirement:** View owned cards, card levels, rarity system

#### Available Endpoints:

- `GET /api/users/me/cards` - Get user's card collection
- `GET /api/cards` - Get all available cards
- `GET /api/cards/{cardId}` - Get specific card details

#### Usage Examples:

**Get Card Collection:**

```bash
GET /api/users/me/cards
Authorization: Bearer your_jwt_token
```

**Response:**

```json
{
  "cards": [
    {
      "user_card_instance_id": "uuid",
      "base_card_id": "uuid",
      "level": 3,
      "xp": 250,
      "base_card_data": {
        "name": "Thunder Strike",
        "rarity": "epic",
        "base_power": { "top": 8, "right": 6, "bottom": 4, "left": 7 }
      }
    }
  ]
}
```

---

### 4. Deck Management

**Status:** ✅ **COMPLETE** - Full deck CRUD operations  
**Original Requirement:** Create, edit, delete decks with validation

#### Available Endpoints:

- `GET /api/users/me/decks` - Get user's decks
- `POST /api/decks` - Create new deck

#### Usage Examples:

**Create Deck:**

```bash
POST /api/decks
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "name": "Lightning Deck",
  "card_instance_ids": ["uuid1", "uuid2", "uuid3"]
}
```

---

### 5. Pack Opening System

**Status:** ✅ **COMPLETE** - Rarity-based pack opening  
**Original Requirement:** Open packs, get random cards with rarity weights

#### Available Endpoints:

- `POST /api/packs/open` - Open a card pack
- `GET /api/packs` - Get pack count

#### Usage Examples:

**Open Pack:**

```bash
POST /api/packs/open
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "setId": "uuid-of-card-set"
}
```

**Response:**

```json
{
  "cards": [
    {
      "card_id": "uuid",
      "name": "Lightning Bolt",
      "rarity": "rare",
      "base_power": { "top": 6, "right": 5, "bottom": 3, "left": 4 }
    }
  ],
  "remainingPacks": 2
}
```

---

### 6. Currency System

**Status:** ✅ **COMPLETE** - Dual currency with pack purchasing  
**Original Requirement:** Gold, gems, pack purchasing system

#### Available Endpoints:

- `GET /api/currency` - Get current currency balances
- `GET /api/currency/pack-prices` - Get pack prices
- `POST /api/currency/purchase-packs` - Purchase packs with currency
- `POST /api/currency/award` - Award currency (admin/achievements)

#### Usage Examples:

**Get Currency Balance:**

```bash
GET /api/currency
Authorization: Bearer your_jwt_token
```

**Response:**

```json
{
  "gold": 250,
  "gems": 15,
  "total_xp": 1200,
  "in_game_currency": 250
}
```

**Purchase Packs:**

```bash
POST /api/currency/purchase-packs
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "packType": "standard",
  "quantity": 3,
  "currency": "gold"
}
```

---

### 7. Card XP & Leveling System

**Status:** ✅ **COMPLETE** - Full XP management with transfers and sacrificing  
**Original Requirement:** Level up cards, transfer XP, sacrifice cards

#### Available Endpoints:

- `GET /api/xp/pools` - Get all XP pools
- `GET /api/xp/pools/{cardName}` - Get specific card XP pool
- `POST /api/xp/transfer` - Transfer XP between cards
- `POST /api/xp/sacrifice` - Sacrifice cards for XP
- `POST /api/xp/apply` - Apply XP from pool to card
- `GET /api/xp/history` - Get XP transfer history

#### Usage Examples:

**Transfer XP Between Cards:**

```bash
POST /api/xp/transfer
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "sourceCardInstanceId": "uuid1",
  "targetCardInstanceId": "uuid2",
  "xpAmount": 100
}
```

**Sacrifice Cards for XP Pool:**

```bash
POST /api/xp/sacrifice
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "cardInstanceIds": ["uuid1", "uuid2"]
}
```

---

### 8. Solo Game System

**Status:** ✅ **COMPLETE** - Full PvE gameplay with AI  
**Original Requirement:** Solo games against AI with game rewards

#### Available Endpoints:

- `POST /api/games/solo` - Create solo game
- `GET /api/games/{gameId}` - Get game state
- `POST /api/games/{gameId}/actions` - Submit player action
- `POST /api/games/{gameId}/ai-action` - Process AI turn

#### Usage Examples:

**Create Solo Game:**

```bash
POST /api/games/solo
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "deckId": "uuid-of-your-deck"
}
```

**Submit Game Action:**

```bash
POST /api/games/{gameId}/actions
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "actionType": "placeCard",
  "user_card_instance_id": "uuid",
  "position": {"x": 1, "y": 2}
}
```

---

### 9. Multiplayer System

**Status:** 🔄 **PARTIAL** - Basic matchmaking, missing real-time features  
**Original Requirement:** PvP matchmaking, real-time game updates

#### Available Endpoints:

- `POST /api/matchmaking/join` - Join matchmaking queue
- `GET /api/matchmaking/status` - Check queue status
- `POST /api/matchmaking/leave` - Leave queue

#### Usage Examples:

**Join Matchmaking:**

```bash
POST /api/matchmaking/join
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "deckId": "uuid-of-your-deck"
}
```

#### ⚠️ Missing Features:

- Real-time game updates (SSE)
- Turn timeout system
- Enhanced matchmaking events

---

### 10. Friends & Social Features

**Status:** ✅ **COMPLETE** - Full social system with challenges  
**Original Requirement:** Add friends, friend requests, challenge friends

#### Available Endpoints:

- `GET /api/friends` - Get friends list
- `GET /api/friends/requests` - Get friend requests
- `GET /api/friends/search` - Search users
- `GET /api/friends/status/{userId}` - Check friendship status
- `POST /api/friends/add` - Send friend request
- `POST /api/friends/accept/{friendshipId}` - Accept request
- `POST /api/friends/reject/{friendshipId}` - Reject request
- `POST /api/friends/challenge/{friendId}` - Challenge friend
- `DELETE /api/friends/{friendshipId}` - Remove friend

#### Usage Examples:

**Search for Friends:**

```bash
GET /api/friends/search?query=thor
Authorization: Bearer your_jwt_token
```

**Send Friend Request:**

```bash
POST /api/friends/add
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "userId": "uuid-of-user-to-add",
  "message": "Let's be friends!"
}
```

**Challenge Friend to Game:**

```bash
POST /api/friends/challenge/{friendId}
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "deckId": "uuid-of-your-deck"
}
```

---

### 11. Leaderboard System

**Status:** ✅ **COMPLETE** - ELO rating system with 7 tiers  
**Original Requirement:** Competitive rankings and leaderboards

#### Available Endpoints:

- `GET /api/leaderboard` - Get current leaderboard
- `GET /api/leaderboard/stats` - Get leaderboard statistics
- `GET /api/leaderboard/me` - Get user's ranking
- `GET /api/leaderboard/me/history` - Get rank history
- `GET /api/leaderboard/me/around` - Get leaderboard around user
- `GET /api/leaderboard/user/{identifier}` - Get specific user rank
- `POST /api/leaderboard/me/initialize` - Initialize user for season

#### Usage Examples:

**Get Current Leaderboard:**

```bash
GET /api/leaderboard?page=1&limit=50
Authorization: Bearer your_jwt_token
```

**Get Your Ranking:**

```bash
GET /api/leaderboard/me
Authorization: Bearer your_jwt_token
```

**Response:**

```json
{
  "user_ranking": {
    "rating": 1350,
    "wins": 15,
    "losses": 8,
    "tier": "gold"
  },
  "rank_position": 42,
  "rank_progress": {
    "current_tier": "gold",
    "next_tier": "platinum",
    "rating_needed_for_next_tier": 250,
    "progress_percentage": 75
  }
}
```

---

### 12. Achievements System

**Status:** ✅ **COMPLETE** - 20 achievements with reward claiming  
**Original Requirement:** Achievement tracking with rewards

#### Available Endpoints:

- `GET /api/achievements` - Get all achievements
- `GET /api/achievements/categories` - Get achievement categories
- `GET /api/achievements/{achievementKey}` - Get specific achievement
- `GET /api/achievements/me/progress` - Get user progress
- `GET /api/achievements/me/stats` - Get user achievement stats
- `GET /api/achievements/me/recent` - Get recent achievements
- `POST /api/achievements/{achievementId}/claim` - Claim rewards

#### Usage Examples:

**Get Your Achievement Progress:**

```bash
GET /api/achievements/me/progress
Authorization: Bearer your_jwt_token
```

**Claim Achievement Rewards:**

```bash
POST /api/achievements/{achievementId}/claim
Authorization: Bearer your_jwt_token
```

**Response:**

```json
{
  "claimedAchievements": [
    {
      "achievement_key": "first_victory",
      "rewards": { "gold": 100, "gems": 1 }
    }
  ],
  "totalRewards": { "gold": 100, "gems": 1 },
  "updatedCurrencies": { "gold": 350, "gems": 16 }
}
```

---

### 13. Fate Picks System

**Status:** ✅ **COMPLETE** - Social pack opening gambling mechanic  
**Original Requirement:** Social pack interaction system with special currency

#### Available Endpoints:

- `GET /api/fate-picks` - Browse available fate picks
- `GET /api/fate-picks/{fatePickId}` - Get specific fate pick
- `POST /api/fate-picks/{fatePickId}/participate` - Participate with fate coins
- `POST /api/fate-picks/{fatePickId}/select` - Select card position
- `GET /api/fate-picks/history` - Get participation history
- `GET /api/fate-picks/stats` - Get fate pick statistics

#### Usage Examples:

**Browse Available Fate Picks:**

```bash
GET /api/fate-picks?page=1&limit=20
Authorization: Bearer your_jwt_token
```

**Participate in Fate Pick:**

```bash
POST /api/fate-picks/{fatePickId}/participate
Authorization: Bearer your_jwt_token
```

**Select Your Prize:**

```bash
POST /api/fate-picks/{fatePickId}/select
Authorization: Bearer your_jwt_token
Content-Type: application/json

{
  "selectedPosition": 2
}
```

---

### 14. Mail System

**Status:** ✅ **COMPLETE** - In-game inbox with rewards  
**Original Requirement:** Mail system for notifications and rewards

#### Available Endpoints:

- `GET /api/mail` - Get user's mail
- `GET /api/mail/stats` - Get mail statistics
- `GET /api/mail/counts` - Get unread/unclaimed counts
- `GET /api/mail/recent` - Get recent mail
- `GET /api/mail/{mailId}` - Get specific mail
- `PUT /api/mail/{mailId}/read` - Mark mail as read
- `PUT /api/mail/read/multiple` - Mark multiple as read
- `PUT /api/mail/read/all` - Mark all as read
- `POST /api/mail/{mailId}/claim` - Claim mail rewards
- `POST /api/mail/claim/all` - Claim all rewards
- `POST /api/mail/send/system` - Send system mail (admin)

#### Usage Examples:

**Get Your Mail:**

```bash
GET /api/mail?page=1&limit=20
Authorization: Bearer your_jwt_token
```

**Claim All Rewards:**

```bash
POST /api/mail/claim/all
Authorization: Bearer your_jwt_token
```

---

## 🔧 AUTHENTICATION

All endpoints require JWT authentication. Include the token in the Authorization header:

```bash
Authorization: Bearer your_jwt_token_here
```

## 🚨 MISSING FEATURES (Not Implemented)

The following were mentioned in requirements but are not yet implemented:

1. **Real-time Multiplayer Updates** - Missing SSE for live game updates
2. **Turn Timeout System** - No automatic turn timeouts in PvP
3. **Push Notifications** - No mobile push notification system
4. **Advanced Anti-cheat** - Basic validation only

## 📊 READY FOR CLIENT INTEGRATION

**✅ FULLY READY (65 endpoints):**

- All core game features are complete and production-ready
- Authentication, user management, cards, decks, packs
- XP system, currency system, solo gameplay
- Full social features (friends, leaderboards, achievements)
- Advanced features (fate picks, mail system)

**⚠️ PARTIALLY READY (3 endpoints):**

- Basic multiplayer works but lacks real-time features
- Matchmaking functional but missing enhanced notifications

The backend is production-ready for most client features. The only major gap is enhanced real-time multiplayer functionality.
