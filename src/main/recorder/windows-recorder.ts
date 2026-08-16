import type { RecorderOptions, RecordingQuality, Region } from '../../shared/recorder';
import { getSystemCompatibility } from '../ffmpeg/ffmpeg';
import type { RecorderBackend, RecorderBackendType } from './recorder-backend';

function buildWindowsRegionArgs(region?: Region): string[] {
  if (!region) {
    return [];
  }

  return [
    '-offset_x',
    String(Math.max(0, Math.floor(region.x))),
    '-offset_y',
    String(Math.max(0, Math.floor(region.y))),
    '-video_size',
    `${Math.max(1, Math.floor(region.width))}x${Math.max(1, Math.floor(region.height))}`
  ];
}

function getWindowsQualitySettings(quality: RecordingQuality = 'balanced') {
  switch (quality) {
    case 'high':
      return { crf: '18', preset: 'fast', audioBitrate: '192k' };
    case 'compact':
      return { crf: '28', preset: 'veryfast', audioBitrate: '96k' };
    case 'balanced':
    default:
      return { crf: '23', preset: 'veryfast', audioBitrate: '128k' };
  }
}

export function formatWindowsDshowSource(type: 'audio' | 'video', source: string): string {
  const cleaned = (source ?? '')
    .trim()
    .replace(/^audio=|^video=/i, '')
    .replace(/^"|"$/g, '')
    .replace(/"/g, '');

  if (!cleaned || cleaned === 'default' || cleaned === 'none') {
    return `${type}=default`;
  }

  return `${type}="${cleaned}"`;
}

function buildWindowsSegmentArgs(options: RecorderOptions, outputPath: string, display: string): string[] {
  const frameRate = options.frameRate ?? 30;
  const quality = getWindowsQualitySettings(options.quality ?? 'balanced');
  const args = ['-y', '-f', 'gdigrab', '-framerate', String(frameRate), '-i', display];

  if (options.captureMode === 'region' && options.region) {
    args.splice(4, 0, ...buildWindowsRegionArgs(options.region));
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

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    quality.preset,
    '-crf',
    quality.crf,
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(frameRate),
    '-c:a',
    'aac',
    '-b:a',
    quality.audioBitrate,
    outputPath
  );

  return args;
}

export function buildWindowsConcatArgs(concatFile: string, outputPath: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outputPath];
}

export function buildWindowsStreamCopyMp4Args(inputPath: string, outputPath: string): string[] {
  return ['-y', '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', outputPath];
}

export function buildWindowsReencodeMp4Args(inputPath: string, outputPath: string, quality: RecordingQuality = 'balanced'): string[] {
  const settings = getWindowsQualitySettings(quality);
  return [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-preset',
    settings.preset,
    '-crf',
    settings.crf,
    '-c:a',
    'aac',
    '-b:a',
    settings.audioBitrate,
    '-movflags',
    '+faststart',
    outputPath
  ];
}

export function getWindowsDisplayName(): string {
  return 'desktop';
}

export class WindowsRecorderAdapter implements RecorderBackend {
  readonly type: RecorderBackendType = 'windows';
  readonly enabled = true;

  buildSegmentArgs(options: RecorderOptions, outputPath: string): string[] {
    return buildWindowsSegmentArgs(options, outputPath, getWindowsDisplayName());
  }

  buildConcatArgs(concatFile: string, outputPath: string): string[] {
    return buildWindowsConcatArgs(concatFile, outputPath);
  }

  buildStreamCopyMp4Args(inputPath: string, outputPath: string): string[] {
    return buildWindowsStreamCopyMp4Args(inputPath, outputPath);
  }

  buildReencodeMp4Args(inputPath: string, outputPath: string, quality: RecordingQuality = 'balanced'): string[] {
    return buildWindowsReencodeMp4Args(inputPath, outputPath, quality);
  }

  getDisplayName(): string {
    return getWindowsDisplayName();
  }

  buildRecordingRoot(): string {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
    return `${userProfile}\\Videos\\SimpleRecorder`;
  }

  async getCompatibilityError(): Promise<string | null> {
    const compatibility = await getSystemCompatibility();

    if (!compatibility.ffmpegAvailable) {
      return compatibility.reason ?? 'FFmpeg is required.';
    }

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