# Story Mode System Guide

## Overview

The Story Mode system allows you to configure pre-defined AI opponents with specific decks, difficulty levels, unlock requirements, and rewards. Players progress through 10 chapters, each with 5 difficulty levels (1–5) that reflect the AI's card level and intelligence. Each chapter features a preconfigured AI deck and theme, scaling in both stats and tactics. Completing all difficulties of a chapter fully "masters" that storyline.

### 🗺️ Campaign Overview

| Chapter | Theme                       | Difficulties | Deck Source  | Boss        |
| ------- | --------------------------- | ------------ | ------------ | ----------- |
| 1       | Forest Whispers (Japanese)  | 5            | ch1_ai_deck  | Hachiman    |
| 2       | Sun over Steel              | 5            | ch2_ai_deck  | Susanoo     |
| 3       | Winter of Ravens (Norse)    | 5            | ch3_ai_deck  | Vidar       |
| 4       | Hammerfall                  | 5            | ch4_ai_deck  | Thor        |
| 5       | Tides of Creation (Poly)    | 5            | ch5_ai_deck  | Pele        |
| 6       | Heart of Fire               | 5            | ch6_ai_deck  | Kāne        |
| 7       | Clash of Currents (JP×Poly) | 5            | ch7_ai_deck  | Ryūjin      |
| 8       | Twilight Council (JP×Norse) | 5            | ch8_ai_deck  | Odin        |
| 9       | When Worlds Collide         | 5            | ch9_ai_deck  | Loki        |
| 10      | The Convergence             | 5            | ch10_ai_deck | Odin & Pele |

## Features

### 🎯 Core Functionality

- **Pre-configured AI opponents** with specific decks and difficulties
- **Progressive unlock system** with customizable requirements
- **Flexible reward system** supporting multiple reward types
- **Progress tracking** with completion statistics
- **Admin management interface** for easy configuration

### 🏆 Reward Types

- **Currency**: Gold, Gems, Fate Coins, Card Fragments
- **Cards**: Specific cards or random card packs
- **XP**: Card experience points
- **Achievements**: Unlock specific achievements
- **Custom rewards**: Extensible for future reward types

### ⚔️ Difficulty Levels

Each story mode chapter has five difficulties:

| Level | AI Card Level | Description                                     |
| ----- | ------------- | ----------------------------------------------- |
| 1     | 1             | Easy — AI uses base card stats                  |
| 2     | 2             | Normal — +1 to one side per card                |
| 3     | 3             | Hard — +2 across two sides total                |
| 4     | 4             | Expert — +3 total (one per side up to level)    |
| 5     | 5             | Mythic — +4 total, optimized AI placement logic |

Defeating a difficulty unlocks the next within the same chapter.

### 🔓 Unlock Requirements

- **Difficulty progression**: Each higher difficulty requires beating the previous difficulty of the same chapter
- **Sequential progression**: Require completing previous story modes
- **Level gating**: Minimum user level requirements
- **Achievement requirements**: Specific achievements must be completed
- **Win count requirements**: Minimum total story wins needed
- **Custom conditions**: Extensible for complex unlock logic

## Database Schema

### Tables Created

1. **`story_mode_config`** - Main story mode configurations (each row represents a chapter × difficulty combination)
2. **`story_mode_rewards`** - Reward definitions for each story mode
3. **`user_story_progress`** - User progress tracking

### Conceptual Structure

While the current schema uses `story_mode_config` as a flattened representation, conceptually the system is organized as:

- **Chapters**: 10 thematic storylines with unique AI decks and bosses
- **Difficulties**: Each chapter has 5 difficulty levels (1–5), creating 50 total story mode entries
- **Progression**: Players unlock higher difficulties within a chapter by completing previous ones

Each `story_mode_config` row represents one chapter × difficulty pairing, with appropriate `order_index` and `unlock_requirements` to enforce the progression chain.

### Migration

Run the migration to create the necessary tables:

```bash
# The migration file: migrations/1762400000000_create-story-mode-tables.js
npm run migrate
```

## API Endpoints

### Player Endpoints

- `GET /api/story-modes` - Get available story modes for user
- `POST /api/story-modes/start` - Start a story mode game
- `GET /api/story-modes/progress` - Get user's progress
- `POST /api/story-modes/complete` - Process game completion
- `GET /api/story-modes/{id}/unlock-status` - Check unlock status

### Admin Endpoints

- `GET /api/admin/story-modes` - List all story modes
- `POST /api/admin/story-modes` - Create new story mode
- `GET /api/admin/story-modes/{id}` - Get specific story mode
- `PUT /api/admin/story-modes/{id}` - Update story mode
- `DELETE /api/admin/story-modes/{id}` - Delete story mode

