import type { MicrophoneDevice } from '@/shared/recorder';

export function MicrophoneSelector({
  devices,
  value,
  onChange
}: {
  devices: MicrophoneDevice[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-3">
      <select
        className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-violet-400/50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.label}
          </option>
        ))}
      </select>
    </div>
  );
}
