import test from "node:test";
import assert from "node:assert/strict";
import { AILogic } from "../ai.logic";
import { AI_MOVE_SELECTION_SCENARIOS } from "./ai.move-selection-scenarios";

function getAbilityIdForMove(
  state: any,
  userCardInstanceId: string
): string {
  const card = state.hydrated_card_data_cache?.[userCardInstanceId];
  return (
    card?.base_card_data.special_ability?.id ??
    card?.base_card_data.special_ability?.ability_id ??
    "none"
  );
}

for (const scenario of AI_MOVE_SELECTION_SCENARIOS) {
  test(`move-selection: ${scenario.id}`, async () => {
    const ai = new AILogic();
    const move = await ai.makeAIMove(structuredClone(scenario.state), "hard");
    assert.ok(move, `No move selected for scenario ${scenario.id}`);

    const selectedAbility = getAbilityIdForMove(
      scenario.state,
      move!.user_card_instance_id
    );

    if (scenario.expectedSelectedAbilityIds?.length) {
      assert.ok(
        scenario.expectedSelectedAbilityIds.includes(selectedAbility),
        `Expected one of ${scenario.expectedSelectedAbilityIds.join(", ")} but got ${selectedAbility}`
      );
    }

    if (scenario.forbiddenAbilityIds?.length) {
      assert.ok(
        !scenario.forbiddenAbilityIds.includes(selectedAbility),
        `Selected forbidden ability ${selectedAbility}`
      );
    }
  });
}
