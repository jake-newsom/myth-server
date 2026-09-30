/* eslint-disable camelcase */

/**
 * Balance patch: ability names, descriptions and trigger moments.
 *
 * The handler rewrites in src/game-engine/abilities/* ship in the same release
 * and depend on these rows. Several use trigger moments added by 1800000000016
 * (terrain), 1800000000017 (move) and 1800000000018 (OnDefend), so this must run
 * after them; the enum values are committed by then because migrate:deploy runs
 * each migration in its own transaction.
 *
 * Values exported from the dev database, where the patch was authored. Rows
 * are matched by special_abilities.id; parameters, sound effects and the
 * characters they belong to are untouched.
 *
 * No down: the pre-patch text only exists in the production data. Rolling back
 * the handlers means restoring these rows from a backup or re-patching them.
 */

exports.shorthands = undefined;

const ABILITIES = [
  ["baldr_immune","Mistletainn’s Absence","On DEFEAT: Return this card to your hand.",["OnFlipped"]],
  ["benkei_steadfast_guard","Standing Death","In hand or play: Gain +1 power when a WAR card is DEFEATED.",["AnyOnFlip","HandOnFlip"]],
  ["fenrir_devourer_surge","Devourer's Surge","Round end: DESTROY a weaker adjacent enemy to gain +1 power.",["OnRoundEnd"]],
  ["freyja_bless","Warrior's Blessing","In hand: Gain +1 power for each COMMON card played and +1 power with a 50% chance for each COMMON card DEFEATED.",["HandOnPlace","AnyOnFlip","HandOnFlip"]],
  ["frigg_bless","Fensalir's Foresight","Before Combat: Gain +3 power if Baldr has been DEFEATED. Choose a card in the opponent's hand to grant -3 power.",["OnPlace"]],
  ["gashadokuro_bone_chill","Bone Chill","Before combat: Grant -2 power to adjacent enemies.",["OnPlace"]],
  ["hachiman_warriors_aura","Divine Archery","Turn End: Grant +1 power to allies in your row and +1 power to a random WAR card in your hand.",["OnTurnEnd"]],
  ["hel_soul","Soul Lock","On Play: Gain +1 power for each UNDERWORLD card in play. Enemies DEFEATED by Hel are protected until Hel is DESTROYED.",["OnPlace","OnFlip"]],
  ["jormungandr_shell","Titan Shell","On Play: Gain +1 power for each SEA card in play. Can only be DEFEATED by Thor.",["OnPlace","OnCombat"]],
  ["kaahupahau_harbor_guardian","Puʻuloa Guard","When an ally would be DEFEATED: Sacrifice 3 power from all sides to protect them.",["AnyOnCombat"]],
  ["kamapuaa_wild_shift","Oinkue’s Path","Round Start: Create LAVA with -1 DEBUFF in a random tile.",["OnRoundStart"]],
  ["kamohoalii_oceans_shield","Aumakua’s Path","Cannot be DEFEATED by enemies with lower total power. On DEFEND: Grant +2 power to a random SEA card in your hand.",["OnDefend","OnCombat"]],
  ["kintaro_beast_friend","Golden Boy’s Grip","Before Combat: Gain +2 power for each stronger adjacent card and +2 power if Minamoto no Raikō is in play.",["OnPlace"]],
  ["ku_war_stance","Blood Altar","When an ally is DEFEATED: Gain +2 power (max 6). At max, attack adjacent enemies again.",["AnyOnFlipped"]],
  ["loki_flip","Trickster's Gambit","Before Combat: For every TRICKSTER in play, DEFEAT a random enemy with a 65% chance.",["OnPlace"]],
  ["lono_fertile_ground","Makahiki Bounty","On Play: Grant +1 power to each NATURE card in hand and protect ally NATURE cards for 1 round.",["OnPlace"]],
  ["maui_sun_trick","Sun Trick","In Hand: Gain +1 power on round end. In Play: Grant +1 power to a random TRICKSTER in hand on round end.",["HandOnRoundEnd","OnRoundEnd"]],
  ["momotaro_allies_rally","Kibi Dango Treat","In hand or play: Gain +1 power for each BEAST card PLAYED or DEFEATED.",["HandOnPlace","AnyOnPlace","AnyOnFlip","HandOnFlip"]],
  ["mooinanea_sacred_spring","Sacred Spring","Turn end: If on WATER, grant +2 power to a random card in your hand.",["OnTurnEnd"]],
  ["nightmarchers_dread_aura","Dread Aura","Round end: Move to a random empty adjacent tile, leaving a -1 power DEBUFF behind. Attack any new adjacent HUMAN card.",["OnRoundEnd"]],
  ["njord_sea","Nóatún’s Guard","On Play: Gain +3 power if adjacent to a SEA card. Fill your row with WATER, even where cards already stand.",["OnPlace"]],
  ["nopperabo_erase_face","Faceless Void","Before combat: Remove all BUFFS from adjacent enemies.",["BeforeCombat"]],
  ["odin_foresight","Eye of Mimir","On Play: Grant +2 power to all cards in your hand.",["OnPlace"]],
  ["pele_lava_field","Lava Field","In hand or play: Gain +1 power when a LAVA tile is added to the board.",["HandOnTerrain","AnyOnTerrain"]],
  ["poliahu_icy_presence","Icy Presence","On Play: Convert all LAVA to WATER. Grant +2 power to allies and -1 power to enemies in WATER.",["OnPlace"]],
  ["ragnarok_worlds_end","Ragnarök","Fill empty tiles on the board with LAVA for 1 round. Turn End: Grant GOD cards in your enemy's hand -1 power.",["OnPlace","OnTurnEnd"]],
  ["skadi_freeze","Winter’s Step","Before combat: Grant -2 power to enemies in the same column through your next turn.",["OnPlace"]],
  ["surtr_flames","Flames of Muspelheim","Before combat: DESTROY the strongest adjacent enemy and create -1 LAVA on all adjacent sides.",["OnPlace"]],
  ["susanoo_storm_breaker","Kusanagi’s Strike","On Play: Gain +3 power if Yamata no Orochi in play. DESTROY the strongest enemy BEAST or DRAGON.",["OnPlace"]],
  ["tawara_piercing_shot","Centipede Arrow","Before combat: Choose an enemy with lower total power to DEFEAT.",["OnPlace"]],
  ["ukupanipo_feast_or_famine","Shark God’s Wake","While in play: Grant -3 power to non-SEA enemies who move into or are played on WATER.",["AnyOnPlace","AnyOnMove"]],
  ["urd_past_weaves","Thread of Fate","Before combat: Gain +1 to all stats for each DESTROYED ally.",["OnPlace"]]
];

const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

exports.up = (pgm) => {
  for (const [id, name, description, triggers] of ABILITIES) {
    pgm.sql(`
      UPDATE special_abilities
         SET name = ${lit(name)},
             description = ${lit(description)},
             trigger_moments = ARRAY[${triggers.map(lit).join(", ")}]::trigger_moment[]
       WHERE id = ${lit(id)};
    `);
  }
};

exports.down = () => {};
