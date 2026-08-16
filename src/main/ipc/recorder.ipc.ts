import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
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
