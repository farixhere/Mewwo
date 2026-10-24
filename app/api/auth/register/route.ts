import { createSession, hashPassword } from '@/lib/server/auth';
import { registerInput, registerUser } from '@/lib/server/game';
import { handle, json } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return handle(async () => {
    const input = registerInput.parse(await req.json());
    const id = await registerUser(input, await hashPassword(input.password));
    await createSession(id);
    return json({ ok: true });
  });
}
