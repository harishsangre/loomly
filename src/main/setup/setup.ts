import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isFfmpegAvailable, refreshFfmpegPathEnv, runProcess } from '../ffmpeg/ffmpeg';
import { getCurrentRecorderBackend } from '../recorder/recorder-backend';

const execFileAsync = promisify(execFile);
const logSetup = (...args: unknown[]) => console.log('[setup]', ...args);

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
  logSetup('checking requirements');
  const backend = await getCurrentRecorderBackend();
  const compatibilityError = await backend.getCompatibilityError();
  const ffmpegInstalled = await isFfmpegAvailable();
  const ffmpegBundleReady = await bundledFfmpegExists();
  const platformSupported = compatibilityError === null;
  const ffmpegAvailable = ffmpegInstalled || ffmpegBundleReady;
  const setupComplete = (await isSetupComplete()) || ffmpegAvailable;
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

  const result = {
    ready,
    setupComplete,
    platformSupported,
    ffmpegAvailable,
    ffmpegBundleReady,
    requiresDownload: !ffmpegAvailable,
    outputDirectory,
    missing
  };

  logSetup('requirements result', result);
  return result;
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

async function downloadFileToPath(
  url: string,
  destination: string,
  onProgress?: (progress: number, stage: string) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    logSetup('starting download', { url, destination });
    const request = https.get(url, { timeout: 300000 }, (response) => {
      const totalBytes = Number(response.headers['content-length'] ?? '0');
      let downloadedBytes = 0;

      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirected = response.headers.location;
        logSetup('redirecting download', { redirected });
        https.get(redirected, { timeout: 300000 }, (redirectedResponse) => {
          if (redirectedResponse.statusCode !== 200) {
            reject(new Error(`Download failed with status ${redirectedResponse.statusCode ?? 'unknown'}.`));
            return;
          }

          const file = require('node:fs').createWriteStream(destination);
          redirectedResponse.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
              const percent = Math.min(82, Math.round((downloadedBytes / totalBytes) * 82));
              onProgress?.(percent, 'Downloading FFmpeg');
              if (downloadedBytes % (1024 * 1024) === 0) {
                logSetup('download progress', { downloadedBytes, totalBytes, percent });
              }
            }
          });
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
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = Math.min(82, Math.round((downloadedBytes / totalBytes) * 82));
          onProgress?.(percent, 'Downloading FFmpeg');
          if (downloadedBytes % (1024 * 1024) === 0) {
            logSetup('download progress', { downloadedBytes, totalBytes, percent });
          }
        }
      });
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
      response.on('error', reject);
    });

    request.on('timeout', () => {
      request.destroy(new Error('FFmpeg download timed out.'));
    });
    request.on('error', reject);
  });
}

async function findExistingFfmpegBinary(): Promise<string | null> {
  const candidates = [
    path.join(os.homedir(), 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(os.homedir(), 'ffmpeg', 'bin', 'ffmpeg'),
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'ffmpeg', 'bin', 'ffmpeg.exe')
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep checking other candidates
    }
  }

  try {
    const { stdout } = await execFileAsync('where', ['ffmpeg'], { timeout: 8000 });
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first) {
      return first;
    }
  } catch {
    // no global ffmpeg in PATH
  }

  return null;
}

async function installWindowsUserFfmpeg(onProgress?: InstallProgressCallback): Promise<boolean> {
  const installRoot = getUserFfmpegInstallDirectory();
  const binDir = getUserFfmpegBinDirectory();
  const installPath = path.join(installRoot, 'bin', 'ffmpeg.exe');
  const zipUrl = getDownloadUrl();

  logSetup('starting Windows install flow');
  const existingBinary = await findExistingFfmpegBinary();
  if (existingBinary) {
    logSetup('found existing ffmpeg binary', existingBinary);
    onProgress?.(35, 'Checking existing install');
    if (existingBinary !== installPath) {
      await fs.mkdir(binDir, { recursive: true });
      try {
        await fs.copyFile(existingBinary, installPath);
      } catch {
        // best-effort copy to user-level install path
      }
    }
    refreshFfmpegPathEnv();
    return true;
  }

  if (!zipUrl) {
    logSetup('no ffmpeg download URL available for this platform');
    return false;
  }

  const tmpZipPath = path.join(os.tmpdir(), 'ffmpeg-user-install.zip');
  await fs.mkdir(installRoot, { recursive: true });

  try {
    await fs.rm(tmpZipPath, { force: true });
  } catch {
    // best effort
  }

  try {
    onProgress?.(5, 'Starting download');
    logSetup('downloading ffmpeg zip', { zipUrl, tmpZipPath });
    await downloadFileToPath(zipUrl, tmpZipPath, onProgress);
    logSetup('ffmpeg zip download completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown network error';
    logSetup('ffmpeg zip download failed', message);
    onProgress?.(0, 'Download timed out');
    throw new Error(`FFmpeg download failed: ${message}. Please check your internet connection and try again.`);
  }

  onProgress?.(85, 'Extracting binaries');
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
    onProgress?.(92, 'Updating PATH');
    logSetup('Windows FFmpeg install complete', { installPath });
    refreshFfmpegPathEnv();
    return true;
  } catch (error) {
    logSetup('Windows FFmpeg install verification failed', error);
    return false;
  }
}

type InstallProgressCallback = (progress: number, stage: string) => void;

export async function downloadFfmpegBundle(onProgress?: InstallProgressCallback): Promise<boolean> {
  const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

  const finalizeSuccess = async (): Promise<boolean> => {
    logSetup('finalizing ffmpeg installation');
    onProgress?.(95, 'Finalizing installation');
    refreshFfmpegPathEnv();
    try {
      await markSetupComplete();
      logSetup('setup mark complete saved');
    } catch (error) {
      logSetup('setup mark complete failed', error);
    }
    onProgress?.(100, 'Ready');
    return true;
  };

  if (process.platform === 'win32') {
    logSetup('starting Windows FFmpeg install');
    const installed = await installWindowsUserFfmpeg(onProgress);
    if (!installed) {
      logSetup('Windows FFmpeg install returned false');
      return false;
    }
    return finalizeSuccess();
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    const macLinuxInstallPath = path.join(os.homedir(), 'ffmpeg', 'bin', ffmpegBinaryName);
    try {
      await fs.access(macLinuxInstallPath);
      return finalizeSuccess();
    } catch {
      const url = getDownloadUrl();
      if (!url) {
        return false;
      }

      const installRoot = getUserFfmpegInstallDirectory();
      const binDir = getUserFfmpegBinDirectory();
      const tmpZipPath = path.join(os.tmpdir(), 'ffmpeg-user-install.zip');
      await fs.mkdir(installRoot, { recursive: true });
      onProgress?.(5, 'Starting download');
      await downloadFileToPath(url, tmpZipPath, onProgress);
      onProgress?.(78, 'Extracting files');
      await runProcess(process.platform === 'darwin' ? 'unzip' : 'tar', process.platform === 'darwin' ? ['-o', tmpZipPath, '-d', installRoot] : ['-xf', tmpZipPath, '-C', installRoot]);
      const extractedBinary = path.join(installRoot, 'bin', platformExecutableName);
      await fs.mkdir(binDir, { recursive: true });
      await fs.copyFile(extractedBinary, macLinuxInstallPath);
      process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
      return finalizeSuccess();
    }
  }

  return false;
}
