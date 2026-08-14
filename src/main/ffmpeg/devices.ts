import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MicrophoneDevice } from '../../shared/recorder';

const execFileAsync = promisify(execFile);

async function getDefaultSourceId(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('pactl', ['info']);
    const match = stdout.match(/^Default Source:\s*(.+)$/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function getMicrophones(): Promise<MicrophoneDevice[]> {
  const defaultSourceId = await getDefaultSourceId();
  const base: MicrophoneDevice[] = [{ id: defaultSourceId ?? 'default', label: 'Default Microphone' }];

  try {
    const { stdout } = await execFileAsync('pactl', ['list', 'short', 'sources']);
    const sources = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[1])
      .filter((id): id is string => Boolean(id))
      .filter((id) => !id.endsWith('.monitor'));

    const seen = new Set(base.map((device) => device.id));
    for (const id of sources) {
      if (!seen.has(id)) {
        base.push({ id, label: id });
        seen.add(id);
      }
    }
  } catch {
    // PulseAudio/PipeWire tooling is optional at startup; the UI will surface the issue
    // if recording is attempted without usable input devices.
  }

  return base;
}
