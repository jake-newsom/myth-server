import { test } from "node:test";
import assert from "node:assert/strict";
import { simulationContext } from "../simulation.context";
import { getCurrentSimulationSeed } from "../simulation.rng";

// AI search yields to the event loop mid-simulation; real game work handled
// in between must not see the simulation flag or the AI's seeded RNG.
test("simulation flag and seed do not leak into concurrent work", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));

  const sim = simulationContext.withSimulation(async () => {
    assert.equal(simulationContext.isInSimulation(), true);
    assert.equal(getCurrentSimulationSeed(), 42);
    await gate;
    assert.equal(simulationContext.isInSimulation(), true);
    assert.equal(getCurrentSimulationSeed(), 42);
  }, 42);

  await new Promise<void>((r) => setImmediate(r));
  assert.equal(simulationContext.isInSimulation(), false);
  assert.equal(getCurrentSimulationSeed(), null);
  release();
  await sim;
  assert.equal(simulationContext.isInSimulation(), false);
});
