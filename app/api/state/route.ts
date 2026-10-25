import { currentUserId } from '@/lib/server/auth';
import { readState, stateUnchanged } from '@/lib/server/game';
import { handle, json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Authoritative snapshot. Also advances the cat's life to "now" before answering. */
export async function GET(req: Request) {
  return handle(async () => {
    const uid = await currentUserId();
    if (!uid) return json({ error: 'Please sign in.' }, 401);
    const rev = Number(new URL(req.url).searchParams.get('rev'));
    if (Number.isFinite(rev) && rev > 0 && (await stateUnchanged(uid, rev))) return json({ unchanged: true });
    return json(await readState(uid));
  }, 'state');
}
