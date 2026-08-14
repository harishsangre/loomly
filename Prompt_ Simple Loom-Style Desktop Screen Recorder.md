Build a very simple Loom-style desktop screen recorder using **Electron + React + TypeScript + Node.js + FFmpeg**.

The first version should support **Ubuntu Linux with X11 only**. Keep the code architecture clean enough so Windows and macOS support can be added later.

## Main Goal

Create a desktop app where the user does not need to run any FFmpeg commands manually.

The app should provide:

- Full-screen recording
- Custom-area recording
- Microphone recording
- Start recording
- Pause recording
- Resume recording
- Stop recording
- Recording timer
- Preview recorded video
- Save final video as MP4

Do not add authentication, backend, database, cloud upload, accounts, sharing, webcam, annotations, or any unnecessary features.

Keep this as a small local desktop application.

## Tech Stack

Use:

- Electron
- React
- TypeScript
- Vite
- Node.js
- FFmpeg
- Tailwind CSS

Use Electron main process for all native functionality and FFmpeg execution.

React should only handle the UI.

## Important Architecture

Structure the project approximately like:

```text
src/
├── main/
│   ├── main.ts
│   ├── ipc/
│   │   └── recorder.ipc.ts
│   ├── recorder/
│   │   ├── recorder.service.ts
│   │   └── linux-recorder.ts
│   └── ffmpeg/
│       ├── ffmpeg.ts
│       └── devices.ts
│
├── preload/
│   └── preload.ts
│
└── renderer/
    ├── App.tsx
    ├── components/
    │   ├── RecorderControls.tsx
    │   ├── CaptureSelector.tsx
    │   ├── MicrophoneSelector.tsx
    │   ├── RecordingTimer.tsx
    │   └── VideoPreview.tsx
    └── types/
```

Do not execute FFmpeg directly inside React.

React communicates with Electron using IPC.

## FFmpeg Detection

On app startup, check whether FFmpeg exists:

```bash
ffmpeg -version
```

For now, if FFmpeg is not installed, show:

```text
FFmpeg is required.

Ubuntu:
sudo apt install ffmpeg
```

Do not automatically run sudo commands.

Later we can bundle FFmpeg with the application.

## Environment Detection

Detect:

```js
process.platform
```

For this MVP only allow:

```text
linux
```

Also detect:

```js
process.env.XDG_SESSION_TYPE
```

For now support only:

```text
x11
```

If Wayland is detected, show:

```text
Wayland screen capture is not supported in this MVP.
Please login using an Xorg/X11 session.
```

## Microphone Detection

Get available microphone sources using:

```bash
pactl list short sources
```

Ignore sources ending with:

```text
.monitor
```

Display valid microphone devices inside a dropdown.

Example device:

```text
alsa_input.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__hw_sofhdadsp_6__source
```

Also allow:

```text
default
```

as the default microphone option.

## Main UI

Create a simple modern dark UI.

Something similar to:

```text
┌────────────────────────────────────────────┐
│ Screen Recorder                            │
├────────────────────────────────────────────┤
│                                            │
│ Capture                                    │
│                                            │
│  ● Full Screen                             │
│  ○ Custom Area                             │
│                                            │
│ Microphone                                 │
│                                            │
│ [ Default Microphone                 ▼ ]   │
│                                            │
│                  00:00                     │
│                                            │
│             [ Start Recording ]            │
│                                            │
└────────────────────────────────────────────┘
```

While recording:

```text
┌────────────────────────────────────────────┐
│              🔴 Recording                  │
│                                            │
│                  01:24                     │
│                                            │
│       [ Pause ]       [ Finish ]           │
└────────────────────────────────────────────┘
```

While paused:

```text
┌────────────────────────────────────────────┐
│               Paused                       │
│                                            │
│                  01:24                     │
│                                            │
│       [ Resume ]      [ Finish ]           │
└────────────────────────────────────────────┘
```

## Full-Screen Recording

For X11 use:

```bash
ffmpeg \
-f x11grab \
-framerate 30 \
-i "$DISPLAY" \
-f pulse \
-i default \
-c:v libx264 \
-preset veryfast \
-crf 23 \
-c:a aac \
-b:a 128k \
recording.mkv
```

Do not output directly to MP4 during active recording.

Use:

```text
.mkv
```

as temporary recording files.

## Custom Area Recording

Create a transparent fullscreen Electron window.

The user should:

1. Click Custom Area.
2. A transparent overlay opens.
3. User clicks and drags a rectangle.
4. Show a visible border around the selected region.
5. Store:

```ts
{
  x: number;
  y: number;
  width: number;
  height: number;
}
```

6. Close the selector.
7. Return to recorder UI.

Use those coordinates with FFmpeg.

Example:

```bash
ffmpeg \
-f x11grab \
-framerate 30 \
-video_size 1280x720 \
-i "${DISPLAY}+300,200" \
-f pulse \
-i default \
-c:v libx264 \
-preset veryfast \
-crf 23 \
-c:a aac \
-b:a 128k \
recording.mkv
```

Build these values dynamically.

## Pause and Resume

