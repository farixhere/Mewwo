/**
 * Creates a demo household with two accounts so you can try the game straight away.
 * Usage: DATABASE_URL=... AUTH_SECRET=... npm run db:seed
 * Accounts: demo1@mewwo.local / demo2@mewwo.local, password "mewwo-demo-1234". Do not run against production.
 */
import { hashPassword } from '../lib/server/auth';
import { createHousehold, joinHousehold, registerUser, findUserByEmail } from '../lib/server/game';
import { createInvite } from '../lib/server/game';

async function ensure(email: string, name: string) {
  const ex = await findUserByEmail(email);
  if (ex) return ex.id;
  return registerUser({ email, displayName: name, password: 'mewwo-demo-1234' }, await hashPassword('mewwo-demo-1234'));
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production.');
  const a = await ensure('demo1@mewwo.local', 'Demo One');
  const b = await ensure('demo2@mewwo.local', 'Demo Two');
  try {
    await createHousehold(a, { name: 'Demo Home', catName: 'Biscuit', timeZone: 'Asia/Kolkata' });
    const { code } = await createInvite(a);
    await joinHousehold(b, code);
    console.log('Seeded demo household with cat "Biscuit".');
  } catch (e) {
    console.log('Seed skipped:', (e as Error).message);
  }
  process.exit(0);
}
main();
