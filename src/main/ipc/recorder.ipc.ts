import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { RecorderOptions, Region, RecorderStatus } from '../../shared/recorder';
import { getResolvedFfmpegCommand, runProcess } from '../ffmpeg/ffmpeg';
import { getCaptureDevices } from '../ffmpeg/devices';
import { RecorderService } from '../recorder/recorder.service';

const execFileAsync = promisify(execFile);

interface RegionSelectorState {
  overlayWindow: BrowserWindow | null;
  resolve: ((region: Region | null) => void) | null;
  backgroundDataUrl: string | null;
}

function createRegionSelectorOverlayWindow(bounds: { x: number; y: number; width: number; height: number }): BrowserWindow {
  const preloadPath = path.join(__dirname, '..', '..', 'preload', 'preload.js');
  const rendererUrl = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}/?mode=region-selector-overlay&screenX=${bounds.x}&screenY=${bounds.y}&screenWidth=${bounds.width}&screenHeight=${bounds.height}`
    : `${pathToFileURL(path.join(__dirname, '..', '..', 'renderer', 'index.html')).toString()}?mode=region-selector-overlay&screenX=${bounds.x}&screenY=${bounds.y}&screenWidth=${bounds.width}&screenHeight=${bounds.height}`;

  const regionWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    fullscreen: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    backgroundColor: '#111827',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  regionWindow.loadURL(rendererUrl);
  regionWindow.once('ready-to-show', () => {
    regionWindow.show();
    regionWindow.moveTop();
    regionWindow.focus();
    app.focus({ steal: true });
  });
  return regionWindow;
}

async function captureDisplay(display: Electron.Display): Promise<string | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: display.bounds.width,
      height: display.bounds.height
    }
  });
  const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;

  return source.thumbnail
    .resize({ width: display.bounds.width, height: display.bounds.height, quality: 'best' })
    .toDataURL();
}

function thumbnailPathFor(videoPath: string): string {
  const parsed = path.parse(videoPath);
  return path.join(parsed.dir, `${parsed.name}.thumbnail.jpg`);
}

function captionsPathFor(videoPath: string): string {
  const parsed = path.parse(videoPath);
  return path.join(parsed.dir, `${parsed.name}.vtt`);
}

function getWhisperExecutableName(): string {
  return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
}

function getWhisperResourceRoots(): string[] {
  const roots = [
    path.join(process.resourcesPath ?? '', 'whisper'),
    path.join(process.cwd(), 'resources', 'whisper'),
    path.join(os.homedir(), '.loomly', 'whisper')
  ];

  return [...new Set(roots.filter(Boolean))];
}

function getUserWhisperRoot(): string {
  return path.join(os.homedir(), '.loomly', 'whisper');
}

function getWhisperPlatformDir(): 'win' | 'linux' | 'mac' {
  return process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
}

function getWhisperModelDownloadUrl(): string {
  return 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin';
}

function getWhisperReleasePlatformTerms(): string[] {
  if (process.platform === 'win32') return ['win', 'windows'];
  if (process.platform === 'darwin') return ['mac', 'macos', 'darwin'];
  return ['linux'];
}

function getWhisperReleaseArchTerms(): string[] {
  if (process.arch === 'arm64') return ['arm64', 'aarch64'];
  return ['x64', 'x86_64', 'amd64'];
}

async function downloadUrlToPath(url: string, destination: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Local-Zoom'
    }
  });

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}.`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(entryPath);
      }
      return [entryPath];
    })
  );

  return nested.flat();
}

