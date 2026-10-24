import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '../../db/schema';
import { env } from './env';

// Node < 22 has no global WebSocket; `ws` makes transactions work everywhere.
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

function make() {
  const pool = new Pool({ connectionString: env('DATABASE_URL'), max: 5 });
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
