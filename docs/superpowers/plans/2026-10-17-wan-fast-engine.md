# Wan Fast Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make consecutive on-device Wan2.1 video generations start faster on Android by keeping one Vulkan/model runtime loaded while the app is foregrounded, while preserving the current per-generation CLI engine as a safe fallback.

**Architecture:** Add a second ARM64 executable built from the same pinned `stable-diffusion.cpp` commit: `sd-server`, packaged as `libquartz-wan-fast.so`, bound only to `127.0.0.1:18801`. A new Kotlin `WanFastManager` owns that process, its loopback async `/sdcpp/v1/vid_gen` jobs, cancellation, progress parsing, local timing telemetry, and foreground-session state. The current `generateVideo` CLI path remains intact. Phase 1 exposes the Fast Engine as an explicit test path; it becomes the default only after POCO X6 evidence proves a complete video, true warm reuse, lower warm latency, safe background shutdown, and working fallback.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript 5.9, Kotlin/Expo Modules API, `stable-diffusion.cpp` commit `e31a86ce9110b11a98bd5990c329093244c2d1e3`, ARM64, Vulkan, `HttpURLConnection`, native sdcpp async video API, WebM, existing Android offline PT-BR TTS + Media3 post-processing.

**Spec:** `docs/superpowers/specs/2026-10-17-wan-fast-engine-design.md`

## Global Constraints

- Preserve `engine/arm64-v8a/libquartz-wan.so` and the current CLI generation path until real-device acceptance passes.
- Keep the model pack, prompt rules, default negative prompt, 416×240 profile, 8 FPS, Euler sampling, flow shift 8.0, and current Vulkan/backend memory profile unless a later measured optimization has its own RED/GREEN evidence.
- The Fast Engine may listen only on `127.0.0.1`; never bind `0.0.0.0`, LAN, Wi-Fi, or a public interface.
- Use a dedicated fixed port `18801`; the existing Quartz/chat engine continues using `18799`.
- Only one Wan generation may run at a time across Fast Engine and CLI fallback.
- Keep the chat model paused for the whole lifetime of a loaded Fast Engine, not only for one generation, so chat cannot reclaim RAM while Wan remains resident.
- When the Android activity enters background, cancel any active Fast job, stop the persistent server, release its model/Vulkan state, and release the chat-pause lease. Use the Expo SDK 54 native `OnActivityEntersBackground` hook; JS `AppState` is not the sole safety mechanism.
- User cancellation is terminal for that request and must never trigger an automatic CLI fallback.
- Any automatic fallback must stop the Fast Engine first so two Wan contexts are never resident simultaneously.
- Keep generated media in app-owned storage. Validate the returned job result before writing a final WebM.
- All performance telemetry stays local. No analytics upload is introduced.
- Do not claim a speed multiplier or POCO X6 success until device measurements exist.
- Do not change PT-BR TTS, caption timing, playback, or Media3 export architecture in this work.
- No APK version bump/build trigger until contract tests, TypeScript, security audit, native compile, and packaging gates are green.

## Review Focus

1. **Memory ownership:** the persistent server and chat engine must never both hold their large model state unintentionally; pause-marker ownership must be reference-safe.
2. **Lifecycle:** backgrounding during startup or generation must leave no live Fast Engine process, open job, or owned pause marker.
3. **Fallback:** server startup/job failures may fall back; explicit user cancellation may not.
4. **Loopback security:** server must bind exactly to `127.0.0.1:18801` and all client URLs must be constructed internally, never from user input.
5. **Progress correctness:** values such as `223/242` are valid native progress and must render as `223 / 242`, independent of the requested 8 steps.
6. **Stale state:** if the server process dies, `ready` must not remain cached; the next request must detect death and cold-start again or fall back.
7. **Output memory:** the API returns a base64 WebM. Enforce a bounded encoded payload before decoding and write decoded bytes directly to a file rather than allocating a second full decoded byte array.
8. **No regression:** existing model download, CLI Wan, PT-BR dubbing/captions, cancellation, and MP4 export contracts remain green.

---

