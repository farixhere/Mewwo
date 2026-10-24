/** Local hour (0..24, fractional) in an IANA time zone. Falls back to UTC for invalid zones. */
export function localHour(ms: number, timeZone: string): number {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

/** 0 = deep night, 1 = bright midday. Smooth so lighting never pops. */
export function daylight(hour: number): number {
  const x = (hour - 6) / 12; // sunrise 6, sunset 18
  if (x <= 0 || x >= 1) return 0;
  return Math.sin(Math.PI * x) ** 0.6;
}
