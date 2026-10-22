# Borrowed Eyes — development guide

> Phase 3 voice-input work is documented in [`phase-3-voice.md`](./phase-3-voice.md).
> The AI, session, timer, and system-TTS notes below remain the Phase 2 foundation.

## What this build is (and is not)

The existing Expo 57 / React Native 0.86.3 / Zustand / Expo Router app has a real
Ollama API adapter for Gemma, a validated action planner, system TTS, and a local
Whisper speech-input adapter. It is a **foreground development voice prototype**,
not on-device Gemma, Kokoro, or a finished pocket/screen-off experience.

No Ollama executable was found on PATH and the local runtime was unreachable
during implementation. No model was downloaded. Android `adb devices -l` reported
no connected devices. The test suite uses injected providers/audio bridges; it
does not establish model quality or audible native playback. See the verification
section below for the remaining live acceptance gate.

## Architecture

`Screen → existing sessionStore → existing ExperienceEngine → AIPlanner → AIProvider`

`GemmaProvider → Ollama /api/chat → runtime validator → ExperienceEngine`

`ExperienceEngine → existing MissionEngine (trusted catalogue)`

`sessionStore → AudioController → SpeechOutput / MusicOutput / SpeechInput`

- There is one application session store. `createSessionStore` is a dependency-
  injection factory for tests, not a parallel UI store.
- Gemma creates contextual conversational replies, questions and explicitly
  fictional stories, chooses a curated fact, a quiet interval, or a **catalogue
  mission ID**. It is not limited to rephrasing a fixed script.
- Physical instructions, durations and difficulties are hydrated from trusted
  local mission data. The model cannot author arbitrary physical challenges.
- Mission selection is allowed at start and after the user completes/skips a
  mission. A reply does not replace a current mission or earn completion credit.
- MissionEngine derives available missions from completed/skipped history; the
  deterministic order puts the final theory last. All 16 missions remain usable
  with inference disabled or disconnected.
- The timer uses timestamp anchors and millisecond accumulation, retaining
  fractional time across pauses. One root runtime owns the display interval and
  AppState subscriptions. Leaving/locking the app or Android focus loss pauses it.
- There are no repeated unsolicited model calls. Requests occur on start, explicit
  reply and mission progression, plus at most one closing request in the last 45
  seconds. Quiet intervals use elapsed session time and expire silently. A closing
  proposal never ends the session; only the clock or user does.
- Each request is cancellable and bound to a session/request generation and
  current mission. Pause, end, cancel, progression and reset invalidate old work.

## Install Ollama and choose Gemma

This machine was inspected as an Intel i5-1235U / integrated Iris Xe laptop with
approximately 8 GB RAM. Start with **`gemma3:1b`**, an instruction-tuned Gemma model
available in Ollama (about **806 MB** Q4_K_M download at inspection time).
Budget roughly **2–4 GB free memory** for inference/context/runtime as a practical
starting allowance, not a measured guarantee. Close memory-heavy apps. CPU latency
and quality must be measured on this machine. The 1B model is economical but less
reliable for nuance and structured instructions than larger variants; validation
and fallback are essential. Use `gemma3:4b` only after checking available memory
(prefer a 16 GB+ machine); expect a larger download, more memory and slower CPU
inference. The code does not download or switch models automatically.

Gemma has open weights under Google's Gemma terms; that is not a claim that the
weights have the same licence as this repository. The repository licence is unchanged.

Windows PowerShell, manually performed by the developer:

```powershell
winget install --id Ollama.Ollama --exact
# Open a new terminal after installation. If the tray app already serves Ollama,
# do not start another server on the same port.
ollama --version
$env:OLLAMA_HOST='127.0.0.1:11434'
ollama serve
```

In a second terminal, explicitly download only the selected model:

```powershell
ollama pull gemma3:1b
ollama list
ollama run gemma3:1b
# Exit the interactive model with /bye before continuing.
Invoke-RestMethod http://127.0.0.1:11434/api/version
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

Gemma 3 requires Ollama **0.6 or later**. The app checks `/api/version` and
`/api/tags` before first inference, requires the configured Gemma to be installed,
and rejects known cloud-model entries. Successful checks are cached in the
provider instance and invalidated on connection errors. `/api/chat` uses official
`messages`, `stream: false`, JSON Schema `format` and bounded generation options.
The default timeout is 20 seconds (including preflight/body read); configuration
in `src/config/ai.ts` is bounded to 1–30 seconds, with a planner-wide 30-second cap.
There is no retry loop or background download. A cold CPU model may time out;
warm it with `ollama run` and use the live check below to measure actual behavior.

## Configure the app, not a hardcoded LAN address

Create an ignored `.env.local` from the documented keys in `.env.example`. Set
`EXPO_PUBLIC_OLLAMA_URL` explicitly and optionally `EXPO_PUBLIC_GEMMA_MODEL`.
An empty URL disables networking. Environment changes need a full Expo reload;
restart `npx expo start --clear` if necessary. `EXPO_PUBLIC_*` values are public
bundle configuration, **never secrets**. No API key is needed for private Ollama.

### Android emulator

```dotenv
EXPO_PUBLIC_OLLAMA_URL=http://10.0.2.2:11434
EXPO_PUBLIC_GEMMA_MODEL=gemma3:1b
```

`10.0.2.2` is the standard Android Studio emulator's host-loopback alias. It is
not the correct default for a physical phone, other emulator products, or iOS.
Keep Ollama bound to loopback. Verify reachability on the actual emulator.

### Physical Android, USB (preferred for development)

Enable USB debugging, connect and authorize the device, then:

```powershell
adb devices -l
adb reverse tcp:11434 tcp:11434
```

Use `EXPO_PUBLIC_OLLAMA_URL=http://127.0.0.1:11434` in this case. It works because
of **explicit adb reverse**, not because phone localhost normally refers to the PC.
Remove the forwarding when finished with `adb reverse --remove tcp:11434`.

