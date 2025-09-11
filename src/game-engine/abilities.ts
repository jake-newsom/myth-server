import { AbilityMap } from "../types/game-engine.types";
import { norseAbilities } from "./abilities/norse.abilities";
import { japaneseAbilities } from "./abilities/japanese.abilities";
import { polynesianAbilities } from "./abilities/polynesian.abilities";

export const abilities: AbilityMap = {
  ...norseAbilities,
  ...japaneseAbilities,
  ...polynesianAbilities,
};
