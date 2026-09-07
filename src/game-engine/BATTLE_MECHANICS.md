# Battle mechanics

Battle mechanics are opt-in rules stored in `GameState.mechanics`. Configuration and progress are JSON-serializable, so reconnects and AI simulations use the same rules as the live battle. Definitions live in `src/game-engine/battleMechanics.ts`; they expose validation, initial-board setup, and post-defeat hooks. The engine dispatches defeats from both placement abilities and normal combat, after saga defeat blessings.

At game creation, call `initializeBattleMechanics(state, configs)` once before saving or broadcasting the initial state. This API works independently of saga. Other game-creation services can opt in through the same API. Definitions run in configuration order; duplicate IDs and unknown IDs are rejected. Counts must be nonnegative safe integers and defeat thresholds must be positive safe integers. Starting tile counts are capped to available cells. Initialization cannot be run twice.

## Saga configuration

Set the existing season's `seasonal_mechanic` JSON to:

```json
{
  "mechanics": [
    { "id": "haunted", "tile_count": 4 }
  ]
}
```

The short form `{ "id": "haunted", "tile_count": 4 }` also works. No database migration is required. This code does not activate or publish a Halloween season.

Explicit lists replace legacy floor/boss tile rules. For example, to combine effects:

```json
{
  "mechanics": [
    { "id": "worlds_end", "defeats_per_destroy": 3, "pre_destroyed_tiles": 2 },
    { "id": "haunted", "tile_count": 4 }
  ]
}
```

Use `{ "mechanics": [] }` to disable battle mechanics. Existing empty or `worlds_end` seasonal configuration preserves existing floor/boss defaults through `resolveSagaMechanics`. Persisted battles with only `saga_context.worlds_end` are upgraded lazily, preserving their accumulated defeats without repeating initial board destruction.

## Haunted

Random distinct enabled empty cells receive a persistent `mechanic_effect` marker. Each side of an occupying Underworld card gains 4; each side of any other card loses 2, clamped to zero. Both players are affected. Existing Iron blessing debuff immunity applies. Movement updates the modifier, returning to hand clears it, and repeat power recalculation does not stack it. The modifier is separate from consumable tile effects and water/lava terrain. Blocked cells suppress it. The client shows a ghost marker with a rules tooltip.

## Extending

Add a serializable config variant in `battleMechanic.types.ts`, then a definition in `battleMechanicRegistry`. Mode services select config rather than implementing rules. New kinds of lifecycle triggers should be dispatched by the shared engine. Positional power refresh is in `battleMechanic.power.ts`; add positional payloads and client presentation there when introducing new tile rules.

Saga card blessings and tower encounter modifiers remain their existing systems; this registry currently owns World’s End and Haunted.

Validation:

```sh
node --test --test-force-exit -r ts-node/register tests/game-engine/battleMechanics.test.ts tests/game-engine/sagaBattle.mechanics.test.ts
```
