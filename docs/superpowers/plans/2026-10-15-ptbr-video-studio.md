# PT-BR Video Studio Implementation Plan

> **For agentic workers:** implement task-by-task with RED -> minimal implementation -> GREEN -> review -> checkpoint.

**Goal:** Extend Saient's existing on-device Wan2.1 Android video flow with offline Brazilian-Portuguese dubbing, deterministic synchronized captions, and MP4 export without paid APIs or generation credits.

**Architecture:** Keep Wan generation untouched in `saient-diffusion`. Add a separate local Expo Android module for offline TTS and media composition. The TypeScript layer owns narration segmentation and caption timing; Android owns offline voice discovery/synthesis, media duration inspection, composition/export, cancellation, and file lifecycle.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript 5.9, Kotlin/Expo Modules API, Android TextToSpeech offline voices, AndroidX Media3 Transformer 1.11.1, existing Wan2.1/Quartz runtime.

**Spec:** this plan.

## Global Constraints

- Preserve existing Wan2.1 generation and model-download behavior.
- Android-first; ARM64 target.
- No cloud TTS, paid API, per-generation credits, or hidden server inference.
- Only accept TTS voices where `Voice.isNetworkConnectionRequired == false`.
- PT-BR is the default dubbing locale.
- Captions are derived from the source script and measured synthesized segment durations; do not re-transcribe generated speech.
- Do not overwrite source Wan output; export a separate final MP4.
- Validate paths/URIs and keep generated media inside app-owned storage until the user explicitly exports/shares it.
- Cancellation must release TTS/Transformer resources and leave no partial final file.
- Do not claim POCO X6 compatibility until an APK is installed and an end-to-end generation succeeds on that device.

## Review Focus

1. Empty/whitespace script must not start TTS or export.
2. Offline PT-BR voice missing must fail with an actionable message rather than silently using a network voice.
3. Cancellation during TTS/export must clean temporary files and release native resources.
4. Audio longer than the Wan clip must have explicit policy (trim video extension is not allowed silently); initial policy is to reject and ask for shorter narration.
5. App restart or user retry must not reuse stale temporary audio/caption files from another job.

---

### Task 1: Deterministic narration and caption timeline

**Files:**
- Create: `lib/video-studio/script.ts`
- Create: `scripts/test-video-studio.mjs`
- Modify: `package.json`

**Produces:**
- `segmentNarration(input, maxChars)`
- `buildCaptionTimeline(segments, durationsMs, gapMs)`

**Gate:** `npm run test:video-studio` passes for empty input, punctuation, multiline text, long text, invalid limits, mismatched durations, zero duration, and invalid gap.

### Task 2: Offline PT-BR TTS native module

**Files:**
- Create: `modules/saient-video-studio/expo-module.config.json`
- Create: `modules/saient-video-studio/index.ts`
- Create: `modules/saient-video-studio/src/SaientVideoStudioModule.ts`
- Create: `modules/saient-video-studio/android/build.gradle`
- Create: `modules/saient-video-studio/android/src/main/java/expo/modules/saientvideostudio/SaientVideoStudioModule.kt`
- Create/modify config plugin for Android `TTS_SERVICE` manifest query.

**Interfaces:**
- `getOfflineVoices(locale: string): Promise<OfflineVoice[]>`
- `synthesizeSpeechSegment(options): Promise<SynthesizedSegment>`
- `cancelSpeechSynthesis(): Promise<boolean>`

**Gate:** Android compile + device test proving an offline `pt-BR` voice is selected, a local audio file is created, duration is readable, and airplane-mode synthesis succeeds.

### Task 3: Media3 composition/export

**Files:**
- Modify: `modules/saient-video-studio/android/build.gradle`
- Modify: `SaientVideoStudioModule.kt`
- Modify TypeScript bridge types.

**Interfaces:**
- `exportDubbedVideo({ videoUri, audioSegments, captions, outputName }): Promise<ExportResult>`
- `cancelVideoExport(): Promise<boolean>`

**Implementation constraints:**
- Pin AndroidX Media3 Transformer `1.11.1`.
- Compose Wan video track with synthesized narration audio.
- Initial final container: MP4.
- Reject narration whose measured duration exceeds video duration until an explicit extension policy is implemented.
- Caption rendering must use deterministic timing from Task 1; no speech recognition dependency.

**Gate:** Android instrumentation/device export with valid MP4, audible PT-BR narration, expected duration, and cancellation cleanup.

### Task 4: Video screen integration

**Files:**
- Modify: `app/(tabs)/video.tsx`
- Add focused UI helpers/components only if needed.

**UI:**
- Existing Wan prompt/options remain intact.
- Add `Dublagem PT-BR` toggle.
- Add narration/script field.
- Add offline voice selector.
- Add speech-rate control with safe bounds.
- Add `Legendas` toggle and basic caption style.
- Show distinct stages: Wan generation -> voice synthesis -> captions -> export.
- Preserve the raw Wan result and separately show final dubbed MP4.

**Gate:** typecheck/lint and physical-device UX regression for keyboard, rotation policy, cancellation, repeated generation, app background/foreground, and low-storage error.

### Task 5: End-to-end Android verification

**Scenario:**
1. Install debug-signed APK on target POCO X6.
2. Download/validate Wan pack.
3. Disable Wi-Fi/mobile data after required model/voice assets are present.
4. Generate a 5-frame smoke video, then a 17-frame clip.
5. Synthesize short PT-BR narration offline.
6. Produce synchronized captions.
7. Export MP4.
8. Play final file and verify audio/video/caption timing.

**Acceptance:**
- No inference/network dependency during generation/dubbing/export.
- Final MP4 plays on-device.
- No crash/OOM for smoke profile.
- Cancellation returns UI to idle state.
- Repeating the job does not overwrite another result.
- Source Wan `.webm` remains intact.

### Task 6: Hardening and release gate

- Validate storage headroom before model generation and export.
- Bound script length and generated segment count.
- Sanitize output names and app-owned paths.
- Prevent concurrent Wan/TTS/export jobs from corrupting state.
- Clean abandoned temp files safely.
- Run `lint`, `typecheck`, `test:models`, `test:wan`, `test:video-studio`, Android compile, and physical-device end-to-end test.
- Build APK only after all gates above are green.