async function findWhisperReleaseAssetUrl(): Promise<string> {
  const response = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest', {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Local-Zoom'
    }
  });

  if (!response.ok) {
    throw new Error(`Could not check whisper.cpp releases. GitHub returned ${response.status}.`);
  }

  const release = await response.json() as {
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const platformTerms = getWhisperReleasePlatformTerms();
  const archTerms = getWhisperReleaseArchTerms();
  const archiveExtensions = process.platform === 'win32' ? ['.zip'] : ['.zip', '.tar.gz', '.tgz'];
  const asset = release.assets
    ?.filter((candidate) => candidate.name && candidate.browser_download_url)
    .map((candidate) => ({ ...candidate, normalizedName: candidate.name!.toLowerCase() }))
    .find((candidate) =>
      archiveExtensions.some((extension) => candidate.normalizedName.endsWith(extension)) &&
      platformTerms.some((term) => candidate.normalizedName.includes(term)) &&
      archTerms.some((term) => candidate.normalizedName.includes(term)) &&
      !candidate.normalizedName.includes('server')
    );

  if (!asset?.browser_download_url) {
    throw new Error('No compatible whisper.cpp release asset was found for this system.');
  }

  return asset.browser_download_url;
}

async function extractWhisperArchive(archivePath: string, destination: string): Promise<void> {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });

  if (archivePath.toLowerCase().endsWith('.zip')) {
    if (process.platform === 'win32') {
      await execFileAsync('powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`
      ]);
      return;
    }

    await execFileAsync('unzip', ['-o', archivePath, '-d', destination]);
    return;
  }

  await execFileAsync('tar', ['-xf', archivePath, '-C', destination]);
}

async function installWhisperRuntime(): Promise<void> {
  const root = getUserWhisperRoot();
  const platformDir = getWhisperPlatformDir();
  const binDir = path.join(root, platformDir);
  const modelDir = path.join(root, 'models');
  const executableName = getWhisperExecutableName();
  const executablePath = path.join(binDir, executableName);
  const modelPath = path.join(modelDir, 'ggml-base.en-q5_1.bin');

  try {
    await fs.access(executablePath);
  } catch {
    const assetUrl = await findWhisperReleaseAssetUrl();
    const archiveName = new URL(assetUrl).pathname.split('/').pop() ?? 'whisper-runtime.zip';
    const archivePath = path.join(os.tmpdir(), archiveName);
    const extractDir = path.join(os.tmpdir(), `local-zoom-whisper-${Date.now()}`);

    await downloadUrlToPath(assetUrl, archivePath);
    await extractWhisperArchive(archivePath, extractDir);

    const extractedFiles = await listFilesRecursive(extractDir);
    const extractedExecutable = extractedFiles.find((file) => path.basename(file).toLowerCase() === executableName.toLowerCase());
    if (!extractedExecutable) {
      throw new Error(`${executableName} was not found in the downloaded whisper.cpp archive.`);
    }

    await fs.mkdir(binDir, { recursive: true });
    await fs.copyFile(extractedExecutable, executablePath);
    if (process.platform !== 'win32') {
      await fs.chmod(executablePath, 0o755).catch(() => undefined);
    }
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
  }

  try {
    await fs.access(modelPath);
  } catch {
    await downloadUrlToPath(getWhisperModelDownloadUrl(), modelPath);
  }
}

async function findFirstExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep checking other candidates
    }
  }

  return null;
}

async function resolveWhisperRuntime(): Promise<{ executable: string; model: string }> {
  const executableName = getWhisperExecutableName();
  const platformDir = getWhisperPlatformDir();
  const roots = getWhisperResourceRoots();
  const executable = await findFirstExistingPath([
    ...roots.map((root) => path.join(root, platformDir, executableName)),
    ...roots.map((root) => path.join(root, 'bin', executableName)),
    ...roots.map((root) => path.join(root, executableName))
  ]);
  const model = await findFirstExistingPath([
    ...roots.map((root) => path.join(root, 'models', 'ggml-base.en-q5_1.bin')),
    ...roots.map((root) => path.join(root, 'models', 'ggml-base.en-q5_0.bin')),
    ...roots.map((root) => path.join(root, 'models', 'ggml-base.en.bin')),
    ...roots.map((root) => path.join(root, 'models', 'ggml-small.en-q5_0.bin')),
    ...roots.map((root) => path.join(root, 'models', 'ggml-small.en.bin'))
  ]);

  if (!executable) {
    throw new Error(`whisper.cpp is missing. Add ${executableName} under resources/whisper/${platformDir}/ or ~/.loomly/whisper/${platformDir}/.`);
  }

  if (!model) {
    throw new Error('Whisper model is missing. Add ggml-base.en-q5_0.bin under resources/whisper/models/ or ~/.loomly/whisper/models/.');
  }

  return { executable, model };
}

