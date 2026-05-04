/**
 * Rename the 37 character milestone borders to their canonical display names
 * and retire the legacy "Ravenous Fang" border + its standalone achievement.
 *
 * Background
 * ----------
 * Character borders were originally seeded with auto-generated names of the
 * form `<lookup>-final-ach` (e.g. `ryujin-final-ach`). Those names were
 * intended as internal slugs, not player-facing copy. This migration assigns
 * each border its final display name.
 *
 * The legacy "Ravenous Fang" border + `fenrir_devourers_surge_destroy_1000`
 * achievement (originally seeded by `1772100000000_add-character-achievements`)
 * are functionally redundant with `char_fenrir_final_ach` (same character,
 * same target of 1,000 destroys, same intent). The new `fenrir-final-ach`
 * border is renamed to "Ravenous Fang" to preserve that identity.
 *
 * Idempotency
 * -----------
 * - The achievement / legacy-border DELETEs use simple WHERE clauses and are
 *   safe to re-run (no-op once the rows are gone).
 * - The rename UPDATE uses `name IS DISTINCT FROM EXCLUDED.name` so already-
 *   renamed rows are skipped.
 * - On a fresh database (production first deploy), the legacy DELETEs run
 *   immediately after their seed migration creates the rows, so the net
 *   effect is the same as if the legacy data had never existed.
 */

exports.shorthands = undefined;

const LEGACY_RAVENOUS_FANG_BORDER_ID = "7f52c228-04f6-4ac7-84d0-f5c1f98ce77f";
const LEGACY_FENRIR_ACHIEVEMENT_KEY = "fenrir_devourers_surge_destroy_1000";

// Maps the canonical character milestone border IDs (from
// `1772200000000_add_character_set_achievement_milestones`) to the
// player-facing display name each border should carry.
const BORDER_RENAMES = [
  // Norse
  { borderId: "d4c6a91e-8b3f-4a2c-9d5e-7f8a1b2c3d01", lookup: "fenrir", name: "Ravenous Fang" },
  { borderId: "e5d7ba2f-9c4a-4b3d-ae6f-8a9b2c3d4e02", lookup: "loki", name: "Shifting Deceit" },
  { borderId: "f6e8cb30-ad5b-4c4e-bf70-9bac3d4e5f03", lookup: "thor", name: "Stormbreaker Frame" },
  { borderId: "17f9dc41-be6c-4d5f-a081-acbd4e5f6a04", lookup: "jormungandr", name: "Worldcoil Depths" },
  { borderId: "280aed52-cf7d-4e60-b192-bdce5f6a7b05", lookup: "hel", name: "Helheim Divide" },
  { borderId: "391bfe63-d08e-4f71-a2a3-cedf6a7b8c06", lookup: "baldr", name: "Unbroken Radiance" },
  { borderId: "4a2c0f74-e19f-4082-b3b4-dfea7b8c9d07", lookup: "surtr", name: "Ragnarok Flame" },
  { borderId: "5b3d1085-f2a0-4193-a4c5-eafb8c9d0e08", lookup: "sigurd", name: "Fafnir's Ruin" },
  { borderId: "6c4e2196-03b1-42a4-b5d6-fbac9d0e1f09", lookup: "skadi", name: "Frostbound Hunt" },
  { borderId: "7d5f32a7-14c2-43b5-a6e7-acbd0e1f2a0a", lookup: "vidar", name: "Silent Vengeance" },

  // Japanese
  { borderId: "8e6043b8-25d3-44c6-b7f8-bdce1f2a3b0b", lookup: "amaterasu", name: "Divine Sun Ascendancy" },
  { borderId: "9f7154c9-36e4-45d7-a809-cedf2a3b4c0c", lookup: "ryujin", name: "Abyssal Dragoncoil" },
  { borderId: "a08265da-47f5-46e8-b91a-dfea3b4c5d0d", lookup: "tsukuyomi", name: "Lunar Sovereignty" },
  { borderId: "b19376eb-58a6-47f9-a02b-eafb4c5d6e0e", lookup: "susanoo", name: "Orochi's Bane" },
  { borderId: "c2a487fc-69b7-4801-b13c-fbac5d6e7f0f", lookup: "hachiman", name: "Archer's Oath" },
  { borderId: "d3b5980d-7ac8-4912-a24d-acbd6e7f8a10", lookup: "yamabiko", name: "Echoing Peaks" },
  { borderId: "e4c6a91e-8bd9-4a23-b35e-bdce7f8a9b11", lookup: "benkei", name: "Sevenfold Vow" },
  { borderId: "f5d7ba2f-9cea-4b34-a46f-cedf8a9bac12", lookup: "futakuchionna", name: "Hidden Hunger" },
  { borderId: "06e8cb30-adfb-4c45-b570-dfea9bacbd13", lookup: "yukionna", name: "Frozen Lament" },
  { borderId: "17f9dc41-be0c-4d56-a681-eafbacbdce14", lookup: "minamoto", name: "Oni Severance" },
  { borderId: "280aed52-cf1d-4e67-b792-fbacbdcedf15", lookup: "nurarihyon", name: "Quiet Dominion" },
  { borderId: "391bfe63-d02e-4f78-a8a3-acbdcedfea16", lookup: "jorogumo", name: "Silken Deception" },
  { borderId: "4a2c0f74-e13f-4089-b9b4-bdcedfeafb17", lookup: "kintaro", name: "Wild Strength" },
  { borderId: "5b3d1085-f240-419a-a0c5-cedfeafbac18", lookup: "yamatanoorochi", name: "Eightfold Ruin" },

  // Polynesian
  { borderId: "6c4e2196-0351-42ab-b1d6-dfeafbacbd19", lookup: "pele", name: "Heart of Halema'uma'u" },
  { borderId: "7d5f32a7-1462-43bc-a2e7-eafbacbdce1a", lookup: "maui", name: "Manaiakalani's Wake" },
  { borderId: "8e6043b8-2573-44cd-b3f8-fbacbdcedf1b", lookup: "kane", name: "Source of Life" },
  { borderId: "9f7154c9-3684-45de-a409-acbdcedfea1c", lookup: "nightmarchers", name: "Whispering Procession" },
  { borderId: "a08265da-4795-46ef-b51a-bdcedfeafb1d", lookup: "kamapuaa", name: "Wild Growth" },
  { borderId: "b19376eb-58a6-4801-a62b-cedfeafbac1e", lookup: "kaahupahau", name: "Guardian of the Reef" },
  { borderId: "c2a487fc-69b7-4912-b73c-dfeafbacbd1f", lookup: "ku", name: "War Incarnate" },
  { borderId: "d3b5980d-7ac8-4a23-a84d-eafbacbdce20", lookup: "milu", name: "Shadow of Po" },
  { borderId: "e4c6a91e-8bd9-4b34-b95e-fbacbdcedf21", lookup: "ukupa", name: "Provider of the Deep" },
  { borderId: "f5d7ba2f-9cea-4c45-aa6f-acbdcedfea22", lookup: "laamaomao", name: "Tempest Currents" },
  { borderId: "06e8cb30-adfb-4d56-bb70-bdcedfeafb23", lookup: "kupua", name: "Shifting Essence" },
  { borderId: "17f9dc41-be0c-4e67-ac81-cedfeafbac24", lookup: "kanehekili", name: "Storm-Hammer Basalt" },
  { borderId: "280aed52-cf1d-4f78-bd92-dfeafbacbd25", lookup: "kamohoalii", name: "Wayfinder's Current" },
];

