/**
 * Correct the stored `description` text for character milestone achievements.
 *
 * Migration `1772200000000_add_character_set_achievement_milestones` was
 * applied to local environments before the achievement copy was finalized.
 * The `objective` text in that migration was later updated to match the
 * canonical descriptions in `docs/character-achievements-checklist.md`, but
 * environments where the rows were already inserted retain the stale
 * descriptions until they are explicitly UPDATEd.
 *
 * On environments that have NOT yet run `1772200000000`, that migration will
 * insert the correct descriptions on first run, and this migration becomes a
 * no-op (every UPDATE rewrites the row with the same value it already has).
 *
 * Description format mirrors the original migration:
 *   description = `${objective} (${target_value} times)`
 */

exports.shorthands = undefined;

// Only the characters whose objective text changed are listed here. Each entry
// produces 2 row updates (mid + final tier).
const CHARACTER_DESCRIPTION_FIXES = [
  // Norse
  {
    lookup: "thor",
    mid: 200,
    final: 400,
    objective: "Reduce the power of 5 enemies at once.",
  },
  {
    lookup: "jormungandr",
    mid: 250,
    final: 500,
    objective: "Survive match end without being defeated.",
  },
  {
    lookup: "baldr",
    mid: 400,
    final: 800,
    objective: "Return to hand via Mistletainn's Absence.",
  },
  {
    lookup: "sigurd",
    mid: 100,
    final: 200,
    objective: "Gain +10 Power from Gram's Edge before play.",
  },
  {
    lookup: "skadi",
    mid: 200,
    final: 400,
    objective: "Reduce the Power of 3 enemies at once with Winter's Step.",
  },

  // Japanese
  {
    lookup: "amaterasu",
    mid: 100,
    final: 200,
    objective: "Grant 3 blessings in a single turn with Cave's Light.",
  },
  {
    lookup: "ryujin",
    mid: 200,
    final: 400,
    objective:
      "Defeat 2 enemies diagonally in a single turn with Tide Jewel Pulse.",
  },
  {
    lookup: "tsukuyomi",
    mid: 100,
    final: 200,
    objective: "Siphon Power from an enemy with 15+ Power on one side.",
  },
  {
    lookup: "susanoo",
    mid: 150,
    final: 300,
    objective: "Destroy a BEAST or DRAGON card with Kusanagi's Strike.",
  },
  {
    lookup: "hachiman",
    mid: 300,
    final: 600,
    objective: "Buff a full row of allies with Divine Archery.",
  },
  {
    lookup: "yamabiko",
    mid: 100,
    final: 200,
    objective: "Defeat the enemy you copied with Mountain's Mimicry.",
  },
  {
    lookup: "benkei",
    mid: 100,
    final: 200,
    objective: "Gain +4 Power from Standing Death.",
  },
  {
    lookup: "futakuchionna",
    mid: 200,
    final: 400,
    objective: "Reduce power of 4 adjacent enemies at once.",
  },
  {
    lookup: "yukionna",
    mid: 100,
    final: 200,
    objective: "Affect 3 enemies at once with Frozen Breath.",
  },
  {
    lookup: "minamoto",
    mid: 200,
    final: 400,
    objective: "Play Minamoto with +10 power from Demon Bane.",
  },
  {
    lookup: "nurarihyon",
    mid: 400,
    final: 800,
    objective: "Steal blessings from enemies with Supreme Commander.",
  },
  {
    lookup: "jorogumo",
    mid: 1000,
    final: 2000,
    objective: "Curse enemies with Web Curse.",
  },
  {
    lookup: "kintaro",
    mid: 200,
    final: 400,
    objective: "Gain +6 Power with Golden Boy's Grip.",
  },
  {
    lookup: "yamatanoorochi",
    mid: 100,
    final: 200,
    objective: "Affect 5 different enemies with a single Eight-Fold Venom.",
  },

  // Polynesian
  {
    lookup: "kane",
    mid: 100,
    final: 200,
    objective: "Protect 2 allies from defeat in a single turn with Wai-Ola.",
  },
  {
    lookup: "kamapuaa",
    mid: 100,
    final: 200,
    objective: "Have 4 Lava tiles active at the same time.",
  },
  {
    lookup: "kaahupahau",
    mid: 1000,
    final: 2000,
    objective: "Protect an ally with Pu'uloa Guard.",
  },
  {
    lookup: "milu",
    mid: 200,
    final: 400,
    objective: "Drain an attacker that has 12+ Power with Spirit Bind.",
  },
  {
    lookup: "ukupa",
    mid: 100,
    final: 200,
    objective:
      "Turn 4 tiles into water in a single match with Shark God's Wake.",
  },
  {
    lookup: "kupua",
    mid: 200,
    final: 400,
    objective: "Distribute 4 Dual Aspect debuffs in one turn.",
  },
  {
    lookup: "kanehekili",
    mid: 200,
    final: 400,
    objective: "Reduce same enemy's power 3 times in one match with Split Sky.",
  },
];

function escapeSql(value) {
  return value.replace(/'/g, "''");
}

function buildUpdateValuesSql() {
  // Each character contributes two rows: one per tier.
  return CHARACTER_DESCRIPTION_FIXES.flatMap((c) => [
    `('char_${escapeSql(c.lookup)}_mid_ach', '${escapeSql(c.objective)} (${c.mid} times)')`,
    `('char_${escapeSql(c.lookup)}_final_ach', '${escapeSql(c.objective)} (${c.final} times)')`,
  ]).join(",\n      ");
}

exports.up = (pgm) => {
  const valuesSql = buildUpdateValuesSql();

  pgm.sql(`
    WITH description_fixes (achievement_key, new_description) AS (
      VALUES
        ${valuesSql}
    )
    UPDATE achievements a
    SET
      description = df.new_description,
      updated_at = NOW()
    FROM description_fixes df
    WHERE a.achievement_key = df.achievement_key
      AND a.description IS DISTINCT FROM df.new_description;
  `);
};

exports.down = () => {
  // Intentionally a no-op. Reverting to the prior (incorrect) descriptions has
  // no operational value — the canonical text lives in the original
  // milestone-seed migration and in
  // docs/character-achievements-checklist.md.
};
