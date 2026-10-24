import { destroySession } from '@/lib/server/auth';
import { json } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST() {
  await destroySession();
  return json({ ok: true });
}