async function getRecordingThumbnail(videoPath: string): Promise<string> {
  try {
    await fs.access(videoPath);
  } catch {
    return '';
  }

  const thumbnailPath = thumbnailPathFor(videoPath);
  const ffmpegCommand = getResolvedFfmpegCommand();

  try {
    await fs.access(thumbnailPath);
  } catch {
    try {
      await runProcess(ffmpegCommand.command, [
        '-y',
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '3',
        thumbnailPath
      ], { env: ffmpegCommand.env });
    } catch {
      return '';
    }
  }

  const thumbnail = await fs.readFile(thumbnailPath);
  return `data:image/jpeg;base64,${thumbnail.toString('base64')}`;
}

async function getRecordingDurationMs(videoPath: string): Promise<number> {
  try {
    await fs.access(videoPath);
  } catch {
    return 0;
  }

  const ffmpegCommand = getResolvedFfmpegCommand();
  const ffprobeDir = path.dirname(ffmpegCommand.command);
  const ffprobeCommand = process.platform === 'win32'
    ? path.join(ffprobeDir, 'ffprobe.exe')
    : path.join(ffprobeDir, 'ffprobe');
  const probePath = await fs.access(ffprobeCommand).then(() => ffprobeCommand).catch(() => process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

  try {
    const { stdout } = await execFileAsync(probePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      videoPath
    ], { env: ffmpegCommand.env });
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) ? Math.max(0, Math.round(duration * 1000)) : 0;
  } catch {
    return 0;
  }
}

