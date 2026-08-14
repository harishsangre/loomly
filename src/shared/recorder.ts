export type RecordingState = 'idle' | 'recording' | 'paused' | 'processing' | 'finished';
export type CaptureMode = 'fullscreen' | 'region';
export type RecordingFrameRate = 24 | 30 | 60;
export type RecordingQuality = 'high' | 'balanced' | 'compact';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecorderOptions {
  captureMode: CaptureMode;
  microphone: string;
  systemAudio: string;
  camera: string;
  frameRate: RecordingFrameRate;
  quality: RecordingQuality;
  outputDirectory: string;
  region?: Region;
}

export interface MicrophoneDevice {
  id: string;
  label: string;
}

export interface CaptureDevice {
  id: string;
  label: string;
}

export interface CaptureDevices {
  systemAudio: CaptureDevice[];
  cameras: CaptureDevice[];
  defaultOutputDirectory: string;
}

export type RecorderBackendType = 'linux-x11' | 'windows';

export interface RecorderStatus {
  state: RecordingState;
  captureMode: CaptureMode;
  microphone: string;
  region?: Region;
  elapsedMs: number;
  ffmpegAvailable: boolean;
  ffmpegMessage: string | null;
  platform: NodeJS.Platform;
  backendType?: RecorderBackendType | null;
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
