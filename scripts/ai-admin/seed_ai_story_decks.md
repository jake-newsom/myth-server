# Request: Seed AI User’s Inventory (10 Copies / Levels) and Create 10 Story-Mode Base Decks

## Goal
1. Expand the **AI user’s** inventory to **10 copies of every base card**, with **2 instances at each level 1–5** (leveling adds +1 to one side per level).  
2. Build **10 “Normal” story decks** (20 cards each), honoring constraints:
   - ≤ **2 copies per card name**  
   - ≤ **2 Legendary** cards per deck  
   - Use **`user_card_instance_id`** (not base `card_id`)  
3. Seed `story_decks` and `story_deck_cards` (or equivalent tables) with those decks.

---

## Assumptions
| Table | Notes |
|--------|-------|
| `cards(id, name, rarity, power jsonb)` | Base definitions; `power` = `{top,left,right,bottom}` |
| `users(id, email)` | Has AI account |
| `user_card_instances(id, user_id, card_id, level, power, xp_current, xp_required, created_at)` | Individual owned cards |
| `story_decks(id, chapter, difficulty, name)` | Deck metadata |
| `story_deck_cards(deck_id, user_card_instance_id, slot)` | Card mapping (or a JSON list field) |
| **AI user** | Identifiable via `AI_USER_ID` or `AI_USER_EMAIL` env/config |

---

## Leveling Rules
- **Levels 1–5**.  Level 1 = base `cards.power`.
- Each level-up adds +1 to one side (round-robin pattern):

| Level | Side +1 |
|-------|----------|
| 2 | top |
| 3 | right |
| 4 | bottom |
| 5 | left |

- XP requirements: L2 = 100, L3 = 250, L4 = 450, L5 = 700  
  (`xp_current` = 0 for new seeds)

---

## Script Deliverable
A **Node.js** script (TS allowed) that:

### 1. Locate AI user
Use `AI_USER_ID` or `AI_USER_EMAIL` env var.

### 2. Expand Inventory to 10 Copies / Levels
For each `cards.id`:
- Query existing instances by `(card_id, level)` for AI user.  
- For each level 1-5 ensure 2 instances exist.  
- Create missing instances with leveled `power` and `xp_required`.  
- **Idempotent** — don’t duplicate on re-run.

#### Power Calc Helper
```ts
function levelPower(basePower, level) {
  const inc = {2:'top',3:'right',4:'bottom',5:'left'} as const;
  const p = {...basePower};
  for (let L=2; L<=level; L++) p[inc[L]] += 1;
  return p;
}
```

### 3. Build 10 “Normal” Decks
- For each chapter (list below), pick card instances obeying limits (≤2 per name, ≤2 legendaries).  
- Prefer L2 then L3 instances for variety.  
- Insert deck row → `story_decks`, then 20 rows in `story_deck_cards`.  
- If `(chapter,difficulty)` exists, replace cards (transactional).  
- **Difficulty** = `'normal'` for all.

### 4. Validation
- Deck = 20 cards  
- Per-name ≤ 2  
- Legendaries ≤ 2  
- All `user_card_instance_id` belong to AI user

### 5. Logs
Print summary per deck and count of new instances created.

---

## Deck Lists (Normal Difficulty)

### CH 1 — “Forest Whispers” (Japanese Intro)
**Legendaries:** Yamata no Orochi ×1, Hachiman ×1  
**Epics:** Benkei ×2, Momotaro ×2, Tawara Tōda ×2  
**Rares:** Futakuchi-onna ×2, Noppera-bō ×2, Yuki-onna ×2, Ushi-oni ×2  
**Commons:** Oni ×1, Tengu ×1, Kappa ×1, Tanuki ×1

### CH 2 — “Sun over Steel” (Japanese mastery)
**Legendaries:** Amaterasu ×1, Susanoo ×1  
**Epics:** Benkei ×2, Momotaro ×2, Minamoto no Raikō ×2  
**Rares:** Futakuchi-onna ×2, Noppera-bō ×2, Nurarihyon ×2, Yuki-onna ×2  
**Commons:** Tengu ×2

### CH 3 — “Winter of Ravens” (Norse intro)
**Legendaries:** Vidar ×1, Jörmungandr ×1  
**Epics:** Frigg ×2, Bragi ×2, Skadi ×2, Tyr ×2  
**Rares:** Shieldmaiden ×2, Bear Totem ×2, Peasant Archer ×2  
**Commons:** Drenger ×2, Torchbearer ×2

### CH 4 — “Hammerfall” (Norse mastery)
**Legendaries:** Thor ×1, Baldr ×1  
**Epics:** Frigg ×2, Bragi ×2, Heimdall ×1, Njord ×1, Skadi ×1, Ran ×1  
**Rares:** Sigurd ×1, Freyja ×1, Shieldmaiden ×2, Norse Fox ×2  
**Commons:** Peasant Archer ×2

