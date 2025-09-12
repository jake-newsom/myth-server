-- SQL Queries for direct database insertion
-- Generated from database on 2025-09-12T14:03:43.257Z

-- Clear existing data (optional)
-- TRUNCATE sets CASCADE;
-- TRUNCATE special_abilities CASCADE;
-- TRUNCATE cards CASCADE;

-- Insert sets
INSERT INTO sets (name, description, is_released, image_url)
VALUES ('Japanese', '', true, 'japan-pack.webp')
ON CONFLICT (name) DO UPDATE SET 
  description = EXCLUDED.description,
  is_released = EXCLUDED.is_released,
  image_url = EXCLUDED.image_url;
INSERT INTO sets (name, description, is_released, image_url)
VALUES ('Norse', '', true, 'norse-pack.webp')
ON CONFLICT (name) DO UPDATE SET 
  description = EXCLUDED.description,
  is_released = EXCLUDED.is_released,
  image_url = EXCLUDED.image_url;
INSERT INTO sets (name, description, is_released, image_url)
VALUES ('Polynesian', '', true, 'polynesian-pack.webp')
ON CONFLICT (name) DO UPDATE SET 
  description = EXCLUDED.description,
  is_released = EXCLUDED.is_released,
  image_url = EXCLUDED.image_url;

