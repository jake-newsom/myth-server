# Economy Balancing Plan

## Current State Analysis

### Shop Prices (Current)
- **Packs:** 50 gold
- **Legendary cards:** 100 card_fragments
- **Epic cards:** 50 card_fragments  
- **Enhanced cards (mythic):** 1000 gold

### Desired Economy
- **Packs:** 100 gems per pack, or 800 gems for 10 packs (20% bulk discount)
- **Legendary cards:** Gold currency, purchasable 1 every 2 weeks (~14 days)
- **Epic cards:** Gold currency, purchasable 1 every week (~7 days)
- **Mythic cards:** 100 card_fragments (1 fragment per sacrificed card)
- **Fate coins:** 2 per day (already implemented)

### Current Income Sources
- Solo win: 50 gold
- Solo loss: 25 gold
- PvP win: 100 gold
- PvP loss: 50 gold
- Story mode first win: 100-300 gold, 5-25 gems (by difficulty)
- Story mode repeat: 25-75 gold
- Fate coins: 2 per day (automatic)
- Achievements: Various one-time rewards

## Proposed Economy Balance

### Assumptions
- Active player plays ~3-5 games per day (mix of solo/PvP/story)
- Average player wins ~60% of games
- Daily gold income: ~200-300 gold from gameplay
- Weekly gold income: ~1,400-2,100 gold
- Daily gem income: ~10-20 gems from story mode + achievements

### Shop Price Recommendations

#### 1. Packs
- **Price:** 100 gems per pack
- **Bulk option:** 800 gems for 10 packs (20% discount)
- **Currency:** gems (change from gold)
- **Daily limit:** Keep current limit (3 packs)

#### 2. Legendary Cards
- **Price:** 2,000 gold
- **Currency:** gold
- **Daily limit:** 1 per mythology (3 total available)
- **Rationale:** With ~200-300 gold/day, player can afford 1 legendary every ~7-10 days. To hit "every 2 weeks" goal, price should be ~2,800-4,200 gold. Using 2,000 gold provides buffer and accounts for achievement/story mode bonuses.

#### 3. Epic Cards
- **Price:** 1,000 gold
- **Currency:** gold
- **Daily limit:** 1 per mythology (3 total available)
- **Rationale:** With ~200-300 gold/day, player can afford 1 epic every ~3-5 days. To hit "every week" goal, price should be ~1,400-2,100 gold. Using 1,000 gold provides comfortable weekly purchase.

#### 4. Mythic Cards (Enhanced)
- **Price:** 100 card_fragments
- **Currency:** card_fragments
- **Daily limit:** 2 (as currently configured)
- **Note:** Requires sacrificing 100 cards (1 fragment per card)

### Achievement Reward Tiers

Based on rarity and difficulty, use this scale:

| Rarity | Gold Range | Gems Range | Packs Range |
|--------|-----------|------------|-------------|
| Common | 50-150 | 1-3 | 0-1 |
| Uncommon | 150-400 | 3-8 | 0-2 |
| Rare | 400-750 | 8-15 | 1-3 |
| Epic | 750-1,500 | 15-30 | 2-5 |
| Legendary | 1,500-5,000 | 30-100 | 5-15 |

**Tier Scaling:** Within each tier group, higher tiers should have proportionally better rewards:
- Tier 1: Base reward
- Tier 2: ~2x tier 1
- Tier 3: ~3x tier 1
- Tier 4+: ~4-5x tier 1

### Story Mode Reward Adjustments

Keep current structure - it's well balanced:
- **Level 1:** 100 gold, 5 gems (first win) / 25 gold (repeat)
- **Level 2:** 150 gold, 8 gems / 35 gold
- **Level 3:** 200 gold, 12 gems / 50 gold
- **Level 4:** 250 gold, 18 gems / 60 gold
- **Level 5:** 300 gold, 25 gems, 1 fate_coin / 75 gold

### New Achievement Rewards (Recommended)

#### Solo Wins
- 50 wins (tier 1): 200 gold, 5 gems (uncommon)
- 200 wins (tier 2): 500 gold, 12 gems (rare)
- 500 wins (tier 3): 1,000 gold, 25 gems (epic)
- 1000 wins (tier 4): 2,000 gold, 50 gems (epic)

#### Multiplayer Wins
- 25 wins (tier 1): 250 gold, 6 gems (uncommon)
- 100 wins (tier 2): 600 gold, 15 gems (rare)
- 250 wins (tier 3): 1,200 gold, 30 gems (epic)
- 500 wins (tier 4): 2,000 gold, 50 gems (epic)
- 1000 wins (tier 5): 3,500 gold, 100 gems (legendary)

