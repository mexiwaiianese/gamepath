'use client';

import { useCallback, useMemo, useState, type FormEvent } from 'react';

import {
  TAGGER_STATUS_LABELS,
  deactivationHint,
  isTaggerActive,
  sortTaggers,
  taggerAccessStatus,
  type Tagger,
  type TaggerAccessStatus,
} from '@/lib/tagger-roster';

const button = 'rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40';
const compact = 'rounded px-2 py-1 text-xs font-medium disabled:opacity-40';
const field = 'rounded border border-slate-700 bg-slate-950 p-2 text-sm';
const STATUS_STYLE: Record<TaggerAccessStatus, string> = {
  active: 'bg-emerald-900 text-emerald-200',
  scheduled: 'bg-amber-900 text-amber-200',
  deactivated: 'bg-slate-700 text-slate-200',
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  organization: string;
  notes: string;
  invitedAt: string;
  deactivationDate: string;
};

const EMPTY: FormState = {
  name: '',
  email: '',
  phone: '',
  organization: '',
  notes: '',
  invitedAt: '',
  deactivationDate: '',
};

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function toForm(tagger?: Tagger): FormState {
  if (!tagger) return { ...EMPTY, invitedAt: today() };
  return {
    name: tagger.name,
    email: tagger.email,
    phone: tagger.phone ?? '',
    organization: tagger.organization ?? '',
    notes: tagger.notes ?? '',
    invitedAt: tagger.invitedAt,
    deactivationDate: tagger.deactivationDate ?? '',
  };
}

function payload(form: FormState) {
  return {
    name: form.name,
    email: form.email,
    phone: form.phone,
    organization: form.organization,
    notes: form.notes,
    invitedAt: form.invitedAt || null,
    deactivationDate: form.deactivationDate || null,
  };
}

export default function TaggerRoster({ initialTaggers }: { initialTaggers: Tagger[] }) {
  const [taggers, setTaggers] = useState<Tagger[]>(initialTaggers);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const rows = useMemo(() => sortTaggers(taggers), [taggers]);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/tagger-roster/', { cache: 'no-store' });
    if (res.status === 401) window.location.replace('/admin/');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const body = (await res.json()) as { taggers?: Tagger[] };
    setTaggers(body.taggers ?? []);
  }, []);

  function openAdd() {
    setEditingId(null);
    setForm(toForm());
    setMessage(null);
  }

  function openEdit(tagger: Tagger) {
    setEditingId(tagger.id);
    setForm(toForm(tagger));
    setMessage(null);
  }

  function closeForm() {
    setForm(null);
    setEditingId(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(editingId ? `/api/admin/tagger-roster/${editingId}/` : '/api/admin/tagger-roster/', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload(form)),
      });
      if (res.status === 401) window.location.replace('/admin/');
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      closeForm();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function act(tagger: Tagger, action: 'deactivate' | 'reactivate' | 'delete') {
    if (action === 'delete' && !window.confirm(`Delete ${tagger.name} from the roster?\n\nThis cannot be undone.`)) return;
    if (action === 'deactivate' && !window.confirm(`Deactivate ${tagger.name} now? They will lose tagging access today.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/tagger-roster/${tagger.id}/`, {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        headers: action === 'delete' ? undefined : { 'content-type': 'application/json' },
        body: action === 'delete' ? undefined : JSON.stringify({ action }),
      });
      if (res.status === 401) window.location.replace('/admin/');
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (editingId === tagger.id) closeForm();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Taggers</h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Contact info and access dates for people who tag video. This roster is separate from the court, player, and
            touch marker controls on the video page. Access uses each person&apos;s deactivation date; a future hosted
            login will honor the same rule.
          </p>
        </div>
        <button className={`${button} bg-emerald-600 hover:bg-emerald-500`} type="button" onClick={openAdd} disabled={busy}>
          Add tagger
        </button>
      </div>

      {message && (
        <p role="alert" className="rounded bg-red-950 p-3 text-sm text-red-200">
          {message}
        </p>
      )}

      {form && (
        <form
          onSubmit={save}
          className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5"
          data-testid="tagger-form"
          aria-labelledby="tagger-form-title"
        >
          <h2 id="tagger-form-title" className="text-lg font-medium">
            {editingId ? 'Edit tagger' : 'Add tagger'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Name
              <input className={field} name="name" required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
            </label>
            <label className="grid gap-1 text-sm">
              Email
              <input className={field} name="email" type="email" required maxLength={254} value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Phone <span className="text-slate-500">(optional)</span></span>
              <input className={field} name="phone" type="tel" maxLength={40} value={form.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Organization / team <span className="text-slate-500">(optional)</span></span>
              <input className={field} name="organization" maxLength={120} value={form.organization} onChange={(e) => set('organization', e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              Start / invited date
              <input className={field} name="invitedAt" type="date" required value={form.invitedAt} onChange={(e) => set('invitedAt', e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Deactivation date <span className="text-slate-500">(optional)</span></span>
              <input className={field} name="deactivationDate" type="date" value={form.deactivationDate} onChange={(e) => set('deactivationDate', e.target.value)} />
              <span className="text-xs text-slate-400">Picking a date schedules deactivation on that day. Leave blank to stay active.</span>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span>Notes <span className="text-slate-500">(optional)</span></span>
              <textarea className={`${field} min-h-20`} name="notes" maxLength={2000} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={`${button} bg-sky-600 hover:bg-sky-500`} type="submit" disabled={busy}>
              {editingId ? 'Save changes' : 'Add tagger'}
            </button>
            <button className={`${button} bg-slate-700 hover:bg-slate-600`} type="button" onClick={closeForm} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-left text-sm" data-testid="tagger-list">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Name</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Email</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Phone</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Organization</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Invited</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Deactivation</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Status</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tagger) => {
              const status = taggerAccessStatus(tagger);
              const hint = deactivationHint(tagger);
              return (
                <tr key={tagger.id} className="border-t border-slate-800" data-testid={`tagger-row-${tagger.id}`} data-status={status}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{tagger.name}</td>
                  <td className="whitespace-nowrap px-3 py-2">{tagger.email}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-300">{tagger.phone ?? '—'}</td>
                  <td className="max-w-[12rem] truncate px-3 py-2 text-slate-300" title={tagger.organization ?? undefined}>{tagger.organization ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-300">{tagger.invitedAt}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-300">{tagger.deactivationDate ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[status]}`}>{TAGGER_STATUS_LABELS[status]}</span>
                      {hint && <span className="whitespace-nowrap text-xs text-amber-200">{hint}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-nowrap gap-1.5">
                      <button className={`${compact} bg-slate-700 hover:bg-slate-600`} type="button" disabled={busy} onClick={() => openEdit(tagger)}>
                        Edit
                      </button>
                      {isTaggerActive(tagger) ? (
                        <button className={`${compact} bg-amber-700 hover:bg-amber-600`} type="button" disabled={busy} onClick={() => act(tagger, 'deactivate')}>
                          Deactivate now
                        </button>
                      ) : (
                        <button className={`${compact} bg-emerald-700 hover:bg-emerald-600`} type="button" disabled={busy} onClick={() => act(tagger, 'reactivate')}>
                          Reactivate
                        </button>
                      )}
                      <button className={`${compact} bg-red-900 hover:bg-red-800`} type="button" disabled={busy} onClick={() => act(tagger, 'delete')}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !form && (
              <tr>
                <td className="px-3 py-8 text-center text-slate-400" colSpan={8}>
                  No taggers yet. Add someone to the roster.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