Do NOT use SIGSTOP/SIGCONT for the final implementation.

Implement pause using recording segments.

When Start is clicked:

```text
segment-001.mkv
```

When Pause is clicked:

Stop FFmpeg cleanly using:

```text
SIGINT
```

Do not use SIGKILL.

When Resume is clicked:

Start another FFmpeg process:

```text
segment-002.mkv
```

Next pause:

```text
segment-003.mkv
```

Continue this pattern.

The recording timer should only count actual recording time.

It should stop while paused.

Example:

```text
Record 30 seconds
Pause 2 minutes
Record 20 seconds

Final video duration = 50 seconds
```

## Stop / Finish

When Finish is clicked:

1. Stop the current FFmpeg process cleanly.
2. Collect all segment files.
3. Create a concat file.

Example:

```text
file 'segment-001.mkv'
file 'segment-002.mkv'
file 'segment-003.mkv'
```

Then run:

```bash
ffmpeg \
-f concat \
-safe 0 \
-i segments.txt \
-c copy \
combined.mkv
```

Then convert it to MP4:

```bash
ffmpeg \
-i combined.mkv \
-c copy \
-movflags +faststart \
final-recording.mp4
```

If stream-copying fails, fall back to:

```bash
ffmpeg \
-i combined.mkv \
-c:v libx264 \
-preset veryfast \
-crf 23 \
-c:a aac \
-b:a 128k \
final-recording.mp4
```

## Recording State

Create proper recording states:

```ts
type RecordingState =
  | "idle"
  | "recording"
  | "paused"
  | "processing"
  | "finished";
```

Use these states throughout the UI.

## Electron IPC

Expose safe functions through preload.

Example:

```ts
window.recorder.start(options)
window.recorder.pause()
window.recorder.resume()
window.recorder.stop()
window.recorder.getMicrophones()
window.recorder.selectRegion()
```

Do not expose the entire Node API to React.

Use:

```ts
contextIsolation: true
nodeIntegration: false
```

## Recorder Options

Use a type similar to:

```ts
interface RecorderOptions {
  captureMode: "fullscreen" | "region";

  microphone: string;

  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

## Recording Service

Create a recorder service responsible for:

```ts
start()
pause()
resume()
stop()
```

It should manage:

```text
FFmpeg process
segment counter
temporary directory
recording state
selected region
selected microphone
final output path
```

## Temporary Files

Create a recording session directory like:

```text
~/Videos/SimpleRecorder/temp/<session-id>/
```

Example:

```text
segment-001.mkv
segment-002.mkv
segment-003.mkv
segments.txt
combined.mkv
```

Final recording should be stored somewhere like:

```text
~/Videos/SimpleRecorder/recording-2026-08-13-143000.mp4
```

After successful MP4 generation, delete temporary files.

## Error Handling

Handle errors such as:

- FFmpeg missing
- PulseAudio unavailable
- Microphone unavailable
- X11 unavailable
- Invalid custom region
- FFmpeg unexpectedly exiting
- Output conversion failure

Show simple understandable errors in the React UI.

Do not crash the Electron application.

## Preview

After Finish completes, display:

```html
<video controls />
```

using the generated MP4.

Show:

```text
Recording complete
```

and buttons:

```text
Open Video

Open Folder

New Recording
```

Use Electron shell APIs for opening the file/folder.

## Floating Recording Controller

Once the basic app works, create a small always-on-top floating window.

Example:

```text
┌──────────────────────────┐
│ 🔴 02:14                  │
│                          │
│ [ Pause ]   [ Finish ]   │
└──────────────────────────┘
```

When paused:

```text
┌──────────────────────────┐
│ ⏸ 02:14                  │
│                          │
│ [ Resume ]  [ Finish ]   │
└──────────────────────────┘
```

Set it as:

```ts
alwaysOnTop: true
```

Do not include the floating controller in the captured custom region if possible.

For the first iteration, it is okay if this floating controller is implemented after basic recording functionality works.

## Do Not Add Yet

Do not implement:

- Login
- Signup
- Backend
- Database
- AWS
- Cloud storage
- Upload
- Share links
- Webcam
- System audio
- Drawing tools
- AI
- Team workspace
- Video editing

Only create the local recorder.

## Development Order

Implement in this exact order:

1. Electron + React application setup.
2. Detect Linux/X11.
3. Check FFmpeg.
4. List microphones.
5. Full-screen recording.
6. Start and Finish.
7. Playback generated video.
8. Pause/resume using segments.
9. Custom area selection.
10. Recording timer.
11. Floating controls.
12. Error handling and cleanup.

Do not attempt all advanced functionality before basic screen + microphone recording works.

## Expected Result

I should be able to run:

```bash
npm install
npm run dev
```

Then the desktop application opens.

I select:

```text
Full Screen
Default Microphone
```

Click:

```text
Start Recording
```

The application records my screen and microphone.

I can:

```text
Pause
Resume
Finish
```

After Finish, the recording should be converted to:

```text
.mp4
```

and playable directly inside the application.

Keep the code simple, readable, modular and production-friendly.

Do not over-engineer the first version.