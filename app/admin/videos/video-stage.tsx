'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject, type VideoHTMLAttributes } from 'react';

type SizeMode = 'small' | 'medium' | 'large' | 'fit' | 'custom';
type Size = { mode: SizeMode; px: number };

const SIZE_KEY = 'gamepath:prepare-player-size';
const PRESETS: { mode: Exclude<SizeMode, 'custom'>; label: string }[] = [
  { mode: 'small', label: 'Small' },
  { mode: 'medium', label: 'Medium' },
  { mode: 'large', label: 'Large' },
  { mode: 'fit', label: 'Fit width' },
];
const PRESET_HEIGHT: Record<'small' | 'medium' | 'large', string> = { small: '30vh', medium: '55vh', large: '80vh' };
const MIN_PX = 160;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const small = 'rounded bg-slate-700 px-2 py-1 text-xs font-medium hover:bg-slate-600 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';
const active = 'rounded bg-sky-700 px-2 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';

function readSize(): Size {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIZE_KEY) ?? 'null') as Size | null;
    if (parsed && ['small', 'medium', 'large', 'fit', 'custom'].includes(parsed.mode) && typeof parsed.px === 'number') return parsed;
  } catch {
    // Fall through to the default.
  }
  return { mode: 'medium', px: 480 };
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoProps: VideoHTMLAttributes<HTMLVideoElement>;
};

/**
 * The Prepare player: a resizable stage (presets, or drag the bottom edge) with digital zoom
 * (1x-4x) and drag-to-pan. Native controls are shown at 1x; when zoomed they would be scaled
 * and cropped too, so a play/pause button and seek bar take over below the stage.
 */