### CH 5 — “Tides of Creation” (Polynesian intro)
**Legendaries:** Pele ×1, Kanaloa ×1  
**Epics:** Hauwahine ×2, Mo‘oinanea ×2, La‘amaomao ×2, Hi‘iaka ×1, Kupua ×1  
**Rares:** Kapo ×2, Nightmarchers ×2  
**Commons:** Lava Scout ×2, Village Healer ×2, Fisherman of Kuʻula ×2

### CH 6 — “Heart of Fire” (Polynesian mastery)
**Legendaries:** Kū ×1, Kāne ×1  
**Epics:** Kamapua‘a ×2, Māui ×2, Lono ×2, Kānehekili ×2  
**Rares:** Hauwahine ×2, Ukupanipo ×2  
**Commons:** Koa Warrior ×2, Temple Drummer ×2

### CH 7 — “Clash of Currents” (JP × Poly hybrid)
**Legendaries:** Ryūjin ×1, Pele ×1  
**Epics:** Benkei ×1, Momotaro ×1, Tawara Tōda ×1, Mo‘oinanea ×1, La‘amaomao ×1, Kamapua‘a ×1, Kupua ×1, Lono ×1  
**Rares:** Futakuchi-onna ×2, Noppera-bō ×2, Hauwahine ×2, Ushi-oni ×2

### CH 8 — “Twilight Council” (Norse × Japanese hybrid)
**Legendaries:** Odin ×1, Amaterasu ×1  
**Epics:** Heimdall ×1, Tyr ×1, Frigg ×1, Bragi ×1, Benkei ×1, Minamoto no Raikō ×1  
**Rares:** Noppera-bō ×2, Futakuchi-onna ×2, Shieldmaiden ×2, Bear Totem ×2  
**Commons:** Torchbearer ×2

### CH 9 — “When Worlds Collide” (Triple-culture)
**Legendaries:** Loki ×1, Susanoo ×1  
**Epics:** Frigg ×1, Bragi ×1, Kānehekili ×1, Mo‘oinanea ×1, Lono ×1, Tyr ×1  
**Rares:** Hauwahine ×2, Noppera-bō ×2, Futakuchi-onna ×2, Ushi-oni ×2  
**Commons:** Peasant Archer ×2, Tengu ×2

### CH 10 — “The Convergence” (Boss prelude)
**Legendaries:** Odin ×1, Hel ×1  
**Epics:** Heimdall ×1, Skadi ×1, Frigg ×1, Bragi ×1, Kamapua‘a ×1, Mo‘oinanea ×1, Lono ×1, Tyr ×1  
**Rares:** Hauwahine ×2, Noppera-bō ×2, Shieldmaiden ×2  
**Commons:** Drenger ×2

---

## DB Helper Snippets
```sql
-- Fetch AI user & cards
SELECT id, name, rarity, power FROM cards ORDER BY id;
SELECT id FROM users WHERE email = $1 OR id = $2 LIMIT 1;

-- Existing instances
SELECT id, card_id, level FROM user_card_instances WHERE user_id = $1 ORDER BY card_id, level, id;

-- Insert new instance
INSERT INTO user_card_instances (user_id, card_id, level, power, xp_current, xp_required)
VALUES ($1, $2, $3, $4::jsonb, 0, $5)
RETURNING id;

-- Create deck
INSERT INTO story_decks (chapter, difficulty, name)
VALUES ($1, 'normal', $2)
ON CONFLICT (chapter, difficulty) DO UPDATE SET name = EXCLUDED.name
RETURNING id;

-- Add cards to deck
INSERT INTO story_deck_cards (deck_id, user_card_instance_id, slot)
VALUES ($1, $2, $3);
```

---

## Validation Queries
```sql
-- Deck has 20 cards
SELECT deck_id, COUNT(*) FROM story_deck_cards GROUP BY deck_id HAVING COUNT(*) <> 20;

-- Per-name ≤ 2
SELECT sd.id, c.name, COUNT(*)
FROM story_deck_cards sdc
JOIN story_decks sd ON sd.id = sdc.deck_id
JOIN user_card_instances uci ON uci.id = sdc.user_card_instance_id
JOIN cards c ON c.id = uci.card_id
GROUP BY sd.id, c.name
HAVING COUNT(*) > 2;

-- Legendaries ≤ 2
SELECT sd.id, COUNT(*)
FROM story_deck_cards sdc
JOIN story_decks sd ON sd.id = sdc.deck_id
JOIN user_card_instances uci ON uci.id = sdc.user_card_instance_id
JOIN cards c ON c.id = uci.card_id
WHERE c.rarity = 'legendary'
GROUP BY sd.id
HAVING COUNT(*) > 2;
```

---

## Optional Enhancements
- Add `seed_tag` (e.g., `'story_seed_v1'`) to generated card instances.  
- Store a JSON snapshot of selected cards on each deck row.  
- Provide a `--dry-run` mode for testing changes safely.  
- Generate a post-run summary of counts by rarity and level.
