'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { cameraPositionLabel, cameraSetupUrl, type MatchCamera } from '@/lib/cameras';
import { deviceJoinUrl, reportPageUrl } from '@/lib/live-report';
import QRCode from 'qrcode';

type MatchShareDialogProps = {
  open: boolean;
  matchId: string;
  token: string;
  defaultOrigin: string;
  syncStatus: 'pending' | 'ready' | 'failed';
  cameras: MatchCamera[];
  onClose: () => void;
};

export default function MatchShareDialog({ open, matchId, token, defaultOrigin, syncStatus, cameras, onClose }: MatchShareDialogProps) {
  const [origin, setOrigin] = useState(defaultOrigin);
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);
  const [qrError, setQrError] = useState('');
  const [copied, setCopied] = useState(false);
  const [joinQr, setJoinQr] = useState('');
  let reportUrl = '';
  let joinUrl = '';
  let invalidOrigin = false;

  try {
    const parsed = new URL(origin.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') invalidOrigin = true;
    else {
      reportUrl = reportPageUrl(parsed.toString(), matchId, token);
      joinUrl = deviceJoinUrl(parsed.toString(), matchId, token);
    }
  } catch {
    invalidOrigin = true;
  }

  useEffect(() => {
    if (!open || !reportUrl) return;
    let active = true;
    void QRCode.toDataURL(reportUrl, { width: 280, margin: 1, errorCorrectionLevel: 'Q' })
      .then((dataUrl) => { if (active) setQr({ url: reportUrl, dataUrl }); })
      .catch(() => { if (active) setQrError('Could not generate the QR code.'); });
    return () => { active = false; };
  }, [open, reportUrl]);

  useEffect(() => {
    if (!open || !joinUrl) return;
    let active = true;
    void QRCode.toDataURL(joinUrl, { width: 280, margin: 1, errorCorrectionLevel: 'Q' })
      .then((dataUrl) => { if (active) setJoinQr(dataUrl); })
      .catch(() => { if (active) setJoinQr(''); });
    return () => { active = false; };
  }, [open, joinUrl]);

  if (!open) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(reportUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="match-share-title" className="my-auto w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl">
      <div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-emerald-300">Game created</p><h2 id="match-share-title" className="text-lg font-semibold">Share live report</h2></div><button type="button" onClick={onClose} aria-label="Close share dialog" className="rounded border border-slate-700 px-2 py-1 text-sm">CLOSE</button></div>
      <label className="grid gap-1 text-xs text-slate-400">Address coaches can reach<input aria-label="Report host address" className="min-w-0 rounded border border-slate-700 bg-slate-950 p-2 text-sm" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="http://192.168.1.20:3001" /></label>
      <p role="status" className={`mt-2 text-xs ${syncStatus === 'ready' ? 'text-emerald-300' : syncStatus === 'failed' ? 'text-amber-300' : 'text-slate-400'}`}>
        {syncStatus === 'ready' ? 'Live match data is synced to this host.' : syncStatus === 'failed' ? 'Match sync failed. Keep the host online and check the app server.' : 'Syncing match data to the host…'}
      </p>
      {invalidOrigin ? <p className="mt-2 text-sm text-amber-300">Enter a reachable host address with http:// or https://.</p> : <>
        <div className="mt-3 flex items-center gap-2"><input aria-label="Live report link" readOnly className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200" value={reportUrl} /><button type="button" onClick={copyLink} className="rounded border border-sky-600 px-3 py-2 text-xs text-sky-200">{copied ? 'COPIED' : 'COPY LINK'}</button></div>
        <div className="mt-4 flex justify-center">{qr?.url === reportUrl ? <Image className="h-56 w-56 rounded bg-white p-2" src={qr.dataUrl} alt="QR code for the live match report" width={280} height={280} unoptimized /> : <div className="flex h-56 w-56 items-center justify-center rounded border border-slate-700 text-sm text-slate-400">{qrError || 'Preparing QR code…'}</div>}</div>
      </>}
      <p className="mt-3 text-xs text-slate-400">The host computer must stay on. Anyone with this private link can view the report.</p>
      {!invalidOrigin && <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
        <h3 className="text-sm font-semibold">Join this game</h3>
        <p className="text-xs text-slate-400">A phone on the team network opens this link and chooses stat keeping, coach, or camera. Stat keepers write the same match. Coaches only watch.</p>
        <input aria-label="Join link" readOnly className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200" value={joinUrl} />
        {joinQr && <div className="flex justify-center"><Image className="h-40 w-40 rounded bg-white p-2" src={joinQr} alt="QR code to join this game" width={160} height={160} unoptimized /></div>}
      </div>}
      {defaultOrigin && cameras.length > 0 && <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
        <h3 className="text-sm font-semibold">Camera setup</h3>
        <p className="text-xs text-slate-400">Each link opens that camera on this computer. Set where the near end sits in the picture before you mark the court.</p>
        {cameras.map((camera, index) => {
          const url = cameraSetupUrl(defaultOrigin, matchId, camera.id, token);
          return <div key={camera.id} className="space-y-1">
            <a className="text-sm text-sky-300" href={url} target="_blank" rel="noreferrer">Camera {index + 1}: {cameraPositionLabel(camera.position)}</a>
            <input aria-label={`Camera ${index + 1} setup link`} readOnly className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200" value={url} />
          </div>;
        })}
      </div>}
    </section>
  </div>;
}