### Task 1: Define testable Fast Engine policy and fix native-progress semantics

**Files:**
- Create: `lib/wan-fast/policy.ts`
- Create: `scripts/test-wan-fast-policy.mjs`
- Modify: `package.json`
- Modify: `modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt`
- Modify: `scripts/test-wan-startup-diagnostics.mjs`

**Interfaces:**

```ts
export type WanProfile = "fast" | "balanced" | "quality";
export type WanStartKind = "cold" | "warm";
export type WanEngineMode = "fast" | "cli-fallback" | "cli";

export function resolveWanProfile(profile: WanProfile): {
  steps: number;
  frames: number;
};

export function wanProgressFraction(completed: number, total: number): number;
export function shouldWanFallback(reason: "cancelled" | "startup" | "runtime" | "memory" | "generation"): boolean;
```

Initial profile presets are deliberately conservative and use only settings already allowed by the current mobile contract:
- `fast`: 8 steps / 5 frames
- `balanced`: 8 steps / 17 frames
- `quality`: 12 steps / 17 frames

The existing 41-frame and 20-step advanced controls remain available manually; the profile buttons are shortcuts, not new quality claims.

- [ ] Write `scripts/test-wan-fast-policy.mjs` first. Assert profile mappings, invalid progress handling, `223/242`, clamping above 100%, and that `cancelled` is the only reason that never falls back.
- [ ] Add `test:wan-fast-policy` to `package.json` and run `npm run test:wan-fast-policy`; verify RED because `lib/wan-fast/policy.ts` does not exist.
- [ ] Implement the minimal pure TypeScript policy functions.
- [ ] Run `npm run test:wan-fast-policy`; verify GREEN.
- [ ] Extend `test-wan-startup-diagnostics.mjs` so it rejects the current `total == options.steps` gate and requires native `completed/total` to be forwarded unchanged.
- [ ] Run `npm run test:wan-startup-diagnostics`; verify RED against the current parser.
- [ ] Change only the existing CLI progress parser to accept any positive native total, use `Regex.find(...)`/equivalent robust matching, and publish the engine-reported values and message (`Processando X de Y`).
- [ ] Re-run `npm run test:wan-startup-diagnostics`, `npm run test:wan-performance`, and `npm run test:wan`; verify GREEN.
- [ ] Checkpoint commit: `test: define Wan Fast policy and real progress contract`.

### Task 2: Build and package a second persistent `sd-server` ARM64 binary

**Files:**
- Create: `engine/wan/saient-server-progress.patch`
- Create: `scripts/test-wan-fast-build-contract.mjs`
- Modify: `scripts/build-wan-android.sh`
- Modify: `plugins/quartz/withQuartzEngine.js`
- Modify: `engine/wan/BACKEND_LOCK.json`
- Modify: `package.json`

**Produces:**
- Existing fallback: `engine/arm64-v8a/libquartz-wan.so` (`sd-cli`)
- New persistent runtime: `engine/arm64-v8a/libquartz-wan-fast.so` (`sd-server`)

**Server contract:**
- build from the exact same pinned source commit;
- `SD_VULKAN=ON`, `SD_WEBM=ON`, frontend disabled;
- build targets `sd-cli` and `sd-server` from the same configured tree;
- patch `examples/server/main.cpp` to install a newline-delimited `SAIENT_WAN_PROGRESS completed=N total=M` callback;
- preserve the existing shared `ggml_extend.hpp` memory/K-quant patch exactly once;
- strip both executables after build;
- package both under `jniLibs/arm64-v8a` and keep both executable payloads unstripped by Gradle packaging.

