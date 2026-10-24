/**
 * Applies db/migrations/*.sql in order, once each, tracked in `_migrations`.
 * Usage: DATABASE_URL=... npm run db:migrate
 */
import { Pool } from '@neondatabase/serverless';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url });
  const dir = join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  await pool.query('create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select name from _migrations')).rows.map((r: { name: string }) => r.name));
  for (const f of files) {
    if (done.has(f)) { console.log(`skip   ${f}`); continue; }
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(readFileSync(join(dir, f), 'utf8'));
      await client.query('insert into _migrations (name) values ($1)', [f]);
      await client.query('commit');
      console.log(`apply  ${f}`);
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
