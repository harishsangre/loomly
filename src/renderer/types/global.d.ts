import type { MicrophoneDevice, RecorderOptions, RecorderStatus, Region } from '../../shared/recorder';

declare global {
  interface Window {
    recorder: {
      getStatus: () => Promise<RecorderStatus>;
      getMicrophones: () => Promise<MicrophoneDevice[]>;
      readRecording: (filePath: string) => Promise<ArrayBuffer>;
      getRecordingThumbnail: (filePath: string) => Promise<string>;
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
