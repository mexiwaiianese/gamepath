/**
 * Persistence for the tagger roster. The default implementation writes
 * `.gamepath/tagger-roster.json` (already gitignored via `/.gamepath/`).
 *
 * When hosted tagging ships, replace this file store with a Supabase-backed
 * implementation of `TaggerRosterStore`. Keep using Tagger, parseTaggerFields,
 * isTaggerActive, and sortTaggers from lib/tagger-roster.ts. See
 * docs/TAGGER-ROSTER.md for the draft `taggers` table schema.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  TAGGER_ROSTER_SCHEMA,
  applyTaggerPatch,
  assertUniqueEmail,
  calendarDate,
  isStoredTagger,
  parseTaggerFields,
  sortTaggers,
  TaggerConflictError,
  TaggerNotFoundError,
  TaggerValidationError,
  type Tagger,
  type TaggerFields,
} from './tagger-roster';

export type TaggerRosterStore = {
  list(): Promise<Tagger[]>;
  get(id: string): Promise<Tagger | undefined>;
  create(input: unknown, now?: Date): Promise<Tagger>;
  update(id: string, input: unknown, now?: Date): Promise<Tagger>;
  deactivate(id: string, now?: Date): Promise<Tagger>;
  reactivate(id: string, now?: Date): Promise<Tagger>;
  remove(id: string): Promise<boolean>;
};

const queues = new Map<string, Promise<unknown>>();

export function defaultTaggerRosterPath(): string {
  return process.env.GAMEPATH_TAGGER_ROSTER_PATH || path.join(process.cwd(), '.gamepath', 'tagger-roster.json');
}

export function taggerRosterStore(): TaggerRosterStore {
  return createFileTaggerRosterStore(defaultTaggerRosterPath());
}

export function createFileTaggerRosterStore(filePath: string): TaggerRosterStore {
  const mutate = <T>(fn: (taggers: Tagger[]) => T | Promise<T>) => exclusive(filePath, async () => fn(await readRoster(filePath)));

  return {
    async list() {
      return sortTaggers(await readRoster(filePath));
    },
    async get(id: string) {
      return (await readRoster(filePath)).find((tagger) => tagger.id === id);
    },
    create(input, now = new Date()) {
      return mutate(async (taggers) => {
        const fields = parseTaggerFields(input, now);
        assertUniqueEmail(taggers, fields.email);
        const tagger = record(randomUUID(), fields, now.toISOString(), now.toISOString());
        await writeRoster(filePath, [...taggers, tagger]);
        return tagger;
      });
    },
    update(id, input, now = new Date()) {
      return mutate(async (taggers) => {
        const existing = find(taggers, id);
        const fields = applyTaggerPatch(existing, input, now);
        assertUniqueEmail(taggers, fields.email, id);
        return save(filePath, taggers, record(existing.id, fields, existing.createdAt, now.toISOString()));
      });
    },
    deactivate(id, now = new Date()) {
      return mutate(async (taggers) => {
        const existing = find(taggers, id);
        return save(filePath, taggers, {
          ...existing,
          deactivationDate: calendarDate(now),
          updatedAt: now.toISOString(),
        });
      });
    },
    reactivate(id, now = new Date()) {
      return mutate(async (taggers) => {
        const existing = find(taggers, id);
        return save(filePath, taggers, { ...existing, deactivationDate: null, updatedAt: now.toISOString() });
      });
    },
    remove(id) {
      return mutate(async (taggers) => {
        if (!taggers.some((tagger) => tagger.id === id)) return false;
        await writeRoster(filePath, taggers.filter((tagger) => tagger.id !== id));
        return true;
      });
    },
  };
}

function find(taggers: Tagger[], id: string): Tagger {
  if (typeof id !== 'string' || !id) throw new TaggerValidationError('A tagger id is required.');
  const existing = taggers.find((tagger) => tagger.id === id);
  if (!existing) throw new TaggerNotFoundError();
  return existing;
}

function record(id: string, fields: TaggerFields, createdAt: string, updatedAt: string): Tagger {
  return { id, ...fields, createdAt, updatedAt };
}

async function save(filePath: string, taggers: Tagger[], next: Tagger): Promise<Tagger> {
  await writeRoster(filePath, taggers.map((tagger) => (tagger.id === next.id ? next : tagger)));
  return next;
}

async function readRoster(filePath: string): Promise<Tagger[]> {
  try {
    const payload = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { taggers?: unknown }).taggers)) return [];
    return (payload as { taggers: unknown[] }).taggers.filter(isStoredTagger);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeRoster(filePath: string, taggers: Tagger[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const payload = { schema: TAGGER_ROSTER_SCHEMA, taggers };
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.rename(tmp, filePath);
}

function exclusive<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(filePath) ?? Promise.resolve()).then(fn, fn);
  queues.set(
    filePath,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export { TaggerConflictError, TaggerNotFoundError, TaggerValidationError };
