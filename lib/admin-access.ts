import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_COOKIE, adminPassword, sameAdminOrigin, validAdminSession } from './admin-auth';
import { isLocalAdminRequest } from './admin-video';

export function localAdminGuard(request: Request): NextResponse | null {
  if (!isLocalAdminRequest({
    nodeEnv: process.env.NODE_ENV,
    host: request.headers.get('host'),
    origin: request.headers.get('origin'),
    forwardedFor: request.headers.get('x-forwarded-for'),
  })) return NextResponse.json({ error: 'Admin is available only in development on localhost.' }, { status: 403 });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameAdminOrigin(request)) {
    return NextResponse.json({ error: 'Admin requests must be same-origin.' }, { status: 403 });
  }
  return null;
}

/** Every admin data/command route must call this before reading its body or doing any work. */
export function guard(request: Request): NextResponse | null {
  const blocked = localAdminGuard(request);
  if (blocked) return blocked;
  const password = adminPassword();
  if (!password) return NextResponse.json({ error: 'Set GAMEPATH_ADMIN_PASSWORD in .env.local and restart the server.' }, { status: 503 });
  const token = new NextRequest(request.url, { headers: request.headers }).cookies.get(ADMIN_COOKIE)?.value;
  return validAdminSession(token, password) ? null : NextResponse.json({ error: 'Admin login required. Open /admin/ to sign in.' }, { status: 401 });
}
