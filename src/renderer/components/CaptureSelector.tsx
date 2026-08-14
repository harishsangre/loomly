import type { CaptureMode } from '@/shared/recorder';

export function CaptureSelector({ value, onChange }: { value: CaptureMode; onChange: (value: CaptureMode) => void }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      <button
        type="button"
        onClick={() => onChange('fullscreen')}
        className={`rounded-2xl border p-4 text-left transition ${
          value === 'fullscreen'
            ? 'border-violet-300/50 bg-violet-500/15 shadow-[0_0_0_1px_rgba(167,139,250,0.22)]'
            : 'border-white/10 bg-slate-950/50 hover:bg-white/5'
        }`}
      >
        <div className="text-base font-medium">Full Screen</div>
        <div className="mt-1 text-sm text-slate-400">Capture the entire desktop.</div>
      </button>
      <button
        type="button"
        onClick={() => onChange('region')}
        className={`rounded-2xl border p-4 text-left transition ${
          value === 'region'
            ? 'border-cyan-300/50 bg-cyan-500/15 shadow-[0_0_0_1px_rgba(34,211,238,0.22)]'
            : 'border-white/10 bg-slate-950/50 hover:bg-white/5'
        }`}
      >
        <div className="text-base font-medium">Custom Area</div>
        <div className="mt-1 text-sm text-slate-400">Record only a selected rectangle.</div>
      </button>
    </div>
  );
}
