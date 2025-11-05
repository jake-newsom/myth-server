# AI Tuning Guide

Quick reference for adjusting AI behavior without diving deep into the code.

## Configuration Location

All AI settings are in: `src/config/constants.ts` → `AI_CONFIG`

## Common Adjustments

### Making AI More/Less Aggressive

**More Aggressive:**

```typescript
MOVE_EVALUATION: {
  FLIP_BONUS: 120,              // +20 (was 100)
  OFFENSIVE_POSITION_BONUS: 50, // +15 (was 35)
}
```

**Less Aggressive:**

```typescript
MOVE_EVALUATION: {
  FLIP_BONUS: 80,               // -20 (was 100)
  DEFENSIVE_POSITION_BONUS: 40, // +20 (was 20)
}
```

### Increasing Ability Focus

```typescript
DIFFICULTY_WEIGHTS: {
  MEDIUM: {
    ABILITY_IMPACT: 0.9,  // +0.2 (was 0.7)
  },
  HARD: {
    ABILITY_IMPACT: 1.2,  // +0.2 (was 1.0)
  }
}
```

### Adjusting Difficulty Levels

**Make Easy Easier:**

```typescript
DIFFICULTY_WEIGHTS: {
  EASY: {
    RANDOMNESS: 0.5,  // +0.2 (was 0.3)
    ABILITY_IMPACT: 0.1, // -0.2 (was 0.3)
  }
}
MOVE_SELECTION: {
  EASY_TOP_MOVES: 8,  // +3 (was 5)
}
```

**Make Hard Harder:**

```typescript
LOOKAHEAD: {
  HARD_DEPTH: 3,  // +1 (was 2)
}
DIFFICULTY_WEIGHTS: {
  HARD: {
    RANDOMNESS: 0.0,  // -0.05 (was 0.05)
  }
}
MOVE_SELECTION: {
  HARD_TOP_MOVES: 1,  // Always best (already is)
}
```

### Performance Tuning

**Faster (less thorough):**

```typescript
LOOKAHEAD: {
  MEDIUM_DEPTH: 0,    // -1 (was 1)
  HARD_DEPTH: 1,      // -1 (was 2)
  MAX_TIME_MS: 1500,  // -1500 (was 3000)
}
```

**Slower (more thorough):**

```typescript
LOOKAHEAD: {
  MEDIUM_DEPTH: 2,    // +1 (was 1)
  HARD_DEPTH: 3,      // +1 (was 2)
  MAX_TIME_MS: 5000,  // +2000 (was 3000)
}
```

## Ability Value Adjustments

### Increasing Value of Specific Ability Types

```typescript
MOVE_EVALUATION: {
  DRAW_CARD_VALUE: 100,      // +30 (was 70)
  BUFF_ALLY_VALUE: 60,       // +20 (was 40)
  PROTECTION_VALUE: 100,     // +40 (was 60)
}
```

### Decreasing Value of Specific Ability Types

```typescript
MOVE_EVALUATION: {
  DEBUFF_ENEMY_VALUE: 20,    // -15 (was 35)
  TILE_MANIPULATION_VALUE: 10, // -15 (was 25)
}
```

## Strategic Behavior

### Prioritize Board Control

```typescript
MOVE_EVALUATION: {
  BOARD_CONTROL_VALUE: 50,   // +20 (was 30)
  CORNER_BONUS: 75,          // +25 (was 50)
}
DIFFICULTY_WEIGHTS: {
  MEDIUM: {
    POSITIONAL: 1.0,         // +0.2 (was 0.8)
  }
}
```

### Prioritize Future Planning

```typescript
DIFFICULTY_WEIGHTS: {
  MEDIUM: {
    FUTURE_POTENTIAL: 0.8,   // +0.3 (was 0.5)
  },
  HARD: {
    FUTURE_POTENTIAL: 1.2,   // +0.3 (was 0.9)
  }
}
```

### Prioritize Immediate Gains

```typescript
DIFFICULTY_WEIGHTS: {
  MEDIUM: {
    IMMEDIATE_FLIPS: 1.5,    // +0.5 (was 1.0)
    FUTURE_POTENTIAL: 0.2,   // -0.3 (was 0.5)
  }
}
```

## Testing Your Changes

After making changes:

1. **Rebuild:**

   ```bash
   npm run build
   ```

2. **Run tests:**

   ```bash
   node tests/enhanced-ai.test.js
   ```

3. **Check performance:**

   - Look at "Average" times in test output
   - Should be < 500ms (Easy), < 1500ms (Medium), < 3000ms (Hard)

4. **Test in-game:**
   - Start a solo game
   - Observe AI behavior
   - Check console logs for move scores

## Quick Fixes for Common Issues

### "AI is too random"

```typescript
DIFFICULTY_WEIGHTS: {
  EASY: { RANDOMNESS: 0.2 },    // -0.1
  MEDIUM: { RANDOMNESS: 0.1 },  // -0.05
  HARD: { RANDOMNESS: 0.0 },    // -0.05
}
```

