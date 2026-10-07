import { Suspense } from 'react';
import ReportGate from '@/components/report-gate';

export default function ReportPage() {
  return <Suspense fallback={<main className="mx-auto min-h-screen max-w-3xl p-4 text-slate-100"><p className="text-xs font-bold uppercase tracking-widest text-sky-300">GamePath · Live report</p><h1 className="mt-2 text-xl font-semibold">Connecting to match…</h1></main>}><ReportGate /></Suspense>;
}
