import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CaptureDevice, CaptureDevices, MicrophoneDevice } from '../../shared/recorder';
import { buildRecordingRoot } from '../recorder/linux-recorder';

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

async function getSystemAudioDevices(): Promise<CaptureDevice[]> {
  const devices: CaptureDevice[] = [{ id: 'none', label: 'Not set' }];
  try {
    const { stdout } = await execFileAsync('pactl', ['list', 'short', 'sources']);
    for (const line of stdout.split('\n').map((value) => value.trim()).filter(Boolean)) {
      const id = line.split(/\s+/)[1];
      if (id?.endsWith('.monitor')) {
        devices.push({ id, label: id.replace(/\.monitor$/, '').replaceAll('_', ' ') });
      }
    }
  } catch {
    // PulseAudio/PipeWire may be unavailable until the desktop session is ready.
  }
  return devices;
}

async function getCameras(): Promise<CaptureDevice[]> {
  const devices: CaptureDevice[] = [{ id: 'none', label: 'Not set' }];
  try {
    const entries = await fs.readdir('/dev');
    for (const entry of entries.filter((name) => /^video\d+$/.test(name)).sort()) {
      const id = path.join('/dev', entry);
      let label = entry;
      try {
        label = (await fs.readFile(path.join('/sys/class/video4linux', entry, 'name'), 'utf8')).trim() || entry;
      } catch {
        // The device path is still usable when sysfs does not expose a friendly name.
      }
      devices.push({ id, label });
    }
  } catch {
    // Systems without V4L2 devices simply keep the Not set option.
  }
  return devices;
}

export async function getCaptureDevices(): Promise<CaptureDevices> {
  const [systemAudio, cameras] = await Promise.all([getSystemAudioDevices(), getCameras()]);
  return {
    systemAudio,
    cameras,
    defaultOutputDirectory: buildRecordingRoot()
  };
}
