type RandomGenerator = () => number;

interface RngFrame {
  seed: number;
  generator: RandomGenerator;
}

const rngStack: RngFrame[] = [];

function mulberry32(seed: number): RandomGenerator {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let next = Math.imul(t ^ (t >>> 15), 1 | t);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    return Date.now() >>> 0;
  }
  return Math.floor(seed) >>> 0;
}

export function getCurrentSimulationSeed(): number | null {
  const top = rngStack[rngStack.length - 1];
  return top ? top.seed : null;
}

export function randomFloat(): number {
  const top = rngStack[rngStack.length - 1];
  if (!top) {
    return Math.random();
  }
  return top.generator();
}

export function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  return Math.floor(randomFloat() * maxExclusive);
}

export function randomChance(percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return randomFloat() * 100 < percent;
}

export function chooseRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[randomInt(items.length)];
}

export async function withSimulationSeed<T>(
  seed: number,
  fn: () => Promise<T>
): Promise<T> {
  const normalizedSeed = normalizeSeed(seed);
  rngStack.push({
    seed: normalizedSeed,
    generator: mulberry32(normalizedSeed),
  });

  try {
    return await fn();
  } finally {
    rngStack.pop();
  }
}
