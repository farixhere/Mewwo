/** Server-only environment access. Never import this from client code. */
export function env(name: string, opts: { optional?: boolean } = {}): string {
  const v = process.env[name];
  if (!v && !opts.optional) throw new Error(`Missing required environment variable: ${name}`);
  return v ?? '';
}
