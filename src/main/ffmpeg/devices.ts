import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CaptureDevice, CaptureDevices, MicrophoneDevice } from '../../shared/recorder';
import { buildRecordingRoot } from '../recorder/linux-recorder';
import { getResolvedFfmpegCommand } from './ffmpeg';

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

async function getWindowsMicrophones(): Promise<MicrophoneDevice[]> {
  const base: MicrophoneDevice[] = [{ id: 'none', label: 'No microphone detected' }];

  try {
    const ffmpeg = getResolvedFfmpegCommand();
    const { stdout, stderr } = await execFileAsync(ffmpeg.command, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
      env: ffmpeg.env,
      timeout: 20000
    });

    const output = `${stdout}\n${stderr}`;
    const seen = new Set<string>();
    for (const match of output.matchAll(/"([^"]+)"\s+\(audio\)/g)) {
      const label = match[1]?.trim();
      if (!label || seen.has(label)) {
        continue;
      }

      base.push({ id: label, label });
      seen.add(label);
    }
  } catch {
    // We intentionally do not invent a fake default microphone on Windows.
    // If FFmpeg cannot enumerate real mic names, we disable mic input instead of passing an invalid default source.
  }

  return base.length > 1 ? base : [{ id: 'none', label: 'No microphone detected' }];
}

export async function getMicrophones(): Promise<MicrophoneDevice[]> {
  if (process.platform === 'win32') {
    return getWindowsMicrophones();
  }

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
