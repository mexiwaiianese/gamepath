// Pure helpers for the tagger roster (people who tag video). No Node APIs here so tests and the client can import them.
// Status and isTaggerActive() are the source of truth for access; the future hosted claim lock and tagger login should use them.

export const TAGGER_ROSTER_SCHEMA = 'gamepath.tagger_roster.v1';

export type TaggerAccessStatus = 'active' | 'scheduled' | 'deactivated';

export type Tagger = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  organization: string | null;
  notes: string | null;
  /** Calendar date (YYYY-MM-DD) the person was invited or started. */
  invitedAt: string;
  /** First calendar date (YYYY-MM-DD) they are no longer active. Null means no scheduled end. */
  deactivationDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaggerFields = {
  name: string;
  email: string;
  phone: string | null;
  organization: string | null;
  notes: string | null;
  invitedAt: string;
  deactivationDate: string | null;
};

export const TAGGER_STATUS_LABELS: Record<TaggerAccessStatus, string> = {
  active: 'Active',
  scheduled: 'Scheduled to deactivate',
  deactivated: 'Deactivated',
};

const STATUS_ORDER: Record<TaggerAccessStatus, number> = { active: 0, scheduled: 1, deactivated: 2 };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class TaggerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaggerValidationError';
  }
}

export class TaggerNotFoundError extends Error {
  constructor() {
    super('Tagger not found.');
    this.name = 'TaggerNotFoundError';
  }
}

export class TaggerConflictError extends Error {
  constructor(message = 'A tagger with that email already exists.') {
    super(message);
    this.name = 'TaggerConflictError';
  }
}

/** Local calendar date of `now` as YYYY-MM-DD (the machine's timezone, not UTC). */
export function calendarDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function taggerAccessStatus(tagger: { deactivationDate?: string | null }, now: Date = new Date()): TaggerAccessStatus {
  const end = tagger.deactivationDate;
  if (!end) return 'active';
  if (end <= calendarDate(now)) return 'deactivated';
  return 'scheduled';
}

/** True while the tagger may work: Active or Scheduled to deactivate. False once the deactivation date has been reached. */
export function isTaggerActive(tagger: { deactivationDate?: string | null }, now: Date = new Date()): boolean {
  return taggerAccessStatus(tagger, now) !== 'deactivated';
}

export function daysUntilDeactivation(tagger: { deactivationDate?: string | null }, now: Date = new Date()): number | null {
  if (taggerAccessStatus(tagger, now) !== 'scheduled' || !tagger.deactivationDate) return null;
  return dateIndex(tagger.deactivationDate) - dateIndex(calendarDate(now));
}

export function deactivationHint(tagger: { deactivationDate?: string | null }, now: Date = new Date()): string | null {
  const days = daysUntilDeactivation(tagger, now);
  if (days === null) return null;
  return days === 1 ? 'deactivates in 1 day' : `deactivates in ${days} days`;
}

export function compareTaggers(a: Tagger, b: Tagger, now: Date = new Date()): number {
  const status = STATUS_ORDER[taggerAccessStatus(a, now)] - STATUS_ORDER[taggerAccessStatus(b, now)];
  if (status !== 0) return status;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.email.localeCompare(b.email, undefined, { sensitivity: 'base' });
}

export function sortTaggers(taggers: readonly Tagger[], now: Date = new Date()): Tagger[] {
  return [...taggers].sort((a, b) => compareTaggers(a, b, now));
}

export function parseTaggerFields(input: unknown, now: Date = new Date()): TaggerFields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TaggerValidationError('Expected a tagger object.');
  const raw = input as Record<string, unknown>;
  const name = requiredText(raw.name, 'Name', 120);
  const email = normalizeEmail(raw.email);
  return {
    name,
    email,
    phone: optionalText(raw.phone, 'Phone', 40),
    organization: optionalText(raw.organization, 'Organization', 120),
    notes: optionalText(raw.notes, 'Notes', 2000),
    invitedAt: parseDateField(raw.invitedAt, 'Start / invited date', calendarDate(now)),
    deactivationDate: parseOptionalDate(raw.deactivationDate, 'Deactivation date'),
  };
}

export function applyTaggerPatch(existing: Tagger, input: unknown, now: Date = new Date()): TaggerFields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TaggerValidationError('Expected a tagger object.');
  const raw = input as Record<string, unknown>;
  return parseTaggerFields({
    name: raw.name !== undefined ? raw.name : existing.name,
    email: raw.email !== undefined ? raw.email : existing.email,
    phone: raw.phone !== undefined ? raw.phone : existing.phone,
    organization: raw.organization !== undefined ? raw.organization : existing.organization,
    notes: raw.notes !== undefined ? raw.notes : existing.notes,
    invitedAt: raw.invitedAt !== undefined ? raw.invitedAt : existing.invitedAt,
    deactivationDate: raw.deactivationDate !== undefined ? raw.deactivationDate : existing.deactivationDate,
  }, now);
}

export function assertUniqueEmail(taggers: readonly Tagger[], email: string, exceptId?: string) {
  const wanted = email.trim().toLowerCase();
  if (taggers.some((tagger) => tagger.id !== exceptId && tagger.email === wanted)) throw new TaggerConflictError();
}

export function isStoredTagger(value: unknown): value is Tagger {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.id === 'string' &&
    raw.id.length > 0 &&
    raw.id.length <= 80 &&
    typeof raw.name === 'string' &&
    typeof raw.email === 'string' &&
    (raw.phone === null || typeof raw.phone === 'string') &&
    (raw.organization === null || typeof raw.organization === 'string') &&
    (raw.notes === null || typeof raw.notes === 'string') &&
    typeof raw.invitedAt === 'string' &&
    isIsoDate(raw.invitedAt) &&
    (raw.deactivationDate === null || (typeof raw.deactivationDate === 'string' && isIsoDate(raw.deactivationDate))) &&
    typeof raw.createdAt === 'string' &&
    typeof raw.updatedAt === 'string'
  );
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new TaggerValidationError(`${label} is required.`);
  const text = value.trim();
  if (!text) throw new TaggerValidationError(`${label} is required.`);
  if (text.length > max) throw new TaggerValidationError(`${label} must be ${max} characters or fewer.`);
  return text;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new TaggerValidationError(`${label} must be text.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new TaggerValidationError(`${label} must be ${max} characters or fewer.`);
  return text;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new TaggerValidationError('Email is required.');
  const email = value.trim().toLowerCase();
  if (!email) throw new TaggerValidationError('Email is required.');
  if (email.length > 254 || !EMAIL.test(email)) throw new TaggerValidationError('Enter a valid email address.');
  return email;
}

function parseDateField(value: unknown, label: string, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !isIsoDate(value)) throw new TaggerValidationError(`${label} must be a valid date.`);
  return value;
}

function parseOptionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isIsoDate(value)) throw new TaggerValidationError(`${label} must be a valid date.`);
  return value;
}

/** Days since a fixed origin, for YYYY-MM-DD subtraction without timezone conversion. */
function dateIndex(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}
