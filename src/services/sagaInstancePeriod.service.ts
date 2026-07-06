/** Returns the most recent Monday 00:00:00.000 UTC on or before `at`. */
export function getInstancePeriodStart(at: Date = new Date()): Date {
  const d = new Date(at);
  // getUTCDay(): 0=Sun,1=Mon,...,6=Sat — days since last Monday
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function getCurrentInstancePeriodEnd(now: Date = new Date()): Date {
  const start = getInstancePeriodStart(now);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export function isRunInCurrentInstancePeriod(
  runCreatedAt: Date,
  now: Date = new Date()
): boolean {
  return runCreatedAt.getTime() >= getInstancePeriodStart(now).getTime();
}
