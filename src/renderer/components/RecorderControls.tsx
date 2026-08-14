import type { RecordingState } from '@/shared/recorder';

export function RecorderControls({
  state,
  canStart,
  canPause,
  canResume,
  canStop,
  onStart,
  onPause,
  onResume,
  onStop
}: {
  state: RecordingState;
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      {state === 'processing' ? (
        <button
          type="button"
          disabled
          className="w-full rounded-2xl border border-cyan-300/20 bg-cyan-500/15 px-4 py-3 text-sm font-medium text-cyan-100 opacity-70"
        >
          Processing...
        </button>
      ) : null}

      {canStart ? (
        <button
          type="button"
          onClick={onStart}
          className="w-full rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:brightness-110"
        >
          Start Recording
        </button>
      ) : null}

      {canPause ? (
        <button
          type="button"
          onClick={onPause}
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10"
        >
          Pause
        </button>
      ) : null}

      {canResume ? (
        <button
          type="button"
          onClick={onResume}
          className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
        >
          Resume
        </button>
      ) : null}

      {canStop ? (
        <button
          type="button"
          onClick={onStop}
          className="w-full rounded-2xl bg-gradient-to-r from-rose-500 to-red-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-500/20 transition hover:brightness-110"
        >
          Finish
        </button>
      ) : null}
    </div>
  );
}