## Configuration Examples

### Basic Story Mode (Chapter 1, Difficulty 1)

```typescript
{
  name: "Forest Whispers - Level 1",
  description: "A gentle introduction to combat",
  difficulty: 1, // Difficulty level 1-5
  ai_deck_id: "uuid-of-ch1-ai-deck",
  order_index: 0,
  unlock_requirements: {}, // Available from start (first chapter, first difficulty)
  rewards: [
    {
      reward_type: "first_win",
      reward_data: {
        gold: 100,
        gems: 5,
        card_xp: 50
      }
    },
    {
      reward_type: "repeat_win",
      reward_data: {
        gold: 25,
        card_xp: 15
      }
    }
  ]
}
```

### Advanced Story Mode with Requirements (Chapter 10, Difficulty 5)

```typescript
{
  name: "The Convergence - Level 5",
  description: "The ultimate challenge",
  difficulty: 5, // Highest difficulty level
  ai_deck_id: "uuid-of-ch10-ai-deck",
  order_index: 49, // Last entry (10 chapters × 5 difficulties - 1)
  unlock_requirements: {
    prerequisite_stories: ["uuid-of-ch10-difficulty-4"], // Must complete previous difficulty
    min_user_level: 15,
    min_total_story_wins: 45, // Must have completed most of campaign
    required_achievements: ["uuid-of-achievement"]
  },
  rewards: [
    {
      reward_type: "first_win",
      reward_data: {
        gold: 300,
        gems: 25,
        card_xp: 150,
        fate_coins: 1,
        specific_cards: ["uuid-of-legendary-card"]
      }
    }
  ]
}
```

## Usage Examples

### Setting Up Story Modes

1. **Run the example setup script**:

```bash
node scripts/setup-example-story-modes.js
```

2. **Create a story mode via API**:

```bash
curl -X POST http://localhost:3000/api/admin/story-modes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Forest Guardian",
    "description": "An ancient protector challenges you",
    "difficulty": "medium",
    "ai_deck_id": "uuid-of-ai-deck",
    "unlock_requirements": {
      "min_user_level": 5
    },
    "rewards": [
      {
        "reward_type": "first_win",
        "reward_data": {
          "gold": 150,
          "gems": 10
        }
      }
    ]
  }'
```

### Playing Story Modes

1. **Get available story modes**:

```bash
curl -X GET http://localhost:3000/api/story-modes \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

2. **Start a story mode game**:

```bash
curl -X POST http://localhost:3000/api/story-modes/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "story_id": "uuid-of-story-mode-difficulty",
    "player_deck_id": "uuid-of-player-deck"
  }'