export default function VideoStage({ videoRef, videoProps }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => (typeof window === 'undefined' ? { mode: 'medium', px: 480 } : readSize()));
  const [aspect, setAspect] = useState(16 / 9);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [paused, setPaused] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const drag = useRef<{ kind: 'pan' | 'resize'; x: number; y: number; startX: number; startY: number; startPx: number } | null>(null);

  const saveSize = (next: Size) => {
    setSize(next);
    try {
      window.localStorage.setItem(SIZE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable; the size still holds for this session.
    }
  };

  const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
    const el = stageRef.current;
    const maxX = el ? (el.clientWidth * (z - 1)) / 2 : 0;
    const maxY = el ? (el.clientHeight * (z - 1)) / 2 : 0;
    return { x: clamp(p.x, -maxX, maxX), y: clamp(p.y, -maxY, maxY) };
  }, []);

  const applyZoom = useCallback(
    (next: number) => {
      const z = clamp(Math.round(next * 100) / 100, 1, MAX_ZOOM);
      setZoom(z);
      setPan((p) => (z === 1 ? { x: 0, y: 0 } : clampPan({ x: (p.x * z) / zoom, y: (p.y * z) / zoom }, z)));
    },
    [clampPan, zoom],
  );

  // Ctrl/Cmd + wheel zooms; a plain wheel still scrolls the page. Needs a non-passive listener.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom, zoom]);

  const zoomed = zoom > 1;

  function onStagePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!zoomed || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, startX: pan.x, startY: pan.y, startPx: 0 };
  }

  function onHandlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: 'resize', x: e.clientX, y: e.clientY, startX: 0, startY: 0, startPx: stageRef.current?.clientHeight ?? size.px };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setPan(clampPan({ x: d.startX + e.clientX - d.x, y: d.startY + e.clientY - d.y }, zoom));
    else setSize({ mode: 'custom', px: Math.round(clamp(d.startPx + e.clientY - d.y, MIN_PX, window.innerHeight * 1.5)) });
  }

  function onPointerUp() {
    if (drag.current?.kind === 'resize') saveSize(size);
    drag.current = null;
  }

  function onStageKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = 40;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (e.key === '+' || e.key === '=') applyZoom(zoom + ZOOM_STEP);
    else if (e.key === '-' || e.key === '_') applyZoom(zoom - ZOOM_STEP);
    else if (e.key === '0') applyZoom(1);
    else if (zoomed && moves[e.key]) setPan((p) => clampPan({ x: p.x + moves[e.key][0], y: p.y + moves[e.key][1] }, zoom));
    else return;
    e.preventDefault();
  }

  function onHandleKey(e: KeyboardEvent<HTMLDivElement>) {
    const delta = e.key === 'ArrowUp' ? -40 : e.key === 'ArrowDown' ? 40 : 0;
    if (!delta) return;
    e.preventDefault();
    const from = stageRef.current?.clientHeight ?? size.px;
    saveSize({ mode: 'custom', px: Math.round(clamp(from + delta, MIN_PX, window.innerHeight * 1.5)) });
  }

  const stageStyle =
    size.mode === 'fit' ? { aspectRatio: String(aspect) } : size.mode === 'custom' ? { height: `${size.px}px` } : { height: PRESET_HEIGHT[size.mode] };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400" id="player-size-label">Size</span>
        <div className="flex gap-1" role="group" aria-labelledby="player-size-label">
          {PRESETS.map((p) => (
            <button key={p.mode} type="button" className={size.mode === p.mode ? active : small} aria-pressed={size.mode === p.mode} onClick={() => saveSize({ ...size, mode: p.mode })}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="ml-3 text-slate-400" id="player-zoom-label">Zoom</span>
        <div className="flex items-center gap-1" role="group" aria-labelledby="player-zoom-label">
          <button type="button" className={small} aria-label="Zoom out" disabled={zoom <= 1} onClick={() => applyZoom(zoom - ZOOM_STEP)}>−</button>
          <span className="w-12 rounded bg-slate-900 px-1 py-1 text-center font-mono" aria-live="polite" data-testid="zoom-level">{zoom.toFixed(2).replace(/\.?0+$/, '')}x</span>
          <button type="button" className={small} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => applyZoom(zoom + ZOOM_STEP)}>+</button>
          <button type="button" className={small} aria-label="Reset zoom" disabled={!zoomed} onClick={() => applyZoom(1)}>Reset</button>
        </div>
        <span className="text-slate-500">Ctrl/⌘ + wheel to zoom{zoomed ? ', drag or arrow keys to pan' : ''}</span>
      </div>

      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${zoomed ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={stageStyle}
        tabIndex={0}
        role="group"
        aria-label={`Video stage, zoom ${zoom}x. Plus and minus keys zoom, 0 resets${zoomed ? ', arrow keys pan' : ''}.`}
        onKeyDown={onStageKey}
        onPointerDown={onStagePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <video
          {...videoProps}
          ref={videoRef}
          controls={!zoomed}
          draggable={false}
          className="h-full w-full object-contain select-none"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center', pointerEvents: zoomed ? 'none' : undefined }}
          onPlay={(e) => {
            setPaused(false);
            videoProps.onPlay?.(e);
          }}
          onPause={(e) => {
            setPaused(true);
            videoProps.onPause?.(e);
          }}
          onTimeUpdate={(e) => {
            setCurrent(e.currentTarget.currentTime);
            videoProps.onTimeUpdate?.(e);
          }}
          onSeeked={(e) => {
            setCurrent(e.currentTarget.currentTime);
            videoProps.onSeeked?.(e);
          }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (el.videoWidth && el.videoHeight) setAspect(el.videoWidth / el.videoHeight);
            if (Number.isFinite(el.duration)) setDuration(el.duration);
            videoProps.onLoadedMetadata?.(e);
          }}
        />
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize player height. Up and down arrow keys change it."
        aria-valuenow={size.mode === 'custom' ? size.px : undefined}
        tabIndex={0}
        className="-mt-1 flex h-3 cursor-ns-resize items-center justify-center rounded hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onHandleKey}
      >
        <span className="h-1 w-12 rounded bg-slate-600" aria-hidden="true" />
      </div>

      {zoomed && (
        <div className="flex items-center gap-2" data-testid="zoom-controls">
          <button type="button" className={small} onClick={togglePlay}>{paused ? 'Play' : 'Pause'}</button>
          <input
            type="range"
            className="flex-1 accent-sky-500"
            aria-label="Seek"
            min={0}
            max={duration || 0}
            step={0.01}
            value={Math.min(current, duration || 0)}
            onChange={(e) => {
              const el = videoRef.current;
              if (el) el.currentTime = Number(e.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
