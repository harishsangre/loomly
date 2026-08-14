import type { RecordingState } from '@/shared/recorder';

function formatTime(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function RecordingTimer({ elapsedMs, state }: { elapsedMs: number; state: RecordingState }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-center">
      <div
        className={`text-4xl font-semibold tracking-tight ${
          state === 'recording' ? 'text-cyan-300' : state === 'paused' ? 'text-amber-200' : 'text-white'
        }`}
      >
        {formatTime(elapsedMs)}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.28em] text-slate-400">
        {state === 'recording' ? 'Recording Time' : state === 'paused' ? 'Paused' : 'Ready'}
      </div>
    </div>
  );
}
