import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { env } from './env';

const COOKIE = 'mewwo_session';
const MAX_AGE = 60 * 60 * 24 * 30;

const key = () => new TextEncoder().encode(env('AUTH_SECRET'));

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 11);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user's id, or null. Authorization still happens per request against household membership. */
export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Invite codes are shown once; only a hash is stored. */
export function newInviteCode(): { code: string; hash: string } {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (const b of bytes) code += alphabet[b % alphabet.length];
  const pretty = `${code.slice(0, 4)}-${code.slice(4)}`;
  return { code: pretty, hash: hashInvite(pretty) };
}

export function hashInvite(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
}