- [ ] Write `scripts/test-wan-fast-build-contract.mjs` first. Require the pinned commit, `sd-server` target, `libquartz-wan-fast.so`, server progress callback, frontend-off build, WebM/Vulkan, plugin copy, and Gradle `keepDebugSymbols` entry. Also assert that `libquartz-wan.so` is still present in the script/plugin.
- [ ] Add `test:wan-fast-build` and run it; verify RED.
- [ ] Add the server-only progress patch. Do not duplicate the existing common memory patch.
- [ ] Update `build-wan-android.sh` to apply both patches idempotently, build both targets, copy/strip both outputs, and print `file`, `readelf`, and SHA-256 evidence for each.
- [ ] Update `withQuartzEngine.js` to copy `libquartz-wan-fast.so` and preserve its symbols/executable packaging.
- [ ] Extend `BACKEND_LOCK.json` with a separate Fast Engine artifact record while retaining the current CLI artifact record.
- [ ] Run `npm run test:wan-fast-build`; verify GREEN.
- [ ] On the native build environment, run `bash scripts/build-wan-android.sh`. Gate on both outputs being ARM64 ELF executables and linked successfully; if pinned `sd-server` does not compile with the existing patches, stop here and diagnose instead of changing the app integration blindly.
- [ ] Re-run `npm run test:wan`, `npm run test:wan-performance`, and the packaging contract.
- [ ] Checkpoint commit: `build: add persistent Wan server runtime`.

### Task 3: Add lifecycle-safe `WanFastManager` and shared chat-pause ownership

**Files:**
- Create: `modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/WanChatPauseCoordinator.kt`
- Create: `modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/WanFastManager.kt`
- Create: `scripts/test-wan-fast-native-contract.mjs`
- Modify: `modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt`
- Modify: `modules/saient-diffusion/src/SaientDiffusionModule.ts`
- Modify: `modules/saient-diffusion/index.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export type WanFastState =
  | "stopped" | "starting" | "loading" | "ready"
  | "generating" | "stopping" | "failed";

export type WanFastStatus = {
  state: WanFastState;
  available: boolean;
  healthy: boolean;
  sessionId?: string;
  generationCount: number;
  message: string;
  lastError?: string;
};

export function getWanFastStatus(): Promise<WanFastStatus>;
export function startWanFastEngine(): Promise<WanFastStatus>;
export function stopWanFastEngine(): Promise<WanFastStatus>;
```

**Native lifecycle:**
- Fast binary path: `nativeLibraryDir/libquartz-wan-fast.so`.
- Internal base URL is fixed to `http://127.0.0.1:18801`.
- `WanChatPauseCoordinator` is reference-counted: the first lease creates `filesDir/models/.paused` only if it was not already present; the final lease removes it only if the coordinator originally created it.
- The Fast Engine holds one chat-pause lease for its whole `starting/loading/ready/generating` lifetime.
- Server startup arguments contain model paths and current validated backend/memory flags, but no per-request prompt/seed/steps.
- Readiness is `GET /sdcpp/v1/capabilities` with HTTP 200 plus `supported_modes` containing `vid_gen`, not merely “port open”.
- If the process exits, status becomes `failed`/`stopped`; never leave stale `ready`.
- Expo SDK 54 `OnActivityEntersBackground` calls Fast shutdown; `OnDestroy` force-kills as a final failsafe.

- [ ] Write `test-wan-fast-native-contract.mjs` first for exact loopback binding, dedicated port, state set, capability health check, reference-counted pause lease, background hook, process-death handling, and no LAN binding.
- [ ] Add `test:wan-fast-native` and run it; verify RED.
- [ ] Implement `WanChatPauseCoordinator` with reference-counted ownership and bounded wait for chat port `18799` to close.
- [ ] Implement `WanFastManager` state/process/readiness/shutdown skeleton. Do not add generation yet.
- [ ] Add native module bridge methods and TypeScript exports/types.
- [ ] Wire `OnActivityEntersBackground` and `OnDestroy` to stop/force-stop the Fast Engine and release pause leases.
- [ ] Run `npm run test:wan-fast-native`; verify GREEN.
- [ ] Run `npm run typecheck` and the existing Wan contracts.
- [ ] Run Android Kotlin compile before proceeding. Any lifecycle/import/API mismatch is fixed here, before HTTP generation is added.
- [ ] Checkpoint commit: `feat: add lifecycle-safe Wan Fast manager`.

### Task 4: Implement async `/sdcpp/v1/vid_gen`, cancellation, progress, and bounded WebM output

