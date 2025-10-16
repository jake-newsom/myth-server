import { AbilityMap, CombatResolverMap } from "../types/game-engine.types";
import {
  norseAbilities,
  norseCombatResolvers,
} from "./abilities/norse.abilities";
import {
  japaneseAbilities,
  japaneseCombatResolvers,
} from "./abilities/japanese.abilities";
import {
  polynesianAbilities,
  polynesianCombatResolvers,
} from "./abilities/polynesian.abilities";

export const abilities: AbilityMap = {
  ...norseAbilities,
  ...japaneseAbilities,
  ...polynesianAbilities,
};

export const combatResolvers: CombatResolverMap = {
  ...norseCombatResolvers,
  ...japaneseCombatResolvers,
  ...polynesianCombatResolvers,
};
