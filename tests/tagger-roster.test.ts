import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ADMIN_COOKIE, createAdminSession } from '../lib/admin-auth';
import {
  TaggerConflictError,
  TaggerNotFoundError,
  TaggerValidationError,
  applyTaggerPatch,
  calendarDate,
  daysUntilDeactivation,
  deactivationHint,
  isTaggerActive,
  parseTaggerFields,
  sortTaggers,
  taggerAccessStatus,
  type Tagger,
} from '../lib/tagger-roster';
import { createFileTaggerRosterStore } from '../lib/tagger-roster-store';
import { DELETE as rosterDelete, PATCH as rosterPatch } from '../app/api/admin/tagger-roster/[id]/route.dev';
import { GET as rosterGet, POST as rosterPost } from '../app/api/admin/tagger-roster/route.dev';

const password = 'test-only-unique-admin-secret';

function at(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour);
}

function tagger(partial: Partial<Tagger> & Pick<Tagger, 'name' | 'email'>): Tagger {
  return {
    id: partial.id ?? partial.email,
    phone: null,
    organization: null,
    notes: null,
    invitedAt: '2026-01-01',
    deactivationDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

test('calendar dates use the local timezone, not UTC', () => {
  assert.equal(calendarDate(at(2026, 11, 20, 22)), '2026-11-20');
  assert.equal(calendarDate(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01');
});

test('isTaggerActive and status follow the deactivation calendar date', () => {
  const now = at(2026, 11, 20);
  const open = tagger({ name: 'Open', email: 'open@example.com' });
  const scheduled = tagger({ name: 'Scheduled', email: 'soon@example.com', deactivationDate: '2026-11-27' });
  const today = tagger({ name: 'Today', email: 'today@example.com', deactivationDate: '2026-11-20' });
  const past = tagger({ name: 'Past', email: 'past@example.com', deactivationDate: '2026-11-13' });

  assert.equal(taggerAccessStatus(open, now), 'active');
  assert.equal(isTaggerActive(open, now), true);
  assert.equal(deactivationHint(open, now), null);

  assert.equal(taggerAccessStatus(scheduled, now), 'scheduled');
  assert.equal(isTaggerActive(scheduled, now), true);
  assert.equal(daysUntilDeactivation(scheduled, now), 7);
  assert.equal(deactivationHint(scheduled, now), 'deactivates in 7 days');
  assert.equal(deactivationHint(tagger({ name: 'Tomorrow', email: 't@example.com', deactivationDate: '2026-11-21' }), now), 'deactivates in 1 day');

  assert.equal(taggerAccessStatus(today, now), 'deactivated');
  assert.equal(isTaggerActive(today, now), false);
  assert.equal(daysUntilDeactivation(today, now), null);
  assert.equal(taggerAccessStatus(past, now), 'deactivated');
  assert.equal(isTaggerActive(past, now), false);
});

test('sorts by status (active, scheduled, deactivated) then name', () => {
  const now = at(2026, 11, 20);
  const sorted = sortTaggers(
    [
      tagger({ name: 'Zoe', email: 'zoe@example.com', deactivationDate: '2026-11-01' }),
      tagger({ name: 'Mia', email: 'mia@example.com' }),
      tagger({ name: 'Alex', email: 'alex@example.com', deactivationDate: '2026-12-01' }),
      tagger({ name: 'Ben', email: 'ben@example.com' }),
    ],
    now,
  );
  assert.deepEqual(sorted.map((item) => item.name), ['Ben', 'Mia', 'Alex', 'Zoe']);
});

test('field validation requires name and a real email, and accepts optional contact fields', () => {
  const now = at(2026, 11, 20);
  const parsed = parseTaggerFields(
    {
      name: '  Alex Rivera  ',
      email: 'Alex@Example.COM',
      phone: ' 555-0100 ',
      organization: 'West High',
      notes: 'Invite sent',
      invitedAt: '2026-10-01',
      deactivationDate: '2026-12-15',
    },
    now,
  );
  assert.deepEqual(parsed, {
    name: 'Alex Rivera',
    email: 'alex@example.com',
    phone: '555-0100',
    organization: 'West High',
    notes: 'Invite sent',
    invitedAt: '2026-10-01',
    deactivationDate: '2026-12-15',
  });
  assert.equal(parseTaggerFields({ name: 'Sam', email: 'sam@example.com' }, now).invitedAt, '2026-11-20');
  assert.equal(parseTaggerFields({ name: 'Sam', email: 'sam@example.com', phone: '  ', deactivationDate: '' }, now).phone, null);
  for (const input of [{}, { name: '', email: 'a@b.co' }, { name: 'Sam', email: 'not-an-email' }, { name: 'Sam', email: 'sam@example.com', invitedAt: '2026-13-40' }, { name: 'Sam', email: 'sam@example.com', deactivationDate: '2026-02-31' }]) {
    assert.throws(() => parseTaggerFields(input, now), TaggerValidationError);
  }
  const existing = tagger({ id: '1', name: 'Sam', email: 'sam@example.com', phone: '1' });
  assert.equal(applyTaggerPatch(existing, { phone: '' }, now).phone, null);
  assert.equal(applyTaggerPatch(existing, { name: 'Samantha' }, now).email, 'sam@example.com');
});

test('file store creates, updates, deactivates, reactivates, and deletes taggers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gamepath-taggers-'));
  const filePath = path.join(dir, 'tagger-roster.json');
  const store = createFileTaggerRosterStore(filePath);
  const now = at(2026, 11, 20);
  try {
    const first = await store.create({ name: 'Alex Rivera', email: 'alex@example.com', organization: 'West High' }, now);
    const scheduled = await store.create({ name: 'Jordan Lee', email: 'jordan@example.com', deactivationDate: '2026-11-27' }, now);
    const past = await store.create({ name: 'Sam Patel', email: 'sam@example.com', deactivationDate: '2026-11-13' }, now);
    assert.equal(isTaggerActive(first, now), true);
    assert.equal(taggerAccessStatus(scheduled, now), 'scheduled');
    assert.equal(isTaggerActive(past, now), false);

    const listed = await store.list();
    assert.deepEqual(listed.map((item) => item.email), ['alex@example.com', 'jordan@example.com', 'sam@example.com']);

    await assert.rejects(store.create({ name: 'Alex 2', email: 'ALEX@example.com' }, now), TaggerConflictError);
    const renamed = await store.update(first.id, { name: 'Alex R.' }, now);
    assert.equal(renamed.name, 'Alex R.');

    const deactivated = await store.deactivate(first.id, now);
    assert.equal(deactivated.deactivationDate, '2026-11-20');
    assert.equal(isTaggerActive(deactivated, now), false);
    const reactivated = await store.reactivate(first.id, now);
    assert.equal(reactivated.deactivationDate, null);
    assert.equal(isTaggerActive(reactivated, now), true);

    assert.equal(await store.remove(past.id), true);
    assert.equal(await store.remove(past.id), false);
    await assert.rejects(store.update('missing', { name: 'Nope' }, now), TaggerNotFoundError);

    const saved = JSON.parse(await readFile(filePath, 'utf8')) as { schema: string; taggers: Tagger[] };
    assert.equal(saved.schema, 'gamepath.tagger_roster.v1');
    assert.equal(saved.taggers.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tagger roster API enforces admin auth before reading or writing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gamepath-taggers-api-'));
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    GAMEPATH_ADMIN_PASSWORD: process.env.GAMEPATH_ADMIN_PASSWORD,
    GAMEPATH_TAGGER_ROSTER_PATH: process.env.GAMEPATH_TAGGER_ROSTER_PATH,
  };
  Object.assign(process.env, {
    NODE_ENV: 'development',
    GAMEPATH_ADMIN_PASSWORD: password,
    GAMEPATH_TAGGER_ROSTER_PATH: path.join(dir, 'tagger-roster.json'),
  });
  const cookie = `${ADMIN_COOKIE}=${createAdminSession(password)}`;
  const request = (url: string, options: RequestInit = {}) =>
    new Request(`http://localhost:3000${url}`, { ...options, headers: { host: 'localhost:3000', origin: 'http://localhost:3000', ...options.headers } });
  const params = (id: string) => Promise.resolve({ id });
  try {
    assert.equal((await rosterGet(request('/api/admin/tagger-roster/'))).status, 401);
    assert.equal((await rosterPost(request('/api/admin/tagger-roster/', { method: 'POST', body: '{"name":"X","email":"x@example.com"}' }))).status, 401);
    assert.equal((await rosterPatch(request('/api/admin/tagger-roster/abc/', { method: 'PATCH', body: '{}' }), { params: params('abc') })).status, 401);
    assert.equal((await rosterDelete(request('/api/admin/tagger-roster/abc/', { method: 'DELETE' }), { params: params('abc') })).status, 401);

    const created = await rosterPost(request('/api/admin/tagger-roster/', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alex Rivera', email: 'alex@example.com' }),
    }));
    assert.equal(created.status, 201);
    const { tagger: row } = (await created.json()) as { tagger: Tagger };
    const listed = await rosterGet(request('/api/admin/tagger-roster/', { headers: { cookie } }));
    assert.equal(listed.status, 200);
    assert.equal(((await listed.json()) as { taggers: Tagger[] }).taggers.length, 1);

    const deactivated = await rosterPatch(request(`/api/admin/tagger-roster/${row.id}/`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'deactivate' }),
    }), { params: params(row.id) });
    assert.equal(deactivated.status, 200);
    assert.equal(isTaggerActive(((await deactivated.json()) as { tagger: Tagger }).tagger), false);

    const removed = await rosterDelete(request(`/api/admin/tagger-roster/${row.id}/`, { method: 'DELETE', headers: { cookie } }), { params: params(row.id) });
    assert.equal(removed.status, 200);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