function escapeSql(value) {
  return value.replace(/'/g, "''");
}

function buildRenameValuesSql() {
  return BORDER_RENAMES.map(
    (b) => `('${b.borderId}'::uuid, '${escapeSql(b.name)}')`
  ).join(",\n      ");
}

exports.up = (pgm) => {
  // 1. Drop the legacy standalone "Devourer's Legacy" achievement, which is
  //    superseded by char_fenrir_final_ach (same character, same target).
  pgm.sql(`
    DELETE FROM achievements
    WHERE achievement_key = '${LEGACY_FENRIR_ACHIEVEMENT_KEY}';
  `);

  // 2. Drop the legacy "Ravenous Fang" border row. The new fenrir-final-ach
  //    border (renamed below) takes over the "Ravenous Fang" identity.
  //    Cascades: any equipped/owned references would have been cleared by
  //    the SET NULL / CASCADE rules on the FKs to card_borders.border_id.
  pgm.sql(`
    DELETE FROM card_borders
    WHERE border_id = '${LEGACY_RAVENOUS_FANG_BORDER_ID}'::uuid;
  `);

  // 3. Apply the canonical display names to all 37 character milestone
  //    borders. Skip rows that already carry the target name so the migration
  //    is safe to re-run.
  pgm.sql(`
    WITH new_names (border_id, new_name) AS (
      VALUES
        ${buildRenameValuesSql()}
    )
    UPDATE card_borders cb
    SET
      name = nn.new_name,
      updated_at = NOW()
    FROM new_names nn
    WHERE cb.border_id = nn.border_id
      AND cb.name IS DISTINCT FROM nn.new_name;
  `);
};

exports.down = (pgm) => {
  // Restore the lookup-style names for the 37 character milestone borders.
  // The deleted legacy "Ravenous Fang" border + achievement are not
  // restored — re-applying `1772100000000_add-character-achievements`
  // would be the right way to bring them back if ever needed.
  const restoreValuesSql = BORDER_RENAMES.map(
    (b) => `('${b.borderId}'::uuid, '${escapeSql(b.lookup)}-final-ach')`
  ).join(",\n      ");

  pgm.sql(`
    WITH old_names (border_id, old_name) AS (
      VALUES
        ${restoreValuesSql}
    )
    UPDATE card_borders cb
    SET
      name = on_.old_name,
      updated_at = NOW()
    FROM old_names on_
    WHERE cb.border_id = on_.border_id
      AND cb.name IS DISTINCT FROM on_.old_name;
  `);
};
