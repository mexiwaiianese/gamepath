import { Suspense } from 'react';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminLogin from './admin-login';
import { ADMIN_COOKIE, adminPassword, validAdminSession } from '@/lib/admin-auth';
import { isLocalAdminRequest } from '@/lib/admin-video';

export const metadata = { title: 'GamePath admin' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const allowed = isLocalAdminRequest({
    nodeEnv: process.env.NODE_ENV,
    host: h.get('host'),
    origin: null,
    forwardedFor: h.get('x-forwarded-for'),
  });
  if (!allowed) notFound();
  const password = adminPassword();
  const signedIn = validAdminSession((await cookies()).get(ADMIN_COOKIE)?.value, password);
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-3 flex items-center gap-6">
        <Link href="/admin" className="font-semibold">GamePath admin</Link>
        {signedIn && <Link href="/admin/videos" className="text-sm text-slate-300 hover:text-white">Video tagging</Link>}
        <span className="ml-auto text-xs text-slate-500">local development only</span>
        {signedIn && <form action="/api/admin/session/" method="post"><input type="hidden" name="action" value="logout" /><button type="submit" className="text-sm text-slate-300">Sign out</button></form>}
      </header>
      <main className="mx-auto max-w-6xl p-6">{signedIn ? children : <Suspense><AdminLogin configured={Boolean(password)} /></Suspense>}</main>
    </div>
  );
}
