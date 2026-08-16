import type { CaptureDevices, MicrophoneDevice, RecorderOptions, RecorderStatus, Region } from '../../shared/recorder';

declare global {
  interface Window {
    recorder: {
      getSetupStatus: () => Promise<{
        ready: boolean;
        setupComplete: boolean;
        platformSupported: boolean;
        ffmpegAvailable: boolean;
        ffmpegBundleReady: boolean;
        requiresDownload: boolean;
        outputDirectory: string;
        missing: string[];
      }>;
      downloadFfmpegBundle: () => Promise<boolean>;
      completeSetup: () => Promise<boolean>;
      onFfmpegInstallProgress: (callback: (payload: { progress: number; stage: string }) => void) => () => void;
      getStatus: () => Promise<RecorderStatus>;
      getMicrophones: () => Promise<MicrophoneDevice[]>;
      getCaptureDevices: () => Promise<CaptureDevices>;
      selectOutputDirectory: (currentDirectory: string) => Promise<string | null>;
      readRecording: (filePath: string) => Promise<ArrayBuffer>;
      getRecordingThumbnail: (filePath: string) => Promise<string>;
      getRecordingDuration: (filePath: string) => Promise<number>;
      getRecordingCaptions: (filePath: string) => Promise<string>;
      generateRecordingCaptions: (filePath: string) => Promise<string>;
      recordingExists: (filePath: string) => Promise<boolean>;
      deleteRecording: (filePath: string) => Promise<boolean>;
      start: (options: RecorderOptions) => Promise<RecorderStatus>;
      pause: () => Promise<RecorderStatus>;
      resume: () => Promise<RecorderStatus>;
      stop: () => Promise<RecorderStatus>;
      discard: () => Promise<RecorderStatus>;
      selectRegion: () => Promise<Region | null>;
      getRegionBackground: () => Promise<string | null>;
      startRegionSelection: () => Promise<boolean>;
      submitRegionSelection: (region: Region) => Promise<Region>;
      cancelRegionSelection: () => Promise<boolean>;
      minimize: () => Promise<boolean>;
      onStatusUpdated: (callback: (status: RecorderStatus) => void) => () => void;
    };
  }
}

export {};
