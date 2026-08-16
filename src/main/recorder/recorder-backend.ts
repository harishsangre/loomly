import type { RecorderOptions, RecordingQuality } from '../../shared/recorder';
import { getSystemCompatibility } from '../ffmpeg/ffmpeg';
import { buildConcatArgs, buildReencodeMp4Args, buildRecordingRoot, buildSegmentArgs, buildStreamCopyMp4Args, getDisplayName } from './linux-recorder';

const AUDIO_NOISE_REDUCTION_FILTER = 'afftdn=nf=-25,highpass=f=80,lowpass=f=12000';

export type RecorderBackendType = 'linux-x11' | 'windows';

export interface RecorderBackend {
  readonly type: RecorderBackendType;
  readonly enabled: boolean;
  getCompatibilityError(): Promise<string | null>;
  prepareForCapture(): Promise<void>;
  buildSegmentArgs(options: RecorderOptions, outputPath: string): string[];
  buildConcatArgs(concatFile: string, outputPath: string): string[];
  buildStreamCopyMp4Args(inputPath: string, outputPath: string): string[];
  buildReencodeMp4Args(inputPath: string, outputPath: string, quality?: RecordingQuality): string[];
  getDisplayName(): string;
  buildRecordingRoot(): string;
}

export class LinuxX11RecorderBackend implements RecorderBackend {
  readonly type: RecorderBackendType = 'linux-x11';
  readonly enabled = true;

  buildSegmentArgs(options: RecorderOptions, outputPath: string): string[] {
    return buildSegmentArgs(options, outputPath, this.getDisplayName());
  }

  buildConcatArgs(concatFile: string, outputPath: string): string[] {
    return buildConcatArgs(concatFile, outputPath);
  }

  buildStreamCopyMp4Args(inputPath: string, outputPath: string): string[] {
    return buildStreamCopyMp4Args(inputPath, outputPath);
  }

  buildReencodeMp4Args(inputPath: string, outputPath: string, quality: RecordingQuality = 'balanced'): string[] {
    return buildReencodeMp4Args(inputPath, outputPath, quality);
  }

  getDisplayName(): string {
    return getDisplayName();
  }

  buildRecordingRoot(): string {
    return buildRecordingRoot();
  }

  async getCompatibilityError(): Promise<string | null> {
    const compatibility = await getSystemCompatibility();

    if (process.platform !== 'linux') {
      return 'Linux X11 capture is only available on Linux.';
    }

    if (compatibility.sessionType === 'wayland') {
      return 'Wayland screen capture is not supported in this MVP.\nPlease login using an Xorg/X11 session.';
    }

    if (compatibility.sessionType && compatibility.sessionType !== 'x11') {
      return 'This MVP only supports X11 screen capture.';
    }

    if (!['x64', 'arm64'].includes(process.arch)) {
      return `This build supports Linux x64 and arm64 only. Detected architecture: ${process.arch}.`;
    }

    return null;
  }

  async prepareForCapture(): Promise<void> {
    const error = await this.getCompatibilityError();
    if (error) {
      throw new Error(error);
    }
  }
}