**Files:**
- Create: `scripts/test-wan-fast-generation-contract.mjs`
- Modify: `modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/WanFastManager.kt`
- Modify: `modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt`
- Modify: `modules/saient-diffusion/src/SaientDiffusionModule.ts`
- Modify: `modules/saient-diffusion/index.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export type WanGenerationTimings = {
  engineStartMs: number;
  timeToFirstProgressMs?: number;
  generationMs: number;
  totalMs: number;
};

export type WanFastVideoResult = VideoGenerationResult & {
  engineMode: "fast";
  startKind: "cold" | "warm";
  engineSessionId: string;
  generationCount: number;
  timings: WanGenerationTimings;
};

export function generateFastLocalVideo(options: VideoGenerationOptions): Promise<WanFastVideoResult>;
export function cancelFastLocalVideo(): Promise<boolean>;
```

**Request mapping:**

`POST /sdcpp/v1/vid_gen` with:
- `prompt`, combined `negative_prompt`
- `width: 416`, `height: 240`
- `seed`, `video_frames`, `fps: 8`
- `sample_params.sample_method: "euler"`
- `sample_params.sample_steps: options.steps`
- `sample_params.flow_shift: 8.0`
- `sample_params.guidance.txt_cfg: options.guidance`
- `vae_tiling_params.enabled: true`
- `output_format: "webm"`

Poll the returned `poll_url` internally until `completed`, `failed`, or `cancelled`; use a bounded delay rather than a busy loop. Cancellation posts to `/sdcpp/v1/jobs/{id}/cancel`.

**Output policy:** require `video/webm`, expected frame metadata, and a sane encoded-size ceiling before decoding `result.b64_json`. Decode directly into a temporary app-owned `.webm`; atomically rename/promote only after file size/header validation. Delete partial output on all failures/cancellation.

- [ ] Write `test-wan-fast-generation-contract.mjs` first. Require exact endpoint, request fields, 500 ms-ish bounded polling, cancel endpoint, arbitrary native progress totals, WebM MIME/result validation, encoded payload ceiling, temp-file cleanup, and no user-controlled URL/host.
- [ ] Run the new test; verify RED.
- [ ] Add a single stdout-drain coroutine/thread when the server starts. Parse `SAIENT_WAN_PROGRESS` with a non-strict line search and emit actual `completed/total` through `onVideoProgress`.
- [ ] Implement job submission and polling with explicit HTTP connect/read timeouts and bounded response size.
- [ ] Implement cancellation against the active Fast job. A healthy server should remain resident after a successful cancellation; if cancellation fails and the process must be killed, mark the next start cold.
- [ ] Implement bounded WebM decode/promote and return Fast Engine telemetry/session metadata.
- [ ] Run `npm run test:wan-fast-generation`, `npm run test:wan-fast-native`, `npm run test:wan-startup-diagnostics`; verify GREEN.
- [ ] Run Kotlin compile and TypeScript checks.
- [ ] Checkpoint commit: `feat: generate Wan video through persistent local server`.

### Task 5: Add fast-first fallback orchestration without double-loading Wan

**Files:**
- Create: `scripts/test-wan-fast-fallback-contract.mjs`
- Modify: `modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt`
- Modify: `modules/saient-diffusion/src/SaientDiffusionModule.ts`
- Modify: `modules/saient-diffusion/index.ts`
- Modify: `lib/wan-fast/policy.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export type WanSmartVideoResult = VideoGenerationResult & {
  engineMode: "fast" | "cli-fallback";
  startKind: "cold" | "warm";
  engineSessionId?: string;
  generationCount?: number;
  fallbackReason?: string;
  timings: WanGenerationTimings;
};

export function generateSmartLocalVideo(options: VideoGenerationOptions): Promise<WanSmartVideoResult>;
export function cancelSmartLocalVideo(): Promise<boolean>;
```

**Reservation rule:** refactor the native path so one outer reservation covers the smart request. Do not call the current public `generateVideo()` from inside another reserved generation. Extract a private “CLI execution while already reserved” helper if needed, keeping the existing public CLI behavior unchanged.

