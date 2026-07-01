/** Saga instance window length (7 days). */
export const SAGA_INSTANCE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export function getInstancePeriodStart(
  at: Date,
  seasonStart: Date
): Date {
  const anchorMs = seasonStart.getTime();
  const atMs = at.getTime();
  if (atMs < anchorMs) return new Date(anchorMs);
  const periodIndex = Math.floor((atMs - anchorMs) / SAGA_INSTANCE_PERIOD_MS);
  return new Date(anchorMs + periodIndex * SAGA_INSTANCE_PERIOD_MS);
}

export function getInstancePeriodEnd(periodStart: Date): Date {
  return new Date(periodStart.getTime() + SAGA_INSTANCE_PERIOD_MS);
}

export function isRunInCurrentInstancePeriod(
  runCreatedAt: Date,
  seasonStart: Date,
  now: Date = new Date()
): boolean {
  const periodStart = getInstancePeriodStart(now, seasonStart);
  return runCreatedAt.getTime() >= periodStart.getTime();
}

export function getCurrentInstancePeriodEnd(
  seasonStart: Date,
  now: Date = new Date()
): Date {
  const periodStart = getInstancePeriodStart(now, seasonStart);
  return getInstancePeriodEnd(periodStart);
}
