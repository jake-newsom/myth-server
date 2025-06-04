/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Helper function to escape single quotes in SQL strings
 */
function escapeSql(str) {
  if (typeof str !== "string") return str;
  return str.replace(/'/g, "''");
}

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  try {
    // First: Delete all existing entries in cards table (this will cascade to other tables)
    pgm.sql("DELETE FROM cards");

    // Second: Delete all existing entries in special_abilities table
    pgm.sql("DELETE FROM special_abilities");

    // Third: Check for and add missing enum values
    // Safer approach for adding enum values - first check if they exist
    pgm.sql(`
      DO $$
      BEGIN
        -- Check if 'uncommon' exists in card_rarity
        IF NOT EXISTS (
          SELECT 1 FROM pg_type 
          JOIN pg_enum ON pg_enum.enumtypid = pg_type.oid 
          WHERE pg_type.typname = 'card_rarity' AND pg_enum.enumlabel = 'uncommon'
        ) THEN
          -- If it doesn't exist, add it
          ALTER TYPE card_rarity ADD VALUE 'uncommon';
        END IF;
        
        -- Check if 'OnAnyFlip' exists in trigger_moment
        IF NOT EXISTS (
          SELECT 1 FROM pg_type 
          JOIN pg_enum ON pg_enum.enumtypid = pg_type.oid 
          WHERE pg_type.typname = 'trigger_moment' AND pg_enum.enumlabel = 'OnAnyFlip'
        ) THEN
          -- If it doesn't exist, add it
          ALTER TYPE trigger_moment ADD VALUE 'OnAnyFlip';
        END IF;
      END $$;
    `);

    // Insert special abilities one by one to avoid SQL quote issues
    // Each ability is inserted as a separate SQL command

    // Define abilities to insert - all abilities from cards.ts
    const abilities = [
      {
        id: "ability_card2",
        name: "Shieldmaidens Unite",
        description:
          "Gain +1 to all stats if adjacent to another Shield Maiden",
        trigger: "OnPlace",
      },
      {
        id: "ability_card5",
        name: "Hunt Charge",
        description: "+3 Right if it defeats an enemy this turn",
        trigger: "OnFlipped",
      },
      {
        id: "ability_card7",
        name: "Watery Depths",
        description: "+2 Bottom if adjacent to a Sea card",
        trigger: "OnPlace",
      },
      {
        id: "ability_card8",
        name: "Inspiring Song",
        description: "+1 to adjacent ally stats while on the board",
        trigger: "OnPlace",
      },
      {
        id: "ability_card13",
        name: "Icy Grasp",
        description: "Reduce adjacent enemy power by 2 before attack",
        trigger: "OnPlace",
      },
      {
        id: "ability_card14",
        name: "Young Fury",
        description: "+2 Top if it defeats an enemy",
        trigger: "OnFlipped",
      },
      {
        id: "ability_card16",
        name: "Swarm Tactics",
        description: "+2 to all power when surrounded by 2 or more cards",
        trigger: "OnPlace",
      },
      {
        id: "ability_card19",
        name: "Cunning Flank",
        description: "+1 to all powers if flanked on both sides by enemies",
        trigger: "OnPlace",
      },
      {
        id: "ability_card20",
        name: "Corner Light",
        description: "+1 all stats when placed in corner",
        trigger: "OnPlace",
      },
      {
        id: "ability_card21",
        name: "Heaven's Wrath",
        description: "Defeats all adjacent enemies if placed in top row",
        trigger: "OnPlace",
      },
      {
        id: "ability_card22",
        name: "Grave Vengeance",
        description: "50% chance to defeat 1 adjacent enemy back when defeated",
        trigger: "OnFlipped",
      },
      {
        id: "ability_card23",
        name: "Switcheroo",
        description: "Once: swap places with 1 adjacent enemy card",
        trigger: "OnPlace",
      },
      {
        id: "ability_card25",
        name: "Boatman's Bonus",
        description: "+2 Right if adjacent to boat or sea creature",
        trigger: "OnPlace",
      },
      {
        id: "ability_card26",
        name: "Runic Aura",
        description: "+1 to adjacent ally stats",
        trigger: "OnPlace",
      },
      {
        id: "ability_card27",
        name: "Devour Essence",
        description: "+1 to all stats for each defeated enemy",
        trigger: "OnPlace",
      },
      {
        id: "ability_card28",
        name: "Totem Empower",
        description: "+1 to top/bottom of adjacent Beast allies",
        trigger: "OnPlace",
      },
      {
        id: "ability_card29",
        name: "Storm Strike",
        description: "Reduce an adjacent enemy card's power by 2 for 1 turn",
        trigger: "OnPlace",
      },
      {
        id: "ability_card30",
        name: "Frost Roots",
        description: "+2 all stats if placed in bottom row",
        trigger: "OnPlace",
      },
      {
        id: "ability_card31",
        name: "Stone Wall",
        description: "Cannot be defeated for 1 turn after placement",
        trigger: "OnPlace",
      },
      {
        id: "ability_card32",
        name: "Mirror Mist",
        description: "Once: swap this card's left/right values",
        trigger: "OnPlace",
      },
      {
        id: "ability_card33",
        name: "Ice Line Bonus",
        description: "+2 Bottom if adjacent to a water-based card",
        trigger: "OnPlace",
      },
      {
        id: "ability_card34",
        name: "Flame Touch",
        description: "Reduce adjacent enemy power by 1 before attack",
        trigger: "OnPlace",
      },
      {
        id: "ability_card35",
        name: "Wind Push",
        description: "Push 1 adjacent enemy card away (if space open)",
        trigger: "OnPlace",
      },
      {
        id: "ability_card36",
        name: "Divine Judgment",
        description: "Defeats any adjacent card with lower total power",
        trigger: "OnPlace",
      },
      {
        id: "ability_card37",
        name: "Bloodlust",
        description: "Defeated enemies become permanent allies",
        trigger: "OnAnyFlip",
      },
      {
        id: "ability_card38",
        name: "Thunder Response",
        description: "+3 all stats if placed after opponent's turn",
        trigger: "OnPlace",
      },
      {
        id: "ability_card39",
        name: "Titan Shell",
        description: "Cannot be defeated",
        trigger: "OnPlace",
      },
      {
        id: "ability_card40",
        name: "Warrior's Blessing",
        description: "Allies adjacent gain +2 while Freya is on the board",
        trigger: "OnPlace",
      },
      {
        id: "ability_card41",
        name: "Soul Lock",
        description: "Defeated enemies become permanent allies",
        trigger: "OnFlipped",
      },
      {
        id: "ability_card42",
        name: "Hoofed Escape",
        description: "Can move once after being placed",
        trigger: "OnPlace",
      },
      {
        id: "ability_card43",
        name: "Mjölnir Shock",
        description: "Reduce an adjacent enemy card's power by 2 for one turn",
        trigger: "OnPlace",
      },
      {
        id: "ability_card44",
        name: "World Tree's Blessing",
        description: "+2 to all adjacent ally cards on placement",
        trigger: "OnPlace",
      },
      {
        id: "ability_card45",
        name: "Corrosion",
        description: "Reduce all sides of one adjacent enemy card by 2",
        trigger: "OnPlace",
      },
      {
        id: "ability_card46",
        name: "Twin Ravens",
        description: "Choose one adjacent enemy to defeat at end of turn",
        trigger: "OnPlace",
      },
      {
        id: "ability_card47",
        name: "Watchman's Gate",
        description: "Blocks enemy placements adjacent for 1 turn",
        trigger: "OnPlace",
      },
      {
        id: "ability_card48",
        name: "Rainbow Bridge",
        description: "Once: swap with any ally card on the board",
        trigger: "OnPlace",
      },
      {
        id: "ability_card49",
        name: "Fated Rewrite",
        description: "Reroll one adjacent card's highest stat",
        trigger: "OnPlace",
      },
      {
        id: "ability_card50",
        name: "Ragnarok Blast",
        description: "Destroys all adjacent cards",
        trigger: "OnPlace",
      },
      {
        id: "ability_card51",
        name: "Mother's Blessing",
        description: "Grants +1 to all ally cards when played",
        trigger: "OnPlace",
      },
      {
        id: "ability_card52",
        name: "Duelist's Edge",
        description: "If facing a single enemy, gain +2 to both facing sides",
        trigger: "OnPlace",
      },
      {
        id: "ability_card53",
        name: "Light Undimmed",
        description: "Cannot be defeated by special abilities",
        trigger: "OnPlace",
      },
      {
        id: "ability_card54",
        name: "Apples of Youth",
        description:
          "Restores +1 stat to each adjacent ally (if they've been reduced)",
        trigger: "OnPlace",
      },
      {
        id: "ability_card55",
        name: "Poet's Rhythm",
        description:
          "Flip bonus +2 if this card is the 3rd card played by your team this turn",
        trigger: "OnFlipped",
      },
      {
        id: "ability_card56",
        name: "Sea's Protection",
        description: "Cannot be defeated if placed next to a Sea card",
        trigger: "OnPlace",
      },
      {
        id: "ability_card57",
        name: "Golden Hair",
        description: "Adjacent allies gain +1 Left and Right power",
        trigger: "OnPlace",
      },
      {
        id: "ability_card58",
        name: "Arbiter's Judgment",
        description:
          "Forseti and neighbors cannot be defeated for the next round",
        trigger: "OnPlace",
      },
      {
        id: "ability_card59",
        name: "Healing Touch",
        description: "All adjacent allies gain +1 to lowest power",
        trigger: "OnPlace",
      },
      {
        id: "ability_card60",
        name: "Winter's Aim",
        description: "If played on an edge tile, +2 to Top and Bottom",
        trigger: "OnPlace",
      },
      {
        id: "ability_card61",
        name: "Flames of Muspelheim",
        description:
          "Destroys one adjacent enemy card and reduces all others' stats by 1",
        trigger: "OnPlace",
      },
      {
        id: "ability_card62",
        name: "Messenger's Scurry",
        description:
          "Once per game, swap places with any adjacent ally or enemy card",
        trigger: "OnPlace",
      },
    ];

    // Insert each ability separately
    abilities.forEach((ability) => {
      pgm.sql(`
        INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
        VALUES (
          '${escapeSql(ability.id)}',
          '${escapeSql(ability.name)}',
          '${escapeSql(ability.description)}',
          '${escapeSql(ability.trigger)}',
          '{}'
        )
      `);
    });

    // Insert cards one by one
    // Example cards
    const cards = [
      {
        name: "Thrall",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/thrall.svg",
        power: { top: 3, right: 4, bottom: 3, left: 4 },
        tags: ["human"],
        ability_id: null,
      },
      {
        name: "Shield Maiden",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/shield_maiden.svg",
        power: { top: 5, right: 6, bottom: 6, left: 5 },
        tags: ["human"],
        ability_id: "ability_card2",
      },
      {
        name: "Wolf Pup",
        type: "beast",
        rarity: "common",
        image: "/assets/images/cards/wolf_pup.svg",
        power: { top: 4, right: 8, bottom: 2, left: 6 },
        tags: ["beast"],
        ability_id: null,
      },
      {
        name: "Drengr",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/drengr_warrior.svg",
        power: { top: 6, right: 5, bottom: 7, left: 3 },
        tags: ["warrior", "human"],
        ability_id: null,
      },
      {
        name: "Boar of the Hunt",
        type: "beast",
        rarity: "common",
        image: "/assets/images/cards/boar_of_the_hunt.svg",
        power: { top: 7, right: 2, bottom: 6, left: 3 },
        tags: ["beast"],
        ability_id: "ability_card5",
      },
      {
        name: "Peasant Archer",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/peasant_archer.svg",
        power: { top: 4, right: 5, bottom: 5, left: 6 },
        tags: ["warrior", "human"],
        ability_id: null,
      },
      {
        name: "Fisherman",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/fisherman.svg",
        power: { top: 3, right: 3, bottom: 6, left: 7 },
        tags: ["human", "sea"],
        ability_id: "ability_card7",
      },
      {
        name: "Skald",
        type: "mystic",
        rarity: "common",
        image: "/assets/images/cards/skald_bard.svg",
        power: { top: 3, right: 4, bottom: 5, left: 6 },
        tags: ["human", "musical"],
        ability_id: "ability_card8",
      },
      {
        name: "Goat of Heidrun",
        type: "beast",
        rarity: "common",
        image: "/assets/images/cards/goat_of_heidrun.svg",
        power: { top: 6, right: 3, bottom: 4, left: 6 },
        tags: ["beast"],
        ability_id: null,
      },
      {
        name: "Raven Scout",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/raven_scout.svg",
        power: { top: 4, right: 8, bottom: 3, left: 6 },
        tags: ["human"],
        ability_id: null,
      },
      {
        name: "Woodcutter",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/woodcutter.svg",
        power: { top: 5, right: 6, bottom: 6, left: 5 },
        tags: ["human"],
        ability_id: null,
      },
      {
        name: "Young Jarl",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/young_jarl.svg",
        power: { top: 6, right: 6, bottom: 5, left: 6 },
        tags: ["human"],
        ability_id: null,
      },
      {
        name: "Ice Wraith",
        type: "undead",
        rarity: "common",
        image: "/assets/images/cards/ice_wraith.svg",
        power: { top: 5, right: 8, bottom: 4, left: 5 },
        tags: ["undead"],
        ability_id: "ability_card13",
      },
      {
        name: "Berserker Initiate",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/berserker_initiate.svg",
        power: { top: 5, right: 9, bottom: 3, left: 5 },
        tags: ["warrior", "human"],
        ability_id: "ability_card14",
      },
      {
        name: "Farmstead Boar",
        type: "beast",
        rarity: "common",
        image: "/assets/images/cards/farmstead_boar.svg",
        power: { top: 7, right: 5, bottom: 5, left: 3 },
        tags: ["beast"],
        ability_id: null,
      },
      {
        name: "Rat King",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/rat_king.svg",
        power: { top: 5, right: 6, bottom: 6, left: 6 },
        tags: ["beast"],
        ability_id: "ability_card16",
      },
      {
        name: "Mead Bearer",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/mead_bearer.svg",
        power: { top: 4, right: 6, bottom: 6, left: 6 },
        tags: ["human"],
        ability_id: null,
      },
      {
        name: "Stag of the Grove",
        type: "beast",
        rarity: "common",
        image: "/assets/images/cards/stag_of_the_grove.svg",
        power: { top: 6, right: 3, bottom: 7, left: 3 },
        tags: ["beast"],
        ability_id: null,
      },
      {
        name: "Norse Fox",
        type: "beast",
        rarity: "common",
        image: "/assets/images/cards/norse_fox.svg",
        power: { top: 5, right: 8, bottom: 5, left: 5 },
        tags: ["beast"],
        ability_id: "ability_card19",
      },
      {
        name: "Torchbearer",
        type: "warrior",
        rarity: "common",
        image: "/assets/images/cards/torchbearer.svg",
        power: { top: 3, right: 9, bottom: 3, left: 9 },
        tags: ["human"],
        ability_id: "ability_card20",
      },
      {
        name: "Valkyrie",
        type: "warrior",
        rarity: "rare",
        image: "/assets/images/cards/valkyrie.svg",
        power: { top: 8, right: 8, bottom: 5, left: 8 },
        tags: ["warrior", "mythological"],
        ability_id: "ability_card21",
      },
      {
        name: "Draugr",
        type: "undead",
        rarity: "rare",
        image: "/assets/images/cards/draugr.svg",
        power: { top: 6, right: 10, bottom: 5, left: 9 },
        tags: ["undead"],
        ability_id: "ability_card22",
      },
      {
        name: "Loki",
        type: "god",
        rarity: "rare",
        image: "/assets/images/cards/lokis_trick.svg",
        power: { top: 3, right: 12, bottom: 3, left: 12 },
        tags: ["god"],
        ability_id: "ability_card23",
      },
      {
        name: "Seer",
        type: "mystic",
        rarity: "rare",
        image: "/assets/images/cards/seer.svg",
        power: { top: 2, right: 13, bottom: 3, left: 10 },
        tags: ["mystic"],
        ability_id: null,
      },
      {
        name: "Oarsman",
        type: "warrior",
        rarity: "rare",
        image: "/assets/images/cards/oarsman.svg",
        power: { top: 6, right: 11, bottom: 7, left: 7 },
        tags: ["human", "sea"],
        ability_id: "ability_card25",
      },
      {
        name: "Runestone Keeper",
        type: "artifact",
        rarity: "rare",
        image: "/assets/images/cards/runestone_keeper.svg",
        power: { top: 6, right: 8, bottom: 9, left: 8 },
        tags: ["human"],
        ability_id: "ability_card26",
      },
      {
        name: "Corpse-Eater",
        type: "undead",
        rarity: "rare",
        image: "/assets/images/cards/corpse-eater.svg",
        power: { top: 3, right: 11, bottom: 5, left: 10 },
        tags: ["undead"],
        ability_id: "ability_card27",
      },
      {
        name: "Bear Totem",
        type: "beast",
        rarity: "rare",
        image: "/assets/images/cards/bear_totem.svg",
        power: { top: 7, right: 6, bottom: 10, left: 6 },
        tags: ["beast", "nature"],
        ability_id: "ability_card28",
      },
      {
        name: "Thunder Priest",
        type: "mystic",
        rarity: "rare",
        image: "/assets/images/cards/thunder_priest.svg",
        power: { top: 6, right: 7, bottom: 11, left: 5 },
        tags: ["mystic"],
        ability_id: "ability_card29",
      },
      {
        name: "Frost Giant Whelp",
        type: "god",
        rarity: "rare",
        image: "/assets/images/cards/frost_giant_whelp.svg",
        power: { top: 6, right: 9, bottom: 8, left: 4 },
        tags: ["mythological", "giant"],
        ability_id: "ability_card30",
      },
      {
        name: "Troll Bridge Guard",
        type: "warrior",
        rarity: "rare",
        image: "/assets/images/cards/troll_bridge_guard.svg",
        power: { top: 8, right: 7, bottom: 7, left: 7 },
        tags: ["mythological"],
        ability_id: "ability_card31",
      },
      {
        name: "Mistcaller",
        type: "warrior",
        rarity: "rare",
        image: "/assets/images/cards/mistcaller.svg",
        power: { top: 6, right: 10, bottom: 6, left: 6 },
        tags: ["human", "mystic"],
        ability_id: "ability_card32",
      },
      {
        name: "Ice Fisher",
        type: "warrior",
        rarity: "rare",
        image: "/assets/images/cards/ice_fisher.svg",
        power: { top: 5, right: 11, bottom: 7, left: 6 },
        tags: ["human", "sea"],
        ability_id: "ability_card33",
      },
      {
        name: "Fire Dancer",
        type: "warrior",
        rarity: "rare",
        image: "/assets/images/cards/fire_dancer.svg",
        power: { top: 6, right: 6, bottom: 11, left: 5 },
        tags: ["human"],
        ability_id: "ability_card34",
      },
      {
        name: "Howling Wind Spirit",
        type: "spirit",
        rarity: "rare",
        image: "/assets/images/cards/howling_wind_spirit.svg",
        power: { top: 8, right: 7, bottom: 7, left: 7 },
        tags: ["mythological"],
        ability_id: "ability_card35",
      },
      {
        name: "Odin",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/odin_allfather.svg",
        power: { top: 12, right: 11, bottom: 10, left: 11 },
        tags: ["god"],
        ability_id: "ability_card36",
      },
      {
        name: "Fenrir",
        type: "warrior",
        rarity: "epic",
        image: "/assets/images/cards/fenrir.svg",
        power: { top: 11, right: 13, bottom: 9, left: 10 },
        tags: ["mythological", "beast"],
        ability_id: "ability_card37",
      },
      {
        name: "Thor",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/thor_god_of_thunder.svg",
        power: { top: 12, right: 9, bottom: 14, left: 9 },
        tags: ["god", "warrior"],
        ability_id: "ability_card38",
      },
      {
        name: "Jörmungandr",
        type: "warrior",
        rarity: "epic",
        image: "/assets/images/cards/jörmungandr.svg",
        power: { top: 9, right: 13, bottom: 12, left: 13 },
        tags: ["mythological", "beast"],
        ability_id: "ability_card39",
      },
      {
        name: "Freya",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/freya.svg",
        power: { top: 10, right: 10, bottom: 10, left: 10 },
        tags: ["god"],
        ability_id: "ability_card40",
      },
      {
        name: "Hel",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/hel.svg",
        power: { top: 10, right: 12, bottom: 12, left: 9 },
        tags: ["god"],
        ability_id: "ability_card41",
      },
      {
        name: "Sleipnir",
        type: "warrior",
        rarity: "epic",
        image: "/assets/images/cards/sleipnir.svg",
        power: { top: 8, right: 9, bottom: 14, left: 6 },
        tags: ["mythological", "beast"],
        ability_id: "ability_card42",
      },
      {
        name: "Mjölnir",
        type: "artifact",
        rarity: "epic",
        image: "/assets/images/cards/mjölnir.svg",
        power: { top: 9, right: 15, bottom: 5, left: 5 },
        tags: ["mythological", "weapon"],
        ability_id: "ability_card43",
      },
      {
        name: "Yggdrasil",
        type: "artifact",
        rarity: "epic",
        image: "/assets/images/cards/yggdrasil.svg",
        power: { top: 7, right: 11, bottom: 7, left: 11 },
        tags: ["mythological", "nature"],
        ability_id: "ability_card44",
      },
      {
        name: "Nidhogg",
        type: "warrior",
        rarity: "epic",
        image: "/assets/images/cards/nidhogg.svg",
        power: { top: 13, right: 11, bottom: 13, left: 8 },
        tags: ["mythological", "beast"],
        ability_id: "ability_card45",
      },
      {
        name: "Hugin & Munin",
        type: "warrior",
        rarity: "legendary",
        image: "/assets/images/cards/hugin_&_munin.svg",
        power: { top: 10, right: 10, bottom: 10, left: 10 },
        tags: ["mythological", "beast"],
        ability_id: "ability_card46",
      },
      {
        name: "Heimdall",
        type: "god",
        rarity: "legendary",
        image: "/assets/images/cards/heimdall.svg",
        power: { top: 12, right: 12, bottom: 9, left: 9 },
        tags: ["god"],
        ability_id: "ability_card47",
      },
      {
        name: "Bifrost Gate",
        type: "artifact",
        rarity: "legendary",
        image: "/assets/images/cards/bifrost_gate.svg",
        power: { top: 8, right: 14, bottom: 8, left: 14 },
        tags: ["mythological"],
        ability_id: "ability_card48",
      },
      {
        name: "The Norns",
        type: "god",
        rarity: "legendary",
        image: "/assets/images/cards/the_norns.svg",
        power: { top: 9, right: 9, bottom: 13, left: 9 },
        tags: ["mystic", "god", "mythological"],
        ability_id: "ability_card49",
      },
      {
        name: "Ragnarok",
        type: "warrior",
        rarity: "legendary",
        image: "/assets/images/cards/ragnarok.svg",
        power: { top: 15, right: 15, bottom: 15, left: 15 },
        tags: ["mythological", "event"],
        ability_id: "ability_card50",
      },
      {
        name: "Frigg",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/frigg.svg",
        power: { top: 10, right: 10, bottom: 12, left: 9 },
        tags: ["god"],
        ability_id: "ability_card51",
      },
      {
        name: "Tyr",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/tyr.svg",
        power: { top: 13, right: 9, bottom: 11, left: 9 },
        tags: ["god", "warrior"],
        ability_id: "ability_card52",
      },
      {
        name: "Baldur",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/baldur.svg",
        power: { top: 11, right: 11, bottom: 11, left: 11 },
        tags: ["god", "warrior"],
        ability_id: "ability_card53",
      },
      {
        name: "Idunn",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/idunn.svg",
        power: { top: 9, right: 10, bottom: 10, left: 11 },
        tags: ["god"],
        ability_id: "ability_card54",
      },
      {
        name: "Bragi",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/bragi.svg",
        power: { top: 8, right: 13, bottom: 9, left: 10 },
        tags: ["god"],
        ability_id: "ability_card55",
      },
      {
        name: "Njord",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/njord.svg",
        power: { top: 10, right: 12, bottom: 10, left: 9 },
        tags: ["god", "sea"],
        ability_id: "ability_card56",
      },
      {
        name: "Sif",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/sif.svg",
        power: { top: 9, right: 9, bottom: 14, left: 10 },
        tags: ["god"],
        ability_id: "ability_card57",
      },
      {
        name: "Forseti",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/forseti.svg",
        power: { top: 12, right: 10, bottom: 10, left: 10 },
        tags: ["god"],
        ability_id: "ability_card58",
      },
      {
        name: "Eir",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/eir.svg",
        power: { top: 10, right: 8, bottom: 12, left: 10 },
        tags: ["god"],
        ability_id: "ability_card59",
      },
      {
        name: "Ullr",
        type: "god",
        rarity: "epic",
        image: "/assets/images/cards/ullr.svg",
        power: { top: 11, right: 9, bottom: 13, left: 9 },
        tags: ["god", "hunter"],
        ability_id: "ability_card60",
      },
      {
        name: "Surtr",
        type: "god",
        rarity: "legendary",
        image: "/assets/images/cards/surtr.svg",
        power: { top: 14, right: 12, bottom: 13, left: 10 },
        tags: ["god", "giant"],
        ability_id: "ability_card61",
      },
      {
        name: "Ratatoskr",
        type: "beast",
        rarity: "rare",
        image: "/assets/images/cards/ratatoskr.svg",
        power: { top: 7, right: 9, bottom: 8, left: 6 },
        tags: ["god", "beast"],
        ability_id: "ability_card62",
      },
    ];

    // Insert each card separately
    cards.forEach((card) => {
      const abilityIdQuery = card.ability_id
        ? `(SELECT ability_id FROM special_abilities WHERE id = '${escapeSql(
            card.ability_id
          )}')`
        : "NULL";

      const tagsArray = card.tags
        .map((tag) => `'${escapeSql(tag)}'`)
        .join(", ");

      pgm.sql(`
        INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags)
        VALUES (
          '${escapeSql(card.name)}',
          '${escapeSql(card.type)}',
          '${escapeSql(card.rarity)}',
          '${escapeSql(card.image)}',
          '${escapeSql(JSON.stringify(card.power))}',
          ${abilityIdQuery},
          ARRAY[${tagsArray}]
        )
      `);
    });
  } catch (error) {
    console.error("Error in migration:", error);
    throw error;
  }
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Clean all cards and abilities
  pgm.sql("DELETE FROM cards");
  pgm.sql("DELETE FROM special_abilities");
};
