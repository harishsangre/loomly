import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Download,
  Eye,
  Folder,
  FolderOpen,
  Hash,
  HardDrive,
  Info,
  LayoutGrid,
  List,
  ListVideo,
  Mic,
  Minus,
  Monitor,
  MoreVertical,
  PencilLine,
  Pause,
  Play,
  Plus,
  ScanLine,
  Search,
  Settings,
  Share2,
  Sparkles,
  Square,
  Star,
  Trash,
  Upload,
  Users,
  Video,
  Volume2,
  X
} from 'lucide-react';

import type {
  CaptureDevice,
  CaptureMode,
  MicrophoneDevice,
  RecorderStatus,
  RecordingFrameRate,
  RecordingQuality,
  Region
} from '@/shared/recorder';
import { RegionSelector, RegionSelectorControls } from './components/RegionSelector';

type Page = 'library' | 'video';
type SidebarSection = 'library' | 'shared' | 'favorites' | 'trash';

interface RecordingItem {
  title: string;
  meta: string;
  durationLabel: string;
  durationMs: number;
  path: string;
  createdAt: string;
  accent: string;
  tone: string;
  favorite: boolean;
  shared: boolean;
  trashed: boolean;
}

const RECORDINGS_STORAGE_KEY = 'local-zoom:recordings';

const demoChapters = [
  { time: '0:00', label: 'Intro and goals' },
  { time: '0:42', label: 'Recording overview' },
  { time: '1:30', label: 'Open questions' }
];

const recordingPalette = [
  { accent: 'var(--bg-accent)', tone: 'var(--text-accent)' },
  { accent: 'var(--bg-success)', tone: 'var(--text-success)' },
  { accent: 'var(--bg-warning)', tone: 'var(--text-warning)' },
  { accent: 'var(--bg-danger)', tone: 'var(--text-danger)' }
];

const defaultStatus: RecorderStatus = {
  state: 'idle',
  captureMode: 'fullscreen',
  microphone: 'default',
  elapsedMs: 0,
  ffmpegAvailable: false,
  ffmpegMessage: 'Checking FFmpeg...',
  platform: 'linux',
  backendType: 'linux-x11',
  sessionType: null,
  microphones: [{ id: 'default', label: 'Default Microphone' }],
  error: null,
  finalVideoPath: null,
  tempSessionPath: null
};

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatTime(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Saved locally';
  }

  return `${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })} · ${date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  })}`;
}

function getPageFromHash(): Page {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === '/video') {
    return 'video';
  }

  return 'library';
}

function pushPage(next: Page): void {
  const hash = next === 'video' ? '#/video' : '#/';
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

function parseRegionBounds(): Region {
  const params = new URLSearchParams(window.location.search);
  const x = Number.parseInt(params.get('screenX') ?? '0', 10);
  const y = Number.parseInt(params.get('screenY') ?? '0', 10);
  const width = Number.parseInt(params.get('screenWidth') ?? '1920', 10);
  const height = Number.parseInt(params.get('screenHeight') ?? '1080', 10);

  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(width) ? width : 1920,
    height: Number.isFinite(height) ? height : 1080
  };
}

