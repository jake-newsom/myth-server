import { addTempBuff, addTempDebuff } from "./ability.utils";
import { BaseGameEvent } from "./game-events";
import { TriggerContext } from "./game.utils";

export const abilities: Record<
  string,
  (context: TriggerContext) => BaseGameEvent[]
> = {
  "Shieldmaidens Unite": (context) => {
    const { triggerCard } = context;
    addTempBuff(triggerCard, 2, {
      top: 5,
      bottom: 5,
      left: 5,
      right: 5,
    });
    return [];
  },
  "Inspiring Song": (context) => {
    const { triggerCard } = context;
    addTempBuff(triggerCard, 2, {
      top: 5,
      bottom: 5,
      left: 5,
      right: 5,
    });
    return [];
  },
  "Watery Depths": (context) => {
    const { triggerCard } = context;
    addTempBuff(triggerCard, 2, {
      top: 5,
      bottom: 5,
      left: 5,
      right: 5,
    });
    return [];
  },
  "Grave Vengeance": (context) => {
    const { triggerCard } = context;
    addTempDebuff(triggerCard, 3, {
      top: 5,
      bottom: 5,
      left: 5,
      right: 5,
    });
    return [];
  },
};
