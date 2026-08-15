import { app, BrowserWindow, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RecorderService } from './recorder/recorder.service';
import { registerRecorderIpc } from './ipc/recorder.ipc';
import type { RecorderStatus } from '../shared/recorder';
import { getCurrentRecorderBackend } from './recorder/recorder-backend';
import { checkSetupRequirements, downloadFfmpegBundle, markSetupComplete } from './setup/setup';

let mainWindow: BrowserWindow | null = null;
let recordingToolbarWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');
  const rendererUrl = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}/`
    : pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).toString();

  const win = new BrowserWindow({
    fullscreen: true,
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    title: 'Simple Recorder',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(rendererUrl);
  return win;
}

function createRecordingToolbarWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');
  const width = 560;
  const height = 96;
  const bounds = screen.getPrimaryDisplay().workArea;
  const x = Math.round(bounds.x + bounds.width / 2 - width / 2);
  const y = Math.round(bounds.y + bounds.height - height - 24);
  const rendererUrl = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}/?mode=recording-toolbar`
    : `${pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).toString()}?mode=recording-toolbar`;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(rendererUrl);
  win.setAlwaysOnTop(true, 'screen-saver');
  return win;
}

async function wireMainWindow(win: BrowserWindow, service: RecorderService): Promise<void> {
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  win.webContents.on('did-finish-load', async () => {
    const status = await service.getStatus();
    win.webContents.send('recorder:status-updated', status);
  });
}

function updateRecordingChrome(status: RecorderStatus): void {
  const shouldShowToolbar = status.state === 'recording' || status.state === 'paused' || status.state === 'processing';

  if (shouldShowToolbar) {
    if (!recordingToolbarWindow || recordingToolbarWindow.isDestroyed()) {
      recordingToolbarWindow = createRecordingToolbarWindow();
    }
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.minimize();
    }
    recordingToolbarWindow?.show();
    recordingToolbarWindow?.focus();
    return;
  }

  if (recordingToolbarWindow && !recordingToolbarWindow.isDestroyed()) {
    recordingToolbarWindow.close();
  }
  recordingToolbarWindow = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.restore();
    mainWindow.setFullScreen(true);
    mainWindow.focus();
  }
}

async function bootstrap(): Promise<void> {
  const appDataRoot = path.join(process.env.LOCALAPPDATA ?? app.getPath('appData'), 'Simple Recorder');
  const appDataDir = path.join(appDataRoot, 'AppData');
  const cacheDir = path.join(appDataRoot, 'Cache');
  const tempDir = path.join(appDataRoot, 'Temp');

  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  app.commandLine.appendSwitch('media-cache-dir', path.join(appDataRoot, 'MediaCache'));
  app.setPath('userData', appDataDir);
  app.setPath('cache', cacheDir);
  app.setPath('temp', tempDir);

  await app.whenReady();
  app.setName('Simple Recorder');

  const backend = await getCurrentRecorderBackend();
  const compatibilityError = await backend.getCompatibilityError();

  if (compatibilityError && !backend.enabled) {
    console.warn(`Recorder backend disabled for this platform: ${compatibilityError}`);
  }

  const service = new RecorderService((status: RecorderStatus) => {
    mainWindow?.webContents.send('recorder:status-updated', status);
    updateRecordingChrome(status);
  });

  registerRecorderIpc({
    service,
    onStatus: (status) => {
      mainWindow?.webContents.send('recorder:status-updated', status);
      updateRecordingChrome(status);
    },
    onRegionSelectorOpen: async (open) => {
      if (!mainWindow) return;
      if (open) {
        mainWindow.setFullScreen(false);
        mainWindow.setSkipTaskbar(true);
        mainWindow.setOpacity(0);
        mainWindow.setIgnoreMouseEvents(true);
        mainWindow.minimize();
        mainWindow.hide();
        // Let the compositor reveal the previous window before capturing it.
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      } else {
        mainWindow.setIgnoreMouseEvents(false);
        mainWindow.setOpacity(1);
        mainWindow.setSkipTaskbar(false);
        mainWindow.show();
        mainWindow.restore();
        mainWindow.setFullScreen(true);
        mainWindow.focus();
      }
    }
  });

  ipcMain.handle('app:get-setup-status', async () => checkSetupRequirements());
  ipcMain.handle('app:download-ffmpeg-bundle', async () => downloadFfmpegBundle());
  ipcMain.handle('app:complete-setup', async () => {
    await markSetupComplete();
    return true;
  });

  mainWindow = createMainWindow();
  await wireMainWindow(mainWindow, service);

  ipcMain.handle('app:minimize', async () => {
    mainWindow?.minimize();
    return true;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      void wireMainWindow(mainWindow, service);
    }
  });
}

void bootstrap();

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