### "AI ignores abilities"

```typescript
DIFFICULTY_WEIGHTS: {
  MEDIUM: { ABILITY_IMPACT: 1.0 },  // +0.3
  HARD: { ABILITY_IMPACT: 1.5 },    // +0.5
}
```

### "AI too slow"

```typescript
LOOKAHEAD: {
  MEDIUM_DEPTH: 0,    // Disable lookahead for medium
  HARD_DEPTH: 1,      // Reduce hard lookahead
}
```

### "AI makes obvious mistakes"

```typescript
MOVE_SELECTION: {
  EASY_TOP_MOVES: 3,    // -2 (less random)
  MEDIUM_TOP_MOVES: 2,  // -1 (less random)
}
```

### "AI plays too similarly across difficulties"

Increase differences in weights:

```typescript
DIFFICULTY_WEIGHTS: {
  EASY: {
    ABILITY_IMPACT: 0.2,    // -0.1
    POSITIONAL: 0.3,        // -0.2
  },
  HARD: {
    ABILITY_IMPACT: 1.2,    // +0.2
    POSITIONAL: 1.2,        // +0.2
  }
}
```

## Advanced: Adding New Abilities

To add recognition for a new ability, edit `src/game-engine/ai.ability-analyzer.ts`:

```typescript
// In evaluateSpecificAbility method
else if (abilityName === "Your New Ability") {
  // Calculate value based on context
  const relevantCards = getRelevantCards(position, board);
  score += relevantCards.length * AI_CONFIG.MOVE_EVALUATION.YOUR_VALUE;
}
```

Add configuration value in `constants.ts`:

```typescript
MOVE_EVALUATION: {
  YOUR_VALUE: 45,  // New scoring value
}
```

## Monitoring AI Performance

Add these console logs to track AI decisions:

```typescript
// In ai.logic.ts makeAIMove method
console.log(`[AI Debug] Top 3 moves:`);
possibleMoves.slice(0, 3).forEach((move, i) => {
  console.log(
    `  ${i + 1}. Card: ${
      move.card?.base_card_data.name
    }, Score: ${move.score.toFixed(2)}`
  );
});
```

## Balance Guidelines

### Recommended Value Ranges

| Category   | Recommended Range | Current |
| ---------- | ----------------- | ------- |
| Flips      | 80-120            | 100     |
| Abilities  | 60-100            | 80      |
| Buffs      | 30-60             | 40      |
| Debuffs    | 25-50             | 35      |
| Draw       | 60-100            | 70      |
| Position   | 40-80             | 50      |
| Protection | 50-100            | 60      |

### Weight Ranges

| Weight           | Easy    | Medium  | Hard    |
| ---------------- | ------- | ------- | ------- |
| Ability Impact   | 0.1-0.4 | 0.6-0.9 | 0.9-1.5 |
| Positional       | 0.3-0.6 | 0.7-1.0 | 0.9-1.2 |
| Future Potential | 0.0-0.2 | 0.4-0.7 | 0.8-1.2 |
| Randomness       | 0.2-0.5 | 0.1-0.3 | 0.0-0.1 |

## Saving and Testing Configurations

1. **Create configuration presets:**

```typescript
const AI_PRESETS = {
  BALANCED: {
    /* current values */
  },
  AGGRESSIVE: {
    /* aggressive values */
  },
  DEFENSIVE: {
    /* defensive values */
  },
};
```

2. **Switch between presets:**

```typescript
export const AI_CONFIG = AI_PRESETS.BALANCED;
```

3. **A/B test configurations:**
   - Save current config
   - Try new config
   - Run test suite on both
   - Compare results

## Emergency Rollback

If changes break the AI:

1. **Restore from git:**

   ```bash
   git checkout src/config/constants.ts
   npm run build
   ```

2. **Or use these safe defaults:**
   ```typescript
   AI_CONFIG = {
     MOVE_EVALUATION: {
       FLIP_BONUS: 100,
       ABILITY_BASE_VALUE: 80,
       // ... (see current constants.ts)
     },
   };
   ```

## Getting Help

If AI behaves unexpectedly:

1. Check console logs for move scores
2. Run test suite to verify performance
3. Review recent config changes
4. Test with different difficulties
5. Check if abilities are being recognized (console logs show ability name)

## Summary

**Most Common Tuning:**

1. Adjust `DIFFICULTY_WEIGHTS` for behavior changes
2. Adjust `MOVE_EVALUATION` for value changes
3. Adjust `LOOKAHEAD.DEPTH` for planning depth
4. Test with `npm run build && node tests/enhanced-ai.test.js`

**Remember:**

- Small changes (±20%) are usually better than large ones
- Test changes with multiple difficulties
- Monitor performance after changes
- Document why you made changes
