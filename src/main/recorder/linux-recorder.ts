import path from 'node:path';
import type { RecorderOptions, Region } from '../../shared/recorder';

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
  const audioInput = options.microphone || 'default';
  const audioArgs =
    audioInput === 'default'
      ? [
          '-f',
          'lavfi',
          '-i',
          'anullsrc=channel_layout=stereo:sample_rate=44100'
        ]
      : [
          '-f',
          'pulse',
          '-i',
          audioInput
        ];

  return [
    '-y',
    '-f',
    'x11grab',
    '-framerate',
    '30',
    ...x11.inputArgs,
    '-thread_queue_size',
    '1024',
    ...audioArgs,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    outputPath
  ];
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

export function buildReencodeMp4Args(inputPath: string, outputPath: string): string[] {
  return [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
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
