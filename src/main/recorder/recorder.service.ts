import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { MicrophoneDevice, RecorderOptions, RecorderStatus, RecordingState, Region } from '../../shared/recorder';
import { getMicrophones } from '../ffmpeg/devices';
import { isFfmpegAvailable, runProcess } from '../ffmpeg/ffmpeg';
import { getCurrentRecorderBackend, type RecorderBackend } from './recorder-backend';

type StatusListener = (status: RecorderStatus) => void;

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
    this.status = {
      ...this.status,
      backendType: backend.type,
      microphone: this.availableMicrophones[0]?.id ?? this.status.microphone
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
      this.availableMicrophones = [{ id: 'default', label: 'Default Microphone' }];
    }
    this.status = {
      ...this.status,
      microphone: this.availableMicrophones[0]?.id ?? this.status.microphone
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
    if (requestedMicrophone !== 'default') {
      return requestedMicrophone;
    }

    return this.availableMicrophones.find((device) => device.id !== 'default')?.id ?? requestedMicrophone;
  }

  private async startSegment(): Promise<void> {
    if (!this.sessionDir || !this.currentOptions) {
      throw new Error('Recording session is not initialized.');
    }

    this.segmentCounter += 1;
    const fileName = `segment-${String(this.segmentCounter).padStart(3, '0')}.mkv`;
    const segmentPath = path.join(this.sessionDir, fileName);
    this.activeSegmentPath = segmentPath;
    this.segmentStartedAt = Date.now();

    const backend = this.backend ?? (await getCurrentRecorderBackend());
    this.backend = backend;
    const args = backend.buildSegmentArgs(this.currentOptions, segmentPath);
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe']
    });

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
    });
    ffmpeg.on('error', (error) => {
      this.lastError = error.message;
      this.state = 'idle';
      this.emitStatus();
    });
    ffmpeg.on('close', (code, signal) => {
      const expectedClose = this.closingIntent || signal === 'SIGINT';
      if (expectedClose) {
        this.activeProcess = null;
        return;
      }

      if (this.state === 'recording') {
        const details = stderrOutput
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-3)
          .join(' ');
        this.lastError = details
          ? `FFmpeg exited unexpectedly (code ${code ?? 'unknown'}).\n${details}`
          : `FFmpeg exited unexpectedly (code ${code ?? 'unknown'}).`;
        this.state = 'idle';
        this.activeProcess = null;
        this.activeSegmentPath = null;
        this.emitStatus();
      }
    });
    await started;
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

    processRef.kill('SIGINT');
    await Promise.race([
      exitPromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('FFmpeg did not shut down cleanly.')), 8000))
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

    if (this.segmentFiles.length === 0) {
      throw new Error('No recording segments were captured.');
    }

    const concatFile = path.join(this.sessionDir, 'segments.txt');
    const combinedFile = path.join(this.sessionDir, 'combined.mkv');
    const backend = this.backend ?? (await getCurrentRecorderBackend());
    this.backend = backend;
    const outputDirectory = this.currentOptions?.outputDirectory || backend.buildRecordingRoot();
    const outputFile = path.join(outputDirectory, `recording-${fileNameSafeTime()}.mp4`);

    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    const concatContent = this.segmentFiles.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`).join(os.EOL);
    await fs.writeFile(concatFile, `${concatContent}${os.EOL}`, 'utf8');

    await runProcess('ffmpeg', backend.buildConcatArgs(concatFile, combinedFile));

    try {
      await runProcess('ffmpeg', backend.buildStreamCopyMp4Args(combinedFile, outputFile));
    } catch {
      await runProcess('ffmpeg', backend.buildReencodeMp4Args(combinedFile, outputFile, this.currentOptions?.quality));
    }

    return outputFile;
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
