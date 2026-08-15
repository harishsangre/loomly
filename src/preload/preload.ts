import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureDevices, RecorderOptions, RecorderStatus, Region, MicrophoneDevice } from '../shared/recorder';

const recorderApi = {
  getSetupStatus: (): Promise<{
    ready: boolean;
    setupComplete: boolean;
    platformSupported: boolean;
    ffmpegAvailable: boolean;
    ffmpegBundleReady: boolean;
    requiresDownload: boolean;
    outputDirectory: string;
    missing: string[];
  }> => ipcRenderer.invoke('app:get-setup-status'),
  downloadFfmpegBundle: (): Promise<boolean> => ipcRenderer.invoke('app:download-ffmpeg-bundle'),
  completeSetup: (): Promise<boolean> => ipcRenderer.invoke('app:complete-setup'),
  getStatus: (): Promise<RecorderStatus> => ipcRenderer.invoke('recorder:get-status'),
  getMicrophones: (): Promise<MicrophoneDevice[]> => ipcRenderer.invoke('recorder:get-microphones'),
  getCaptureDevices: (): Promise<CaptureDevices> => ipcRenderer.invoke('recorder:get-capture-devices'),
  selectOutputDirectory: (currentDirectory: string): Promise<string | null> =>
    ipcRenderer.invoke('recorder:select-output-directory', currentDirectory),
  readRecording: (filePath: string): Promise<ArrayBuffer> => ipcRenderer.invoke('recorder:read-recording', filePath),
  getRecordingThumbnail: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('recorder:get-recording-thumbnail', filePath),
  start: (options: RecorderOptions): Promise<RecorderStatus> => ipcRenderer.invoke('recorder:start', options),
  pause: (): Promise<RecorderStatus> => ipcRenderer.invoke('recorder:pause'),
  resume: (): Promise<RecorderStatus> => ipcRenderer.invoke('recorder:resume'),
  stop: (): Promise<RecorderStatus> => ipcRenderer.invoke('recorder:stop'),
  discard: (): Promise<RecorderStatus> => ipcRenderer.invoke('recorder:discard'),
  selectRegion: (): Promise<Region | null> => ipcRenderer.invoke('recorder:select-region'),
  getRegionBackground: (): Promise<string | null> => ipcRenderer.invoke('recorder:get-region-background'),
  startRegionSelection: (): Promise<boolean> => ipcRenderer.invoke('recorder:start-region-selection'),
  submitRegionSelection: (region: Region): Promise<Region> =>
    ipcRenderer.invoke('recorder:submit-region-selection', region),
  cancelRegionSelection: (): Promise<boolean> => ipcRenderer.invoke('recorder:cancel-region-selection'),
  minimize: (): Promise<boolean> => ipcRenderer.invoke('app:minimize'),
  onStatusUpdated: (callback: (status: RecorderStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: RecorderStatus) => callback(status);
    ipcRenderer.on('recorder:status-updated', listener);
    return () => ipcRenderer.removeListener('recorder:status-updated', listener);
  }
};

contextBridge.exposeInMainWorld('recorder', recorderApi);
