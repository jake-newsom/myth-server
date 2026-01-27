# Rare Card Drop Feature - Frontend Integration Guide

## Overview

When a player wins a solo game against an AI deck, there is a **1/1000 chance (0.1%)** to receive a rare variant card (+/++/+++) from the AI's deck as a bonus reward.

## When It Can Occur

The rare card drop **only** happens when ALL of these conditions are met:
- Game mode is `solo` (not PvP)
- The player **wins** the game
- The game ends normally (not via surrender/forfeit)
- The AI deck contains at least one +/++/+++ rarity card
- The 1/1000 random roll succeeds

## Response Location

The rare card drop appears in the game completion response under:

```
rewards.rare_card_drop
```

This field will be `null` or `undefined` if no rare card was dropped.

## Response Structure

When a rare card drops, the field contains:

```json
{
  "rewards": {
    "currency": {
      "gems": 5
    },
    "card_xp_rewards": [...],
    "rare_card_drop": {
      "user_card_instance_id": "uuid-of-new-card-instance",
      "card_variant_id": "uuid-of-card-variant",
      "name": "Odin",
      "rarity": "legendary+",
      "image_url": "https://example.com/cards/odin-plus.png"
    }
  }
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `user_card_instance_id` | string (UUID) | The ID of the new card instance added to the player's collection |
| `card_variant_id` | string (UUID) | The base card variant ID |
| `name` | string | Display name of the card |
| `rarity` | string | The rarity tier (e.g., `"rare+"`, `"epic++"`, `"legendary+++"`) |
| `image_url` | string | URL to the card's image asset |

## Possible Rarity Values

The dropped card will always be a "plus" variant:
- `common+`, `common++`, `common+++`
- `uncommon+`, `uncommon++`, `uncommon+++`
- `rare+`, `rare++`, `rare+++`
- `epic+`, `epic++`, `epic+++`
- `legendary+`, `legendary++`, `legendary+++`

## Endpoints Affected

The rare card drop can appear in responses from:

1. **POST** `/api/games/{gameId}/actions` - When submitting a winning move
2. **POST** `/api/games/{gameId}/ai-action` - When the AI's move results in player victory

## Frontend Implementation Suggestions

### 1. Check for Rare Drop
```typescript
if (response.rewards?.rare_card_drop) {
  // Show special rare card animation/modal
  showRareCardDrop(response.rewards.rare_card_drop);
}
```

### 2. Display Considerations
- This is a **rare** event (0.1% chance) - make it feel special!
- Consider a unique animation or celebration effect
- Show the card image, name, and rarity prominently
- Indicate this card has been added to their collection
- The card comes from the AI deck they just defeated (thematic "loot" drop)

### 3. Timing
- Display the rare card drop **after** showing standard victory rewards
- Or integrate it as a "bonus" reveal at the end of the rewards sequence

## Example Full Response

```json
{
  "game_id": "abc123-...",
  "game_state": { ... },
  "game_status": "completed",
  "winner_id": "user-uuid-...",
  "game_result": {
    "winner": "user-uuid-...",
    "final_scores": { "player1": 10, "player2": 6 },
    "game_duration_seconds": 245
  },
  "rewards": {
    "currency": {
      "gems": 7
    },
    "card_xp_rewards": [
      { "card_id": "...", "card_name": "Thor", "xp_gained": 25 }
    ],
    "rare_card_drop": {
      "user_card_instance_id": "new-instance-uuid",
      "card_variant_id": "variant-uuid",
      "name": "Fenrir",
      "rarity": "epic++",
      "image_url": "https://cdn.example.com/cards/fenrir-plusplus.png"
    }
  },
  "updated_currencies": {
    "gems": 1250,
    "total_xp": 15000
  }
}
```

## Questions?

The card is automatically added to the user's collection - no additional API calls needed. The `user_card_instance_id` can be used to reference the card in deck building or other card operations.