#### Win Streaks (Multiplayer)
- 10 streak (tier 1): 300 gold, 8 gems (rare)
- 15 streak (tier 2): 500 gold, 15 gems (rare)
- 20 streak (tier 3): 800 gold, 25 gems (epic)
- 30 streak (tier 4): 1,500 gold, 50 gems (epic)

#### Pack Opening
- 10 packs (tier 1): 100 gold, 3 gems (common)
- 25 packs (tier 2): 250 gold, 8 gems (uncommon)
- 50 packs (tier 3): 500 gold, 15 gems (rare)
- 100 packs (tier 4): 1,000 gold, 30 gems (epic)
- 250 packs (tier 5): 2,000 gold, 60 gems (epic)
- 500 packs (tier 6): 3,500 gold, 100 gems (legendary)
- 1000 packs (tier 7): 5,000 gold, 150 gems (legendary)

#### Card Collection
- 50 cards (tier 1): 300 gold, 10 gems (uncommon)
- 200 cards (tier 2): 1,000 gold, 30 gems (epic)

#### Card Leveling by Rarity
**Epic Cards:**
- Level 2 (tier 1): 200 gold, 5 gems (uncommon)
- Level 3 (tier 2): 400 gold, 10 gems (rare)
- Level 4 (tier 3): 750 gold, 20 gems (epic)
- Level 5 (tier 4): 1,500 gold, 40 gems (epic)

**Legendary Cards:**
- Level 2 (tier 1): 300 gold, 8 gems (rare)
- Level 3 (tier 2): 600 gold, 15 gems (epic)
- Level 4 (tier 3): 1,200 gold, 30 gems (epic)
- Level 5 (tier 4): 2,500 gold, 60 gems (legendary)

**Rare Cards:**
- Level 2 (tier 1): 150 gold, 3 gems (common)
- Level 3 (tier 2): 300 gold, 8 gems (uncommon)
- Level 4 (tier 3): 600 gold, 15 gems (rare)
- Level 5 (tier 4): 1,000 gold, 25 gems (epic)

#### Mythic Card Collection
- 10 mythic cards (tier 1): 500 gold, 15 gems (rare)
- 25 mythic cards (tier 2): 1,200 gold, 35 gems (epic)
- 50 mythic cards (tier 3): 2,500 gold, 75 gems (legendary)

#### Card Sacrifice
- 50 sacrifices (tier 1): 200 gold, 5 gems (uncommon)
- 200 sacrifices (tier 2): 600 gold, 15 gems (rare)
- 500 sacrifices (tier 3): 1,500 gold, 40 gems (epic)
- 1000 sacrifices (tier 4): 3,000 gold, 80 gems (legendary)

#### Total Matches Played
- 100 matches (tier 1): 300 gold, 8 gems (uncommon)
- 250 matches (tier 2): 600 gold, 15 gems (rare)
- 500 matches (tier 3): 1,200 gold, 30 gems (epic)
- 1000 matches (tier 4): 2,000 gold, 50 gems (epic)
- 2500 matches (tier 5): 3,500 gold, 100 gems (legendary)
- 5000 matches (tier 6): 5,000 gold, 150 gems (legendary)
- 10000 matches (tier 7): 7,500 gold, 250 gems (legendary)

### Story Mode Achievement Rewards

Per-story achievements (win once, win 10x, win by 4/6/8):
- **Win once:** 50 gold, 2 gems (common)
- **Win 10 times:** 200 gold, 10 gems (uncommon)
- **Win by 4:** 100 gold, 5 gems (common)
- **Win by 6:** 150 gold, 8 gems (uncommon)
- **Win by 8:** 250 gold, 15 gems (rare)

## Implementation Checklist

- [ ] Update shop configuration: Change pack currency from gold to gems (100 gems)
- [ ] Update shop configuration: Change legendary card price to 2,000 gold, currency to gold
- [ ] Update shop configuration: Change epic card price to 1,000 gold, currency to gold
- [ ] Update shop configuration: Change enhanced card price to 100 card_fragments, currency to card_fragments
- [ ] Assign rewards to all new tiered achievements (use recommendations above)
- [ ] Create story mode achievement reward structure
- [ ] Test economy balance with expected player behavior
- [ ] Consider adding gem rewards to regular gameplay wins (5-10 gems per win)
- [ ] Consider daily login bonuses (gold/gems) to supplement income

## Notes

- Gem income may need to be increased if pack purchases are too difficult
- Consider adding gem rewards to PvP wins (5-10 gems) to support pack economy
- Card fragment economy relies on card sacrifice - ensure players have enough cards to sacrifice
- Fate coins are already balanced at 2/day - good for fate picks
- Monitor player feedback and adjust prices/rewards as needed

