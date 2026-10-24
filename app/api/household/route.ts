import { currentUserId } from '@/lib/server/auth';
import { createHousehold, createHouseholdInput } from '@/lib/server/game';
import { handle, json } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return handle(async () => {
    const uid = await currentUserId();
    if (!uid) return json({ error: 'Please sign in.' }, 401);
    const id = await createHousehold(uid, createHouseholdInput.parse(await req.json()));
    return json({ ok: true, householdId: id });
  });
}
