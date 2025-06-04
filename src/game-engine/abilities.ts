import { buff, debuff } from "./ability.utils";
import { BaseGameEvent } from "./game-events";
import { TriggerContext } from "./game.utils";

export const abilities: Record<
  string,
  (context: TriggerContext) => BaseGameEvent[]
> = {
  "Shieldmaidens Unite": (context) => {
    const { triggerCard } = context;
    buff(triggerCard, 5);
    return [];
  },
  "Inspiring Song": (context) => {
    const { triggerCard } = context;
    buff(triggerCard, 5);
    return [];
  },
  "Watery Depths": (context) => {
    const { triggerCard } = context;
    buff(triggerCard, 5);
    return [];
  },
  "Grave Vengeance": (context) => {
    const { triggerCard } = context;
    debuff(triggerCard, 5);
    return [];
  },
};
