'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { DEFAULT_HOTSPOT_PEERS, DEFAULT_HOTSPOT_SSID, HOTSPOT_HELPER_URL, MAX_HOTSPOT_PEERS, MIN_HOTSPOT_PEERS, generateHotspotPassphrase, wifiJoinCode } from '@/lib/hotspot';

type HotspotResponse = {
  message?: string;
  config?: { ssid?: string; passphrase?: string; maxPeers?: number } | null;
  status?: { ok?: boolean; message?: string; gateway?: string } | null;
};

type HotspotSetupProps = { open: boolean; onClose: () => void };

export default function HotspotSetup({ open, onClose }: HotspotSetupProps) {
  const [ssid, setSsid] = useState(DEFAULT_HOTSPOT_SSID);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseDirty, setPassphraseDirty] = useState(false);
  const [maxPeers, setMaxPeers] = useState(String(DEFAULT_HOTSPOT_PEERS));
  const [ensureLoopback, setEnsureLoopback] = useState(false);
  const [message, setMessage] = useState('');
  const [gateway, setGateway] = useState('192.168.137.1');
  const [busy, setBusy] = useState(false);
  const [helperDown, setHelperDown] = useState(false);
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch(`${HOTSPOT_HELPER_URL}/hotspot`)
      .then((response) => response.json() as Promise<HotspotResponse>)
      .then((body) => {
        if (!active) return;
        setHelperDown(false);
        if (body.config?.ssid) setSsid(body.config.ssid);
        if (body.config?.passphrase) setPassphrase(body.config.passphrase);
        if (body.config?.maxPeers) setMaxPeers(String(body.config.maxPeers));
        if (body.status?.message) setMessage(body.status.message);
        if (body.status?.gateway) setGateway(body.status.gateway);
      })
      .catch(() => { if (active) setHelperDown(true); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || passphrase.length < 8) { setQr(''); return; }
    let active = true;
    void QRCode.toDataURL(wifiJoinCode(ssid.trim() || DEFAULT_HOTSPOT_SSID, passphrase), { width: 280, margin: 1, errorCorrectionLevel: 'Q' })
      .then((dataUrl) => { if (active) setQr(dataUrl); })
      .catch(() => { if (active) setQr(''); });
    return () => { active = false; };
  }, [open, ssid, passphrase]);

  if (!open) return null;

  const enable = async () => {
    setBusy(true);
    setMessage('');
    try {
      const peers = Number(maxPeers);
      const response = await fetch(`${HOTSPOT_HELPER_URL}/hotspot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ssid,
          maxPeers: peers,
          ensureLoopback,
          ...(passphraseDirty ? { passphrase } : {}),
        }),
      });
      const body = await response.json() as HotspotResponse;
      setHelperDown(false);
      if (body.config?.passphrase) setPassphrase(body.config.passphrase);
      if (body.config?.ssid) setSsid(body.config.ssid);
      if (body.config?.maxPeers) setMaxPeers(String(body.config.maxPeers));
      setPassphraseDirty(false);
      if (body.status?.gateway) setGateway(body.status.gateway);
      setMessage(body.message || body.status?.message || (response.ok ? 'Team network is on.' : 'Team network setup did not finish.'));
    } catch {
      setHelperDown(true);
      setMessage('The team-network helper is not running on this computer.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="hotspot-title" className="my-auto w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-sky-300">Team network</p>
          <h2 id="hotspot-title" className="text-lg font-semibold">Let phones join this computer</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close team network" className="rounded border border-slate-700 px-2 py-1 text-sm">CLOSE</button>
      </div>
      <p className="mb-3 text-xs text-slate-400">Phones need this Wi-Fi password before they can open a report. Running setup again keeps the saved name, password, games, roster, and video labels.</p>
      {helperDown && <p className="mb-3 rounded border border-amber-600 bg-amber-500/10 p-2 text-xs text-amber-200">Start the helper on this computer with npm run hotspot, then open this panel again.</p>}
      <div className="grid gap-3">
        <label className="grid gap-1 text-xs text-slate-400">Network name
          <input aria-label="Team network name" className="rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100" value={ssid} onChange={(event) => setSsid(event.target.value)} />
        </label>
        <label className="grid gap-1 text-xs text-slate-400">Wi-Fi password
          <input aria-label="Team network password" className="rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100" value={passphrase} placeholder="Created the first time you enable this" onChange={(event) => { setPassphrase(event.target.value); setPassphraseDirty(true); }} />
        </label>
        <div className="flex gap-2">
          <button type="button" className="rounded border border-slate-700 px-2 py-1 text-xs" onClick={() => { setPassphrase(generateHotspotPassphrase()); setPassphraseDirty(true); }}>NEW PASSWORD</button>
          <label className="grid gap-1 text-xs text-slate-400">Device limit
            <input aria-label="Maximum phones" className="w-24 rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100" inputMode="numeric" min={MIN_HOTSPOT_PEERS} max={MAX_HOTSPOT_PEERS} value={maxPeers} onChange={(event) => setMaxPeers(event.target.value)} />
          </label>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-300">
          <input type="checkbox" className="mt-0.5" checked={ensureLoopback} onChange={(event) => setEnsureLoopback(event.target.checked)} />
          This computer has no internet. Create an offline adapter only if one is not already there.
        </label>
        <button type="button" disabled={busy} onClick={() => void enable()} className="rounded border border-sky-600 px-3 py-2 text-sm text-sky-200 disabled:opacity-50">{busy ? 'WAITING FOR WINDOWS APPROVAL…' : 'ENABLE TEAM NETWORK'}</button>
      </div>
      {message && <p className="mt-3 text-sm text-slate-200">{message}</p>}
      {qr && <div className="mt-3 flex flex-col items-center gap-2">
        <img src={qr} alt="QR code for the team Wi-Fi" width={180} height={180} className="rounded bg-white p-2" />
        <p className="text-center text-xs text-slate-400">After joining, open http://{gateway}:3000</p>
      </div>}
    </section>
  </div>;
}
