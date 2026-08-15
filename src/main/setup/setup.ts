import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { isFfmpegAvailable, refreshFfmpegPathEnv, runProcess } from '../ffmpeg/ffmpeg';
import { getCurrentRecorderBackend } from '../recorder/recorder-backend';

const platformExecutableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const electronApp = (() => {
  try {
    // This module can be required in a plain Node process during first-run validation.
    // In that case Electron is not running yet, so we must fall back to user-home paths.
    return require('electron').app as { getPath?: (name: string) => string } | undefined;
  } catch {
    return undefined;
  }
})();

function getAppPath(name: 'userData' | 'videos' | 'home' | 'temp' | 'cache'): string {
  if (electronApp && typeof electronApp.getPath === 'function') {
    return electronApp.getPath(name);
  }

  if (name === 'videos') {
    return path.join(os.homedir(), 'Videos');
  }

  if (name === 'userData') {
    return path.join(os.homedir(), '.loomly');
  }

  if (name === 'temp') {
    return os.tmpdir();
  }

  if (name === 'cache') {
    return path.join(os.homedir(), '.loomly', 'cache');
  }

  return os.homedir();
}

const setupStateFile = path.join(getAppPath('userData'), 'loomly-setup.json');

export interface SetupCheckResult {
  ready: boolean;
  setupComplete: boolean;
  platformSupported: boolean;
  ffmpegAvailable: boolean;
  ffmpegBundleReady: boolean;
  requiresDownload: boolean;
  outputDirectory: string;
  missing: string[];
}

export function getSetupStateFile(): string {
  return setupStateFile;
}

export async function isSetupComplete(): Promise<boolean> {
  try {
    const raw = await fs.readFile(setupStateFile, 'utf8');
    const parsed = JSON.parse(raw) as { complete?: boolean };
    return Boolean(parsed.complete);
  } catch {
    return false;
  }
}

export async function markSetupComplete(): Promise<void> {
  await fs.mkdir(path.dirname(setupStateFile), { recursive: true });
  await fs.writeFile(setupStateFile, JSON.stringify({ complete: true }, null, 2), 'utf8');
}

export function getUserFfmpegInstallDirectory(): string {
  return path.join(os.homedir(), 'ffmpeg');
}

export function getUserFfmpegExecutable(): string {
  return path.join(getUserFfmpegInstallDirectory(), 'bin', platformExecutableName);
}

export function getUserFfmpegBinDirectory(): string {
  return path.join(getUserFfmpegInstallDirectory(), 'bin');
}

export async function bundledFfmpegExists(): Promise<boolean> {
  const userExecutable = getUserFfmpegExecutable();

  try {
    await fs.access(userExecutable);
    return true;
  } catch {
    return false;
  }
}

export async function checkSetupRequirements(): Promise<SetupCheckResult> {
  const backend = await getCurrentRecorderBackend();
  const compatibilityError = await backend.getCompatibilityError();
  const ffmpegInstalled = await isFfmpegAvailable();
  const ffmpegBundleReady = await bundledFfmpegExists();
  const platformSupported = compatibilityError === null;
  const ffmpegAvailable = ffmpegInstalled || ffmpegBundleReady;
  const setupComplete = await isSetupComplete();
  const ready = platformSupported && ffmpegAvailable;
  const missing: string[] = [];

  if (!platformSupported) {
    missing.push(compatibilityError ?? 'This platform is not supported.');
  }

  if (!ffmpegAvailable) {
    missing.push('FFmpeg is missing. Download the FFmpeg bundle to continue.');
  }

  if (!setupComplete) {
    missing.push('Complete the one-time setup to launch the recorder.');
  }

  const outputDirectory = path.join(getAppPath('videos'), 'Local Zoom');

  return {
    ready,
    setupComplete,
    platformSupported,
    ffmpegAvailable,
    ffmpegBundleReady,
    requiresDownload: !ffmpegAvailable,
    outputDirectory,
    missing
  };
}