```

Note: The `story_id` refers to a specific chapter & difficulty combination, not just the chapter. Each of the 50 entries (10 chapters × 5 difficulties) has its own unique identifier.

## Configuration Constants

The system includes predefined constants in `src/config/constants.ts`:

```typescript
export const STORY_MODE_CONFIG = {
  DEFAULT_REWARDS: {
    FIRST_WIN: {
      LEVEL_1: { gold: 100, gems: 5, card_xp: 50 },
      LEVEL_2: { gold: 150, gems: 8, card_xp: 75 },
      LEVEL_3: { gold: 200, gems: 12, card_xp: 100 },
      LEVEL_4: { gold: 250, gems: 18, card_xp: 125 },
      LEVEL_5: { gold: 300, gems: 25, card_xp: 150, fate_coins: 1 },
    },
    // ... more configurations
  },
  UNLOCK_TEMPLATES: {
    STARTER: {}, // First chapter, first difficulty
    DIFFICULTY_PROGRESSION: (previousDifficultyId) => ({
      prerequisite_stories: [previousDifficultyId],
    }),
    CHAPTER_PROGRESSION: (previousChapterLastDifficultyId) => ({
      prerequisite_stories: [previousChapterLastDifficultyId],
    }),
    LEVEL_GATED: (minLevel) => ({ min_user_level: minLevel }),
    // ... more templates
  },
  CHAPTERS: 10,
  DIFFICULTIES_PER_CHAPTER: 5,
  TOTAL_ENTRIES: 50, // 10 chapters × 5 difficulties
};
```

## Integration with Game System

### Game Creation Integration

The story mode system integrates with your existing game creation flow. When a player starts a story mode:

1. **Validation**: Check unlock requirements and deck ownership
2. **Game Creation**: Create a new game with the AI opponent
3. **Configuration**: Apply story mode specific settings (difficulty, etc.)

### Game Completion Integration

When a story mode game completes:

1. **Progress Tracking**: Update user's story progress
2. **Reward Calculation**: Determine appropriate rewards (first win vs repeat)
3. **Reward Distribution**: Award currency, cards, XP, etc.
4. **Unlock Check**: Check if new story modes are unlocked

## Best Practices

### Story Mode Design

1. **Chapter Structure**: Organize content into 10 distinct chapters with thematic consistency
2. **Progressive Difficulty**: Each chapter scales from difficulty 1 to 5, with AI card levels matching difficulty
3. **Clear Unlock Path**: Make requirements obvious to players (difficulty progression within chapters, chapter progression across campaign)
4. **Meaningful Rewards**: Balance rewards with difficulty and progression, scaling appropriately for each tier
5. **Thematic Consistency**: Use descriptive names and lore-appropriate descriptions that reflect each chapter's theme

### Reward Balancing

1. **First Win Bonus**: Make first completion significantly more rewarding
2. **Repeat Play Value**: Provide ongoing incentive for replay
3. **Difficulty Scaling**: Higher difficulty should offer better rewards
4. **Economy Balance**: Consider impact on overall game economy

### Difficulty Scaling Rewards

Each difficulty tier grants higher rewards to match AI power:

| Difficulty | Gold | Gems | Card XP | Fate Coins | Notes              |
| ---------- | ---- | ---- | ------- | ---------- | ------------------ |
| Level 1    | 100  | 5    | 50      | —          | Intro difficulty   |
| Level 2    | 150  | 8    | 75      | —          | Moderate reward    |
| Level 3    | 200  | 12   | 100     | —          | Mid-tier challenge |
| Level 4    | 250  | 18   | 125     | —          | High skill test    |
| Level 5    | 300  | 25   | 150     | 1          | Mythic finale      |

### Technical Considerations

1. **AI Deck Management**: Ensure AI decks are properly configured and balanced
2. **Performance**: Monitor database performance with large numbers of story modes
3. **Extensibility**: Use the custom fields for future feature additions
4. **Error Handling**: Gracefully handle edge cases and invalid states

### AI Deck Scaling by Level

Each AI deck is drawn from the same base 20-card composition per chapter. Cards scale automatically based on difficulty:

| Difficulty | Card Instance Level | Behavior            |
| ---------- | ------------------- | ------------------- |
| 1          | Level 1             | Uses baseline stats |
| 2          | Level 2             | +1 top side         |
| 3          | Level 3             | +1 right side       |
| 4          | Level 4             | +1 bottom side      |
| 5          | Level 5             | +1 left side        |

The AI user's inventory contains pre-leveled instances (L1–L5), so each difficulty references the appropriate set of `user_card_instance_id`s.

## Troubleshooting

### Common Issues

1. **"AI deck not found"**

   - Ensure AI decks are created before story modes
   - Run `node scripts/create-ai-decks.js` if needed

2. **"Requirements not met"**

   - Check user level, achievements, and prerequisite completions
   - Use the unlock status endpoint to debug requirements

3. **"Story mode not unlocked"**
   - Verify unlock requirements are correctly configured
   - Check user progress and achievements

### Debugging Tools

1. **Check story mode configuration**:

```bash
curl -X GET http://localhost:3000/api/admin/story-modes/{story-id} \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

2. **Check user progress**:

```bash
curl -X GET http://localhost:3000/api/story-modes/progress \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

3. **Check unlock status**:

```bash
curl -X GET http://localhost:3000/api/story-modes/{story-id}/unlock-status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Future Enhancements

### Planned Features

- **Chapter Mastery Tracking**: Track completion of all 5 difficulties per chapter
- **Elite Rematches**: Unlock post-campaign versions with modified rules or special rewards
- **Lore Codex**: Unlock story entries as each chapter is cleared
- **Seasonal Content**: Time-limited story modes with special rewards
- **Leaderboards**: Competition for fastest completion times
- **Story Replay**: Special modes for replaying completed stories

### Extension Points

- **Custom Unlock Logic**: Extend unlock requirements system
- **Advanced Rewards**: New reward types and distribution methods
- **AI Behavior**: Story-specific AI personality and tactics
- **Narrative System**: Rich storytelling and dialogue integration

## Support

For questions or issues with the story mode system:

1. Check this guide and the API documentation
2. Review the example configurations and scripts
3. Test with the provided setup script
4. Check server logs for detailed error information

The story mode system is designed to be flexible and extensible, allowing for rich single-player content that can grow with your game.
