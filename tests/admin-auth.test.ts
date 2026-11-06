import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, adminCookieOptions, createAdminSession, passwordMatches, sameAdminOrigin, validAdminSession } from '../lib/admin-auth';
import { guard } from '../lib/admin-access';
import { POST as session } from '../app/api/admin/session/route.dev';
import { GET as taggersGet, POST as taggersPost } from '../app/api/admin/taggers/route.dev';
import { GET as videosGet, POST as videosPost } from '../app/api/admin/videos/route.dev';
import { POST as upload } from '../app/api/admin/videos/upload/route.dev';
import { POST as pipeline } from '../app/api/admin/videos/pipeline/route.dev';
import { GET as fileGet, HEAD as fileHead } from '../app/api/admin/videos/file/route.dev';

// Deliberately test-only; never a configured/default app password.
const password = 'test-only-unique-admin-secret';
function request(path = '/api/admin/videos/', options: RequestInit = {}) {
  return new Request(`http://localhost:3000${path}`, { ...options, headers: { host: 'localhost:3000', ...options.headers } });
}
function login(body: string, headers: Record<string, string> = {}) {
  return session(request('/api/admin/session/', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:3000', ...headers } }));
}

test('signed sessions are random, expiring, tamper-proof and invalidated by password rotation', () => {
  const now = 1_800_000_000_000;
  const token = createAdminSession(password, now);
  assert.notEqual(token, createAdminSession(password, now));
  assert.equal(validAdminSession(token, password, now), true);
  assert.equal(validAdminSession(token, password, now + ADMIN_SESSION_SECONDS * 1000 - 1), true);
  assert.equal(validAdminSession(token, password, now + ADMIN_SESSION_SECONDS * 1000), false);
  assert.equal(validAdminSession(token, password, now - 1000), false);
  assert.equal(validAdminSession(token, 'rotated-password', now), false);
  assert.equal(validAdminSession(token, undefined, now), false);
  for (const bad of [undefined, '', 'bad', `${token}junk`, token.replace(/^./, '9'), token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), 'x'.repeat(10000)]) {
    assert.equal(validAdminSession(bad, password, now), false);
  }
  assert.equal(passwordMatches(password, password), true);
  assert.equal(passwordMatches('wrong', password), false);
  assert.equal(passwordMatches('', ''), false);
  assert.equal(passwordMatches('密码', '密码'), true);
  assert.deepEqual(adminCookieOptions(true), { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 28800 });
  assert.equal(adminCookieOptions(false).secure, false);
});

test('same-origin checks distinguish localhost ports and reject foreign or malformed origins', () => {
  assert.equal(sameAdminOrigin(request()), true);
  for (const origin of ['http://localhost:3001', 'http://evil.test', 'null', 'not-a-url', 'https://localhost:3000/']) {
    assert.equal(sameAdminOrigin(request('/', { headers: { origin } })), false, origin);
  }
  assert.equal(sameAdminOrigin(request('/', { headers: { origin: 'http://localhost:3000' } })), true);
  assert.equal(sameAdminOrigin(request('/', { headers: { 'sec-fetch-site': 'cross-site' } })), false);
});

test('admin API boundary, login/logout and fail-closed configuration', async (t) => {
  const saved = { NODE_ENV: process.env.NODE_ENV, GAMEPATH_ADMIN_PASSWORD: process.env.GAMEPATH_ADMIN_PASSWORD };
  Object.assign(process.env, { NODE_ENV: 'development', GAMEPATH_ADMIN_PASSWORD: password });
  try {
    const cookie = `${ADMIN_COOKIE}=${createAdminSession(password)}`;
    await t.test('all data/command endpoints reject unauthenticated requests before work', async () => {
      const routes: [string, string, (r: Request) => Promise<Response>][] = [
        ['/api/admin/taggers/', 'GET', taggersGet], ['/api/admin/taggers/', 'POST', taggersPost],
        ['/api/admin/videos/', 'GET', videosGet], ['/api/admin/videos/', 'POST', videosPost],
        ['/api/admin/videos/upload/', 'POST', upload], ['/api/admin/videos/pipeline/', 'POST', pipeline],
        ['/api/admin/videos/file/', 'GET', fileGet], ['/api/admin/videos/file/', 'HEAD', fileHead],
      ];
      for (const [path, method, handler] of routes) {
        const response = await handler(request(path, { method }));
        assert.equal(response.status, 401, `${method} ${path}`);
      }
      assert.equal(guard(request('/', { headers: { cookie } })), null);
      assert.equal(guard(request('/', { headers: { cookie: `${ADMIN_COOKIE}=forged` } }))?.status, 401);
      assert.equal(guard(request('/', { headers: { cookie, host: '192.168.137.1:3000' } }))?.status, 403);
      assert.equal(guard(request('/', { method: 'POST', headers: { cookie, origin: 'http://localhost:9999' } }))?.status, 403);
      assert.equal(guard(request('/', { headers: { cookie, 'x-forwarded-for': '10.0.0.5' } }))?.status, 403);
      Object.assign(process.env, { NODE_ENV: 'production' });
      assert.equal(guard(request('/', { headers: { cookie } }))?.status, 403);
      Object.assign(process.env, { NODE_ENV: 'development' });
    });
    await t.test('missing password disables admin even with an old session', async () => {
      delete process.env.GAMEPATH_ADMIN_PASSWORD;
      assert.equal(guard(request('/', { headers: { cookie } }))?.status, 503);
      const response = await login(`password=${password}`);
      assert.equal(new URL(response.headers.get('location')!).searchParams.get('login'), 'unconfigured');
      assert.equal(response.headers.get('set-cookie'), null);
      process.env.GAMEPATH_ADMIN_PASSWORD = password;
    });
    await t.test('login sets a protected cookie, logout expires it, bad and cross-origin forms fail', async () => {
      const response = await login(`password=${password}`);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), 'http://localhost:3000/admin/');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const setCookie = response.headers.get('set-cookie')!;
      for (const flag of ['HttpOnly', 'SameSite=strict', 'Path=/', 'Max-Age=28800']) assert.ok(setCookie.includes(flag), flag);
      assert.equal(validAdminSession(setCookie.split(';')[0].split('=')[1], password), true);
      assert.equal((await login(`password=${password}`, { 'x-forwarded-proto': 'https' })).headers.get('set-cookie')?.includes('Secure'), true);
      const logout = await login('action=logout');
      assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
      const bad = await login('password=wrong');
      assert.equal(new URL(bad.headers.get('location')!).searchParams.get('login'), 'invalid');
      assert.equal(bad.headers.get('set-cookie'), null);
      assert.equal((await login(`password=${password}`, { origin: 'http://localhost:9999' })).status, 403);
      assert.equal((await login(`password=${password}`, { origin: 'http://evil.test' })).status, 403);
      const oversized = await login(`password=${'x'.repeat(5000)}`);
      assert.equal(new URL(oversized.headers.get('location')!).searchParams.get('login'), 'invalid');
    });
    await t.test('process-local login rate limit rejects repeated guesses', async () => {
      let last: Response | undefined;
      for (let i = 0; i < 11; i++) last = await login('password=wrong');
      assert.equal(new URL(last!.headers.get('location')!).searchParams.get('login'), 'limited');
      assert.equal(last!.headers.get('set-cookie'), null);
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
