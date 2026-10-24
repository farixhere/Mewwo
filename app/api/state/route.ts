import { currentUserId } from '@/lib/server/auth';
import { readState } from '@/lib/server/game';
import { handle, json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Authoritative snapshot. Also advances the cat's life to "now" before answering. */
export async function GET() {
  return handle(async () => {
    const uid = await currentUserId();
    if (!uid) return json({ error: 'Please sign in.' }, 401);
    return json(await readState(uid));
  });
}
