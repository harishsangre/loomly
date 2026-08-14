export function VideoPreview({ src }: { src: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-[0_20px_50px_rgba(15,23,42,0.28)]">
      <video
        className="block aspect-video w-full bg-black object-contain"
        src={src}
        controls
        preload="metadata"
        playsInline
      />
    </div>
  );
}
