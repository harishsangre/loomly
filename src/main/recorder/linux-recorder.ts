import path from 'node:path';
import type { RecorderOptions, RecordingQuality, Region } from '../../shared/recorder';

const AUDIO_NOISE_REDUCTION_FILTER = 'afftdn=nf=-25,highpass=f=80,lowpass=f=12000';

function buildX11Input(display: string, region?: Region): { inputArgs: string[]; inputLabel: string } {
  if (region) {
    return {
      inputArgs: [
        '-video_size',
        `${Math.max(1, Math.floor(region.width))}x${Math.max(1, Math.floor(region.height))}`,
        '-i',
        `${display}+${Math.floor(region.x)},${Math.floor(region.y)}`
      ],
      inputLabel: `${display}+${Math.floor(region.x)},${Math.floor(region.y)}`
    };
  }

  return {
    inputArgs: ['-i', display],
    inputLabel: display
  };
}

export function buildSegmentArgs(options: RecorderOptions, outputPath: string, display: string): string[] {
  const x11 = buildX11Input(display, options.captureMode === 'region' ? options.region : undefined);
  const frameRate = options.frameRate ?? 30;
  const quality = options.quality ?? 'balanced';
  const qualitySettings = {
    high: { crf: '18', preset: 'fast', audioBitrate: '192k' },
    balanced: { crf: '23', preset: 'veryfast', audioBitrate: '128k' },
    compact: { crf: '28', preset: 'veryfast', audioBitrate: '96k' }
  }[quality];
  const args = [
    '-y',
    '-f',
    'x11grab',
    '-framerate',
    String(frameRate),
    ...x11.inputArgs
  ];
  const cameraEnabled = Boolean(options.camera && options.camera !== 'none');
  if (cameraEnabled) {
    args.push(
      '-thread_queue_size',
      '1024',
      '-f',
      'v4l2',
      '-framerate',
      String(Math.min(frameRate, 30)),
      '-video_size',
      '640x480',
      '-i',
      options.camera
    );
  }

  const audioIndexes: number[] = [];
  const audioSources = [options.microphone, options.systemAudio].filter(
    (source, index, sources): source is string => Boolean(source && source !== 'none') && sources.indexOf(source) === index
  );
  for (const source of audioSources) {
    const inputIndex = 1 + (cameraEnabled ? 1 : 0) + audioIndexes.length;
    args.push('-thread_queue_size', '1024', '-f', 'pulse', '-i', source);
    audioIndexes.push(inputIndex);
  }
  if (audioIndexes.length === 0) {
    const inputIndex = 1 + (cameraEnabled ? 1 : 0);
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    audioIndexes.push(inputIndex);
  }

  const videoMap = cameraEnabled ? '[video]' : '0:v:0';
  const audioMap = '[audio]';
  const filters: string[] = [];
  if (cameraEnabled) {
    filters.push('[1:v]scale=320:-2[camera]', '[0:v][camera]overlay=W-w-24:H-h-24[video]');
  }
  if (audioIndexes.length > 1) {
    filters.push(
      `${audioIndexes.map((index) => `[${index}:a]`).join('')}amix=inputs=${audioIndexes.length}:duration=longest:dropout_transition=2[mixedaudio]`,
      `[mixedaudio]${AUDIO_NOISE_REDUCTION_FILTER}[audio]`
    );
  } else {
    filters.push(`[${audioIndexes[0]}:a]${AUDIO_NOISE_REDUCTION_FILTER}[audio]`);
  }
  if (filters.length > 0) {
    args.push('-filter_complex', filters.join(';'));
  }

  args.push(
    '-map',
    videoMap,
    '-map',
    audioMap,
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

export function buildScreenshotArgs(outputPath: string, display: string, region?: Region): string[] {
  const input = buildX11Input(display, region);

  return [
    '-y',
    '-f',
    'x11grab',
    '-framerate',
    '1',
    ...input.inputArgs,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outputPath
  ];
}

export function buildConcatArgs(concatFile: string, outputPath: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outputPath];
}

export function buildStreamCopyMp4Args(inputPath: string, outputPath: string): string[] {
  return ['-y', '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', outputPath];
}

export function buildReencodeMp4Args(inputPath: string, outputPath: string, quality: RecordingQuality = 'balanced'): string[] {
  const crf = quality === 'high' ? '20' : quality === 'compact' ? '28' : '24';
  return [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    crf,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath
  ];
}

export function getDisplayName(): string {
  const display = process.env.DISPLAY || ':0';
  return display.includes('.') ? display : `${display}.0`;
}

export function buildRecordingRoot(): string {
  return path.join(process.env.HOME || process.cwd(), 'Videos', 'SimpleRecorder');
}