**Fallback sequence:**
1. Fast failure is classified as startup/runtime/memory/generation or cancellation.
2. Cancellation returns cancellation immediately.
3. For eligible failures, stop the server and release its Vulkan/model context before starting CLI.
4. Keep chat paused safely through the transition using the shared pause coordinator.
5. Run the exact same prompt/negative/seed/steps/frames in CLI.
6. Return `engineMode: "cli-fallback"` and bounded `fallbackReason`.

- [ ] Write the fallback contract test first: eligible startup/runtime failures fall back; cancellation does not; Fast process is stopped before CLI spawn; one generation reservation is shared; prompt/seed/steps/frames are preserved.
- [ ] Run it; verify RED.
- [ ] Refactor only enough of the current CLI `generateVideo` to support reserved fallback without duplicating validation/output logic.
- [ ] Implement `generateSmartLocalVideo`/cancel bridge.
- [ ] Run new fallback test plus `test:wan`, `test:wan-performance`, `test:wan-startup-diagnostics`; verify GREEN.
- [ ] Run Kotlin compile and typecheck.
- [ ] Checkpoint commit: `feat: add safe CLI fallback for Wan Fast Engine`.

### Task 6: Add Fast/Balanced/Quality UI, prewarm, benchmark metadata, and beta gate

**Files:**
- Create: `scripts/test-wan-fast-ui-contract.mjs`
- Modify: `app/(tabs)/video.tsx`
- Modify: `modules/saient-diffusion/src/SaientDiffusionModule.ts`
- Modify: `modules/saient-diffusion/index.ts`
- Modify: `package.json`

**Phase-1 UI behavior:**
- Add `Motor rápido (teste)` switch, **off by default** until device acceptance proves the new engine.
- Add Fast / Balanced / Quality shortcut buttons that apply policy presets; advanced step/frame buttons remain editable.
- When the Video tab is focused, model is active, and beta switch is on, call `startWanFastEngine()` to prewarm.
- When beta is on, Generate calls `generateSmartLocalVideo`; when off, it calls the existing `generateLocalVideo` baseline.
- Do not stop Fast Engine merely because the user changes tabs; native app-background lifecycle owns shutdown, matching the requirement “keep loaded while the app remains foregrounded.”
- Show state labels: `Inicializando motor`, `Carregando modelos`, `Pronto`, `Gerando`, `Finalizando`.
- Show engine-native percentage from actual progress totals.
- After success show engine mode, cold/warm, total time, time to first progress, session/generation counter, and a clear notice if CLI fallback was used.
- Keep the existing result URI contract so dubbing/captions/export continue unchanged.

- [ ] Write UI contract test first for the beta default, three profile controls, prewarm condition, baseline-vs-smart call selection, actual progress fraction, timing metadata, and fallback notice.
- [ ] Run it; verify RED.
- [ ] Implement the smallest UI/state changes without touching the PT-BR post-processing flow.
- [ ] Run `npm run test:wan-fast-ui`; verify GREEN.
- [ ] Run existing `test:video-studio-ui`, `test:ptbr-ui`, pipeline/cancel/export/storage tests, and `npm run typecheck`.
- [ ] Checkpoint commit: `feat: expose Wan Fast beta and benchmark UI`.

### Task 7: Integrate CI gates and prove both binaries/package paths before an APK

**Files:**
- Modify: `.github/workflows/video-studio-contract.yml`
- Modify: `.github/workflows/video-studio-final-gates.yml`
- Modify: `.github/workflows/video-studio-module-compile.yml` if needed for new native source coverage
- Modify: `package.json` only if an aggregate test script is useful

**Required CI gates:**
- Fast policy
- Fast build/package contract
- Fast native lifecycle
- Fast generation contract
- Fast fallback contract
- Fast UI contract
- existing Wan contract
- existing Wan performance/startup diagnostics
- all Video Studio/TTS/export/storage/cancel/UI/PT-BR tests
- TypeScript
- production dependency audit at critical severity
- Android release Kotlin compile after Expo prebuild
- generated Android project contains all three expected engine payloads: chat/image `libquartz.so`, CLI Wan `libquartz-wan.so`, Fast Wan `libquartz-wan-fast.so`

