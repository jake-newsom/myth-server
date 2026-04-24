import test from "node:test";
import assert from "node:assert/strict";
import {
  randomFloat,
  randomInt,
  withSimulationSeed,
} from "../simulation.rng";

test("withSimulationSeed produces deterministic float sequence", async () => {
  const sampleA = await withSimulationSeed(1337, async () => {
    return [randomFloat(), randomFloat(), randomFloat()];
  });
  const sampleB = await withSimulationSeed(1337, async () => {
    return [randomFloat(), randomFloat(), randomFloat()];
  });

  assert.deepEqual(sampleA, sampleB);
});

test("withSimulationSeed produces deterministic integer sequence", async () => {
  const drawA = await withSimulationSeed(2026, async () => {
    return [randomInt(100), randomInt(100), randomInt(100), randomInt(100)];
  });
  const drawB = await withSimulationSeed(2026, async () => {
    return [randomInt(100), randomInt(100), randomInt(100), randomInt(100)];
  });

  assert.deepEqual(drawA, drawB);
});