async function generateRecordingCaptions(videoPath: string): Promise<string> {
  try {
    await fs.access(videoPath);
  } catch {
    throw new Error('Recording file was not found.');
  }

  let runtime: { executable: string; model: string };
  try {
    runtime = await resolveWhisperRuntime();
  } catch {
    try {
      await installWhisperRuntime();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not install whisper.cpp automatically. ${message}`);
    }
    runtime = await resolveWhisperRuntime();
  }

  const { executable, model } = runtime;
  const captionPath = captionsPathFor(videoPath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-zoom-captions-'));
  const audioPath = path.join(tempDir, 'audio.wav');
  const captionBasePath = path.join(tempDir, 'captions');
  const generatedCaptionPath = `${captionBasePath}.vtt`;
  const ffmpegCommand = getResolvedFfmpegCommand();

  try {
    await runProcess(ffmpegCommand.command, [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      audioPath
    ], { env: ffmpegCommand.env });

    await runProcess(executable, [
      '-m',
      model,
      '-f',
      audioPath,
      '-ovtt',
      '-of',
      captionBasePath
    ]);

    const captions = await fs.readFile(generatedCaptionPath, 'utf8');
    await fs.writeFile(captionPath, captions, 'utf8');
    return captions;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function registerRecorderIpc(args: {
  service: RecorderService;
  onStatus: (status: RecorderStatus) => void;
  onRegionSelectorOpen?: (open: boolean) => void | Promise<void>;
}): void {
  const selectorState: RegionSelectorState = {
    overlayWindow: null,
    resolve: null,
    backgroundDataUrl: null
  };

  ipcMain.handle('recorder:get-status', async () => {
    return args.service.getStatus();
  });

  ipcMain.handle('recorder:get-microphones', async () => {
    return args.service.getMicrophones();
  });

  ipcMain.handle('recorder:get-capture-devices', async () => getCaptureDevices());

  ipcMain.handle('recorder:select-output-directory', async (_event, currentDirectory?: string) => {
    const result = await dialog.showOpenDialog({
      defaultPath: currentDirectory,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('recorder:read-recording', async (_event, filePath: string) => {
    const data = await fs.readFile(filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  });

  ipcMain.handle('recorder:get-recording-thumbnail', async (_event, filePath: string) => {
    return getRecordingThumbnail(filePath);
  });

  ipcMain.handle('recorder:get-recording-duration', async (_event, filePath: string) => {
    return getRecordingDurationMs(filePath);
  });

  ipcMain.handle('recorder:get-recording-captions', async (_event, filePath: string) => {
    try {
      return await fs.readFile(captionsPathFor(filePath), 'utf8');
    } catch {
      return '';
    }
  });

  ipcMain.handle('recorder:generate-recording-captions', async (_event, filePath: string) => {
    return generateRecordingCaptions(filePath);
  });

  ipcMain.handle('recorder:recording-exists', async (_event, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('recorder:delete-recording', async (_event, filePath: string) => {
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      await fs.unlink(thumbnailPathFor(filePath)).catch(() => undefined);
      await fs.unlink(captionsPathFor(filePath)).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('recorder:start', async (_event, options: RecorderOptions) => {
    const status = await args.service.start(options);
    args.onStatus(status);
    return status;
  });

  ipcMain.handle('recorder:pause', async () => {
    const status = await args.service.pause();
    args.onStatus(status);
    return status;
  });

  ipcMain.handle('recorder:resume', async () => {
    const status = await args.service.resume();
    args.onStatus(status);
    return status;
  });

  ipcMain.handle('recorder:stop', async () => {
    const status = await args.service.stop();
    args.onStatus(status);
    return status;
  });

  ipcMain.handle('recorder:discard', async () => {
    const status = await args.service.discard();
    args.onStatus(status);
    return status;
  });

  ipcMain.handle('recorder:select-region', async () => {
    if (selectorState.overlayWindow) {
      selectorState.overlayWindow.focus();
      return new Promise<Region | null>((resolve) => {
        const previous = selectorState.resolve;
        selectorState.resolve = (region) => {
          previous?.(region);
          resolve(region);
        };
      });
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = display.bounds;
    await args.onRegionSelectorOpen?.(true);
    try {
      selectorState.backgroundDataUrl = await captureDisplay(display);
      if (!selectorState.backgroundDataUrl) {
        throw new Error('Could not capture the screen for region selection.');
      }
      selectorState.overlayWindow = createRegionSelectorOverlayWindow(bounds);
    } catch (error) {
      selectorState.backgroundDataUrl = null;
      await args.onRegionSelectorOpen?.(false);
      throw error;
    }
    selectorState.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    selectorState.overlayWindow.once('closed', () => {
      selectorState.overlayWindow = null;
      selectorState.backgroundDataUrl = null;
      const resolve = selectorState.resolve;
      selectorState.resolve = null;
      resolve?.(null);
      args.onRegionSelectorOpen?.(false);
    });

    return new Promise<Region | null>((resolve) => {
      selectorState.resolve = resolve;
    });
  });

  ipcMain.handle('recorder:get-region-background', async () => selectorState.backgroundDataUrl);

  ipcMain.handle('recorder:start-region-selection', async () => {
    if (selectorState.overlayWindow) {
      selectorState.overlayWindow.focus();
      return true;
    }
    return false;
  });

  ipcMain.handle('recorder:submit-region-selection', async (_event, region: Region) => {
    const resolve = selectorState.resolve;
    selectorState.resolve = null;
    if (selectorState.overlayWindow) {
      selectorState.overlayWindow.close();
      selectorState.overlayWindow = null;
    }
    resolve?.(region);
    args.onRegionSelectorOpen?.(false);
    return region;
  });

  ipcMain.handle('recorder:cancel-region-selection', async () => {
    const resolve = selectorState.resolve;
    selectorState.resolve = null;
    if (selectorState.overlayWindow) {
      selectorState.overlayWindow.close();
      selectorState.overlayWindow = null;
    }
    resolve?.(null);
    args.onRegionSelectorOpen?.(false);
    return true;
  });
}