### Physical Android, trusted private Wi-Fi

Use the developer computer's actual private IPv4 address in `.env.local`. Bind
Ollama to that specific private interface using `OLLAMA_HOST=<private-ip>:11434`
and restart it. Limit the OS firewall to the test device/private subnet. The phone
and machine must be mutually reachable; guest Wi-Fi isolation can prevent this.
Ollama is unauthenticated HTTP here: use only a trusted private network, and
prefer USB instead of transmitting personal information over Wi-Fi.

**Never port-forward, use a public tunnel, bind for public access, or publish the
endpoint.** The adapter rejects public IPv4, credentials, paths, query strings,
URLs supplied by a model, and redirects. It currently accepts only explicit
private/loopback IPv4 or `localhost` HTTP base URLs; no arbitrary hostnames,
`.local`, IPv6 or HTTPS in this development adapter. Keep the provider replaceable
when adding a future on-device runtime or authenticated transport.

### Start the mobile application

```powershell
npx expo start --clear
# With a running Android emulator or connected device:
npx expo start --android
```

Use an SDK 57-compatible Expo Go for the initial system-TTS test. Choose Detective,
duration, and explicitly turn on **Use Gemma · development** at setup. This opts
in only for that adventure. The toggle is disabled when no URL is configured.
Speak the Detective can be disabled independently. Reply with **Respond ·
development text** while stopped somewhere safe. No microphone is involved.

For a native Android development binary, rebuild after adding native modules or
changing permissions. Private HTTP may be blocked by Android's cleartext policy;
the local CNG config plugin supports an explicit development-only switch:

```powershell
$env:BORROWED_EYES_DEV_HTTP='1'
npx expo run:android
```

This requires an Android SDK/toolchain and a connected runtime. Expo will generate
native folders; do not hand-edit them. Choose your app identifier when prompted.
Do not ship a binary built with that switch. Normal config writes cleartext false;
the plugin rejects this switch with EAS profile `production`. Expo Go's own
manifest is not changed by project plugins. No native build was run here.
iOS system TTS is included in Expo Go, but iOS networking/audio and local-network
permission behavior still need separate device verification (including silent mode).

## Speech and ambient audio

- **Speech output now:** `expo-speech` system TTS, added at Expo-compatible version.
  It is not Kokoro. Offline availability depends on the selected OS voice and is
  not verified. On physical iOS, system TTS respects silent mode. The OS voice
  service may process text over its own network; disable speech if that is unwanted.
- One `AudioController` at the app root coordinates playback. It pauses music
  before speech/processing/capture and restores it at volume 0.12 afterward.
  This is **pause/resume**, not a measured crossfade or true volume ducking.
  `Speaking` is reported only after the speech adapter's start callback.
- Stop, pause and end cancel speech; Android does not support Expo speech pause,
  so Resume does not resume a cancelled utterance. Use Replay Detective if needed.
  Duplicate utterance IDs do not enqueue extra speech. Request/session generations
  and serialized cleanup isolate late callbacks. Speech preparation/playback is
  bounded to 120 seconds; errors keep the mission usable as text.
- **Music now:** no suitable licensed track existed. `detectiveAmbientTrack` is
  explicitly `null`; no player is started and no music-playing state is shown.
  To enable it later, add a licensed, quiet bundled asset and set `{source:
  require(...), title, license}` in `src/audio/tracks.ts`. Retain attribution and
  verify native loading/playback, interruptions and headphone disconnection.
  URLs and imaginary asset paths are not accepted. Never add commercial music.
- **Speech input now:** `WhisperSpeechInput` uses `whisper.rn` and the Expo SDK 57
  `AudioStream` PCM API. It keeps one bounded float32 PCM utterance in memory,
  resamples it to mono 16 kHz, transcribes locally, then clears the buffer. It
  never creates a recorder file or uploads audio. The text input remains available
  as an explicitly labelled fallback.
- The user must choose a local `.bin`, `.ggml`, or `.gguf` Whisper model through
  `expo-document-picker`. The URI is held in memory and the picker copies the
  file to app cache for native access. No model download is performed by the app.
- `whisper.rn` includes native whisper.cpp binaries/JSI code and requires an Expo
  native development build (not Expo Go), a model binary, compatible audio capture,
  and Android ABI/iOS toolchain validation. See `phase-3-voice.md` for the build
  and device walkthrough. Background microphone and background playback remain off.

