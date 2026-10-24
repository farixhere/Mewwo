import { currentUserId } from '@/lib/server/auth';
import { joinHousehold, joinInput } from '@/lib/server/game';
import { handle, json } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return handle(async () => {
    const uid = await currentUserId();
    if (!uid) return json({ error: 'Please sign in.' }, 401);
    const { code } = joinInput.parse(await req.json());
    await joinHousehold(uid, code);
    return json({ ok: true });
  });
}
