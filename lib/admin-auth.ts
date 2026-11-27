// Server-only password/session primitives. Never import this module from a client component.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'gamepath_admin';
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

export function adminPassword(): string | undefined {
  return process.env.GAMEPATH_ADMIN_PASSWORD || undefined;
}

export function passwordMatches(actual: string, expected: string): boolean {
  return Boolean(expected) && timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
}

function signature(payload: string, password: string): string {
  return createHmac('sha256', password).update(`gamepath-admin-v1:${payload}`).digest('hex');
}

export function createAdminSession(password: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + ADMIN_SESSION_SECONDS;
  const payload = `${expires}.${randomBytes(24).toString('hex')}`;
  return `${payload}.${signature(payload, password)}`;
}

export function validAdminSession(token: string | undefined, password: string | undefined, now = Date.now()): boolean {
  if (!password || !token || token.length > 200) return false;
  const match = /^(\d{10})\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + ADMIN_SESSION_SECONDS) return false;
  return timingSafeEqual(Buffer.from(match[3], 'hex'), Buffer.from(signature(`${match[1]}.${match[2]}`, password), 'hex'));
}

export function adminCookieOptions(https: boolean) {
  return { httpOnly: true, secure: https, sameSite: 'strict' as const, path: '/', maxAge: ADMIN_SESSION_SECONDS };
}

/** Redirect target for /api/admin/session. Uses the browser Host header so a visit to
 * 127.0.0.1 is not sent to localhost (Next's request.url can disagree, and the
 * host-only session cookie would not follow that redirect). */
export function adminPortalRedirectUrl(request: Request, error?: string): URL {
  const incoming = new URL(request.url);
  const host = (request.headers.get('host') || '').trim();
  const protocol = (request.headers.get('x-forwarded-proto') || incoming.protocol.replace(/:$/, '')).split(',')[0].trim();
  const origin = host ? `${protocol}://${host}` : incoming.origin;
  const url = new URL('/admin/', `${origin}/`);
  if (error) url.searchParams.set('login', error);
  return url;
}

/** Same-site is not same-origin (ports differ). Check Origin on every browser mutation. */
export function sameAdminOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site'; // non-browser/CLI callers
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.get('host') && parsed.origin === origin;
  } catch {
    return false;
  }
}
