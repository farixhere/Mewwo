import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { GameError } from './game';

export function json(data: unknown, init?: number | ResponseInit) {
  const res = NextResponse.json(data, typeof init === 'number' ? { status: init } : init);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** Wrap a handler so thrown errors become tidy JSON, and nothing internal leaks. */
export async function handle(fn: () => Promise<Response>, label = 'api'): Promise<Response> {
  const t0 = performance.now();
  try {
    const res = await fn();
    const ms = Math.round(performance.now() - t0);
    // Visible in the browser's network tab, and slow requests are logged so lag can be traced to its source.
    res.headers.set('Server-Timing', `${label};dur=${ms}`);
    if (ms > 700) console.warn(`[mewwo] slow ${label}: ${ms}ms`);
    return res;
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    if (e instanceof ZodError) return json({ error: e.issues[0]?.message ?? 'Invalid input.' }, 400);
    console.error('[mewwo] unhandled', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