function formatWindowsDshowSource(type: 'audio' | 'video', source: string): string {
  const cleaned = (source ?? '')
    .trim()
    .replace(/^audio=|^video=/i, '')
    .replace(/^"|"$/g, '')
    .replace(/"/g, '');

  if (!cleaned || cleaned === 'default' || cleaned === 'none') {
    return `${type}=default`;
  }

  // When spawning ffmpeg directly we must not include shell-style quoting
  // characters in the argument values. Return the device assignment without
  // surrounding quotes so the spawn argv element contains the plain device
  // name (which may include spaces) and ffmpeg receives the correct value.
  return `${type}=${cleaned}`;
}

export class WindowsRecorderBackend implements RecorderBackend {
  readonly type: RecorderBackendType = 'windows';
  readonly enabled = true;

  buildSegmentArgs(options: RecorderOptions, outputPath: string): string[] {
    const frameRate = options.frameRate ?? 30;
    const quality = options.quality ?? 'balanced';
    const qualitySettings = {
      high: { crf: '18', preset: 'fast', audioBitrate: '192k' },
      balanced: { crf: '23', preset: 'veryfast', audioBitrate: '128k' },
      compact: { crf: '28', preset: 'veryfast', audioBitrate: '96k' }
    }[quality];

    const args = ['-y', '-f', 'gdigrab', '-framerate', String(frameRate), '-i', 'desktop'];

    if (options.captureMode === 'region' && options.region) {
      // Insert region-specific gdigrab options before the input specifier (`-i`).
      // Previously this used a hard-coded splice index which could end up
      // breaking the argument order (frame rate must follow `-framerate`).
      const insertIndex = Math.max(0, args.indexOf('-i'));
      // Ensure video_size dimensions are even numbers (required by libx264).
      const rawWidth = Math.max(1, Math.floor(options.region.width));
      const rawHeight = Math.max(1, Math.floor(options.region.height));
      const evenWidth = rawWidth % 2 === 0 ? rawWidth : Math.max(1, rawWidth - 1);
      const evenHeight = rawHeight % 2 === 0 ? rawHeight : Math.max(1, rawHeight - 1);
      const offsetArgs = [
        '-offset_x',
        String(Math.max(0, Math.floor(options.region.x))),
        '-offset_y',
        String(Math.max(0, Math.floor(options.region.y))),
        '-video_size',
        `${evenWidth}x${evenHeight}`
      ];
      args.splice(insertIndex, 0, ...offsetArgs);
    }

    const cameraEnabled = Boolean(options.camera && options.camera !== 'none');
    if (cameraEnabled) {
      args.push('-thread_queue_size', '1024', '-f', 'dshow', '-i', formatWindowsDshowSource('video', options.camera));
    }

    const audioInputs: string[] = [];
    if (options.microphone && options.microphone !== 'none' && options.microphone !== 'default') {
      audioInputs.push(formatWindowsDshowSource('audio', options.microphone));
    }
    if (options.systemAudio && options.systemAudio !== 'none' && options.systemAudio !== 'default') {
      audioInputs.push(formatWindowsDshowSource('audio', options.systemAudio));
    }

    if (audioInputs.length === 0) {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    } else {
      for (const source of audioInputs) {
        args.push('-f', 'dshow', '-i', source);
      }
    }

    if (cameraEnabled) {
      args.push('-map', '0:v:0', '-map', '1:v:0', '-map', `${audioInputs.length + (cameraEnabled ? 1 : 0)}:a:0`);
    } else {
      args.push('-map', '0:v:0', '-map', `${audioInputs.length > 0 ? 1 : 1}:a:0`);
    }

    if (audioInputs.length > 0) {
      args.push('-af', AUDIO_NOISE_REDUCTION_FILTER);
    }

    args.push(
      '-c:v',
      'libx264',
      '-preset',
      qualitySettings.preset,
      '-crf',
      qualitySettings.crf,
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(frameRate),
      '-c:a',
      'aac',
      '-b:a',
      qualitySettings.audioBitrate,
      outputPath
    );

    return args;
  }

  buildConcatArgs(concatFile: string, outputPath: string): string[] {
    return ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outputPath];
  }

  buildStreamCopyMp4Args(inputPath: string, outputPath: string): string[] {
    return ['-y', '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', outputPath];
  }

  buildReencodeMp4Args(inputPath: string, outputPath: string, quality: RecordingQuality = 'balanced'): string[] {
    const qualitySettings = {
      high: { crf: '20', preset: 'medium', audioBitrate: '160k' },
      balanced: { crf: '24', preset: 'medium', audioBitrate: '128k' },
      compact: { crf: '28', preset: 'medium', audioBitrate: '96k' }
    }[quality];

    return ['-y', '-i', inputPath, '-c:v', 'libx264', '-preset', qualitySettings.preset, '-crf', qualitySettings.crf, '-c:a', 'aac', '-b:a', qualitySettings.audioBitrate, '-movflags', '+faststart', outputPath];
  }

  getDisplayName(): string {
    return 'desktop';
  }

  buildRecordingRoot(): string {
    return process.env.USERPROFILE ? `${process.env.USERPROFILE}\\Videos\\SimpleRecorder` : 'C:\\Videos\\SimpleRecorder';
  }

  async getCompatibilityError(): Promise<string | null> {
    const compatibility = await getSystemCompatibility();

    if (process.platform !== 'win32') {
      return 'Windows capture backend is only available on Windows.';
    }

    if (!['x64', 'arm64'].includes(process.arch)) {
      return `This build supports Windows x64 and arm64 only. Detected architecture: ${process.arch}.`;
    }

    if (!compatibility.windowsVersion || compatibility.windowsVersion < 10) {
      return `Windows 10 or newer is required. Detected version: ${compatibility.windowsVersion ?? 'unknown'}.`;
    }

    return null;
  }

  async prepareForCapture(): Promise<void> {
    const error = await this.getCompatibilityError();
    if (error) {
      throw new Error(error);
    }
  }
}

export class UnsupportedPlatformRecorderBackend implements RecorderBackend {
  readonly type: RecorderBackendType = 'linux-x11';
  readonly enabled = false;

  buildSegmentArgs(): string[] {
    return [];
  }

  buildConcatArgs(concatFile: string, outputPath: string): string[] {
    return ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outputPath];
  }

  buildStreamCopyMp4Args(inputPath: string, outputPath: string): string[] {
    return ['-y', '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', outputPath];
  }

  buildReencodeMp4Args(inputPath: string, outputPath: string, quality: RecordingQuality = 'balanced'): string[] {
    const crf = quality === 'high' ? '20' : quality === 'compact' ? '28' : '24';
    return ['-y', '-i', inputPath, '-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath];
  }

  getDisplayName(): string {
    return '';
  }

  buildRecordingRoot(): string {
    return process.cwd();
  }

  async getCompatibilityError(): Promise<string | null> {
    return `This build is currently supported on Linux X11 and Windows only. Detected platform: ${process.platform}.`;
  }

  async prepareForCapture(): Promise<void> {
    const error = await this.getCompatibilityError();
    if (error) {
      throw new Error(error);
    }
  }
}

export async function getCurrentRecorderBackend(): Promise<RecorderBackend> {
  if (process.platform === 'win32') {
    return new WindowsRecorderBackend();
  }

  if (process.platform === 'linux') {
    return new LinuxX11RecorderBackend();
  }

  return new UnsupportedPlatformRecorderBackend();
}