function getDownloadUrl(): string | null {
  if (process.platform === 'win32') {
    return 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  }

  if (process.platform === 'darwin') {
    return 'https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip';
  }

  if (process.platform === 'linux') {
    return 'https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz';
  }

  return null;
}

async function downloadFileToPath(url: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirected = response.headers.location;
        https.get(redirected, (redirectedResponse) => {
          const file = require('node:fs').createWriteStream(destination);
          redirectedResponse.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', reject);
          redirectedResponse.on('error', reject);
        }).on('error', reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode ?? 'unknown'}.`));
        return;
      }

      const file = require('node:fs').createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
      response.on('error', reject);
    });

    request.on('error', reject);
  });
}

async function installWindowsUserFfmpeg(): Promise<boolean> {
  const installRoot = getUserFfmpegInstallDirectory();
  const binDir = getUserFfmpegBinDirectory();
  const installPath = path.join(installRoot, 'bin', 'ffmpeg.exe');
  const zipUrl = getDownloadUrl();

  if (!zipUrl) {
    return false;
  }

  try {
    await fs.access(installPath);
    refreshFfmpegPathEnv();
    return true;
  } catch {
    // continue with install flow
  }

  const tmpZipPath = path.join(os.tmpdir(), 'ffmpeg-user-install.zip');
  await fs.mkdir(installRoot, { recursive: true });
  await downloadFileToPath(zipUrl, tmpZipPath);

  const powerShellCommand = `
    $ErrorActionPreference = 'Stop';
    Expand-Archive -LiteralPath '${tmpZipPath}' -DestinationPath '${installRoot}' -Force;
    $ffmpeg = Get-ChildItem -Path '${installRoot}' -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1;
    if (-not $ffmpeg) { throw 'ffmpeg.exe was not found after extraction.' };
    New-Item -ItemType Directory -Force -Path '${binDir}' | Out-Null;
    Copy-Item $ffmpeg.FullName '${installPath}' -Force;
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User');
    $existingEntries = @();
    if ($userPath) { $existingEntries = @($userPath -split ';' | Where-Object { $_ -and $_ -ne '${binDir}' }); }
    $entries = @('${binDir}') + $existingEntries | Where-Object { $_ } | Select-Object -Unique;
    $newUserPath = ($entries -join ';');
    [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User');
    $env:Path = '${binDir};' + $env:Path;
    Write-Output '${installPath}';
  `;

  await runProcess('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powerShellCommand]);

  try {
    await fs.access(installPath);
    refreshFfmpegPathEnv();
    return true;
  } catch {
    return false;
  }
}

export async function downloadFfmpegBundle(): Promise<boolean> {
  const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

  if (process.platform === 'win32') {
    return installWindowsUserFfmpeg();
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    const macLinuxInstallPath = path.join(os.homedir(), 'ffmpeg', 'bin', ffmpegBinaryName);
    try {
      await fs.access(macLinuxInstallPath);
      return true;
    } catch {
      const url = getDownloadUrl();
      if (!url) {
        return false;
      }

      const installRoot = getUserFfmpegInstallDirectory();
      const binDir = getUserFfmpegBinDirectory();
      const tmpZipPath = path.join(os.tmpdir(), 'ffmpeg-user-install.zip');
      await fs.mkdir(installRoot, { recursive: true });
      await downloadFileToPath(url, tmpZipPath);
      await runProcess(process.platform === 'darwin' ? 'unzip' : 'tar', process.platform === 'darwin' ? ['-o', tmpZipPath, '-d', installRoot] : ['-xf', tmpZipPath, '-C', installRoot]);
      const extractedBinary = path.join(installRoot, 'bin', platformExecutableName);
      await fs.mkdir(binDir, { recursive: true });
      await fs.copyFile(extractedBinary, macLinuxInstallPath);
      process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
      return true;
    }
  }

  return false;
}
