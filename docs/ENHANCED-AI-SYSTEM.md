# Enhanced AI System Documentation

## Overview

The enhanced AI system provides intelligent, ability-aware decision making for AI opponents in the game. The system scales from novice to expert difficulty levels and considers card abilities, strategic positioning, and future consequences when making moves.

## Key Features

### 1. **Ability-Aware Decision Making**

The AI now understands and evaluates card special abilities, including:

- Buff/debuff effects
- Card drawing abilities
- Board manipulation (tile effects, card movement)
- Protection abilities
- Combat modifiers
- Synergies between abilities

### 2. **Strategic Positioning**

The AI evaluates:

- **Positional value**: Corners, edges, and center positions
- **Board control**: Territory dominance and influence zones
- **Defensive positioning**: Protecting valuable cards
- **Offensive positioning**: Maximizing pressure and flips
- **Future potential**: Flexibility for subsequent moves

### 3. **Difficulty Scaling**

Three difficulty levels with different characteristics:

#### Easy

- **Focus**: Immediate gains and simple plays
- **Lookahead**: None (0 moves)
- **Ability consideration**: 30%
- **Randomness**: 30%
- **Target time**: < 0.5 seconds
- **Best for**: New players learning the game

#### Medium

- **Focus**: Balanced strategy with moderate planning
- **Lookahead**: 1 move ahead
- **Ability consideration**: 70%
- **Randomness**: 15%
- **Target time**: < 1.5 seconds
- **Best for**: Intermediate players

#### Hard

- **Focus**: Optimal play with deep analysis
- **Lookahead**: 2 moves ahead
- **Ability consideration**: 100%
- **Randomness**: 5%
- **Target time**: < 3 seconds
- **Best for**: Expert players seeking a challenge

### 4. **Performance Optimization**

- Alpha-beta pruning for lookahead evaluation
- Time-bounded decision making (maximum 3 seconds)
- Intelligent move sampling for performance
- Caching and efficient state evaluation

## Architecture

### Core Components

```
AILogic (main coordinator)
├── AbilityAnalyzer (ability evaluation)
├── StrategicEvaluator (position evaluation)
└── LookaheadEngine (future move simulation)
```

### File Structure

- **`ai.logic.ts`**: Main AI coordinator and move selection
- **`ai.ability-analyzer.ts`**: Analyzes and scores ability impacts
- **`ai.strategic-evaluator.ts`**: Evaluates strategic positioning
- **`ai.lookahead.ts`**: Implements minimax-style lookahead

### Configuration

All AI configuration is centralized in `src/config/constants.ts` under `AI_CONFIG`:

```typescript
AI_CONFIG = {
  MOVE_EVALUATION: {
    FLIP_BONUS: 100,
    ABILITY_BASE_VALUE: 80,
    BUFF_ALLY_VALUE: 40,
    DEBUFF_ENEMY_VALUE: 35,
    DRAW_CARD_VALUE: 70,
    // ... more scoring values
  },
  DIFFICULTY_WEIGHTS: {
    EASY: {
      /* weight configuration */
    },
    MEDIUM: {
      /* weight configuration */
    },
    HARD: {
      /* weight configuration */
    },
  },
  LOOKAHEAD: {
    EASY_DEPTH: 0,
    MEDIUM_DEPTH: 1,
    HARD_DEPTH: 2,
    MAX_TIME_MS: 3000,
  },
};
```

## How It Works

### Move Evaluation Process

1. **Generate possible moves**: For each card in hand, evaluate all valid board positions

2. **Score each move** using weighted components:

   - Immediate flips (100 points per flip)
   - Card power (sum of all sides)
   - Ability impact (context-dependent scoring)
   - Ability chains (synergies with other cards)
   - Strategic positioning (corners, edges, territory)
   - Defensive/offensive value
   - Future potential

3. **Apply lookahead** (Medium/Hard only):

   - Simulate the move
   - Predict opponent's best response
   - Adjust score based on consequences

4. **Select move** based on difficulty:
   - Easy: Random choice from top 5 moves
   - Medium: Random choice from top 3 moves
   - Hard: Always choose the best move

### Ability Scoring Examples

**Swift Messenger** (Draw 2 cards):

```
Base ability value: 80
Draw card value: 70 × 2 = 140
Total: 220 points
```

**Foresight** (Buff all allies):

```
Base ability value: 80
Buff value: 40 per ally
With 3 allies: 80 + (40 × 3) = 200 points
```

**Storm Breaker** (Defeat strongest in row):

```
Base ability value: 80
Flip enemy value: 120 × 1.5 = 180
Total: 260 points (if enemy in row)
```

### Strategic Positioning Scoring

**Corner Position**:

```
Base corner bonus: 50
Adjacent enemies to pressure: 2 × 17.5 = 35
Total: 85 points
```

**Defensive Position** (protecting valuable ally):

```
Defense bonus: 20
Protecting ability card: 10
Total: 30 points
```

