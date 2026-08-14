export function StatusBanner({
  ffmpegMessage,
  error,
  environmentIssue
}: {
  ffmpegMessage: string | null;
  error: string | null;
  environmentIssue: string | null;
}) {
  const message = error ?? environmentIssue ?? ffmpegMessage;
  const tone =
    error || environmentIssue
      ? 'border-rose-400/20 bg-rose-500/10 text-rose-100'
      : ffmpegMessage
        ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
        : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100';

  return (
    <div className={`rounded-xl border p-3 text-sm leading-6 ${tone}`}>
      <div className="text-[11px] uppercase tracking-[0.24em] opacity-70">Status</div>
      <div className="mt-2 whitespace-pre-line">{message ?? 'Everything looks ready.'}</div>
    </div>
  );
}
