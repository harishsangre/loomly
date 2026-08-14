export function AppHeader({ state }: { state: string }) {
  return (
    <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-slate-950/70 px-5 py-4 shadow-glow backdrop-blur-xl">
      <div>
        <div className="text-xl font-semibold tracking-tight">Simple Recorder</div>
        <div className="text-sm text-slate-400">Electron, React, FFmpeg, Linux X11 only</div>
      </div>
      <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
        {state === 'recording' ? 'Recording' : state === 'paused' ? 'Paused' : state === 'processing' ? 'Processing' : state === 'finished' ? 'Ready' : 'Idle'}
      </div>
    </header>
  );
}