## Performance Benchmarks

Test results on standard hardware:

| Difficulty | Average Time | Target | Status |
| ---------- | ------------ | ------ | ------ |
| Easy       | 5ms          | 500ms  | ✅ Met |
| Medium     | 6ms          | 1500ms | ✅ Met |
| Hard       | 7ms          | 3000ms | ✅ Met |

_Note: Times will increase with more complex board states but remain well within targets_

## Usage Examples

### Basic Usage

```typescript
import { AILogic } from "./game-engine/ai.logic";

const ai = new AILogic();
const move = await ai.makeAIMove(gameState, "medium");

if (move) {
  console.log(
    `AI plays card ${move.user_card_instance_id} at (${move.position.x}, ${move.position.y})`
  );
}
```

### Difficulty Selection

```typescript
// Easy AI for tutorial
const easyMove = await ai.makeAIMove(gameState, "easy");

// Medium AI for normal play
const mediumMove = await ai.makeAIMove(gameState, "medium");

// Hard AI for challenge mode
const hardMove = await ai.makeAIMove(gameState, "hard");
```

### Manual Evaluation

```typescript
const ai = new AILogic();
const score = ai.evaluateMove(
  gameState,
  cardToPlay,
  { x: 2, y: 1 },
  aiPlayerId,
  "hard"
);

console.log(`Move score: ${score}`);
```

## Extending the System

### Adding New Ability Recognition

Edit `ai.ability-analyzer.ts` in the `evaluateSpecificAbility` method:

```typescript
else if (abilityName === "New Ability Name") {
  // Custom scoring logic
  const value = calculateCustomValue();
  score += value;
}
```

### Adjusting Difficulty Balance

Edit `src/config/constants.ts` to adjust weights:

```typescript
DIFFICULTY_WEIGHTS: {
  MEDIUM: {
    ABILITY_IMPACT: 0.7,  // Increase to 0.8 for more ability focus
    POSITIONAL: 0.8,      // Decrease to 0.6 for less position focus
    // ... other weights
  }
}
```

### Adding New Evaluation Criteria

1. Add scoring constants to `AI_CONFIG.MOVE_EVALUATION`
2. Implement evaluation logic in appropriate analyzer
3. Integrate into `evaluateMove()` in `ai.logic.ts`

## Testing

Run the enhanced AI test suite:

```bash
node tests/enhanced-ai.test.js
```

This tests:

- Ability recognition
- Difficulty scaling
- Performance benchmarks
- Move selection quality

## Known Abilities

The AI specifically recognizes and optimizes for these abilities:

**Norse Abilities:**

- Foresight (buff all allies)
- Thunderous Push (push enemies)
- Mother's Blessing (buff adjacent allies)
- Swift Messenger (draw cards)
- Storm Breaker (auto-defeat in row)
- Dragon Slayer (bonus vs Dragons)
- Tidal Sweep (debuff column)
- Winter's Grasp (freeze tile)
- Flames of Muspelheim (destroy strongest)
- Light Undimmed (ability immune)
- Titan Shell (Thor-only defeat)

**Japanese Abilities:**

- Frost Row (debuff row)
- Web Curse (curse adjacent tiles)
- Slipstream (bonus near defeated)

**Polynesian Abilities:**

- Lava Field (fill tiles with lava)
- Cleansing Hula (cleanse debuffs)

Generic pattern matching also detects:

- Buff/gain/+ abilities
- Debuff/lose/- abilities
- Draw abilities
- Flip/defeat abilities
- Protect/immunity abilities

## Future Enhancements

Potential improvements for future iterations:

1. **Machine Learning**: Train neural network on expert games
2. **Opening Book**: Pre-computed optimal opening moves
3. **Personality**: Different AI styles (aggressive, defensive, balanced)
4. **Adaptive Difficulty**: AI adjusts based on player skill
5. **Monte Carlo Tree Search**: For even deeper analysis
6. **Ability Combo Detection**: Recognize powerful multi-card combos

## Troubleshooting

### AI Taking Too Long

- Reduce lookahead depth in constants
- Decrease MAX_TIME_MS limit
- Check for infinite loops in ability evaluation

### AI Playing Poorly

- Verify ability scoring values are appropriate
- Check difficulty weights are balanced
- Test specific scenarios with manual evaluation
- Review console logs for score breakdowns

### Performance Issues

- Profile specific board states causing slowdowns
- Optimize ability evaluation for problematic abilities
- Consider caching more intermediate calculations

## Conclusion

The enhanced AI system provides a sophisticated, scalable opponent that:

- ✅ Understands and values card abilities
- ✅ Plans strategically multiple moves ahead
- ✅ Adapts to different difficulty levels
- ✅ Performs efficiently (< 10ms on average)
- ✅ Provides challenging and varied gameplay

The system is designed to be maintainable, extensible, and performant while providing an excellent player experience across all skill levels.
