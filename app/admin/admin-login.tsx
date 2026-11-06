"use client";

import { useSearchParams } from 'next/navigation';

export default function AdminLogin({ configured }: { configured: boolean }) {
  const error = useSearchParams().get('login');
  return <section className="mx-auto max-w-sm space-y-4 rounded border border-slate-800 bg-slate-900 p-6">
    <h1 className="text-xl font-semibold">Admin sign in</h1>
    <p className="text-sm text-slate-300">Video preparation and tagging are for admins. Watchers and live stat keepers do not need this password.</p>
    {!configured ? <p role="status" className="text-sm text-amber-300">Set GAMEPATH_ADMIN_PASSWORD in .env.local and restart npm run dev. Admin access is disabled until a password is configured.</p> : <form action="/api/admin/session/" method="post" className="space-y-3">
      <label className="grid gap-1 text-sm">Admin password
        <input name="password" type="password" autoComplete="current-password" required maxLength={1024} className="rounded border border-slate-700 bg-slate-950 p-2" />
      </label>
      {error && <p role="alert" className="text-sm text-amber-300">{error === 'limited' ? 'Too many attempts. Wait one minute and try again.' : 'Sign in failed. Check the password and try again.'}</p>}
      <button type="submit" className="rounded border border-sky-600 px-4 py-2">Sign in</button>
    </form>}
  </section>;
}
