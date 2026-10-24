import { currentUserId } from '@/lib/server/auth';
import { createInvite } from '@/lib/server/game';
import { handle, json } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST() {
  return handle(async () => {
    const uid = await currentUserId();
    if (!uid) return json({ error: 'Please sign in.' }, 401);
    return json(await createInvite(uid));
  });
}
