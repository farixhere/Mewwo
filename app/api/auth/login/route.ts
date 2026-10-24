import { createSession, hashPassword, verifyPassword } from '@/lib/server/auth';
import { findUserByEmail, loginInput } from '@/lib/server/game';
import { handle, json } from '@/lib/server/http';

export const runtime = 'nodejs';

// A real hash, computed once, to compare against when the email is unknown so timing doesn't reveal which emails exist.
let dummyHash: Promise<string> | null = null;
const getDummy = () => (dummyHash ??= hashPassword('mewwo-timing-equaliser'));

export async function POST(req: Request) {
  return handle(async () => {
    const input = loginInput.parse(await req.json());
    const user = await findUserByEmail(input.email);
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummy()));
    if (!user || !ok) return json({ error: 'Email or password is incorrect.' }, 401);
    await createSession(user.id);
    return json({ ok: true });
  });
}
