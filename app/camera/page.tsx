import { Suspense } from 'react';
import CameraSetup from '@/components/camera-setup';

export default function CameraPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-950 p-6 text-slate-300">Loading camera setup.</main>}>
    <CameraSetup />
  </Suspense>;
}
