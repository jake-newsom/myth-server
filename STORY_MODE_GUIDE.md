# Story Mode System Guide

## Overview

The Story Mode system allows you to configure pre-defined AI opponents with specific decks, difficulty levels, unlock requirements, and rewards. Players can progress through a series of story-based challenges, earning rewards and unlocking new content as they advance.

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

### 🔓 Unlock Requirements
- **Sequential progression**: Require completing previous story modes
- **Level gating**: Minimum user level requirements
- **Achievement requirements**: Specific achievements must be completed
- **Win count requirements**: Minimum total story wins needed
- **Custom conditions**: Extensible for complex unlock logic

## Database Schema

### Tables Created
1. **`story_mode_config`** - Main story mode configurations
2. **`story_mode_rewards`** - Reward definitions for each story mode
3. **`user_story_progress`** - User progress tracking

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

### Basic Story Mode
```typescript
{
  name: "Training Grounds",
  description: "A gentle introduction to combat",
  difficulty: "easy",
  ai_deck_id: "uuid-of-ai-deck",
  order_index: 0,
  unlock_requirements: {}, // Available from start
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

### Advanced Story Mode with Requirements
```typescript
{
  name: "Shadow Lord",
  description: "The ultimate challenge",
  difficulty: "legendary",
  ai_deck_id: "uuid-of-ai-deck",
  order_index: 10,
  unlock_requirements: {
    min_user_level: 15,
    min_total_story_wins: 15,
    prerequisite_stories: ["uuid-of-previous-story"],
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
    "story_id": "uuid-of-story-mode",
    "player_deck_id": "uuid-of-player-deck"
  }'
```

## Configuration Constants

The system includes predefined constants in `src/config/constants.ts`:

```typescript
export const STORY_MODE_CONFIG = {
  DEFAULT_REWARDS: {
    FIRST_WIN: {
      EASY: { gold: 100, gems: 5, card_xp: 50 },
      MEDIUM: { gold: 150, gems: 10, card_xp: 75 },
      HARD: { gold: 200, gems: 15, card_xp: 100 },
      LEGENDARY: { gold: 300, gems: 25, card_xp: 150, fate_coins: 1 }
    },
    // ... more configurations
  },
  UNLOCK_TEMPLATES: {
    STARTER: {},
    SEQUENTIAL: (prerequisiteStoryId) => ({ prerequisite_stories: [prerequisiteStoryId] }),
    LEVEL_GATED: (minLevel) => ({ min_user_level: minLevel }),
    // ... more templates
  }
}
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
1. **Progressive Difficulty**: Start easy and gradually increase challenge
2. **Clear Unlock Path**: Make requirements obvious to players
3. **Meaningful Rewards**: Balance rewards with difficulty and progression
4. **Thematic Consistency**: Use descriptive names and lore-appropriate descriptions

### Reward Balancing
1. **First Win Bonus**: Make first completion significantly more rewarding
2. **Repeat Play Value**: Provide ongoing incentive for replay
3. **Difficulty Scaling**: Higher difficulty should offer better rewards
4. **Economy Balance**: Consider impact on overall game economy

### Technical Considerations
1. **AI Deck Management**: Ensure AI decks are properly configured and balanced
2. **Performance**: Monitor database performance with large numbers of story modes
3. **Extensibility**: Use the custom fields for future feature additions
4. **Error Handling**: Gracefully handle edge cases and invalid states

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
- **Story Campaigns**: Group related story modes into campaigns
- **Dynamic Difficulty**: Adjust AI difficulty based on player performance
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