## Validation and privacy

The discriminated response contract supports conversation, observation/listening/
movement/breathing mission IDs, character_fact, story, quiet_interval and
session_closing. Validation rejects extra keys, unsupported actions, malformed or
fenced JSON, too-long text, invalid durations, repeated/unknown/wrong-type mission
IDs, unauthorized mission replacement and premature closing. No model-generated
code, URL, navigation, session duration or status is executed.

Facts use IDs from a small cited offline catalogue; model factual wording is
discarded. Stories must be explicitly labelled fictional. Free conversational
text has conservative English safety/perception/instruction checks and a short
one-question/three-sentence limit. **Lexical checks cannot prove the semantic
safety or truth of arbitrary language**: harmless reports may be rejected, and
adversarial paraphrases remain a limitation. Physical missions are separately
restricted to reviewed local content. Do not treat this as a production safety
certification. Test a representative prompt corpus before broader use.

The app holds only six recent conversation turns and six recent action labels
in memory, with a 400-character input limit and 500-character generated reply
limit. Mission progress remains for the summary. Conversation text is cleared
from current app state on end/reset, not written to disk, analytics or a database.
The local speech service receives spoken text; opt-in Ollama receives compact
mission/session context, recent turns and the voluntarily submitted text. No GPS,
device identifiers, images or audio are sent. Server/OS retention is controlled by
those services, not erased by the app. Private `.env.local`, model binaries and
recording folders are ignored by git. No secret belongs in `EXPO_PUBLIC_*`.

## Checks and the live acceptance gate

```powershell
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo install --check
npx expo export --platform android
npx expo config --type introspect
```

Node tests reuse the already-installed TypeScript compiler through
`scripts/register-types.cjs`; no new test runner/transpiler package was installed.
They exercise validator rejection, prompt/context shape, private endpoints,
preflight/API payload, deadline/body cancellation, catalogue selection,
millisecond clock/pausing, progress, bounded memory, quiet intervals, early
closing permissions, stale results, and audio pause/speech/resume ordering with
injected adapters. Native speech bridge mocks test the actual adapter's pending
cancellation, completion and error paths. They are not microphone/device tests.

After Ollama is installed and the chosen model is present, test the **actual
provider** using a fixed synthetic observation (no personal data):

```powershell
$env:EXPO_PUBLIC_OLLAMA_URL='http://127.0.0.1:11434'
$env:EXPO_PUBLIC_GEMMA_MODEL='gemma3:1b'
npm run check:gemma
```

This command intentionally has **no fallback**. It exits nonzero unless a real
model reply passes validation. It does not load `.env.local` by itself; use the
explicit environment above for this PC-side smoke check. The app's Expo CLI does
load `.env.local`. For an emulator app launch in the same shell, change/remove
the process URL override so it does not override the intended emulator address.

During implementation: baseline typecheck/lint passed; all **62 regression tests**,
typecheck, lint, Expo Doctor (21/21), dependency check and Android JS/Hermes bundle
export passed. Config introspection confirmed microphone/background audio off and
default Android cleartext false; it also reported the existing optional
`expo-system-ui` warning for the pre-existing `userInterfaceStyle` setting. No
unrelated styling dependency was added. The live smoke check failed at the
unavailable local Ollama prerequisite, as expected; no live Gemma claim is made.

### Required device walkthrough (not yet executed)

1. Home → select Detective → setup. Back works before starting; no early countdown.
2. Start with Gemma off; hear the local mission through system TTS (or disable
   speech and read it). Complete and skip, checking distinct missions and totals.
3. Pause mid-speech, background/lock the app, then return. It must remain paused;
   resume the timer and use Replay if desired. Test Android hardware back and
   cancelling/confirming the end dialog. Only deliberate confirmation ends early.
4. With real Gemma configured and opted in, submit the blue-door observation.
   Verify a validated model reply is shown/spoken without completing the mission.
5. Disconnect Ollama; try another reply and progress. Fallback must remain usable.
6. End during inference/speech, start another adventure and confirm no old reply
   appears or speaks. Let one session reach zero and check actual summary values.
7. Test TTS missing voices, silent mode, phone/audio interruptions, wired/Bluetooth
   disconnection, font scaling, keyboard and a small Android screen. Do not assume
   `expo-audio` interruption behavior also guarantees system-TTS audio routing.

Next: satisfy the live/device voice gate in `phase-3-voice.md`, then consider an
open TTS adapter (such as Kokoro) behind the existing interface and a licensed
ambient asset. Keep foreground mode until real background-audio lifecycle tests
justify changing it.

## References

- https://docs.expo.dev/versions/v57.0.0/sdk/speech/
- https://docs.expo.dev/versions/v57.0.0/sdk/audio/
- https://docs.ollama.com/api/chat
- https://docs.ollama.com/capabilities/structured-outputs
- https://ollama.com/library/gemma3:1b
- https://ai.google.dev/gemma/terms
- https://github.com/mybigday/whisper.rn
- Fact source links: `src/data/detectiveFacts.ts`
