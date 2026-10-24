import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from '../../db/schema';
import { env } from './env';

// Transactions use a WebSocket. Node 22+ (Vercel runs 24) has one built in, so we deliberately do NOT
// import the `ws` package: bundlers mangle it and the process crashes with "b.mask is not a function".

function make() {
  const pool = new Pool({ connectionString: env('DATABASE_URL'), max: 5 });
  // Neon closes idle connections. Without a listener, that surprise error would take the whole process down.
  pool.on('error', (e: Error) => console.error('[mewwo] idle db connection dropped:', e.message));
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof make>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const g = globalThis as unknown as { __mewwoDb?: Db };

/** Lazy so `next build` works without a database URL. Reused across hot reloads and warm invocations. */
export function getDb(): Db {
  if (!g.__mewwoDb) g.__mewwoDb = make();
  return g.__mewwoDb;
}

export { schema };
