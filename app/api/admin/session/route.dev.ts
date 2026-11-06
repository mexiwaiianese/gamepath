import { NextResponse } from 'next/server';

import { localAdminGuard } from '@/lib/admin-access';
import { ADMIN_COOKIE, adminCookieOptions, adminPassword, createAdminSession, passwordMatches } from '@/lib/admin-auth';

// Shared process-local limit: the admin surface is already loopback-only. Do not trust a client IP header.
let attempts = 0;
let windowEnds = 0;
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

function reply(request: Request, error?: string) {
  const url = new URL('/admin/', request.url);
  if (error) url.searchParams.set('login', error);
  const response = NextResponse.redirect(url, 303);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

async function readForm(request: Request): Promise<URLSearchParams> {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new Error('Invalid form');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing form');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new Error('Form too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export async function POST(request: Request) {
  const blocked = localAdminGuard(request);
  if (blocked) return blocked;
  let form: URLSearchParams;
  try {
    form = await readForm(request);
  } catch {
    return reply(request, 'invalid');
  }
  const response = reply(request);
  const https = new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const options = adminCookieOptions(https);
  if (form.get('action') === 'logout') {
    response.cookies.set(ADMIN_COOKIE, '', { ...options, maxAge: 0 });
    return response;
  }
  const password = adminPassword();
  if (!password) return reply(request, 'unconfigured');
  const now = Date.now();
  if (now >= windowEnds) {
    attempts = 0;
    windowEnds = now + WINDOW_MS;
  }
  if (attempts >= MAX_ATTEMPTS) return reply(request, 'limited');
  attempts++;
  if (!passwordMatches(form.get('password') ?? '', password)) return reply(request, 'invalid');
  response.cookies.set(ADMIN_COOKIE, createAdminSession(password), options);
  return response;
}
