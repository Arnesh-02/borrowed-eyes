# Borrowed Eyes — Phase 3 local voice input

## Delivered flow

The active-session **Talk to Detective** control now follows this path:

```text
hold/open voice interaction
  → microphone permission and local model preparation
  → Expo AudioStream PCM capture
  → bounded in-memory mono 16 kHz PCM buffer
  → whisper.rn local transcription
  → exact lifecycle phrase handling or existing ExperienceEngine planner
  → existing system TTS response
```

There is one root-owned `AudioController` and one `VoiceInteractionController`.
Voice input does not complete missions, change the timer, or bypass the existing
planner/mission validation boundary. Exact phrases for pause, end, quiet, and
cancel are handled deterministically before planner submission.

## Native development build requirement

`whisper.rn` is a native React Native module. Expo Go cannot load it. Expo SDK 57
requires the project to be prebuilt into a native development application before
local Whisper can be tested. The project uses Continuous Native Generation; do not
hand-edit generated `android/` or `ios/` folders.

From the repository root, with an Android SDK/device or emulator available:

```powershell
npx expo install --check
npx expo prebuild
$env:BORROWED_EYES_DEV_HTTP='1' # only if testing the private Ollama endpoint
npx expo run:android
```

For iOS, run `npx expo run:ios` on macOS with the required Xcode toolchain. After
changing `app.json`, `expo-audio`, or `whisper.rn`, rebuild the development binary;
reloading JavaScript alone does not add native permissions/modules.

The `expo-audio` config plugin enables `RECORD_AUDIO`/the iOS microphone usage
description but keeps `enableBackgroundRecording` and `enableBackgroundPlayback`
false. The app pauses the session when it loses foreground focus.

## Choose a model

On setup, select **Choose local Whisper model** and choose a model already on the
device ending in `.bin`, `.ggml`, or `.gguf`. The picker uses
`copyToCacheDirectory: true`, so the selected file is immediately available to the
native model loader. The app does not download, update, or upload model files.

Use an English Whisper model appropriate for the device, such as a small quantized
model for an initial trial. Model size, transcription latency, accuracy, and memory
use must be measured on the target device. A model being selectable is not proof
that its native runtime can load it.

## Capture and privacy boundaries

- Capture uses `expo-audio` `AudioStream`, not a recorder file.
- Native float buffers are converted to mono 16 kHz signed 16-bit PCM (resampling
  when the hardware rate or channel count differs); this is the format expected by
  the installed whisper.rn native binding.
- A single utterance is capped at 60 seconds and the raw PCM buffer is cleared after
  transcription, cancellation, timeout, or failure.
- Audio never crosses the Gemma/Ollama boundary. Only the normalized transcript can
  be submitted to the existing planner when the user chooses to continue.
- The selected model URI and model name are held in memory only. Ending a session
  releases active Whisper context but leaves the reusable adapter available for the
  next session; permanent root teardown may dispose the adapter.
- No background recording, screen-off listening, wake word, cloud transcription, or
  automatic model download is implemented.

## Voice states and controls

The store exposes `idle`, `requesting_permission`, `listening`, `transcribing`,
`thinking`, `speaking`, `paused`, `cancelled`, and `error` states. The UI shows the
latest normalized transcript only; it does not retain a transcript history.

The button starts an interaction, finishes an active capture, cancels while the
local transcription/planner is pending, stops Detective speech, or retries after
an error. Pause/end/reset cancel the active voice generation and invalidate late
planner or TTS results.

## Verification performed

The repository currently passes:

```powershell
npm run typecheck
npm run lint
npm test
```

The Node suite covers voice normalization, deterministic intents, duplicate starts,
stop/finalize, cancellation, stale callbacks, unavailable/empty input, and audio
controller reuse. It does not emulate native PCM, the JSI Whisper implementation,
microphone permission dialogs, audible TTS, or a physical device.

## Required device acceptance walkthrough

1. Build and install the native development app.
2. Select a known-good local Whisper model in setup and verify the filename appears.
3. Start a session and grant microphone permission only when starting voice input.
4. Speak a short observation, tap **Finish speaking**, and verify the transcript is
   shown and reaches the existing planner/TTS path.
5. Test empty/very short speech, denied permission, invalid model selection, a model
   load failure, cancellation during capture, cancellation during transcription, and
   repeated starts.
6. Say the exact lifecycle phrases for pause, end, quiet, and cancel. Confirm mission
   progress and timer authority remain with the existing store/engine.
7. Leave or lock the app during capture and confirm the session pauses and capture is
   cancelled; no background microphone service should remain active.
8. Repeat with Android/iOS audio interruptions, Bluetooth/headphone removal, font
   scaling, and a small screen. Record model, device, latency, and memory results.

The current workspace has no connected Android device/emulator, so this native and
audio acceptance gate remains unverified here.

## References

- Expo SDK 57 Audio: https://docs.expo.dev/versions/v57.0.0/sdk/audio/
- Expo SDK 57 DocumentPicker: https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/
- Expo development builds: https://docs.expo.dev/develop/development-builds/introduction/
- whisper.rn: https://github.com/mybigday/whisper.rn