- [ ] Add the new tests to contract/final-gate workflows.
- [ ] Run/observe a fresh contract workflow; require every new RED/GREEN contract to pass from a clean checkout.
- [ ] Run/observe security audit and full Android compile.
- [ ] Inspect generated packaging evidence for both Wan binaries. Do not treat Node source contracts alone as native proof.
- [ ] If any gate fails, read the failing job logs, diagnose root cause, and fix only that cause before rerunning.
- [ ] Checkpoint commit: `ci: gate Wan Fast Engine integration`.

### Task 8: Build a versioned test APK and perform the POCO X6 acceptance benchmark

**Files:**
- Modify only after Task 7 is green: `app.json`
- Modify only after Task 7 is green: `.github/apk-build-trigger`
- Optionally update after evidence: `docs/superpowers/specs/2026-10-17-wan-fast-engine-design.md` or a dedicated benchmark note with measured results

**Version:** bump from `0.1.5` / versionCode `13` to `0.1.6` / versionCode `14` so Android offers an in-place update over v5.2.

**Fixed benchmark prompt:** reuse the exact prompt/settings already used for v5.2 so comparisons are meaningful:

`Uma rua de cidade à noite em estilo anime cinematográfico, carros andando lentamente, luzes refletindo no asfalto molhado, câmera avançando suavemente para frente.`

Negative prompt: `estático, borrado, distorcido, texto, baixa qualidade`

Baseline settings: 8 steps / 5 frames / same seed for paired tests where practical.

**Device matrix:**
1. CLI beta switch OFF: complete baseline generation and record total/first-progress time.
2. Fast beta ON after fresh foreground start: complete cold generation.
3. Immediately generate again without minimizing: complete warm generation and confirm the same `engineSessionId` with incremented generation count.
4. Put app in background; return and confirm Fast state was stopped and the next generation is cold/new session.
5. Exercise one controlled recoverable Fast failure and verify CLI fallback without two simultaneous Wan processes.
6. Cancel a Fast generation and verify no CLI fallback starts.
7. Run PT-BR dubbing/captions/export on a Fast-generated result.

**Acceptance gate:** Fast Engine remains beta unless all spec acceptance criteria pass. It becomes the default only in a separate, evidence-backed change after the measured warm generation is faster than the CLI baseline and no reproducible crash/OOM/regression appears.

- [ ] Bump version/versionCode only after all prior CI gates are fresh-green.
- [ ] Trigger Android APK workflow and require Build APK + Upload APK success.
- [ ] Install over v5.2 on the POCO X6; confirm Android performs an update rather than a separate install.
- [ ] Execute the device matrix and capture screenshots/timings/errors.
- [ ] Record FATO vs INFERÊNCIA: compile/package evidence is not generation evidence; one cold result is not warm-reuse evidence.
- [ ] If acceptance passes, create a separate follow-up bounded change to default the Fast Engine on while retaining CLI fallback. If it does not pass, leave CLI default and use measured bottlenecks for the next targeted optimization.
- [ ] Checkpoint measured result only after device evidence exists: `test: record Wan Fast POCO X6 benchmark`.

## Final Verification Checklist

- [ ] `npm run test:wan-fast-policy`
- [ ] `npm run test:wan-fast-build`
- [ ] `npm run test:wan-fast-native`
- [ ] `npm run test:wan-fast-generation`
- [ ] `npm run test:wan-fast-fallback`
- [ ] `npm run test:wan-fast-ui`
- [ ] `npm run test:wan`
- [ ] `npm run test:wan-performance`
- [ ] `npm run test:wan-startup-diagnostics`
- [ ] all existing Video Studio/PT-BR contracts
- [ ] `npm run typecheck`
- [ ] `npm audit --omit=dev --audit-level=critical`
- [ ] Android release Kotlin compile
- [ ] APK package contains both Wan executables
- [ ] POCO X6 baseline/cold/warm/background/cancel/fallback/post-process evidence
- [ ] No claim that Fast is default or faster until the measured acceptance gate passes
