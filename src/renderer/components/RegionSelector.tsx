import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Region } from '@/shared/recorder';

type Bounds = Region;

interface DragBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function normalizeBox(box: DragBox): Region {
  const x = Math.min(box.startX, box.currentX);
  const y = Math.min(box.startY, box.currentY);
  const width = Math.abs(box.currentX - box.startX);
  const height = Math.abs(box.currentY - box.startY);
  return { x, y, width, height };
}

export function RegionSelector({
  bounds,
  onConfirm,
  onCancel
}: {
  bounds: Bounds;
  onConfirm: (region: Region) => Promise<unknown>;
  onCancel: () => Promise<unknown>;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [box, setBox] = useState<DragBox | null>(null);
  const [background, setBackground] = useState<string | null>(null);

  const region = useMemo(() => (box ? normalizeBox(box) : null), [box]);

  useEffect(() => {
    let active = true;
    void window.recorder.getRegionBackground().then((dataUrl) => {
      if (active) setBackground(dataUrl);
    });

    const previousMode = document.body.dataset.mode;
    const previousHtmlMode = document.documentElement.dataset.mode;
    const previousBodyBackground = document.body.style.background;
    const previousHtmlBackground = document.documentElement.style.background;
    const previousRootBackground = document.getElementById('root')?.style.background ?? '';
    document.body.dataset.mode = 'region-selector';
    document.documentElement.dataset.mode = 'region-selector';
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    const root = document.getElementById('root');
    if (root) {
      root.style.background = 'transparent';
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void onCancel();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => {
      active = false;
      window.removeEventListener('keydown', handleKey);
      if (previousMode) {
        document.body.dataset.mode = previousMode;
      } else {
        delete document.body.dataset.mode;
      }
      if (previousHtmlMode) {
        document.documentElement.dataset.mode = previousHtmlMode;
      } else {
        delete document.documentElement.dataset.mode;
      }
      document.body.style.background = previousBodyBackground;
      document.documentElement.style.background = previousHtmlBackground;
      if (root) {
        root.style.background = previousRootBackground;
      }
    };
  }, [onCancel]);

  function getPoint(event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const element = stageRef.current;
    if (!element) {
      return { x: 0, y: 0 };
    }
    const rect = element.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height)
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const point = getPoint(event);
    setDragging(true);
    setBox({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y
    });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !box) return;
    const point = getPoint(event);
    setBox({ ...box, currentX: point.x, currentY: point.y });
  }

  function handlePointerUp() {
    setDragging(false);
  }

  async function handleConfirm() {
    if (!region || region.width < 40 || region.height < 40) {
      return;
    }

    await onConfirm({
      x: Math.round(region.x + bounds.x),
      y: Math.round(region.y + bounds.y),
      width: Math.round(region.width),
      height: Math.round(region.height)
    });
  }

  const displayRegion = region
    ? {
        x: Math.round(region.x),
        y: Math.round(region.y),
        width: Math.round(region.width),
        height: Math.round(region.height)
      }
    : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-white">
      {background ? (
        <img
          src={background}
          alt="Screen to select"
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
          draggable={false}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-slate-950/10" />
      <div className="pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-full border border-white/12 bg-slate-950/80 px-4 py-2 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <span className="text-sm text-white/90">Drag to select the area you want to record</span>
          <button
            type="button"
            onClick={() => void onCancel()}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80 transition hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="absolute inset-0 cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {displayRegion ? (
          <div
            className="absolute rounded-2xl border-2 border-cyan-400 bg-cyan-400/8 shadow-[0_0_0_9999px_rgba(15,23,42,0.10)]"
            style={{
              left: displayRegion.x,
              top: displayRegion.y,
              width: displayRegion.width,
              height: displayRegion.height
            }}
          >
            <div className="absolute -left-1 -top-1 h-3 w-3 rounded-full border border-white/80 bg-cyan-400" />
            <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full border border-white/80 bg-cyan-400" />
            <div className="absolute -bottom-1 -left-1 h-3 w-3 rounded-full border border-white/80 bg-cyan-400" />
            <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border border-white/80 bg-cyan-400" />
          </div>
        ) : null}

        {displayRegion ? (
          <div
            className="absolute rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white shadow-xl backdrop-blur-sm"
            style={{
              left: displayRegion.x + Math.min(18, Math.max(0, displayRegion.width - 180)),
              top: displayRegion.y + Math.min(18, Math.max(0, displayRegion.height - 90))
            }}
          >
            <div>X: {Math.round(displayRegion.x + bounds.x)}</div>
            <div>Y: {Math.round(displayRegion.y + bounds.y)}</div>
            <div>W: {displayRegion.width}</div>
            <div>H: {displayRegion.height}</div>
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-[22px] border border-white/10 bg-slate-950/80 px-3 py-3 shadow-[0_24px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
          <button
            type="button"
            onClick={() => void onCancel()}
            className="pointer-events-auto h-12 rounded-full border border-white/10 bg-white/5 px-5 text-sm font-medium text-white/85 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <div className="pointer-events-auto rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
            Click and drag to draw a rectangle
          </div>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!region || region.width < 40 || region.height < 40}
            className="pointer-events-auto h-12 rounded-full bg-cyan-400 px-6 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export function RegionSelectorControls({
  onStartSelection,
  onCancel
}: {
  onStartSelection: () => Promise<unknown>;
  onCancel: () => Promise<unknown>;
}) {
  const [mode, setMode] = useState<'Selection' | 'Screen' | 'Window'>('Selection');

  useEffect(() => {
    const previousMode = document.body.dataset.mode;
    const previousHtmlMode = document.documentElement.dataset.mode;
    const previousBodyBackground = document.body.style.background;
    const previousHtmlBackground = document.documentElement.style.background;
    const previousRootBackground = document.getElementById('root')?.style.background ?? '';
    document.body.dataset.mode = 'region-selector-controls';
    document.documentElement.dataset.mode = 'region-selector-controls';
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    const root = document.getElementById('root');
    if (root) {
      root.style.background = 'transparent';
    }

    return () => {
      if (previousMode) {
        document.body.dataset.mode = previousMode;
      } else {
        delete document.body.dataset.mode;
      }
      if (previousHtmlMode) {
        document.documentElement.dataset.mode = previousHtmlMode;
      } else {
        delete document.documentElement.dataset.mode;
      }
      document.body.style.background = previousBodyBackground;
      document.documentElement.style.background = previousHtmlBackground;
      if (root) {
        root.style.background = previousRootBackground;
      }
    };
  }, []);

  return (
    <div className="flex h-screen w-screen items-end justify-end bg-transparent p-4 text-white">
      <div className="relative w-[390px] rounded-[24px] border border-white/10 bg-slate-950/92 p-3 shadow-[0_24px_90px_rgba(0,0,0,0.48)] backdrop-blur-2xl">
        <button
          type="button"
          onClick={() => void onCancel()}
          className="absolute -right-3 -top-3 flex size-9 items-center justify-center rounded-full border border-white/10 bg-slate-900/95 text-white/80 shadow-[0_10px_25px_rgba(0,0,0,0.45)] transition hover:bg-slate-800"
          aria-label="Close"
        >
          ×
        </button>

        <div className="grid grid-cols-3 gap-3 rounded-[20px] border border-white/10 bg-white/5 p-2">
          <DockTile active={mode === 'Selection'} icon="▢" label="Selection" onClick={() => setMode('Selection')} />
          <DockTile active={mode === 'Screen'} icon="▭" label="Screen" onClick={() => setMode('Screen')} />
          <DockTile active={mode === 'Window'} icon="▦" label="Window" onClick={() => setMode('Window')} />
        </div>

        <div className="mt-3 rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
          Choose the capture mode, then start selection when you are ready.
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void onCancel()}
            className="h-11 flex-1 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-medium text-white/85 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onStartSelection()}
            className="h-11 flex-1 rounded-full bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            Start Selection
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function DockTile({
  active,
  icon,
  label,
  onClick
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-2 rounded-[18px] px-3 py-4 text-xs font-medium transition ${
        active ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
      }`}
    >
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full border text-lg ${
          active ? 'border-cyan-400 bg-slate-200 text-slate-950' : 'border-white/10 bg-white/5 text-slate-300'
        }`}
      >
        {icon}
      </div>
      <div>{label}</div>
    </button>
  );
}
