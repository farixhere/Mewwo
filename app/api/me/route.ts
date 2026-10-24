import { currentUserId } from '@/lib/server/auth';
import { whoAmI } from '@/lib/server/game';
import { handle, json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const uid = await currentUserId();
    if (!uid) return json({ user: null });
    return json({ user: await whoAmI(uid) });
  });
}
