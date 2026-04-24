import test from "node:test";
import assert from "node:assert/strict";
import { AILogic } from "../ai.logic";
import { AI_REGRESSION_SCENARIOS } from "./ai.regression-scenarios";

function getAbilityId(card: { base_card_data: { special_ability: any } }): string {
  return (
    card.base_card_data.special_ability?.id ??
    card.base_card_data.special_ability?.ability_id ??
    "none"
  );
}

for (const scenario of AI_REGRESSION_SCENARIOS) {
  test(`regression-pack: ${scenario.id}`, () => {
    const ai = new AILogic();
    const scored = scenario.candidates
      .map((candidate) => ({
        abilityId: getAbilityId(candidate.card),
        score: ai.evaluateMove(
          scenario.state,
          candidate.card,
          candidate.position,
          scenario.aiPlayerId,
          "hard"
        ),
      }))
      .sort((a, b) => b.score - a.score);

    assert.ok(
      scenario.expectedPreferredAbilityIds.includes(scored[0].abilityId),
      `Expected one of ${scenario.expectedPreferredAbilityIds.join(", ")} but got ${scored[0].abilityId}`
    );
  });
}
