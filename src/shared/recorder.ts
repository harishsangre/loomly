export type RecordingState = 'idle' | 'recording' | 'paused' | 'processing' | 'finished';
export type CaptureMode = 'fullscreen' | 'region';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecorderOptions {
  captureMode: CaptureMode;
  microphone: string;
  region?: Region;
}

export interface MicrophoneDevice {
  id: string;
  label: string;
}

export interface RecorderStatus {
  state: RecordingState;
  captureMode: CaptureMode;
  microphone: string;
  region?: Region;
  elapsedMs: number;
  ffmpegAvailable: boolean;
  ffmpegMessage: string | null;
  platform: NodeJS.Platform;
  sessionType: string | null;
  microphones: MicrophoneDevice[];
  error: string | null;
  finalVideoPath: string | null;
  tempSessionPath: string | null;
}

export interface RegionSelectorBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
