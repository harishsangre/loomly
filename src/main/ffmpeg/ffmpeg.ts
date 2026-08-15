import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

export function getUserFfmpegExecutable(): string {
  return path.join(os.homedir(), 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

function getSystemFfmpegCandidates(): string[] {
  const candidates = new Set<string>();
  const envPath = process.env.PATH ?? '';

  for (const dir of envPath.split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    const exe = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (exe) candidates.add(exe);
  }

  if (process.platform === 'win32') {
    candidates.add(path.join(os.homedir(), 'ffmpeg', 'bin', 'ffmpeg.exe'));
    candidates.add(path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe'));
    candidates.add(path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'ffmpeg', 'bin', 'ffmpeg.exe'));
    candidates.add(path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages', 'BtbN.FFmpeg', 'ffmpeg.exe'));
  }

  return [...candidates];
}

export function getResolvedFfmpegCommand(): { command: string; env: NodeJS.ProcessEnv } {
  const userExecutable = getUserFfmpegExecutable();
  const systemCandidates = getSystemFfmpegCandidates();
  const pathSeparator = process.platform === 'win32' ? ';' : ':';

  for (const candidate of [userExecutable, ...systemCandidates, 'ffmpeg']) {
    if (!candidate || candidate === 'ffmpeg' ? false : !fs.existsSync(candidate)) {
      continue;
    }

    const candidateDir = path.dirname(candidate);
    return {
      command: candidate,
      env: {
        ...process.env,
        PATH: `${candidateDir}${pathSeparator}${process.env.PATH ?? ''}`
      }
    };
  }

  return {
    command: 'ffmpeg',
    env: process.env
  };
}

export function refreshFfmpegPathEnv(): { command: string; env: NodeJS.ProcessEnv } {
  const resolved = getResolvedFfmpegCommand();
  process.env.PATH = resolved.env.PATH ?? process.env.PATH ?? '';
  return resolved;
}

export type SystemCompatibility = {
  platform: NodeJS.Platform;
  arch: string;
  sessionType: string | null;
  ffmpegAvailable: boolean;
  ffmpegVersion: string | null;
  reason: string | null;
  supported: boolean;
  windowsVersion: number | null;
};

export async function isFfmpegAvailable(): Promise<boolean> {
  const { command, env } = getResolvedFfmpegCommand();

  try {
    await execFileAsync(command, ['-version'], { env });
    return true;
  } catch {
    return false;
  }
}

export async function getSystemCompatibility(): Promise<SystemCompatibility> {
  const platform = process.platform;
  const arch = process.arch;
  const sessionType = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase() || null;
  const windowsVersion = platform === 'win32' ? Number.parseInt(os.release().split('.')[0] ?? '0', 10) || null : null;

  let ffmpegAvailable = false;
  let ffmpegVersion: string | null = null;
  let reason: string | null = null;

  try {
    const { command, env } = getResolvedFfmpegCommand();
    const { stdout } = await execFileAsync(command, ['-version'], { env });
    ffmpegAvailable = true;
    ffmpegVersion = stdout.split('\n')[0]?.trim() ?? null;
  } catch {
    ffmpegAvailable = false;
    reason = 'FFmpeg is required.\n\nUbuntu:\nsudo apt install ffmpeg\nWindows:\nInstall FFmpeg and add it to PATH.';
  }

  if (!ffmpegAvailable) {
    return {
      platform,
      arch,
      sessionType,
      ffmpegAvailable: false,
      ffmpegVersion: null,
      reason,
      supported: false,
      windowsVersion
    };
  }

  if (platform === 'win32') {
    if (!['x64', 'arm64'].includes(arch)) {
      return {
        platform,
        arch,
        sessionType,
        ffmpegAvailable: true,
        ffmpegVersion,
        reason: `This build supports Windows x64 and arm64 only. Detected architecture: ${arch}.`,
        supported: false,
        windowsVersion
      };
    }

    if (!windowsVersion || windowsVersion < 10) {
      return {
        platform,
        arch,
        sessionType,
        ffmpegAvailable: true,
        ffmpegVersion,
        reason: `Windows 10 or newer is required. Detected version: ${windowsVersion ?? 'unknown'}.`,
        supported: false,
        windowsVersion
      };
    }

    return {
      platform,
      arch,
      sessionType,
      ffmpegAvailable: true,
      ffmpegVersion,
      reason: null,
      supported: true,
      windowsVersion
    };
  }

  if (platform !== 'linux') {
    return {
      platform,
      arch,
      sessionType,
      ffmpegAvailable: true,
      ffmpegVersion,
      reason: `This build supports Linux and Windows only. Detected platform: ${platform}.`,
      supported: false,
      windowsVersion
    };
  }

  if (!['x64', 'arm64'].includes(arch)) {
    return {
      platform,
      arch,
      sessionType,
      ffmpegAvailable: true,
      ffmpegVersion,
      reason: `This build supports Linux x64 and arm64 only. Detected architecture: ${arch}.`,
      supported: false,
      windowsVersion
    };
  }

  if (sessionType === 'wayland') {
    return {
      platform,
      arch,
      sessionType,
      ffmpegAvailable: true,
      ffmpegVersion,
      reason: 'Wayland screen capture is not supported in this MVP.\nPlease login using an Xorg/X11 session.',
      supported: false,
      windowsVersion
    };
  }

  if (sessionType !== 'x11' && sessionType !== null) {
    return {
      platform,
      arch,
      sessionType,
      ffmpegAvailable: true,
      ffmpegVersion,
      reason: 'This MVP only supports X11 screen capture.',
      supported: false,
      windowsVersion
    };
  }

  return {
    platform,
    arch,
    sessionType,
    ffmpegAvailable: true,
    ffmpegVersion,
    reason: null,
    supported: true,
    windowsVersion
  };
}

export async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  const resolved = command === 'ffmpeg' ? getResolvedFfmpegCommand() : { command, env: options.env ?? process.env };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolved.command, args, {
      cwd: options.cwd,
      env: resolved.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