function loadRecordings(): RecordingItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RECORDINGS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const candidate = item as Partial<RecordingItem>;
        if (
          typeof candidate.title !== 'string' ||
          typeof candidate.meta !== 'string' ||
          typeof candidate.durationLabel !== 'string' ||
          typeof candidate.durationMs !== 'number' ||
          typeof candidate.path !== 'string' ||
          typeof candidate.createdAt !== 'string'
        ) {
          return null;
        }

        const palette = recordingPalette[index % recordingPalette.length];
        return {
          title: candidate.title,
          meta: candidate.meta,
          durationLabel: candidate.durationLabel,
          durationMs: candidate.durationMs,
          path: candidate.path,
          createdAt: candidate.createdAt,
          accent: candidate.accent ?? palette.accent,
          tone: candidate.tone ?? palette.tone,
          favorite: candidate.favorite ?? false,
          shared: candidate.shared ?? false,
          trashed: candidate.trashed ?? false
        } satisfies RecordingItem;
      })
      .filter((item): item is RecordingItem => item !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

function makeRecordingTitle(index: number): string {
  const suffix = String(index + 1).padStart(2, '0');
  return `Recording ${suffix}`;
}

function buildRecordingItem(path: string, elapsedMs: number, index: number): RecordingItem {
  const createdAt = new Date().toISOString();
  const palette = recordingPalette[index % recordingPalette.length];

  return {
    title: makeRecordingTitle(index),
    meta: `${formatRelativeDate(createdAt)} · Saved locally`,
    durationLabel: formatTime(elapsedMs),
    durationMs: elapsedMs,
    path,
    createdAt,
    accent: palette.accent,
    tone: palette.tone,
    favorite: false,
    shared: false,
    trashed: false
  };
}

function buildVideoPosterDataUri(item: RecordingItem | null): string {
  const title = item?.title ?? 'Local Zoom';
  const subtitle = item ? item.meta : 'Finished recording';
  const svg = `
    <svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f8f4ff"/>
          <stop offset="100%" stop-color="#eceff8"/>
        </linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#a855f7"/>
          <stop offset="100%" stop-color="#7c3aed"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#bg)"/>
      <circle cx="180" cy="160" r="90" fill="#ddd6fe" opacity="0.9"/>
      <circle cx="1140" cy="120" r="130" fill="#dbeafe" opacity="0.8"/>
      <circle cx="1060" cy="600" r="170" fill="#ecfccb" opacity="0.55"/>
      <rect x="120" y="140" width="1040" height="440" rx="36" fill="rgba(255,255,255,0.6)" stroke="rgba(148,163,184,0.35)"/>
      <rect x="160" y="190" width="92" height="92" rx="26" fill="url(#accent)"/>
      <path d="M202 218v38l34-19-34-19Z" fill="#fff"/>
      <text x="160" y="360" fill="#0f172a" font-family="Geist Variable, Arial, sans-serif" font-size="58" font-weight="700">${escapeSvg(title)}</text>
      <text x="160" y="420" fill="#475569" font-family="Geist Variable, Arial, sans-serif" font-size="30" font-weight="500">${escapeSvg(subtitle)}</text>
      <text x="160" y="500" fill="#7c3aed" font-family="Geist Variable, Arial, sans-serif" font-size="24" font-weight="700">Local Zoom recording</text>
    </svg>`;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildLibraryPosterDataUri(item: RecordingItem): string {
  const svg = `
    <svg width="640" height="360" viewBox="0 0 640 360" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#f4f7fb"/>
        </linearGradient>
      </defs>
      <rect width="640" height="360" fill="url(#bg)"/>
      <rect x="0" y="0" width="640" height="360" fill="${posterAccentHex(item.accent)}" opacity="0.22"/>
      <circle cx="92" cy="90" r="54" fill="${posterAccentHex(item.accent)}" opacity="0.18"/>
      <circle cx="560" cy="64" r="72" fill="#dbeafe" opacity="0.8"/>
      <path d="M300 120v120l104-60-104-60Z" fill="${posterToneHex(item.tone)}"/>
      <text x="40" y="286" fill="#0f172a" font-family="Geist Variable, Arial, sans-serif" font-size="28" font-weight="700">${escapeSvg(item.title)}</text>
      <text x="40" y="320" fill="#64748b" font-family="Geist Variable, Arial, sans-serif" font-size="18" font-weight="500">${escapeSvg(item.meta)}</text>
    </svg>`;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function posterAccentHex(value: string): string {
  if (value === 'var(--bg-success)') return '#bbf7d0';
  if (value === 'var(--bg-warning)') return '#fde68a';
  if (value === 'var(--bg-danger)') return '#fecaca';
  return '#e9ddff';
}

function posterToneHex(value: string): string {
  if (value === 'var(--text-success)') return '#15803d';
  if (value === 'var(--text-warning)') return '#b45309';
  if (value === 'var(--text-danger)') return '#b91c1c';
  return '#6d28d9';
}

function getVisibleRecordings(items: RecordingItem[], section: SidebarSection): RecordingItem[] {
  return items
    .filter((item) => {
      if (section === 'favorites') return item.favorite && !item.trashed;
      if (section === 'shared') return item.shared && !item.trashed;
      if (section === 'trash') return item.trashed;
      return !item.trashed;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getSectionLabel(section: SidebarSection): string {
  if (section === 'shared') return 'Shared';
  if (section === 'favorites') return 'Favorites';
  if (section === 'trash') return 'Trash';
  return 'My library';
}

function getSectionDescription(section: SidebarSection): string {
  if (section === 'shared') return 'Recordings you marked as shared.';
  if (section === 'favorites') return 'Your starred recordings.';
  if (section === 'trash') return 'Recordings waiting to be restored or removed.';
  return 'Recordings stay local on this machine.';
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function shellStateFor(status: RecorderStatus['state']): string {
  if (status === 'recording') return 'Recording';
  if (status === 'paused') return 'Paused';
  if (status === 'processing') return 'Processing';
  if (status === 'finished') return 'Ready';
  return 'Ready';
}

export default function App() {
  const [status, setStatus] = useState<RecorderStatus>(defaultStatus);
  const [setupStatus, setSetupStatus] = useState<{
    ready: boolean;
    setupComplete: boolean;
    platformSupported: boolean;
    ffmpegAvailable: boolean;
    ffmpegBundleReady: boolean;
    requiresDownload: boolean;
    outputDirectory: string;
    missing: string[];
  } | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [installingFfmpeg, setInstallingFfmpeg] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installStage, setInstallStage] = useState('Loading...');
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>(defaultStatus.microphones);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('fullscreen');
  const [selectedMicrophone, setSelectedMicrophone] = useState('default');
  const [systemAudioDevices, setSystemAudioDevices] = useState<CaptureDevice[]>([{ id: 'none', label: 'Not set' }]);
  const [cameraDevices, setCameraDevices] = useState<CaptureDevice[]>([{ id: 'none', label: 'Not set' }]);
  const [selectedSystemAudio, setSelectedSystemAudio] = useState('none');
  const [selectedCamera, setSelectedCamera] = useState('none');
  const [frameRate, setFrameRate] = useState<RecordingFrameRate>(30);
  const [quality, setQuality] = useState<RecordingQuality>('high');
  const [outputDirectory, setOutputDirectory] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [selectedVideoPath, setSelectedVideoPath] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(() => getPageFromHash());
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>('library');
  const [recordings, setRecordings] = useState<RecordingItem[]>(() => loadRecordings());
  const [recordingThumbnails, setRecordingThumbnails] = useState<Record<string, string>>({});
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [showPlaybackPoster, setShowPlaybackPoster] = useState(true);
  const [loadingRegion, setLoadingRegion] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [compactView, setCompactView] = useState(false);
  const [editingRecordingPath, setEditingRecordingPath] = useState<string | null>(null);
  const [editingRecordingTitle, setEditingRecordingTitle] = useState('');
  const editingTitleInputRef = useRef<HTMLInputElement | null>(null);
  const lastCommittedPathRef = useRef<string | null>(null);

  const regionSelectorMode = useMemo(() => new URLSearchParams(window.location.search).get('mode') === 'region-selector-overlay', []);
  const regionSelectorControlsMode = useMemo(
    () => new URLSearchParams(window.location.search).get('mode') === 'region-selector-controls',
    []
  );
  const recordingToolbarMode = useMemo(() => new URLSearchParams(window.location.search).get('mode') === 'recording-toolbar', []);
  const recordingPathsKey = recordings.map((item) => item.path).join('\n');

  const currentVideoPath =
    selectedVideoPath ?? status.finalVideoPath ?? getVisibleRecordings(recordings, 'library')[0]?.path ?? recordings[0]?.path ?? null;
  const activeRecording = recordings.find((item) => item.path === currentVideoPath) ?? recordings[0] ?? null;
  const canStart = status.state === 'idle' || status.state === 'finished';
  const canResume = status.state === 'paused';
  const canStop = status.state === 'recording' || status.state === 'paused';
  const shellState = shellStateFor(status.state);
  const isRecordingScreen = status.state === 'recording' || status.state === 'paused' || status.state === 'processing';
  const environmentIssue =
    status.error ??
    (status.platform === 'linux' && status.sessionType?.toLowerCase() === 'wayland'
      ? 'Wayland screen capture is not supported in this MVP. Please login using an Xorg/X11 session.'
      : status.platform === 'linux' && status.sessionType?.toLowerCase() !== 'x11' && status.sessionType !== null
        ? 'This MVP only supports X11 screen capture.'
        : status.platform !== 'linux' && status.platform !== 'win32'
          ? 'This build only supports Linux and Windows.'
          : null);
  const navigateToPage = (next: Page) => {
    setPage(next);
    pushPage(next);
  };

  useEffect(() => {
    let alive = true;

    void window.recorder.getSetupStatus().then((nextSetupStatus) => {
      if (!alive) return;
      setSetupStatus(nextSetupStatus);
    }).catch(() => {
      if (!alive) return;
      setSetupStatus({
        ready: false,
        setupComplete: false,
        platformSupported: false,
        ffmpegAvailable: false,
        ffmpegBundleReady: false,
        requiresDownload: true,
        outputDirectory: '',
        missing: ['Setup could not be checked.']
      });
    });

    void window.recorder.getStatus().then((currentStatus) => {
      if (!alive) return;
      setStatus(currentStatus);
      setMicrophones(currentStatus.microphones);
      setCaptureMode(currentStatus.captureMode);
      setSelectedMicrophone(currentStatus.microphone);
      setSelectedRegion((current) => currentStatus.region ?? (currentStatus.captureMode === 'fullscreen' ? null : current));
      if (currentStatus.finalVideoPath) {
        setSelectedVideoPath(currentStatus.finalVideoPath);
      }
    });

    void window.recorder.getMicrophones().then((devices) => {
      if (!alive) return;
      setMicrophones(devices);
    });

    void window.recorder.getCaptureDevices().then((devices) => {
      if (!alive) return;
      setSystemAudioDevices(devices.systemAudio);
      setCameraDevices(devices.cameras);
      setOutputDirectory((current) => current || devices.defaultOutputDirectory);
    });

    const unsubscribe = window.recorder.onStatusUpdated((nextStatus) => {
      setStatus(nextStatus);
      setCaptureMode(nextStatus.captureMode);
      setSelectedMicrophone(nextStatus.microphone);
      setMicrophones(nextStatus.microphones);
      setSelectedRegion((current) => nextStatus.region ?? (nextStatus.captureMode === 'fullscreen' ? null : current));
      if (nextStatus.finalVideoPath) {
        setSelectedVideoPath(nextStatus.finalVideoPath);
      } else if (nextStatus.state !== 'finished') {
        setSelectedVideoPath(null);
      }
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handleHashChange = () => setPage(getPageFromHash());
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (status.state === 'finished' && status.finalVideoPath && lastCommittedPathRef.current !== status.finalVideoPath) {
      lastCommittedPathRef.current = status.finalVideoPath;
      setRecordings((current) => {
        const next = [
          buildRecordingItem(status.finalVideoPath as string, status.elapsedMs, current.length),
          ...current.filter((item) => item.path !== status.finalVideoPath)
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return next.slice(0, 12);
      });
      setSelectedVideoPath(status.finalVideoPath);
      navigateToPage('video');
    }

    if (status.state !== 'finished' && status.finalVideoPath == null) {
      lastCommittedPathRef.current = null;
    }
  }, [status.elapsedMs, status.finalVideoPath, status.state]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RECORDINGS_STORAGE_KEY, JSON.stringify(recordings));
    } catch {
      // Best-effort only.
    }
  }, [recordings]);

  useEffect(() => {
    let active = true;
    const paths = recordingPathsKey ? recordingPathsKey.split('\n') : [];

    void Promise.all(
      paths.map(async (recordingPath) => {
        try {
          const thumbnail = await window.recorder.getRecordingThumbnail(recordingPath);
          return [recordingPath, thumbnail] as const;
        } catch {
          return null;
        }
      })
    ).then((entries) => {
      if (!active) return;
      setRecordingThumbnails((current) => {
        const next = { ...current };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    });

    return () => {
      active = false;
    };
  }, [recordingPathsKey]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    setPlaybackUrl(null);
    setPlaybackError(null);
    setShowPlaybackPoster(true);

    if (!currentVideoPath) {
      return;
    }

    void window.recorder
      .readRecording(currentVideoPath)
      .then((arrayBuffer) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(arrayBuffer)], { type: 'video/mp4' }));
        setPlaybackUrl(objectUrl);
      })
      .catch((error) => {
        if (!active) return;
        setPlaybackError(extractErrorMessage(error));
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [currentVideoPath]);

  useEffect(() => {
    if (status.state !== 'recording') {
      return;
    }

    const timer = window.setInterval(() => {
      void window.recorder.getStatus().then(setStatus).catch(() => undefined);
    }, 500);

    return () => window.clearInterval(timer);
  }, [status.state]);

  useEffect(() => {
    document.title = page === 'video' ? 'Local Zoom - Player' : 'Local Zoom - Library';
  }, [page]);

  useEffect(() => {
    const unsubscribe = window.recorder.onFfmpegInstallProgress(({ progress, stage }) => {
      console.log('[app] FFmpeg install progress update', { progress, stage });
      setInstallProgress(progress);
      setInstallStage(stage);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!setupStatus || setupStatus.setupComplete || installingFfmpeg) {
      return;
    }

    if (setupStatus.requiresDownload || !setupStatus.ffmpegAvailable) {
      console.log('[app] setup is waiting for user action to install');
    }
  }, [setupStatus?.setupComplete, setupStatus?.requiresDownload, setupStatus?.ffmpegAvailable, installingFfmpeg]);

  useEffect(() => {
    let active = true;

    const stalePaths = recordings
      .map((item) => item.path)
      .filter((path) => path.trim().length > 0);

    if (!stalePaths.length) {
      return;
    }

    void Promise.all(stalePaths.map(async (path) => {
      try {
        const exists = await window.recorder.recordingExists(path);
        return [path, exists] as const;
      } catch {
        return [path, false] as const;
      }
    })).then((entries) => {
      if (!active) return;
      const validPaths = new Set(entries.filter(([, exists]) => exists).map(([path]) => path));
      setRecordings((current) => current.filter((item) => validPaths.has(item.path)));
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!editingRecordingPath) {
      return;
    }

    window.setTimeout(() => {
      editingTitleInputRef.current?.focus();
      editingTitleInputRef.current?.select();
    }, 0);
  }, [editingRecordingPath]);

  async function handleSetupDownload() {
    if (installingFfmpeg) {
      return;
    }

    setInstallingFfmpeg(true);
    setSetupBusy(true);
    setSetupError(null);
    setInstallStage('Checking FFmpeg');
    setInstallProgress(0);
    console.log('[app] starting FFmpeg setup download flow');

    try {
      const ok = await window.recorder.downloadFfmpegBundle();
      console.log('[app] FFmpeg setup result', { ok });
      if (!ok) {
        setSetupError('Install failed. Please check your internet connection and try again.');
        return;
      }

      const nextSetup = await window.recorder.getSetupStatus();
      console.log('[app] setup status after install', nextSetup);
      const finalizedSetup = { ...nextSetup, ready: nextSetup.ready || nextSetup.ffmpegAvailable, setupComplete: true };
      setSetupStatus(finalizedSetup);
      await window.recorder.completeSetup();
      setSetupError(null);
      setInstallStage('Ready');
      setInstallProgress(100);
    } catch (error) {
      setSetupError(extractErrorMessage(error));
    } finally {
      setSetupBusy(false);
      setInstallingFfmpeg(false);
    }
  }

  async function handleSetupContinue() {
    setSetupBusy(true);
    setSetupError(null);
    try {
      const nextSetup = await window.recorder.getSetupStatus();
      if (!nextSetup.ready) {
        setSetupError(nextSetup.missing.join('\n'));
        return;
      }
      await window.recorder.completeSetup();
      setSetupStatus({ ...nextSetup, ready: true, setupComplete: true });
    } catch (error) {
      setSetupError(extractErrorMessage(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function handleSelectRegion() {
    setLoadingRegion(true);
    try {
      const region = await window.recorder.selectRegion();
      if (region) {
        setSelectedRegion(region);
        setCaptureMode('region');
      }
    } catch (error) {
      setStatus((current) => ({ ...current, error: extractErrorMessage(error) }));
    } finally {
      setLoadingRegion(false);
    }
  }

  async function handleRefreshMicrophones() {
    try {
      const [nextMicrophones, devices] = await Promise.all([
        window.recorder.getMicrophones(),
        window.recorder.getCaptureDevices()
      ]);
      setMicrophones(nextMicrophones);
      setSystemAudioDevices(devices.systemAudio);
      setCameraDevices(devices.cameras);
      setOutputDirectory((current) => current || devices.defaultOutputDirectory);
    } catch (error) {
      setStatus((current) => ({ ...current, error: extractErrorMessage(error) }));
    }
  }

  async function handleSelectOutputDirectory() {
    try {
      const selected = await window.recorder.selectOutputDirectory(outputDirectory);
      if (selected) setOutputDirectory(selected);
    } catch (error) {
      setStatus((current) => ({ ...current, error: extractErrorMessage(error) }));
    }
  }

  async function handleStart() {
    try {
      let targetOutputDirectory = outputDirectory;
      if (!targetOutputDirectory) {
        const devices = await window.recorder.getCaptureDevices();
        targetOutputDirectory = devices.defaultOutputDirectory;
        setOutputDirectory(targetOutputDirectory);
      }
      setSelectedVideoPath(null);
      navigateToPage('library');
      const next = await window.recorder.start({
        captureMode,
        microphone: selectedMicrophone,
        systemAudio: selectedSystemAudio,
        camera: selectedCamera,
        frameRate,
        quality,
        outputDirectory: targetOutputDirectory,
        region: captureMode === 'region' ? selectedRegion ?? undefined : undefined
      });
      setStatus(next);
    } catch (error) {
      setStatus((current) => ({ ...current, error: extractErrorMessage(error) }));
    }
  }

  async function handleResume() {
    try {
      setStatus(await window.recorder.resume());
    } catch (error) {
      setStatus((current) => ({ ...current, error: extractErrorMessage(error) }));
    }
  }

  async function handlePause() {
    try {
      setStatus(await window.recorder.pause());
    } catch (error) {
      setStatus((current) => ({ ...current, error: extractErrorMessage(error) }));
    }
  }

  async function handleDiscard() {
    try {
      const next = await window.recorder.discard();
      setStatus(next);
      setSelectedVideoPath(null);
      navigateToPage('library');
    } catch (error) {
      setStatus((current) => ({ ...current, error: extractErrorMessage(error) }));
    }
  }

  async function handleStop() {
    try {
      const next = await window.recorder.stop();
      setStatus(next);
      if (next.finalVideoPath) {
        setSelectedVideoPath(next.finalVideoPath);
        setPage('video');
      }
    } catch (error) {
      setStatus((current) => ({ ...current, error: extractErrorMessage(error) }));
    }
  }

  async function handleShare() {
    if (!currentVideoPath) {
      return;
    }

    try {
      await navigator.clipboard.writeText(currentVideoPath);
      setRecordings((current) =>
        current.map((item) => (item.path === currentVideoPath ? { ...item, shared: true, trashed: false } : item))
      );
      setShareFeedback('Path copied');
      window.setTimeout(() => setShareFeedback(null), 1400);
    } catch {
      setStatus((current) => ({ ...current, error: 'Unable to copy the recording path.' }));
    }
  }

  function updateRecording(path: string, updater: (item: RecordingItem) => RecordingItem) {
    setRecordings((current) => current.map((item) => (item.path === path ? updater(item) : item)));
  }

  function toggleFavorite(path: string) {
    updateRecording(path, (item) => ({ ...item, favorite: !item.favorite }));
  }

  function toggleShared(path: string) {
    updateRecording(path, (item) => ({ ...item, shared: !item.shared, trashed: false }));
  }

  function toggleTrash(path: string) {
    const current = recordings.find((item) => item.path === path);
    if (!current) {
      return;
    }

    if (current.trashed) {
      updateRecording(path, (item) => ({ ...item, trashed: false }));
      return;
    }

    void window.recorder.deleteRecording(path)
      .then((deleted) => {
        if (deleted) {
          setRecordings((items) => items.filter((item) => item.path !== path));
        }
      })
      .catch((error) => {
        setStatus((currentStatus) => ({ ...currentStatus, error: extractErrorMessage(error) }));
      });
  }

  function beginRenameRecording(path: string) {
    const current = recordings.find((item) => item.path === path);
    if (!current) {
      return;
    }

    setEditingRecordingPath(path);
    setEditingRecordingTitle(current.title);
  }

  function commitRenameRecording() {
    if (!editingRecordingPath) {
      return;
    }

    const current = recordings.find((item) => item.path === editingRecordingPath);
    if (!current) {
      setEditingRecordingPath(null);
      setEditingRecordingTitle('');
      return;
    }

    const trimmed = editingRecordingTitle.trim();
    if (!trimmed || trimmed === current.title) {
      setEditingRecordingPath(null);
      setEditingRecordingTitle('');
      return;
    }

    updateRecording(editingRecordingPath, (item) => ({ ...item, title: trimmed }));
    setEditingRecordingPath(null);
    setEditingRecordingTitle('');
  }

  function cancelRenameRecording() {
    setEditingRecordingPath(null);
    setEditingRecordingTitle('');
  }

  function handleDownload() {
    if (!playbackUrl || !currentVideoPath) {
      return;
    }

    const link = document.createElement('a');
    link.href = playbackUrl;
    link.download = `${activeRecording?.title ?? 'local-zoom-recording'}.mp4`;
    link.click();
  }

  function openRecording(item: RecordingItem) {
    setSelectedVideoPath(item.path);
    navigateToPage('video');
  }

  function renderExactLibraryPage() {
    const sectionLabel = getSectionLabel(sidebarSection);
    const sectionDescription = getSectionDescription(sidebarSection);
    const visibleRecordings = getVisibleRecordings(recordings, sidebarSection);
    const showRecorder = sidebarSection === 'library';
    const emptyText =
      sidebarSection === 'shared'
        ? 'Share a recording to populate this view.'
        : sidebarSection === 'favorites'
          ? 'Star a recording to see it here.'
          : sidebarSection === 'trash'
            ? 'Deleted recordings will appear here.'
            : 'Start a new recording to populate the library.';

    return (
      <main className="h-screen w-screen overflow-hidden bg-white text-slate-900">
        <header className="flex h-[76px] items-center justify-between border-b border-slate-200 px-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-[12px] bg-violet-100 text-violet-700">
              <Video className="size-6" />
            </div>
            <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Local Zoom</h1>
            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-600">
              {shellState}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void window.recorder.minimize()}
              className="flex size-11 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              aria-label="Minimize app"
            >
              <Minus className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => window.close()}
              className="flex size-11 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              aria-label="Close app"
            >
              <X className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleRefreshMicrophones}
              className="flex h-11 items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshIcon />
              Refresh mics
            </button>
            <button
              type="button"
              onClick={() => void handleStart()}
              className="flex h-11 items-center gap-2 rounded-[12px] bg-violet-700 px-5 text-[13px] font-medium text-white shadow-[0_8px_18px_rgba(109,40,217,0.18)] transition hover:bg-violet-800"
            >
              <Plus className="size-4" />
              New recording
            </button>
            <div className="flex size-10 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">JD</div>
          </div>
        </header>

        <div className="flex h-[calc(100vh-76px)]">
          <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-5 py-5">
            <nav className="space-y-1.5">
              {[
                { icon: Folder, label: 'My library', section: 'library' as SidebarSection },
                { icon: Users, label: 'Shared', section: 'shared' as SidebarSection },
                { icon: Star, label: 'Favorites', section: 'favorites' as SidebarSection },
                { icon: Trash, label: 'Trash', section: 'trash' as SidebarSection }
              ].map(({ icon: Icon, label, section }) => {
                const active = sidebarSection === section;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setSidebarSection(section)}
                    className={`flex w-full items-center gap-3 rounded-[12px] px-3.5 py-3 text-left text-sm transition ${
                      active ? 'bg-violet-100 font-semibold text-violet-700' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="size-[18px]" />
                    {label}
                  </button>
                );
              })}
            </nav>

            <div className="my-4 h-px bg-slate-200" />
            <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">Spaces</p>
            <button
              type="button"
              onClick={() => navigateToPage('library')}
              className="flex w-full items-center gap-3 rounded-[12px] px-3.5 py-3 text-left text-sm text-slate-600 transition hover:bg-slate-50"
            >
              <Hash className="size-[18px]" /> Recorder
            </button>
            <button
              type="button"
              onClick={() => navigateToPage('video')}
              className="flex w-full items-center gap-3 rounded-[12px] px-3.5 py-3 text-left text-sm text-slate-600 transition hover:bg-slate-50"
            >
              <Hash className="size-[18px]" /> Player
            </button>

            <div className="mt-auto overflow-hidden rounded-[13px] border border-slate-200 bg-white">
              <div className="p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <HardDrive className="size-4 text-slate-500" /> Storage
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(78, 14 + recordings.length * 7)}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">{recordings.length} recordings saved locally</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSidebarSection('library');
                  window.setTimeout(() => document.getElementById('recording-settings')?.scrollIntoView({ behavior: 'smooth' }), 0);
                }}
                className="flex w-full items-center gap-3 border-t border-slate-200 px-4 py-3 text-left text-sm text-slate-600 transition hover:bg-slate-50"
              >
                <Settings className="size-4" /> Settings
              </button>
            </div>
          </aside>

          <section className="flex-1 overflow-y-auto bg-[#fbfbfd] p-8">
            <div className={`grid items-start gap-8 ${showRecorder ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : 'grid-cols-1'}`}>
              <div className="min-w-0">
                <div className="mb-6 flex items-center justify-between gap-5">
                  <div>
                    <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{sectionLabel}</h2>
                    <p className="mt-1.5 text-[13px] text-slate-500">{sectionDescription}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex h-11 w-[196px] items-center gap-2.5 rounded-[12px] border border-slate-200 bg-white px-3.5 text-slate-500">
                      <Search className="size-4" />
                      <input className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400" placeholder="Search videos" />
                    </label>
                    <div className="flex h-11 overflow-hidden rounded-[12px] border border-slate-200 bg-white">
                      <button
                        type="button"
                        onClick={() => setCompactView(false)}
                        className={`flex w-11 items-center justify-center border-r border-slate-200 ${!compactView ? 'text-violet-700' : 'text-slate-500'}`}
                        aria-label="Grid view"
                        title="Grid view"
                      >
                        <LayoutGrid className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompactView(true)}
                        className={`flex w-11 items-center justify-center ${compactView ? 'text-violet-700' : 'text-slate-500'}`}
                        aria-label="List view"
                        title="List view"
                      >
                        <List className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 306px))' }}>
                  {visibleRecordings.map((item) => (
                    <article key={item.path} className="overflow-hidden rounded-[13px] border border-slate-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
                      <button type="button" onClick={() => openRecording(item)} className="relative block h-[148px] w-full overflow-hidden bg-slate-900 text-left">
                        <img src={recordingThumbnails[item.path] ?? buildLibraryPosterDataUri(item)} alt={item.title} className="h-full w-full object-cover" />
                        <div className="absolute inset-0 bg-black/10" />
                        <span className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-violet-600 shadow-lg">
                          <Play className="ml-0.5 size-5 fill-current" />
                        </span>
                        <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">{item.durationLabel}</span>
                      </button>
                      <div className="px-3.5 pb-3 pt-3">
                        {editingRecordingPath === item.path ? (
                          <div className="mb-2 flex items-center gap-2">
                            <input
                              ref={editingTitleInputRef}
                              value={editingRecordingTitle}
                              onChange={(event) => setEditingRecordingTitle(event.target.value)}
                              onBlur={() => commitRenameRecording()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  commitRenameRecording();
                                }

                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelRenameRecording();
                                }
                              }}
                              className="h-9 min-w-0 flex-1 rounded-[10px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none"
                              aria-label="Rename recording title"
                            />
                            <button
                              type="button"
                              onClick={commitRenameRecording}
                              className="rounded-[10px] border border-slate-200 px-2.5 py-1.5 text-xs transition hover:bg-slate-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelRenameRecording}
                              className="rounded-[10px] border border-slate-200 px-2.5 py-1.5 text-xs transition hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => beginRenameRecording(item.path)}
                            className="block w-full text-left text-sm font-semibold text-slate-900 transition hover:text-violet-700"
                            title="Rename recording"
                          >
                            {item.title}
                          </button>
                        )}
                        <p className="mt-1 text-xs text-slate-500">{formatRelativeDate(item.createdAt)} · Saved locally</p>
                        <div className="mt-3 flex items-center gap-2">
                          <button type="button" onClick={() => toggleFavorite(item.path)} className={`flex size-8 items-center justify-center rounded-[9px] border border-slate-200 ${item.favorite ? 'bg-violet-50 text-violet-700' : 'text-slate-500 hover:bg-slate-50'}`} aria-label="Favorite">
                            <Star className={`size-4 ${item.favorite ? 'fill-current' : ''}`} />
                          </button>
                          <button type="button" onClick={() => toggleShared(item.path)} className={`flex size-8 items-center justify-center rounded-[9px] border border-slate-200 ${item.shared ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50'}`} aria-label="Share">
                            <Upload className="size-4" />
                          </button>
                          <button type="button" onClick={() => toggleTrash(item.path)} className="flex size-8 items-center justify-center rounded-[9px] border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Move to trash">
                            <Trash className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => beginRenameRecording(item.path)}
                            className="flex size-8 items-center justify-center rounded-[9px] border border-slate-200 text-slate-500 hover:bg-slate-50"
                            aria-label="Rename recording"
                            title="Rename recording"
                          >
                            <PencilLine className="size-4" />
                          </button>
                          <MoreVertical className="ml-auto size-4 text-slate-400" />
                        </div>
                      </div>
                    </article>
                  ))}

                  {showRecorder ? (
                    <button type="button" onClick={() => void handleStart()} className="flex min-h-[255px] items-center justify-center rounded-[13px] border border-dashed border-violet-300 bg-white/70 text-center transition hover:bg-white">
                      <span>
                        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                          <Plus className="size-7" />
                        </span>
                        <span className="mt-3 block text-sm font-semibold text-slate-900">Record new</span>
                        <span className="mt-1.5 block text-xs text-slate-500">Start a new recording</span>
                      </span>
                    </button>
                  ) : null}

                  {!visibleRecordings.length && !showRecorder ? (
                    <div className="col-span-full flex min-h-[255px] items-center justify-center rounded-[13px] border border-dashed border-slate-300 bg-white p-6 text-center">
                      <div>
                        <Video className="mx-auto size-8 text-slate-400" />
                        <p className="mt-3 text-sm font-semibold text-slate-700">No items here yet</p>
                        <p className="mt-1 text-xs text-slate-500">{emptyText}</p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {showRecorder ? (
                  <div className="mt-5 rounded-[13px] border border-slate-200 bg-white p-5 shadow-[0_8px_22px_rgba(15,23,42,0.035)]">
                    <div className="mb-4">
                      <h3 className="text-base font-semibold text-slate-900">Capture setup</h3>
                      <p className="mt-1 text-xs text-slate-500">Choose what and how you want to record.</p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <ExactModeTile active={captureMode === 'fullscreen'} icon={<Monitor className="size-6" />} label="Full screen" description="Capture the entire desktop." onClick={() => setCaptureMode('fullscreen')} />
                      <ExactModeTile active={captureMode === 'region'} icon={<ScanLine className="size-6" />} label="Custom area" description="Record only a selected area." onClick={() => setCaptureMode('region')} />
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="relative flex h-16 cursor-pointer items-center gap-3 rounded-[12px] border border-slate-200 px-3.5">
                        <select value={selectedMicrophone} onChange={(event) => setSelectedMicrophone(event.target.value)} className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0">
                          {microphones.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
                        </select>
                        <span className="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-violet-50 text-violet-600"><Mic className="size-[18px]" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] text-slate-500">Microphone</span>
                          <span className="mt-0.5 block truncate text-xs font-medium text-slate-800">{microphones.find((device) => device.id === selectedMicrophone)?.label ?? 'Default Microphone'}</span>
                        </span>
                        <ChevronDown className="pointer-events-none size-4 text-slate-500" />
                      </label>
                      <label className="relative flex h-16 cursor-pointer items-center gap-3 rounded-[12px] border border-slate-200 px-3.5">
                        <select value={selectedSystemAudio} onChange={(event) => setSelectedSystemAudio(event.target.value)} className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0">
                          {systemAudioDevices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
                        </select>
                        <span className="pointer-events-none flex size-9 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600"><Volume2 className="size-[18px]" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] text-slate-500">System audio</span>
                          <span className="mt-0.5 block truncate text-xs font-medium text-slate-800">{systemAudioDevices.find((device) => device.id === selectedSystemAudio)?.label ?? 'Not set'}</span>
                        </span>
                        <ChevronDown className="pointer-events-none size-4 text-slate-500" />
                      </label>
                      <label className="relative flex h-16 cursor-pointer items-center gap-3 rounded-[12px] border border-slate-200 px-3.5">
                        <select value={selectedCamera} onChange={(event) => setSelectedCamera(event.target.value)} className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0">
                          {cameraDevices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
                        </select>
                        <span className="pointer-events-none flex size-9 items-center justify-center rounded-[10px] bg-indigo-50 text-indigo-600"><Camera className="size-[18px]" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] text-slate-500">Camera</span>
                          <span className="mt-0.5 block truncate text-xs font-medium text-slate-800">{cameraDevices.find((device) => device.id === selectedCamera)?.label ?? 'Not set'}</span>
                        </span>
                        <ChevronDown className="pointer-events-none size-4 text-slate-500" />
                      </label>
                    </div>

                    <div className="mt-4 flex items-center gap-2.5 rounded-[10px] bg-violet-50 px-4 py-3 text-xs text-violet-600">
                      <Info className="size-4 shrink-0" />
                      <span><strong className="font-semibold">Tip:</strong> You can change these settings anytime before starting the recording.</span>
                    </div>
                  </div>
                ) : null}
              </div>

              {showRecorder ? (
                <aside id="recording-settings" className="rounded-[13px] border border-slate-200 bg-white p-5 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
                  <h3 className="text-[17px] font-semibold text-slate-900">Recording settings</h3>

                  <SettingsField label="Mode">
                    <select value={captureMode} onChange={(event) => setCaptureMode(event.target.value as CaptureMode)} className="relative z-10 h-11 w-full cursor-pointer appearance-none rounded-[11px] border border-slate-200 bg-white px-3.5 text-sm outline-none">
                      <option value="fullscreen">Full screen</option>
                      <option value="region">Custom area</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute bottom-3.5 right-3.5 z-20 size-4 text-slate-500" />
                  </SettingsField>

                  <div className="mt-5">
                    <p className="mb-2 text-xs font-medium text-slate-600">Region</p>
                    <div className="grid grid-cols-[minmax(0,1fr)_122px] gap-3">
                      <div className="flex h-11 items-center rounded-[11px] border border-slate-200 bg-slate-50 px-3.5 text-xs text-slate-500">
                        {selectedRegion ? `${selectedRegion.width} × ${selectedRegion.height}` : 'Not set'}
                      </div>
                      <button type="button" onClick={handleSelectRegion} disabled={loadingRegion} className="flex h-11 items-center justify-center gap-2 rounded-[11px] border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        <ScanLine className="size-4" /> {loadingRegion ? 'Selecting' : 'Select region'}
                      </button>
                    </div>
                  </div>

                  <SettingsField label="Frame rate">
                    <select value={frameRate} onChange={(event) => setFrameRate(Number(event.target.value) as RecordingFrameRate)} className="relative z-10 h-11 w-full cursor-pointer appearance-none rounded-[11px] border border-slate-200 bg-white px-3.5 text-sm outline-none">
                      <option value={24}>24 FPS</option>
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute bottom-3.5 right-3.5 z-20 size-4 text-slate-500" />
                  </SettingsField>
                  <SettingsField label="Quality">
                    <select value={quality} onChange={(event) => setQuality(event.target.value as RecordingQuality)} className="relative z-10 h-11 w-full cursor-pointer appearance-none rounded-[11px] border border-slate-200 bg-white px-3.5 text-sm outline-none">
                      <option value="high">High (Recommended)</option>
                      <option value="balanced">Balanced</option>
                      <option value="compact">Compact</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute bottom-3.5 right-3.5 z-20 size-4 text-slate-500" />
                  </SettingsField>
                  <SettingsField label="Save recordings to">
                    <div className="flex h-11 overflow-hidden rounded-[11px] border border-slate-200">
                      <span className="flex min-w-0 flex-1 items-center truncate bg-slate-50 px-3.5 text-xs text-slate-500" title={outputDirectory}>{outputDirectory || 'Loading folder...'}</span>
                      <button type="button" onClick={() => void handleSelectOutputDirectory()} className="flex w-12 items-center justify-center border-l border-slate-200 text-slate-500 transition hover:bg-slate-50" aria-label="Choose recording folder"><FolderOpen className="size-4" /></button>
                    </div>
                  </SettingsField>

                  {captureMode === 'region' && selectedRegion ? (
                    <div className="mt-5 rounded-[11px] border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-500"><span>Selected area</span><span>{selectedRegion.x}, {selectedRegion.y}</span></div>
                      <div className="mt-2 h-16 rounded-[8px] border border-dashed border-violet-300 bg-violet-50" />
                    </div>
                  ) : null}

                  <div className="my-5 h-px bg-slate-200" />
                  <button type="button" onClick={() => void handleStart()} className="flex h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-violet-700 text-sm font-medium text-white shadow-[0_8px_18px_rgba(109,40,217,0.18)] transition hover:bg-violet-800">
                    <CircleDot className="size-4" /> Start recording
                  </button>
                </aside>
              ) : null}
            </div>

            {showRecorder && (environmentIssue || status.ffmpegMessage || status.error) ? (
              <div className="mt-5 rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {status.error ?? environmentIssue ?? status.ffmpegMessage}
              </div>
            ) : null}

            {showRecorder ? (
              <div className="mt-5 rounded-[13px] border border-slate-200 bg-white px-5 py-4 shadow-[0_8px_22px_rgba(15,23,42,0.03)]">
                <div className="flex items-center gap-5">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-violet-100 text-violet-700"><Monitor className="size-6" /></div>
                  <div className="mr-2 min-w-[118px]"><p className="text-sm font-semibold">How to record</p></div>
                  {[
                    ['1', 'Choose area', 'Select full screen or custom area'],
                    ['2', 'Check settings', 'Select mic, audio and preferences'],
                    ['3', 'Start recording', 'Click the start button'],
                    ['4', 'Finish & save', 'Find it in your library']
                  ].map(([step, title, description], index) => (
                    <React.Fragment key={step}>
                      {index > 0 ? <ChevronRight className="size-4 shrink-0 text-slate-300" /> : null}
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">{step}</span>
                        <span className="min-w-0"><span className="block text-xs font-semibold text-slate-800">{title}</span><span className="mt-1 block text-[11px] leading-4 text-slate-500">{description}</span></span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <RecordingToolbar
          visible={isRecordingScreen}
          state={status.state}
          elapsedMs={status.elapsedMs}
          microphoneLabel={microphones.find((device) => device.id === selectedMicrophone)?.label ?? selectedMicrophone}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onDiscard={handleDiscard}
          onCancel={() => window.close()}
          onMinimize={() => void window.recorder.minimize()}
        />
      </main>
    );
  }

  function renderLibraryPage() {
    const sectionLabel = getSectionLabel(sidebarSection);
    const sectionDescription = getSectionDescription(sidebarSection);
    const visibleRecordings = getVisibleRecordings(recordings, sidebarSection);
    const latestRecording = visibleRecordings[0] ?? null;
    const emptyText =
      sidebarSection === 'shared'
        ? 'Share a recording to populate this view.'
        : sidebarSection === 'favorites'
          ? 'Star a recording to see it here.'
          : sidebarSection === 'trash'
            ? 'Deleted recordings will appear here.'
            : 'Start a new recording to populate the library.';

    return (
      <main className="min-h-screen w-screen p-0 text-slate-900">
        <div className="h-screen w-screen">
          <div className="h-full w-full">
            <div className="h-full overflow-hidden rounded-none border-0 bg-[var(--surface-2)] shadow-none">
              <div className="flex h-[76px] items-center justify-between gap-4 border-b border-[var(--border)] px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--bg-accent)]">
                    <Video className="h-5 w-5 text-[var(--text-accent)]" />
                  </div>
                  <h1 className="text-lg font-semibold tracking-tight">Local Zoom</h1>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2 py-0.5 text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
                    {shellState}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] transition hover:bg-[var(--surface-1)]"
                    onClick={() => void window.recorder.minimize()}
                    aria-label="Minimize app"
                  >
                    <Minus className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
                  </button>
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] transition hover:bg-[var(--surface-1)]"
                    onClick={() => window.close()}
                    aria-label="Close app"
                  >
                    <X className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
                  </button>
                  <button
                    type="button"
                    className="flex h-11 items-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] px-4 text-[13px] font-medium transition hover:bg-[var(--surface-1)]"
                    onClick={handleRefreshMicrophones}
                  >
                    <RefreshIcon />
                    Refresh mics
                  </button>
                  <button
                    type="button"
                    className="flex h-11 items-center gap-2 rounded-[12px] bg-[var(--fill-primary)] px-5 text-[13px] font-medium text-[var(--on-primary)] transition hover:opacity-95"
                    onClick={() => void handleStart()}
                  >
                    <Video className="h-[15px] w-[15px]" />
                    New recording
                  </button>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-accent)] text-xs font-semibold text-[var(--text-accent)]">
                    JD
                  </div>
                </div>
              </div>

              <div className="flex h-[calc(100%-76px)] flex-col lg:flex-row">
                <aside className="flex w-full flex-shrink-0 flex-col gap-1 border-b border-[var(--border)] px-5 py-6 lg:w-60 lg:border-b-0 lg:border-r">
                  {[
                    { icon: Folder, label: 'My library', active: sidebarSection === 'library', section: 'library' as SidebarSection },
                    { icon: Users, label: 'Shared', active: sidebarSection === 'shared', section: 'shared' as SidebarSection },
                    { icon: Star, label: 'Favorites', active: sidebarSection === 'favorites', section: 'favorites' as SidebarSection },
                    { icon: Trash, label: 'Trash', active: sidebarSection === 'trash', section: 'trash' as SidebarSection }
                  ].map(({ icon: Icon, label, active, section }) => (
                    <button
                      key={label}
                      type="button"
                      className="flex items-center gap-3 rounded-[12px] px-3.5 py-3 text-left text-sm transition hover:bg-[var(--surface-1)]"
                      onClick={() => setSidebarSection(section)}
                      style={
                        active
                          ? {
                              background: 'var(--bg-accent)',
                              color: 'var(--text-accent)',
                              fontWeight: 500
                            }
                          : { color: 'var(--text-secondary)' }
                      }
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}

                  <div className="mx-1 my-3 h-px bg-[var(--border)]" />
                  <p className="mb-1 px-3.5 text-[11px] uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>
                    Spaces
                  </p>
                  {[
                    { label: 'Recorder', page: 'library' as Page },
                    { label: 'Player', page: 'video' as Page }
                  ].map((space) => (
                    <button
                      key={space.label}
                      type="button"
                      onClick={() => navigateToPage(space.page)}
                      className="flex items-center gap-3 rounded-[12px] px-3.5 py-3 text-sm text-left transition hover:bg-[var(--surface-1)]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Hash className="h-4 w-4" />
                      {space.label}
                    </button>
                  ))}
                </aside>

                <section className="grid flex-1 items-start gap-x-7 overflow-y-auto bg-[#f8f9fc] px-8 py-7 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="mb-6 flex flex-col gap-4 xl:col-start-1 xl:row-start-1 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <p className="text-lg font-semibold tracking-tight">{sectionLabel}</p>
                      <p className="mt-1.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                        {sectionDescription}
                      </p>
                    </div>
                    {sidebarSection === 'library' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div
                          className="flex h-11 items-center gap-2.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] px-4"
                          style={{ minWidth: 280 }}
                        >
                          <Search className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                          <input
                            type="text"
                            placeholder="Search videos"
                            className="w-full bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setCompactView((current) => !current)}
                          className="flex h-11 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] px-3.5 transition hover:bg-[var(--surface-1)]"
                          aria-label="Toggle compact view"
                          title={compactView ? 'List view' : 'Grid view'}
                        >
                          <LayoutGrid className="h-4 w-4" style={{ color: 'var(--text-accent)' }} />
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className={`grid gap-5 xl:col-start-1 xl:row-start-2 ${compactView ? 'grid-cols-1' : 'md:grid-cols-2 2xl:grid-cols-3'}`}>
                    {visibleRecordings.length ? (
                      visibleRecordings.map((item) => (
                        <div
                          key={item.path}
                          className="overflow-hidden rounded-[14px] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]"
                          style={{ border: '1px solid var(--border)' }}
                        >
                          <button
                            type="button"
                            onClick={() => openRecording(item)}
                            className="relative block w-full text-left"
                        >
                            <div className="relative h-[148px] overflow-hidden">
                              <img
                                src={recordingThumbnails[item.path] ?? buildLibraryPosterDataUri(item)}
                                alt={item.title}
                                className="h-full w-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/5" />
                              <span className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-lg backdrop-blur-sm">
                                <Play className="ml-0.5 h-5 w-5" style={{ color: item.tone, fill: item.tone }} />
                              </span>
                              <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-px text-[10px] text-white">
                                {item.durationLabel}
                              </span>
                            </div>
                          </button>
                          <div className="px-4 py-3.5">
                            {editingRecordingPath === item.path ? (
                              <div className="mb-2 flex items-center gap-2">
                                <input
                                  ref={editingTitleInputRef}
                                  value={editingRecordingTitle}
                                  onChange={(event) => setEditingRecordingTitle(event.target.value)}
                                  onBlur={() => commitRenameRecording()}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      commitRenameRecording();
                                    }

                                    if (event.key === 'Escape') {
                                      event.preventDefault();
                                      cancelRenameRecording();
                                    }
                                  }}
                                  className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-sm font-semibold outline-none"
                                  aria-label="Rename recording title"
                                />
                                <button
                                  type="button"
                                  onClick={commitRenameRecording}
                                  className="rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-xs transition hover:bg-[var(--surface-1)]"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelRenameRecording}
                                  className="rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-xs transition hover:bg-[var(--surface-1)]"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => beginRenameRecording(item.path)}
                                  className="mb-1 block w-full text-left text-sm font-semibold transition hover:text-violet-700"
                                  title="Rename recording"
                                >
                                  {item.title}
                                </button>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  {item.meta}
                                </p>
                              </>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => toggleFavorite(item.path)}
                                className="rounded-[9px] border border-[var(--border)] px-2.5 py-1.5 text-[11px] transition hover:bg-[var(--surface-1)]"
                                style={{ color: item.favorite ? 'var(--text-accent)' : 'var(--text-secondary)' }}
                              >
                                {item.favorite ? 'Starred' : 'Star'}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleShared(item.path)}
                                className="rounded-[9px] border border-[var(--border)] px-2.5 py-1.5 text-[11px] transition hover:bg-[var(--surface-1)]"
                                style={{ color: item.shared ? 'var(--text-success)' : 'var(--text-secondary)' }}
                              >
                                {item.shared ? 'Shared' : 'Share'}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleTrash(item.path)}
                                className="rounded-[9px] border border-[var(--border)] px-2.5 py-1.5 text-[11px] transition hover:bg-[var(--surface-1)]"
                                style={{ color: item.trashed ? 'var(--text-success)' : 'var(--text-secondary)' }}
                              >
                                {item.trashed ? 'Restore' : 'Trash'}
                              </button>
                              <button
                                type="button"
                                onClick={() => beginRenameRecording(item.path)}
                                className="rounded-[9px] border border-[var(--border)] px-2.5 py-1.5 text-[11px] transition hover:bg-[var(--surface-1)]"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                Rename
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div
                        className="col-span-full flex min-h-72 items-center justify-center rounded-[var(--radius)] border border-dashed p-6 text-center"
                        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
                      >
                        <div className="max-w-sm">
                          <Video className="mx-auto h-8 w-8" />
                          <p className="mt-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                            No items here yet
                          </p>
                          <p className="mt-1 text-xs leading-6">{emptyText}</p>
                          <button
                            type="button"
                            onClick={() => navigateToPage('library')}
                            className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-[var(--fill-primary)] px-3.5 py-2 text-[13px] font-medium text-[var(--on-primary)]"
                          >
                            <Video className="h-[15px] w-[15px]" />
                            Back to library
                          </button>
                        </div>
                      </div>
                    )}

                    {sidebarSection === 'library' ? (
                      <button
                        type="button"
                        onClick={() => void handleStart()}
                        className="flex min-h-[252px] items-center justify-center rounded-[14px] border border-dashed bg-white/60 text-center transition hover:bg-white"
                        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
                      >
                        <div>
                          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--bg-accent)] text-[var(--text-accent)]">
                            <Plus className="h-6 w-6" />
                          </span>
                          <p className="mt-3 text-sm font-semibold text-slate-900">Record new</p>
                          <p className="mt-1 text-xs">Start a new recording</p>
                        </div>
                      </button>
                    ) : null}
                  </div>

                  {sidebarSection === 'library' ? (
                    <div className="contents">
                      <div className="mt-6 rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] xl:col-start-1 xl:row-start-3">
                        <div className="mb-5 flex items-center justify-between gap-4">
                          <div>
                            <p className="text-base font-semibold tracking-tight text-slate-900">
                              Capture setup
                            </p>
                            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                              Choose what and how you want to record.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleSelectRegion}
                            disabled={loadingRegion}
                            className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] px-3.5 py-2 text-xs font-medium transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {loadingRegion ? 'Selecting...' : 'Select region'}
                          </button>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <ModeTile
                            active={captureMode === 'fullscreen'}
                            icon={<LayoutGrid className="h-5 w-5" />}
                            label="Full screen"
                            description="Capture the entire desktop."
                            onClick={() => setCaptureMode('fullscreen')}
                          />
                          <ModeTile
                            active={captureMode === 'region'}
                            icon={<Sparkles className="h-5 w-5" />}
                            label="Custom area"
                            description="Record only a selected rectangle."
                            onClick={() => setCaptureMode('region')}
                          />
                        </div>
                      </div>

                      <div className="mt-6 rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] xl:col-start-2 xl:row-span-3 xl:row-start-1 xl:mt-0">
                        <p className="mb-4 text-base font-semibold tracking-tight text-slate-900">Recording settings</p>
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>
                          <Mic className="h-4 w-4" />
                          Microphone
                        </div>
                        <select
                          className="mt-3 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm outline-none"
                          value={selectedMicrophone}
                          onChange={(event) => setSelectedMicrophone(event.target.value)}
                        >
                          {microphones.map((device) => (
                            <option key={device.id} value={device.id}>
                              {device.label}
                            </option>
                          ))}
                        </select>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <InfoChip label="Mode" value={captureMode === 'region' ? 'Custom area' : 'Full screen'} />
                          <InfoChip label="Region" value={selectedRegion ? `${selectedRegion.width} × ${selectedRegion.height}` : 'Not set'} />
                        </div>

                        {captureMode === 'region' && selectedRegion ? (
                          <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-medium uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>
                                Selected area
                              </p>
                              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {selectedRegion.x}, {selectedRegion.y}
                              </span>
                            </div>
                            <div className="mt-3 h-24 overflow-hidden rounded-[18px] border border-dashed border-[var(--border-strong)] bg-[linear-gradient(135deg,rgba(124,58,237,0.10),rgba(34,211,238,0.12))] p-2">
                              <div
                                className="mx-auto h-full rounded-[14px] border border-cyan-400/40 bg-cyan-400/12"
                                style={{
                                  aspectRatio: `${Math.max(1, selectedRegion.width)} / ${Math.max(1, selectedRegion.height)}`,
                                  maxWidth: '100%'
                                }}
                              />
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                              <span>W {selectedRegion.width}</span>
                              <span>H {selectedRegion.height}</span>
                              <span>{selectedRegion.width} × {selectedRegion.height}</span>
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-4 flex gap-2">
                          <button
                            type="button"
                            onClick={handleRefreshMicrophones}
                            className="flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm font-medium transition hover:bg-white/70"
                          >
                            Refresh
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleStart()}
                            className="flex-1 rounded-[var(--radius)] bg-[var(--fill-primary)] px-3 py-2 text-sm font-medium text-[var(--on-primary)]"
                          >
                            Start
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {sidebarSection === 'library' && (environmentIssue || status.ffmpegMessage || status.error) ? (
                    <div
                      className="mt-5 rounded-[var(--radius)] border px-4 py-3 text-sm leading-6 xl:col-start-1 xl:row-start-4"
                      style={{
                        borderColor: environmentIssue || status.error ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                        background: environmentIssue || status.error ? 'rgba(248,113,113,0.08)' : 'rgba(245,158,11,0.08)',
                        color: environmentIssue || status.error ? 'var(--text-danger)' : 'var(--text-warning)'
                      }}
                    >
                      <div className="text-[11px] uppercase tracking-[0.24em] opacity-70">Status</div>
                      <div className="mt-2 whitespace-pre-line">{status.error ?? environmentIssue ?? status.ffmpegMessage ?? 'Everything looks ready.'}</div>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          </div>
        </div>

        <RecordingToolbar
          visible={isRecordingScreen}
          state={status.state}
          elapsedMs={status.elapsedMs}
          microphoneLabel={microphones.find((device) => device.id === selectedMicrophone)?.label ?? selectedMicrophone}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onDiscard={handleDiscard}
          onCancel={() => window.close()}
          onMinimize={() => void window.recorder.minimize()}
        />
      </main>
    );
  }

  function renderVideoPage() {
    const playbackPoster = buildVideoPosterDataUri(activeRecording);
    return (
      <main className="min-h-screen w-screen p-0 text-slate-900">
        <div className="h-screen w-screen">
          <div className="h-full w-full">
            <div className="h-full overflow-hidden rounded-none border-0 bg-[var(--surface-2)] shadow-none">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigateToPage('library')}
                    className="rounded-full p-1 transition hover:bg-[var(--surface-1)]"
                    aria-label="Back to library"
                  >
                    <ArrowLeft className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeRecording) {
                        beginRenameRecording(activeRecording.path);
                      }
                    }}
                    className="text-left text-sm font-medium transition hover:text-violet-700"
                    title="Rename recording"
                    disabled={!activeRecording}
                  >
                    {activeRecording?.title ?? 'Recording playback'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeRecording) {
                        beginRenameRecording(activeRecording.path);
                      }
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-[var(--surface-1)]"
                    aria-label="Rename recording"
                    title="Rename recording"
                    disabled={!activeRecording}
                  >
                    <EditIcon />
                  </button>
                  {editingRecordingPath === activeRecording?.path ? (
                    <div className="ml-2 flex items-center gap-2">
                      <input
                        ref={editingTitleInputRef}
                        value={editingRecordingTitle}
                        onChange={(event) => setEditingRecordingTitle(event.target.value)}
                        onBlur={() => commitRenameRecording()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitRenameRecording();
                          }

                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelRenameRecording();
                          }
                        }}
                        className="h-8 w-56 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-sm outline-none"
                        aria-label="Rename recording title"
                      />
                      <button
                        type="button"
                        onClick={commitRenameRecording}
                        className="rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-xs transition hover:bg-[var(--surface-1)]"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelRenameRecording}
                        className="rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-xs transition hover:bg-[var(--surface-1)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] transition hover:bg-[var(--surface-1)]"
                      onClick={() => void window.recorder.minimize()}
                      aria-label="Minimize app"
                    >
                      <Minus className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
                    </button>
                    <button
                      type="button"
                      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] transition hover:bg-[var(--surface-1)]"
                      onClick={() => window.close()}
                      aria-label="Close app"
                    >
                      <X className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
                    </button>
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={!playbackUrl}
                    className="flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-xs transition hover:bg-[var(--surface-1)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleShare()}
                    className="flex items-center gap-1.5 rounded-[var(--radius)] bg-[var(--fill-primary)] px-3 py-1.5 text-xs font-medium text-[var(--on-primary)]"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    {shareFeedback ?? 'Share'}
                  </button>
                </div>
              </div>

              <div className="flex flex-col lg:flex-row">
                <div className="flex-1 p-4">
                  {playbackError ? (
                    <div className="flex min-h-[320px] items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-sm text-red-600">
                      {playbackError}
                    </div>
                  ) : playbackUrl ? (
                    <div className="relative overflow-hidden rounded-[var(--radius)] bg-[#1a1a1a]">
                      {showPlaybackPoster ? (
                        <img
                          src={playbackPoster}
                          alt={activeRecording?.title ?? 'Recording poster'}
                          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                        />
                      ) : null}
                      <video
                        className="block aspect-video w-full bg-black object-contain"
                        src={playbackUrl}
                        poster={playbackPoster}
                        controls
                        preload="metadata"
                        playsInline
                        onPlay={() => setShowPlaybackPoster(false)}
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-[320px] items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] bg-[var(--surface-1)] p-6 text-center">
                      <div className="max-w-sm">
                        <Play className="mx-auto h-8 w-8" style={{ color: 'var(--text-muted)' }} />
                        <p className="mt-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                          No recording selected
                        </p>
                        <p className="mt-1 text-xs leading-6" style={{ color: 'var(--text-muted)' }}>
                          Go back to the library and pick a finished recording to review it here.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-3.5">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-medium"
                        style={{
                          background: 'var(--bg-accent)',
                          color: 'var(--text-accent)'
                        }}
                      >
                        LV
                      </div>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {activeRecording ? formatRelativeDate(activeRecording.createdAt) : 'Open a recording to see details'}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <Eye className="h-[13px] w-[13px]" /> {activeRecording ? activeRecording.durationLabel : '0:00'}
                    </span>
                  </div>

                  <div className="mt-3.5 flex flex-wrap gap-2">
                    {[
                      { Icon: Video, label: status.state === 'finished' ? 'Ready to share' : 'Local preview' },
                      { Icon: Sparkles, label: 'Recorded on device' },
                      { Icon: Mic, label: microphones.find((device) => device.id === selectedMicrophone)?.label ?? 'Microphone' }
                    ].map(({ Icon, label }) => (
                      <div
                        key={label}
                        className="flex items-center gap-1.5 rounded-[var(--radius)] px-2.5 py-1.5 text-xs"
                        style={{
                          background: 'var(--surface-1)',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="w-full flex-shrink-0 border-t border-[var(--border)] p-4 lg:w-[240px] lg:border-t-0 lg:border-l">
                  <p className="mb-2.5 text-xs font-medium uppercase tracking-[0.22em]" style={{ color: 'var(--text-secondary)' }}>
                    Chapters
                  </p>
                  <div className="flex flex-col gap-2">
                    {demoChapters.map((chapter) => (
                      <div key={chapter.time} className="flex items-baseline gap-2">
                        <span className="min-w-[30px] text-[11px]" style={{ color: 'var(--text-accent)' }}>
                          {chapter.time}
                        </span>
                        <span className="text-xs">{chapter.label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] p-3">
                    <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>
                      Session
                    </div>
                    <div className="mt-1 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {status.state === 'finished' ? 'Recording complete' : shellState}
                    </div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {formatTime(status.elapsedMs)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <RecordingToolbar
          visible={isRecordingScreen}
          state={status.state}
          elapsedMs={status.elapsedMs}
          microphoneLabel={microphones.find((device) => device.id === selectedMicrophone)?.label ?? selectedMicrophone}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onDiscard={handleDiscard}
          onCancel={() => window.close()}
          onMinimize={() => void window.recorder.minimize()}
        />
      </main>
    );
  }

  if (setupStatus && (!setupStatus.ready || !setupStatus.setupComplete || !setupStatus.platformSupported || !setupStatus.ffmpegAvailable)) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-[#020b17] p-6 text-slate-50">
        <div className="w-full max-w-[560px] rounded-[28px] border border-[#1d2c3d] bg-[#0d1726] p-7 shadow-[0_20px_50px_rgba(2,6,23,0.75)]">
          <div className="mb-8 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#60a5fa] via-[#8b5cf6] to-[#34d399] transition-[width] duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, installProgress))}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-sm text-slate-300">
            <span>{setupError ? 'Loading failed' : installStage}</span>
            <span>{Math.max(0, Math.min(100, installProgress))}%</span>
          </div>

          {setupError ? (
            <button
              type="button"
              onClick={() => void handleSetupDownload()}
              className="mt-6 flex w-full items-center justify-center rounded-[14px] border border-[#2b3c4c] bg-[#2a3642] px-4 py-3 text-[18px] font-medium text-slate-100 transition hover:bg-[#313f4f]"
            >
              Retry
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSetupDownload()}
              disabled={installingFfmpeg}
              className="mt-6 flex w-full items-center justify-center rounded-[14px] border border-[#2b3c4c] bg-[#2a3642] px-4 py-3 text-[18px] font-medium text-slate-100 transition hover:bg-[#313f4f] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {installingFfmpeg ? 'Installing...' : 'Install'}
            </button>
          )}
        </div>
      </main>
    );
  }

  if (regionSelectorMode) {
    return (
      <RegionSelector
        bounds={parseRegionBounds()}
        onCancel={() => window.recorder.cancelRegionSelection()}
        onConfirm={(region) => window.recorder.submitRegionSelection(region)}
      />
    );
  }

  if (regionSelectorControlsMode) {
    return (
      <RegionSelectorControls
        onStartSelection={() => window.recorder.startRegionSelection()}
        onCancel={() => window.recorder.cancelRegionSelection()}
      />
    );
  }

  if (recordingToolbarMode) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-transparent">
        <RecordingToolbar
          visible
          state={status.state}
          elapsedMs={status.elapsedMs}
          microphoneLabel={microphones.find((device) => device.id === selectedMicrophone)?.label ?? selectedMicrophone}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onDiscard={handleDiscard}
          onCancel={() => window.close()}
          onMinimize={() => void window.recorder.minimize()}
        />
      </main>
    );
  }

  return page === 'video' ? renderVideoPage() : renderExactLibraryPage();
}

function ExactModeTile({
  active,
  icon,
  label,
  description,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex min-h-24 items-center gap-4 rounded-[13px] border px-4 text-left transition ${
        active ? 'border-violet-500 bg-white shadow-[0_6px_16px_rgba(124,58,237,0.08)]' : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <span className={`flex size-14 shrink-0 items-center justify-center rounded-[13px] border ${active ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="mt-1 block text-xs text-slate-500">{description}</span>
      </span>
      {active ? <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-violet-700 text-white"><Check className="size-3" /></span> : null}
    </button>
  );
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative mt-5">
      <p className="mb-2 text-xs font-medium text-slate-600">{label}</p>
      {children}
    </div>
  );
}

function ModeTile({
  active,
  icon,
  label,
  description,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-24 items-center gap-4 rounded-[14px] border px-4 py-4 text-left text-sm transition ${
        active
          ? 'border-[rgba(159,122,234,0.6)] bg-[rgba(255,255,255,0.7)] text-slate-900 shadow-[0_10px_24px_rgba(124,58,237,0.12)]'
          : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-white/70'
      }`}
    >
      <span
        className={`flex size-14 shrink-0 items-center justify-center rounded-[14px] border ${
          active ? 'border-[rgba(159,122,234,0.55)] bg-white text-slate-950' : 'border-[var(--border)] bg-black/5 text-[var(--text-secondary)]'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${active ? 'text-slate-900' : 'text-[var(--text-secondary)]'}`}>{label}</span>
        {description ? <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{description}</span> : null}
      </span>
    </button>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="mt-1 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
        {value}
      </div>
    </div>
  );
}

function RecordingToolbar({
  visible,
  state,
  elapsedMs,
  microphoneLabel,
  onPause,
  onResume,
  onStop,
  onDiscard,
  onCancel,
  onMinimize
}: {
  visible: boolean;
  state: RecorderStatus['state'];
  elapsedMs: number;
  microphoneLabel: string;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
  onDiscard: () => Promise<void>;
  onCancel: () => void;
  onMinimize: () => void;
}) {
  if (!visible) {
    return null;
  }

  const primaryTone =
    state === 'recording'
      ? 'bg-[var(--bg-danger)] text-[var(--text-danger)]'
      : state === 'paused'
        ? 'bg-[var(--bg-success)] text-[var(--text-success)]'
        : 'bg-[var(--bg-warning)] text-[var(--text-warning)]';

  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-1.5 rounded-3xl border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl">
        <button
          type="button"
          className={`flex h-[34px] w-[34px] items-center justify-center rounded-full ${primaryTone}`}
          onClick={() => void onStop()}
          aria-label="Finish recording"
        >
          <Square className="h-[15px] w-[15px]" style={{ color: 'currentColor', fill: 'currentColor' }} />
        </button>

        <button
          type="button"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full"
          style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
          onClick={() => void onDiscard()}
          aria-label="Discard recording"
        >
          <X className="h-4 w-4" />
        </button>

        {state === 'recording' ? (
          <button
            type="button"
            className="flex h-[34px] items-center gap-1.5 rounded-full px-3 text-sm"
            style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
            onClick={() => void onPause()}
            aria-label="Pause recording"
          >
            <Pause className="h-4 w-4" />
            Pause
          </button>
        ) : state === 'paused' ? (
          <button
            type="button"
            className="flex h-[34px] items-center gap-1.5 rounded-full px-3 text-sm"
            style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
            onClick={() => void onResume()}
            aria-label="Resume recording"
          >
            <Play className="h-4 w-4" />
            Resume
          </button>
        ) : (
          <div
            className="flex h-[34px] items-center gap-1.5 rounded-full px-3 text-sm"
            style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
          >
            <Mic className="h-4 w-4" />
            <span className="max-w-[150px] truncate">{microphoneLabel}</span>
          </div>
        )}

        <div
          className="flex h-[34px] items-center gap-1.5 rounded-full px-3 text-sm"
          style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
        >
          <span className="font-medium tabular-nums">{formatTime(elapsedMs)}</span>
        </div>

        <div className="mx-0.5 h-5 w-px bg-[var(--border)]" />

        <button
          type="button"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full"
          style={{ color: 'var(--text-secondary)' }}
          onClick={onMinimize}
          aria-label="Minimize app"
        >
          <Minus className="h-4 w-4" />
        </button>

        <button
          type="button"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full"
          style={{ color: 'var(--text-secondary)' }}
          onClick={onCancel}
          aria-label="Close app"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.7L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[13px] w-[13px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m18 2 4 4-12 12-5 1 1-5L18 2Z" />
    </svg>
  );
}