-- Insert special abilities
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('amaterasu_radiant_blessing', 'Radiant Blessing', 'Adjacent allies gain +1 power for a round.', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('baldr_immune', 'Light Undimmed', 'Cannot be defeated by special abilities.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('benkei_steadfast_guard', 'Steadfast Guard', 'Adjacent allies gain +1 power if attacked but not defeated.', 'AnyOnDefend', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('bragi_inspire', 'Poet''s Rhythm', 'Adjacent allies gain +1 for a round.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('brynhildr_valk', 'Valkyrie Sisterhood', 'Gain +2 if adjacent to another Valkyrie.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('eir_heal', 'Healing Touch', 'Cleanse adjacent allies of negative effects.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('fafnir_venom', 'Venomous Presence', 'Reduce the strongest adjacent enemy card''s power by 2.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('fenrir_devourer_surge', 'Devourer''s Surge', 'Gain +1 for each adjacent enemy.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('freyja_bless', 'Warrior''s Blessing', 'Grant +2 to adjacent allies for a turn.', 'AfterCombat', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('freyr_peace', 'Peaceful Strength', 'Gain +2 if no adjacent enemies.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('frigg_bless', 'Mother''s Blessing', 'Grant +1 to all adjacent allies.', 'AfterCombat', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('futakuchi_onna_vengeful_bite', 'Vengeful Bite', 'When defeated, the attacker loses 1 power permanently.', 'OnFlipped', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('gashadokuro_bone_chill', 'Bone Chill', 'All adjacent enemies lose 1 power.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('gunnr_war', 'Battle Cry', 'Boost adjacent allies by +1.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('hachiman_warriors_aura', 'Warrior’s Aura', 'Adjacent friendly cards gain +1 power.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('hauwahine_rains_blessing', 'Rain''s Blessing', 'Fill an empty tile with water. Allies placed after her gain +1 to a random side.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('heimdall_block', 'Watchman''s Gate', 'Blocks enemy placements on all adjacent tiles for 1 turn.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('hel_soul', 'Soul Lock', 'Enemies Hel defeats become permanent allies.', 'OnFlip', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('hiaka_cleansing_hula', 'Cleansing Hula', 'Each of your turns, cleanse adjacent allies of one curse.', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('hrungnir_worthy', 'Worthy Opponent', 'Gain +1 to all stats if adjacent to Thor.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('jormungandr_shell', 'Titan Shell', 'Can only be defeated by Thor.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('jorogumo_web_curse', 'Web Curse', 'Adjacent tiles are cursed and drain all power for 1 round.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('kaahupahau_harbor_guardian', 'Harbor Guardian', 'Fill an empty tile with water. Adjacent allies are protected from defeat for 1 turn.', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('kamapuaa_wild_shift', 'Wild Shift', 'Each turn, alternate between +2 top and +2 bottom.', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('kamohoalii_oceans_shield', 'Ocean''s Shield', 'Fill an empty tile with water. Prevents allies in water from defeat.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('kanaloa_tide_ward', 'Tide Ward', 'Fill an empty tile with water. Protect adjacent allies from curses.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('kane_pure_waters', 'Pure Waters', 'Fill an empty tile with water. Cleanse all allies when played.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('kanehekili_thunderous_omen', 'Thunderous Omen', 'Strike a random enemy with lightning, reducing a random power by 1.', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('kapo_hex_field', 'Hex Field', 'Curse all empty adjacent tiles for 1 round.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('kintaro_beast_friend', 'Beast Friend', 'All ally BEAST cards gain +1 power.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('ku_war_stance', 'War Stance', 'Allies in the same row gain +1 Top.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('kupua_dual_aspect', 'Dual Aspect', 'Each turn, alternate between +2 left/right and +2 top/bottom.', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('laamaomao_gale_aura', 'Gale Aura', 'Push adjacent enemies away 1 tile.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('loki_flip', 'Trickster''s Gambit', 'Flip 4 random cards on the board with 50% chance.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('lono_fertile_ground', 'Fertile Ground', 'Bless adjacent empty titles with +1 for Allies.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('maui_sun_trick', 'Sun Trick', 'Each round, switch between +1 to left/right and top/bottom.', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('milu_spirit_bind', 'Spirit Bind', 'If defeated, the attacker loses 1 power permanently.', 'OnFlipped', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('minamoto_demon_bane', 'Demon Bane', 'Gains +2 power if adjacent to a YOKAI.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('momotaro_allies_rally', 'Allies Rally', 'Adjacent allies gain +1 power for a round.', 'AfterCombat', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('mooinanea_sacred_spring', 'Sacred Spring', 'Fill an empty tile with water. Each of your turns, cleanse adjacent allies of one curse.', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('nightmarchers_dread_aura', 'Dread Aura', 'Enemy abilities are disabled next turn.', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('njord_sea', 'Sea''s Protection', 'Gain +3 if adjacent to a Sea card.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('nopperabo_erase_face', 'Erase Face', 'Remove all buffs from adjacent enemies.', 'BeforeCombat', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('nurarihyon_slipstream', 'Slipstream', 'Gains +1 power if placed next to an already defeated card.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('odin_foresight', 'Foresight', 'Grant +1 to all allies on the board.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('okuriinu_hunters_mark', 'Hunter's Mark', 'Gains +1 power for each defeated enemy.', 'AnyOnFlip', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('pele_lava_field', 'Lava Field', 'Fill empty adjacent tiles with lava. Enemy cards placed on lava lose 1 power.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('poliahu_icy_presence', 'Icy Presence', 'Adjacent enemies lose 1 power.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('ran_pull', 'Drowning Net', 'Pull enemy cards one tile closer before combat.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('ryujin_tidal_sweep', 'Tidal Sweep', 'Enemies in the same column lose 1 power this turn.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('sigurd_slayer', 'Dragon Slayer', 'Gain +3 to all stats if adjacent to a Dragon card.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('skadi_freeze', 'Winter''s Grasp', 'Freeze one adjacent tile for 1 turn.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('sleipnir_swift_messenger', 'Swift Messenger', 'Draw 2 cards.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('surtr_flames', 'Flames of Muspelheim', 'Destroys the strongest adjacent enemy and reduces others by 1.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('susanoo_storm_breaker', 'Storm Breaker', 'Defeat strongest enemy in the same row regardless of power.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('tawara_piercing_shot', 'Piercing Shot', 'Enemies in the same column permanently lose 1 power.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('thor_push', 'Thunderous Push', 'Push all adjacent enemies away 1 space after combat.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('thrym_demand', 'Bride Demand', 'Gain +3 Right if adjacent to a Goddess card.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('tyr_binding_justice', 'Binding Justice', 'Lower the strongest adjacent enemy’s power by 2 for this turn.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('ukupanipo_feast_or_famine', 'Feast or Famine', 'Each of your turns, reduce one random side of an adjacent enemy by 1 (temporary).', 'OnTurnEnd', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('urashima_time_shift', 'Time Shift', 'Remove all temporary buffs from a random enemy in the same column.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('urd_past_weaves', 'Past Weaves', 'Gain +1 to all stats for each destroyed ally.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('ushi_oni_shore_fury', 'Shore Fury', 'Gains +2 power if placed on an edge.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('vali_revenge', 'Avenge Baldr', 'Gain +1 to all stats for each ally defeated this game.', 'AnyOnFlip', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('verdandi_present', 'Fated Draw', 'Draw 1 card.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('vidar_vengeance', 'Silent Vengeance', 'If Odin has been defeated, gain +3 to all stats.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('yamabiko_echo_power', 'Echo Power', 'Matches the highest adjacent card’s power this turn.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('yamata_many_heads', 'Many Heads', 'Gains +1 power for each adjacent enemy.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('ymir_isolation', 'Primordial Force', 'Gain +2 to all stats if no adjacent cards.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;
INSERT INTO special_abilities (id, name, description, trigger_moment, parameters)
VALUES ('yuki_onna_frost_row', 'Frost Row', 'Enemies in the same row lose 1 power this turn.', 'OnPlace', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  trigger_moment = EXCLUDED.trigger_moment,
  parameters = EXCLUDED.parameters;

-- Insert cards
-- Note: These queries assume sets and abilities are already inserted
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Akaname',
  'yokai',
  'common',
  'japanese/akaname.webp',
  '{"top":3,"left":3,"right":3,"bottom":3}',
  NULL,
  ARRAY['japanese', 'yokai'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Amaterasu',
  'god',
  'legendary',
  'japanese/amaterasu.webp',
  '{"top":9,"left":8,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'amaterasu_radiant_blessing'),
  ARRAY['japanese', 'goddess', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Bakeneko',
  'yokai',
  'common',
  'japanese/bakeneko.webp',
  '{"top":4,"left":4,"right":6,"bottom":4}',
  NULL,
  ARRAY['japanese', 'yokai'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Baldr',
  'god',
  'epic',
  'norse/baldr.webp',
  '{"top":11,"left":11,"right":11,"bottom":11}',
  (SELECT ability_id FROM special_abilities WHERE id = 'baldr_immune'),
  ARRAY['norse', 'god', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Bear Totem',
  'human',
  'common',
  'norse/bear-totem.webp',
  '{"top":6,"left":5,"right":4,"bottom":4}',
  NULL,
  ARRAY['norse', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Benkei',
  'human',
  'epic',
  'japanese/benkei.webp',
  '{"top":8,"left":7,"right":7,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'benkei_steadfast_guard'),
  ARRAY['japanese', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Berserker',
  'human',
  'common',
  'norse/berserker.webp',
  '{"top":6,"left":4,"right":6,"bottom":3}',
  NULL,
  ARRAY['norse', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Bragi',
  'god',
  'rare',
  'norse/bragi.webp',
  '{"top":7,"left":8,"right":7,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'bragi_inspire'),
  ARRAY['norse', 'god', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Canoe Builder',
  'human',
  'common',
  'polynesian/canoe-builder.webp',
  '{"top":4,"left":6,"right":4,"bottom":5}',
  NULL,
  ARRAY['polynesian', 'human', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Drenger',
  'human',
  'common',
  'norse/drengr.webp',
  '{"top":5,"left":5,"right":4,"bottom":4}',
  NULL,
  ARRAY['norse', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Fenrir',
  'beast',
  'epic',
  'norse/fenrir.webp',
  '{"top":10,"left":9,"right":10,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'fenrir_devourer_surge'),
  ARRAY['norse', 'beast', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Fisherman of Kuʻula',
  'human',
  'common',
  'polynesian/fisherman.webp',
  '{"top":4,"left":4,"right":6,"bottom":5}',
  NULL,
  ARRAY['polynesian', 'human', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Freyja',
  'goddess',
  'epic',
  'norse/freya.webp',
  '{"top":9,"left":9,"right":8,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'freyja_bless'),
  ARRAY['norse', 'goddess', 'warrior', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Frigg',
  'goddess',
  'rare',
  'norse/frigg.webp',
  '{"top":8,"left":7,"right":9,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'frigg_bless'),
  ARRAY['norse', 'goddess', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Futakuchi-onna',
  'yokai',
  'rare',
  'japanese/futakuchi-onna.webp',
  '{"top":5,"left":4,"right":6,"bottom":4}',
  (SELECT ability_id FROM special_abilities WHERE id = 'futakuchi_onna_vengeful_bite'),
  ARRAY['japanese', 'yokai'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Gashadokuro',
  'yokai',
  'legendary',
  'japanese/gashadokuro.webp',
  '{"top":9,"left":9,"right":9,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'gashadokuro_bone_chill'),
  ARRAY['japanese', 'yokai', 'beast'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Hachiman',
  'god',
  'legendary',
  'japanese/hachiman.webp',
  '{"top":8,"left":8,"right":8,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'hachiman_warriors_aura'),
  ARRAY['japanese', 'god', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Hauwahine',
  'mystic',
  'rare',
  'polynesian/hauwahine.webp',
  '{"top":5,"left":7,"right":8,"bottom":6}',
  (SELECT ability_id FROM special_abilities WHERE id = 'hauwahine_rains_blessing'),
  ARRAY['polynesian', 'mystic', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Heimdall',
  'god',
  'rare',
  'norse/heimdall.webp',
  '{"top":8,"left":7,"right":9,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'heimdall_block'),
  ARRAY['norse', 'god', 'warrior', 'sky'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Hel',
  'goddess',
  'epic',
  'norse/hel.webp',
  '{"top":8,"left":9,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'hel_soul'),
  ARRAY['norse', 'goddess', 'mystic', 'undead'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Hitotsume-kozō',
  'yokai',
  'common',
  'japanese/hitotsume-kozo.webp',
  '{"top":3,"left":4,"right":3,"bottom":4}',
  NULL,
  ARRAY['japanese', 'yokai'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Hi‘iaka',
  'goddess',
  'epic',
  'polynesian/hiiaka.webp',
  '{"top":9,"left":8,"right":7,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'hiaka_cleansing_hula'),
  ARRAY['polynesian', 'goddess', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Hula Dancer',
  'human',
  'common',
  'polynesian/hula-dancer.webp',
  '{"top":3,"left":5,"right":6,"bottom":4}',
  NULL,
  ARRAY['polynesian', 'human', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Ice Fisher',
  'human',
  'common',
  'norse/ice-fisher.webp',
  '{"top":3,"left":5,"right":3,"bottom":6}',
  NULL,
  ARRAY['norse', 'human', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Jorōgumo',
  'yokai',
  'rare',
  'japanese/jorogumo.webp',
  '{"top":5,"left":6,"right":5,"bottom":6}',
  (SELECT ability_id FROM special_abilities WHERE id = 'jorogumo_web_curse'),
  ARRAY['japanese', 'yokai', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Jörmungandr',
  'beast',
  'legendary',
  'norse/jormungandr.webp',
  '{"top":12,"left":8,"right":12,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'jormungandr_shell'),
  ARRAY['norse', 'beast', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kamapuaʻa',
  'god',
  'epic',
  'polynesian/kamapuaa.webp',
  '{"top":12,"left":8,"right":7,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'kamapuaa_wild_shift'),
  ARRAY['polynesian', 'god', 'warrior', 'nature'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kamohoali‘i',
  'god',
  'epic',
  'polynesian/kamohoalii.webp',
  '{"top":8,"left":9,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'kamohoalii_oceans_shield'),
  ARRAY['polynesian', 'god', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kanaloa',
  'god',
  'legendary',
  'polynesian/kanaloa.webp',
  '{"top":10,"left":12,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'kanaloa_tide_ward'),
  ARRAY['polynesian', 'god', 'mystic', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kapo',
  'goddess',
  'rare',
  'polynesian/kapo.webp',
  '{"top":6,"left":8,"right":6,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'kapo_hex_field'),
  ARRAY['polynesian', 'goddess', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kappa',
  'yokai',
  'common',
  'japanese/kappa.webp',
  '{"top":4,"left":5,"right":3,"bottom":4}',
  NULL,
  ARRAY['japanese', 'yokai', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kaʻahupahau',
  'goddess',
  'rare',
  'polynesian/kaahupahau.webp',
  '{"top":6,"left":8,"right":7,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'kaahupahau_harbor_guardian'),
  ARRAY['polynesian', 'goddess', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Ki''i',
  'human',
  'common',
  'polynesian/kii.webp',
  '{"top":5,"left":4,"right":5,"bottom":4}',
  NULL,
  ARRAY['polynesian', 'human'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kintarō',
  'human',
  'epic',
  'japanese/kintaro.webp',
  '{"top":6,"left":8,"right":6,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'kintaro_beast_friend'),
  ARRAY['japanese', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kitsune',
  'yokai',
  'common',
  'japanese/kitsune.webp',
  '{"top":5,"left":5,"right":4,"bottom":5}',
  NULL,
  ARRAY['japanese', 'yokai', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Koa Warrior',
  'human',
  'common',
  'polynesian/koa-warrior.webp',
  '{"top":6,"left":5,"right":4,"bottom":5}',
  NULL,
  ARRAY['polynesian', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kupua',
  'mystic',
  'rare',
  'polynesian/kupua.webp',
  '{"top":8,"left":7,"right":7,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'kupua_dual_aspect'),
  ARRAY['polynesian', 'mystic', 'shapeshifter'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kāne',
  'god',
  'legendary',
  'polynesian/kane.webp',
  '{"top":11,"left":11,"right":10,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'kane_pure_waters'),
  ARRAY['polynesian', 'god', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kānehekili',
  'god',
  'rare',
  'polynesian/kanehekili.webp',
  '{"top":9,"left":5,"right":8,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'kanehekili_thunderous_omen'),
  ARRAY['polynesian', 'god', 'mystic', 'storm'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Kū',
  'god',
  'epic',
  'polynesian/ku.webp',
  '{"top":13,"left":7,"right":9,"bottom":6}',
  (SELECT ability_id FROM special_abilities WHERE id = 'ku_war_stance'),
  ARRAY['polynesian', 'god', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Lava Scout',
  'human',
  'common',
  'polynesian/lava-scout.webp',
  '{"top":5,"left":4,"right":5,"bottom":3}',
  NULL,
  ARRAY['polynesian', 'human'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'La‘amaomao',
  'goddess',
  'rare',
  'polynesian/laamaomao.webp',
  '{"top":7,"left":8,"right":6,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'laamaomao_gale_aura'),
  ARRAY['polynesian', 'goddess', 'mystic', 'wind'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Loki',
  'god',
  'epic',
  'norse/loki.webp',
  '{"top":9,"left":9,"right":9,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'loki_flip'),
  ARRAY['norse', 'god', 'trickster', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Lono',
  'god',
  'epic',
  'polynesian/lono.webp',
  '{"top":8,"left":9,"right":8,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'lono_fertile_ground'),
  ARRAY['polynesian', 'god', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Milu',
  'god',
  'rare',
  'polynesian/milu.webp',
  '{"top":8,"left":6,"right":7,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'milu_spirit_bind'),
  ARRAY['polynesian', 'god', 'mystic', 'underworld'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Minamoto no Raikō',
  'human',
  'epic',
  'japanese/minamoto-raiko.webp',
  '{"top":7,"left":7,"right":6,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'minamoto_demon_bane'),
  ARRAY['japanese', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Mokumokuren',
  'yokai',
  'common',
  'japanese/mokumokuren.webp',
  '{"top":2,"left":3,"right":4,"bottom":3}',
  NULL,
  ARRAY['japanese', 'yokai', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Momotaro',
  'human',
  'epic',
  'japanese/momotaro.webp',
  '{"top":7,"left":6,"right":6,"bottom":6}',
  (SELECT ability_id FROM special_abilities WHERE id = 'momotaro_allies_rally'),
  ARRAY['japanese', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Mo‘oinanea',
  'mystic',
  'rare',
  'polynesian/mooinanea.webp',
  '{"top":6,"left":8,"right":7,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'mooinanea_sacred_spring'),
  ARRAY['polynesian', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Māui',
  'human',
  'epic',
  'polynesian/maui.webp',
  '{"top":9,"left":10,"right":12,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'maui_sun_trick'),
  ARRAY['polynesian', 'human', 'warrior', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Nightmarchers',
  'mystic',
  'rare',
  'polynesian/nightmarchers.webp',
  '{"top":7,"left":6,"right":6,"bottom":7}',
  (SELECT ability_id FROM special_abilities WHERE id = 'nightmarchers_dread_aura'),
  ARRAY['polynesian', 'mystic', 'spirit'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Njord',
  'god',
  'rare',
  'norse/njord.webp',
  '{"top":7,"left":7,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'njord_sea'),
  ARRAY['norse', 'god', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Noppera-bō',
  'yokai',
  'rare',
  'japanese/nopperabo.webp',
  '{"top":5,"left":5,"right":4,"bottom":5}',
  (SELECT ability_id FROM special_abilities WHERE id = 'nopperabo_erase_face'),
  ARRAY['japanese', 'yokai', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Norse Fox',
  'human',
  'common',
  'norse/norse-fox.webp',
  '{"top":5,"left":4,"right":5,"bottom":5}',
  NULL,
  ARRAY['norse', 'human', 'beast', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Nurarihyon',
  'yokai',
  'rare',
  'japanese/nurarihyon.webp',
  '{"top":4,"left":5,"right":5,"bottom":4}',
  (SELECT ability_id FROM special_abilities WHERE id = 'nurarihyon_slipstream'),
  ARRAY['japanese', 'yokai'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Odin',
  'god',
  'epic',
  'norse/odin.webp',
  '{"top":11,"left":9,"right":10,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'odin_foresight'),
  ARRAY['norse', 'god', 'warrior', 'mystic', 'sky'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Okuri-inu',
  'yokai',
  'rare',
  'japanese/okuri-inu.webp',
  '{"top":6,"left":6,"right":5,"bottom":6}',
  (SELECT ability_id FROM special_abilities WHERE id = 'okuriinu_hunters_mark'),
  ARRAY['japanese', 'yokai', 'beast'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Oni',
  'yokai',
  'common',
  'japanese/oni.webp',
  '{"top":5,"left":4,"right":5,"bottom":4}',
  NULL,
  ARRAY['japanese', 'yokai'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Peasant Archer',
  'human',
  'common',
  'norse/peasant-archer.webp',
  '{"top":4,"left":5,"right":5,"bottom":4}',
  NULL,
  ARRAY['norse', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Pele',
  'goddess',
  'legendary',
  'polynesian/pele.webp',
  '{"top":12,"left":10,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'pele_lava_field'),
  ARRAY['polynesian', 'goddess', 'mystic', 'fire'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Poliʻahu',
  'goddess',
  'rare',
  'polynesian/poliahu.webp',
  '{"top":8,"left":7,"right":8,"bottom":6}',
  (SELECT ability_id FROM special_abilities WHERE id = 'poliahu_icy_presence'),
  ARRAY['polynesian', 'goddess', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Ran',
  'goddess',
  'rare',
  'norse/ran.webp',
  '{"top":7,"left":8,"right":7,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'ran_pull'),
  ARRAY['norse', 'goddess', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Raven Scout',
  'human',
  'common',
  'norse/raven-scout.webp',
  '{"top":4,"left":6,"right":4,"bottom":4}',
  NULL,
  ARRAY['norse', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Runestone Keeper',
  'human',
  'common',
  'norse/runestone-keeper.webp',
  '{"top":3,"left":3,"right":4,"bottom":4}',
  NULL,
  ARRAY['norse', 'human', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Ryūjin',
  'god',
  'legendary',
  'japanese/ryujin.webp',
  '{"top":8,"left":9,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'ryujin_tidal_sweep'),
  ARRAY['japanese', 'god', 'sea', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Shieldmaiden',
  'human',
  'common',
  'norse/shield-maiden.webp',
  '{"top":5,"left":4,"right":5,"bottom":5}',
  NULL,
  ARRAY['norse', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Sigurd',
  'human',
  'epic',
  'norse/sigurd.webp',
  '{"top":9,"left":8,"right":9,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'sigurd_slayer'),
  ARRAY['norse', 'human', 'warrior', 'hero'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Skadi',
  'goddess',
  'rare',
  'norse/skadi.webp',
  '{"top":8,"left":8,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'skadi_freeze'),
  ARRAY['norse', 'goddess', 'warrior', 'giant'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Stone Carver',
  'human',
  'common',
  'polynesian/stone-carver.webp',
  '{"top":4,"left":4,"right":5,"bottom":5}',
  NULL,
  ARRAY['polynesian', 'human'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Surtr',
  'giant',
  'legendary',
  'norse/surtr.webp',
  '{"top":12,"left":9,"right":12,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'surtr_flames'),
  ARRAY['norse', 'giant', 'warrior', 'fire'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Susanoo',
  'god',
  'legendary',
  'japanese/susanoo.webp',
  '{"top":9,"left":9,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'susanoo_storm_breaker'),
  ARRAY['japanese', 'god', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Tanuki',
  'yokai',
  'common',
  'japanese/tanuki.webp',
  '{"top":3,"left":5,"right":4,"bottom":3}',
  NULL,
  ARRAY['japanese', 'yokai'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Tapa Weaver',
  'human',
  'common',
  'polynesian/tapa-weaver.webp',
  '{"top":3,"left":4,"right":6,"bottom":4}',
  NULL,
  ARRAY['polynesian', 'human'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Tawara Tōda',
  'human',
  'epic',
  'japanese/tawara-toda.webp',
  '{"top":7,"left":7,"right":7,"bottom":6}',
  (SELECT ability_id FROM special_abilities WHERE id = 'tawara_piercing_shot'),
  ARRAY['japanese', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Temple Drummer',
  'human',
  'common',
  'polynesian/temple-drummer.webp',
  '{"top":5,"left":5,"right":3,"bottom":6}',
  NULL,
  ARRAY['polynesian', 'human', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Tengu',
  'yokai',
  'common',
  'japanese/tengu.webp',
  '{"top":6,"left":3,"right":6,"bottom":3}',
  NULL,
  ARRAY['japanese', 'yokai', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Thor',
  'god',
  'epic',
  'norse/thor.webp',
  '{"top":10,"left":10,"right":12,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'thor_push'),
  ARRAY['norse', 'god', 'warrior', 'sky'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Thrall',
  'human',
  'common',
  'norse/thrall.webp',
  '{"top":5,"left":3,"right":5,"bottom":3}',
  NULL,
  ARRAY['norse', 'human', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Torchbearer',
  'human',
  'common',
  'norse/torchbearer.webp',
  '{"top":4,"left":4,"right":4,"bottom":6}',
  NULL,
  ARRAY['norse', 'human', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Tsuchinoko',
  'yokai',
  'common',
  'japanese/tsuchinoko.webp',
  '{"top":4,"left":2,"right":4,"bottom":2}',
  NULL,
  ARRAY['japanese', 'yokai', 'beast'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Tyr',
  'god',
  'rare',
  'norse/tyr.webp',
  '{"top":9,"left":8,"right":8,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'tyr_binding_justice'),
  ARRAY['norse', 'god', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Ukupanipo',
  'god',
  'rare',
  'polynesian/ukupanipo.webp',
  '{"top":7,"left":10,"right":6,"bottom":8}',
  (SELECT ability_id FROM special_abilities WHERE id = 'ukupanipo_feast_or_famine'),
  ARRAY['polynesian', 'god', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Urashima Tarō',
  'human',
  'epic',
  'japanese/urashima-taro.webp',
  '{"top":5,"left":6,"right":5,"bottom":6}',
  (SELECT ability_id FROM special_abilities WHERE id = 'urashima_time_shift'),
  ARRAY['japanese', 'human', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Ushi-oni',
  'yokai',
  'rare',
  'japanese/ushi-oni.webp',
  '{"top":7,"left":5,"right":7,"bottom":5}',
  (SELECT ability_id FROM special_abilities WHERE id = 'ushi_oni_shore_fury'),
  ARRAY['japanese', 'yokai', 'beast', 'sea'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Vidar',
  'god',
  'epic',
  'norse/vidar.webp',
  '{"top":10,"left":9,"right":10,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'vidar_vengeance'),
  ARRAY['norse', 'god', 'warrior'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Village Healer',
  'human',
  'common',
  'polynesian/village-healer.webp',
  '{"top":3,"left":6,"right":3,"bottom":5}',
  NULL,
  ARRAY['polynesian', 'human', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Polynesian')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Yamabiko',
  'yokai',
  'rare',
  'japanese/yamabiko.webp',
  '{"top":4,"left":4,"right":5,"bottom":4}',
  (SELECT ability_id FROM special_abilities WHERE id = 'yamabiko_echo_power'),
  ARRAY['japanese', 'yokai', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Yamata no Orochi',
  'beast',
  'legendary',
  'japanese/yamata-no-orochi.webp',
  '{"top":10,"left":8,"right":9,"bottom":9}',
  (SELECT ability_id FROM special_abilities WHERE id = 'yamata_many_heads'),
  ARRAY['japanese', 'yokai', 'beast'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Young Jarl',
  'human',
  'common',
  'norse/young-jarl.webp',
  '{"top":3,"left":4,"right":4,"bottom":3}',
  NULL,
  ARRAY['norse', 'human', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Norse')
);
INSERT INTO cards (name, type, rarity, image_url, power, special_ability_id, tags, set_id)
VALUES (
  'Yuki-onna',
  'yokai',
  'rare',
  'japanese/yuki-onna.webp',
  '{"top":6,"left":5,"right":6,"bottom":5}',
  (SELECT ability_id FROM special_abilities WHERE id = 'yuki_onna_frost_row'),
  ARRAY['japanese', 'yokai', 'mystic'],
  (SELECT set_id FROM sets WHERE name = 'Japanese')
);
