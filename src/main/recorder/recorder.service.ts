import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { screen } from 'electron';
import { promisify } from 'node:util';
import type { MicrophoneDevice, RecorderOptions, RecorderStatus, RecordingState, Region } from '../../shared/recorder';
import { getMicrophones } from '../ffmpeg/devices';
import { getResolvedFfmpegCommand, isFfmpegAvailable, runProcess } from '../ffmpeg/ffmpeg';
import { getCurrentRecorderBackend, type RecorderBackend } from './recorder-backend';

type StatusListener = (status: RecorderStatus) => void;

const execFileAsync = promisify(execFile);

function timestampId(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function fileNameSafeTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}${pad(date.getSeconds())}`;
}

function defaultStatus(): RecorderStatus {
  return {
    state: 'idle',
    captureMode: 'fullscreen',
    microphone: 'default',
    elapsedMs: 0,
    ffmpegAvailable: false,
    ffmpegMessage: 'Checking FFmpeg...',
    platform: process.platform,
    backendType: null,
    sessionType: process.env.XDG_SESSION_TYPE ?? null,
    microphones: [{ id: 'default', label: 'Default Microphone' }],
    error: null,
    finalVideoPath: null,
    tempSessionPath: null
  };
}

export class RecorderService extends EventEmitter {
  private status: RecorderStatus = defaultStatus();
  private ffmpegReady = false;
  private ffmpegMessage: string | null = 'Checking FFmpeg...';
  private availableMicrophones: MicrophoneDevice[] = [{ id: 'default', label: 'Default Microphone' }];
  private currentOptions: RecorderOptions | null = null;
  private sessionDir: string | null = null;
  private tempSessionPath: string | null = null;
  private finalVideoPath: string | null = null;
  private segmentCounter = 0;
  private segmentFiles: string[] = [];
  private activeProcess: ReturnType<typeof spawn> | null = null;
  private backend: RecorderBackend | null = null;
  private activeSegmentPath: string | null = null;
  private segmentStartedAt = 0;
  private accumulatedMs = 0;
  private closingIntent = false;
  private region: Region | undefined;
  private lastError: string | null = null;
  private initializePromise: Promise<void>;
  private state: RecordingState = 'idle';

  constructor(private readonly onStatusChange: StatusListener) {
    super();
    this.initializePromise = this.initialize();
  }

  private emitStatus(): void {
    const elapsedMs = this.state === 'recording' ? this.accumulatedMs + (Date.now() - this.segmentStartedAt) : this.accumulatedMs;
    this.status = {
      ...this.status,
      state: this.state,
      captureMode: this.currentOptions?.captureMode ?? this.status.captureMode,
      microphone: this.currentOptions?.microphone ?? this.status.microphone,
      region: this.region ?? this.currentOptions?.region ?? undefined,
      elapsedMs,
      ffmpegAvailable: this.ffmpegReady,
      ffmpegMessage: this.ffmpegMessage,
      microphones: this.availableMicrophones,
      error: this.lastError,
      finalVideoPath: this.finalVideoPath,
      tempSessionPath: this.tempSessionPath
    };
    this.onStatusChange(this.status);
    this.emit('status', this.status);
  }

  async initialize(): Promise<void> {
    const backend = await getCurrentRecorderBackend();
    this.backend = backend;
    const backendError = await backend.getCompatibilityError();
    const [ffmpegAvailable, microphones] = await Promise.all([isFfmpegAvailable(), getMicrophones()]);

    this.ffmpegReady = ffmpegAvailable;
    this.ffmpegMessage = backendError ?? (ffmpegAvailable ? null : 'FFmpeg is required.\n\nUbuntu:\nsudo apt install ffmpeg\nWindows:\nInstall FFmpeg and add it to PATH.');
    this.availableMicrophones = microphones.length > 0 ? microphones : this.availableMicrophones;
    const firstUsable = this.availableMicrophones.find((device) => device.id && device.id !== 'default' && device.id !== 'none');
    this.status = {
      ...this.status,
      backendType: backend.type,
      microphone: firstUsable?.id ?? this.availableMicrophones[0]?.id ?? 'none'
    };
    this.lastError = backendError ?? null;
    this.emitStatus();
  }

  async getStatus(): Promise<RecorderStatus> {
    await this.initializePromise;
    this.emitStatus();
    return this.status;
  }

  async getMicrophones(): Promise<MicrophoneDevice[]> {
    await this.initializePromise;
    try {
      this.availableMicrophones = await getMicrophones();
    } catch {
      this.availableMicrophones = [{ id: 'none', label: 'No microphone detected' }];
    }
    const firstUsable = this.availableMicrophones.find((device) => device.id && device.id !== 'default' && device.id !== 'none');
    this.status = {
      ...this.status,
      microphone: firstUsable?.id ?? this.availableMicrophones[0]?.id ?? 'none'
    };
    this.emitStatus();
    return this.availableMicrophones;
  }

  async start(options: RecorderOptions): Promise<RecorderStatus> {
    await this.initializePromise;
    this.clearError();
    if (this.state !== 'idle' && this.state !== 'finished') {
      throw new Error('A recording is already in progress.');
    }
    await this.ensureReadyForCapture();
    this.validateOptions(options);
    await fs.mkdir(options.outputDirectory, { recursive: true });

    const microphone = this.resolveMicrophoneId(options.microphone);
    this.currentOptions = options;
    this.currentOptions.microphone = microphone;
    this.region = options.region;
    this.finalVideoPath = null;
    this.segmentCounter = 0;
    this.segmentFiles = [];
    this.accumulatedMs = 0;
    const backend = this.backend ?? (await getCurrentRecorderBackend());
    this.backend = backend;
    this.tempSessionPath = path.join(backend.buildRecordingRoot(), 'temp', `session-${timestampId()}`);
    this.sessionDir = this.tempSessionPath;
    await fs.mkdir(this.tempSessionPath, { recursive: true });
    this.state = 'recording';
    this.emitStatus();
    await this.startSegment();
    return this.status;
  }

  async pause(): Promise<RecorderStatus> {
    await this.initializePromise;
    if (this.state !== 'recording') {
      throw new Error('Recording is not active.');
    }

    await this.stopActiveProcess();
    this.accumulatedMs += Date.now() - this.segmentStartedAt;
    this.state = 'paused';
    this.emitStatus();
    return this.status;
  }

  async resume(): Promise<RecorderStatus> {
    await this.initializePromise;
    if (this.state !== 'paused') {
      throw new Error('Recording is not paused.');
    }

    this.state = 'recording';
    this.emitStatus();
    await this.startSegment();
    return this.status;
  }

  async stop(): Promise<RecorderStatus> {
    await this.initializePromise;
    if (this.state === 'idle') {
      return this.status;
    }

    this.clearError();
    if (this.state === 'recording') {
      await this.stopActiveProcess();
      this.accumulatedMs += Date.now() - this.segmentStartedAt;
    }

    this.state = 'processing';
    this.emitStatus();

    try {
      const output = await this.finalizeRecording();
      this.finalVideoPath = output;
      const actualDurationMs = await this.getMediaDurationMs(output);
      this.accumulatedMs = actualDurationMs;
      this.state = 'finished';
      this.emitStatus();
      try {
        await this.cleanupTempDirectory();
      } catch {
        // Best-effort cleanup only; the finished MP4 remains the source of truth.
      }
      this.resetTransientCaptureState();
      return this.status;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Recording finalization failed.';
      this.state = 'idle';
      this.emitStatus();
      return this.status;
    }
  }

  async discard(): Promise<RecorderStatus> {
    await this.initializePromise;
    if (this.state === 'idle') {
      return this.status;
    }

    this.clearError();
    if (this.state === 'recording') {
      await this.stopActiveProcess();
      this.accumulatedMs += Date.now() - this.segmentStartedAt;
    }

    this.state = 'processing';
    this.emitStatus();

    try {
      await this.cleanupTempDirectory();
    } catch {
      // Best-effort cleanup only.
    }

    this.currentOptions = null;
    this.region = undefined;
    this.sessionDir = null;
    this.tempSessionPath = null;
    this.finalVideoPath = null;
    this.segmentCounter = 0;
    this.segmentFiles = [];
    this.activeProcess = null;
    this.activeSegmentPath = null;
    this.segmentStartedAt = 0;
    this.accumulatedMs = 0;
    this.closingIntent = false;
    this.state = 'idle';
    this.emitStatus();
    return this.status;
  }

  private async ensureReadyForCapture(): Promise<void> {
    const backend = await getCurrentRecorderBackend();
    await backend.prepareForCapture();

    if (!this.ffmpegReady) {
      throw new Error('FFmpeg is required.\n\nUbuntu:\nsudo apt install ffmpeg\nWindows:\nInstall FFmpeg and add it to PATH.');
    }
  }

  private validateOptions(options: RecorderOptions): void {
    if (!options.microphone) {
      throw new Error('Please select a microphone.');
    }

    if (![24, 30, 60].includes(options.frameRate)) {
      throw new Error('Please select a supported frame rate.');
    }

    if (!['high', 'balanced', 'compact'].includes(options.quality)) {
      throw new Error('Please select a supported recording quality.');
    }

    if (!options.outputDirectory || !path.isAbsolute(options.outputDirectory)) {
      throw new Error('Please select a valid recording folder.');
    }

    if (options.camera !== 'none' && !/^\/dev\/video\d+$/.test(options.camera)) {
      throw new Error('Please select a valid camera device.');
    }

    if (options.captureMode === 'region') {
      if (!options.region) {
        throw new Error('Please select a capture region.');
      }

      const { width, height } = options.region;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 40 || height < 40) {
        throw new Error('Selected region is too small.');
      }
    }
  }

  private resolveMicrophoneId(requestedMicrophone: string): string {
    const sanitized = (requestedMicrophone ?? '').trim().replace(/^audio=/i, '').replace(/^"|"$/g, '');

    if (!sanitized || sanitized === 'none' || sanitized === 'default') {
      return this.availableMicrophones.find((device) => device.id && device.id !== 'default' && device.id !== 'none')?.id ?? 'none';
    }

    return sanitized;
  }

  private async startSegment(): Promise<void> {
    if (!this.sessionDir || !this.currentOptions) {
      throw new Error('Recording session is not initialized.');
    }

    const backend = this.backend ?? (await getCurrentRecorderBackend());
    this.backend = backend;

    const launchSegment = async (useDefaultMic: boolean): Promise<void> => {
      this.segmentCounter += 1;
      const segmentPath = path.join(this.sessionDir!, 'capture.mp4');
      this.activeSegmentPath = segmentPath;
      this.segmentStartedAt = Date.now();

      try {
        await fs.rm(segmentPath, { force: true });
      } catch {
        // Best effort: allow a fresh capture file for the current session.
      }

      const options = {
        ...this.currentOptions!,
        microphone: useDefaultMic ? 'default' : this.resolveMicrophoneId(this.currentOptions!.microphone)
      };

      // If a region was selected, convert from CSS/DIP coordinates to
      // physical pixels using the display scale factor so gdigrab receives
      // the correct offsets and video_size. This avoids 0x0 captures when
      // running on high-DPI displays.
      if (options.captureMode === 'region' && options.region) {
        try {
          const point = { x: Math.round(options.region.x), y: Math.round(options.region.y) };
          const display = screen.getDisplayNearestPoint(point);
          const scale = display.scaleFactor ?? 1;
          options.region = {
            x: Math.round(options.region.x * scale),
            y: Math.round(options.region.y * scale),
            width: Math.max(1, Math.round(options.region.width * scale)),
            height: Math.max(1, Math.round(options.region.height * scale))
          };
        } catch {
          // if anything goes wrong, fall back to the original region values
        }
      }

      const args = backend.buildSegmentArgs(options, segmentPath);
      const ffmpegCommand = getResolvedFfmpegCommand();
      const ffmpeg = spawn(ffmpegCommand.command, args, {
        env: ffmpegCommand.env,
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true
      });

      // Create a small debug log in the session directory so we can inspect
      // the exact ffmpeg command, args and stderr output when troubleshooting
      // why a capture file wasn't produced.
      const ffmpegLogPath = this.sessionDir ? path.join(this.sessionDir, 'ffmpeg.log') : null;
      if (ffmpegLogPath) {
        void fs.appendFile(
          ffmpegLogPath,
          `\n\n=== FFmpeg start ${new Date().toISOString()} ===\nCommand: ${ffmpegCommand.command}\nArgs: ${args.join(' ')}\nPATH: ${ffmpegCommand.env.PATH}\n\n`
        ).catch(() => {});
      }

      this.closingIntent = false;
      this.activeProcess = ffmpeg;
      let stderrOutput = '';
      const started = new Promise<void>((resolve, reject) => {
        ffmpeg.once('spawn', () => resolve());
        ffmpeg.once('error', (error) => reject(error));
      });

      ffmpeg.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrOutput += text;
        if (/Input #[0-9]+, pulse/.test(text) || /x11grab/.test(text)) {
          return;
        }
        if (ffmpegLogPath) {
          void fs.appendFile(ffmpegLogPath, text).catch(() => {});
        }
      });

      ffmpeg.on('error', (error) => {
        this.lastError = error.message;
        this.state = 'idle';
        this.emitStatus();
      });

      ffmpeg.on('close', async (code, signal) => {
        const expectedClose = this.closingIntent || signal === 'SIGINT';
        if (expectedClose) {
          this.activeProcess = null;
          return;
        }

        if (this.state !== 'recording') {
          return;
        }

        const details = stderrOutput
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-6)
          .join(' ');

        if (ffmpegLogPath) {
          void fs.appendFile(
            ffmpegLogPath,
            `\n=== FFmpeg exit ${new Date().toISOString()} ===\ncode: ${code} signal: ${signal}\nLast stderr snippet:\n${details}\n\nFull stderr:\n${stderrOutput}\n`
          ).catch(() => {});
        }

        const inputError = /Error opening input|I\/O error|Cannot find a match for the device name|Could not open|Failed to set up|No such file or directory/i.test(details);
        const isWindowsMicFailure = process.platform === 'win32' && inputError && options.microphone !== 'default';

        if (isWindowsMicFailure && !useDefaultMic) {
          this.currentOptions = { ...options, microphone: 'default' };
          this.lastError = 'The selected microphone could not be opened, so the app is retrying with the default Windows microphone.';
          this.emitStatus();
          this.activeProcess = null;
          this.activeSegmentPath = null;
          await this.startSegment();
          return;
        }

        this.lastError = details
          ? `FFmpeg exited unexpectedly (code ${code ?? 'unknown'}).\n${details}`
          : `FFmpeg exited unexpectedly (code ${code ?? 'unknown'}).`;
        this.state = 'idle';
        this.activeProcess = null;
        this.activeSegmentPath = null;
        this.emitStatus();
      });

      await started;
    };

    await launchSegment(false);
  }

  private async stopActiveProcess(): Promise<void> {
    if (!this.activeProcess) {
      return;
    }

    const processRef = this.activeProcess;
    this.closingIntent = true;
    const exitPromise = new Promise<void>((resolve) => {
      processRef.once('close', () => resolve());
    });

    try {
      if (processRef.stdin && !processRef.stdin.destroyed) {
        processRef.stdin.write('q');
        processRef.stdin.end();
      }
    } catch {
      // FFmpeg may already be exiting; continue to the fallback path.
    }

    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          try {
            processRef.kill('SIGTERM');
          } catch {
            // Windows may not support SIGTERM in the same way as POSIX; a normal hard kill is the last resort.
          }
          setTimeout(() => {
            try {
              processRef.kill();
            } catch {
              // Ignore second-stage shutdown errors.
            }
            resolve();
          }, 500);
        }, 1500);
      })
    ]);

    if (this.activeSegmentPath) {
      this.segmentFiles.push(this.activeSegmentPath);
      this.activeSegmentPath = null;
    }
    this.activeProcess = null;
  }

  private async finalizeRecording(): Promise<string> {
    if (!this.sessionDir) {
      throw new Error('Recording session directory is missing.');
    }

    const backend = this.backend ?? (await getCurrentRecorderBackend());
    this.backend = backend;
    const outputDirectory = this.currentOptions?.outputDirectory || backend.buildRecordingRoot();
    const outputFile = path.join(outputDirectory, `recording-${fileNameSafeTime()}.mp4`);

    await fs.mkdir(path.dirname(outputFile), { recursive: true });

    const captureFile = this.activeSegmentPath ?? this.segmentFiles[this.segmentFiles.length - 1] ?? (await this.findLatestCaptureFile());
    if (!captureFile) {
      throw new Error('No valid recording was produced.');
    }

    try {
      await fs.access(captureFile);
    } catch {
      throw new Error(`The recording file was not created: ${captureFile}`);
    }

    const compressedOutputFile = path.join(outputDirectory, `recording-${fileNameSafeTime()}-compressed.mp4`);

    try {
      const quality = this.currentOptions?.quality ?? 'balanced';
      const ffmpegCommand = getResolvedFfmpegCommand();
      await runProcess(ffmpegCommand.command, backend.buildReencodeMp4Args(captureFile, compressedOutputFile, quality), {
        env: ffmpegCommand.env
      });

      const [captureStats, compressedStats] = await Promise.all([fs.stat(captureFile), fs.stat(compressedOutputFile)]);
      if (compressedStats.size > 0 && compressedStats.size < captureStats.size) {
        await fs.rename(compressedOutputFile, outputFile);
        return outputFile;
      }
    } catch {
      // Keep the original recording if the compression pass fails.
    }

    await fs.rm(compressedOutputFile, { force: true }).catch(() => undefined);
    await fs.copyFile(captureFile, outputFile);
    return outputFile;
  }

  private async findLatestCaptureFile(): Promise<string | null> {
    if (!this.sessionDir) {
      return null;
    }

    const entries = await fs.readdir(this.sessionDir);
    const candidates = entries
      .filter((entry) => entry.toLowerCase().endsWith('.mp4'))
      .sort((a, b) => a.localeCompare(b));

    if (candidates.length === 0) {
      return null;
    }

    return path.join(this.sessionDir, candidates[candidates.length - 1]);
  }

  private async getMediaDurationMs(filePath: string): Promise<number> {
    const ffmpegCommand = getResolvedFfmpegCommand();
    const ffprobeDir = path.dirname(ffmpegCommand.command);
    const ffprobeCommand = process.platform === 'win32'
      ? path.join(ffprobeDir, 'ffprobe.exe')
      : path.join(ffprobeDir, 'ffprobe');
    const probePath = fsSync.existsSync(ffprobeCommand)
      ? ffprobeCommand
      : (process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

    try {
      const { stdout } = await execFileAsync(probePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath], {
        env: ffmpegCommand.env,
        timeout: 8000
      });
      const duration = Number.parseFloat(stdout.trim());
      return Number.isFinite(duration) ? Math.max(0, duration * 1000) : 0;
    } catch {
      return 0;
    }
  }

  private async getValidSegments(): Promise<string[]> {
    const ffmpegCommand = getResolvedFfmpegCommand();
    const ffprobeDir = path.dirname(ffmpegCommand.command);
    const ffprobeCommand = process.platform === 'win32'
      ? path.join(ffprobeDir, 'ffprobe.exe')
      : path.join(ffprobeDir, 'ffprobe');

    const segmentCandidates = await Promise.all(
      this.segmentFiles.map(async (segment) => {
        try {
          const stats = await fs.stat(segment);
          if (!stats.size || stats.size < 4096) {
            return null;
          }

          const probePath = fsSync.existsSync(ffprobeCommand)
            ? ffprobeCommand
            : (process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

          try {
            const { stdout } = await execFileAsync(probePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', segment], {
              env: ffmpegCommand.env,
              timeout: 8000
            });
            const duration = Number.parseFloat(stdout.trim());
            return Number.isFinite(duration) && duration > 0.2 ? segment : null;
          } catch {
            return segment;
          }
        } catch {
          return null;
        }
      })
    );

    return segmentCandidates.filter((segment): segment is string => Boolean(segment));
  }

  private async cleanupTempDirectory(): Promise<void> {
    if (this.sessionDir) {
      await fs.rm(this.sessionDir, { recursive: true, force: true });
    }
  }

  private resetTransientCaptureState(): void {
    this.currentOptions = null;
    this.region = undefined;
    this.sessionDir = null;
    this.tempSessionPath = null;
    this.segmentCounter = 0;
    this.segmentFiles = [];
    this.activeProcess = null;
    this.activeSegmentPath = null;
    this.segmentStartedAt = 0;
    this.closingIntent = false;
    this.state = 'finished';
    this.emitStatus();
  }

  private clearError(): void {
    this.lastError = null;
  }
}
