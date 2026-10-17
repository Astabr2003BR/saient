# Wan Fast Engine — Design

Date: 2026-10-17
Branch: `feat/ptbr-video-studio`
Status: design approved in chat; implementation not started

## Goal

Reduce local Wan video-generation latency on Android, especially on consecutive generations, while preserving the current CLI engine as a safe fallback.

The target device for runtime validation is the user's POCO X6 5G. The system must remain fully local after model setup, without paid credits or cloud generation.

## Current baseline

The current Android build runs a compiled ARM64/Vulkan `sd-cli` process for each generation. The runtime binary is built from a pinned `stable-diffusion.cpp` commit and invoked as a fresh process, so model/Vulkan setup is repeated for each request.

The current video UI already exposes Wan generation, local model status, step/frame presets, native progress events, cancellation, offline PT-BR dubbing, captions, and Media3 export. The existing flow remains the compatibility fallback.

## Design principles

1. Preserve the working CLI engine.
2. Optimize warm generations first; cold-start improvement is secondary.
3. Keep model state alive only while the app remains in the foreground.
4. Release Wan model memory when the app moves to the background.
5. Never allow more than one Wan generation at a time.
6. Prefer graceful fallback over application failure.
7. Measure real device performance rather than assuming speedups from static changes.

## Architecture

### Components

#### WanFastManager

Android-side lifecycle coordinator responsible for:

- starting the persistent local engine;
- tracking engine state;
- serializing generation requests;
- forwarding progress and diagnostics;
- cancelling a running generation;
- shutting down the engine on app background;
- invoking the existing CLI path when fallback is required.

Public engine states:

- `stopped`
- `starting`
- `loading`
- `ready`
- `generating`
- `stopping`
- `failed`

#### Persistent Wan runtime

A local persistent runtime based on the same `stable-diffusion.cpp` family as the current CLI binary.

It must:

- initialize Vulkan once per foreground session;
- load/prepare model state once per foreground session;
- accept multiple generation requests without process restart;
- expose progress and diagnostics for each request;
- support cancellation;
- shut down deterministically and release model memory.

The preferred transport is an app-private local channel. If an HTTP-style server executable is used, it must bind only to `127.0.0.1`; no LAN or public interface is allowed.

#### Existing CLI engine

The current per-generation `sd-cli` execution remains intact as a fallback path.

Fallback must not silently hide failures. The UI/logging layer records:

- Fast Engine failure reason;
- whether fallback was used;
- whether the fallback generation succeeded.

## Lifecycle

### Foreground entry

The Fast Engine is initialized lazily when video generation is needed. The UI may prewarm it when the Video tab becomes active if memory conditions permit.

State flow:

`stopped -> starting -> loading -> ready`

### Consecutive generations

When state is `ready`, a new request reuses the loaded engine/model state.

State flow:

`ready -> generating -> ready`

No process restart or full model reload should occur between consecutive successful requests while the app remains in the foreground.

### Background transition

When the application moves to the background:

1. reject new generation requests;
2. if a generation is active, request cancellation and complete bounded cleanup;
3. unload model/runtime state;
4. terminate the persistent engine;
5. transition to `stopped`.

No requirement exists to keep Wan resident while the app is backgrounded.

### Return to foreground

The engine remains stopped until the next Video-tab prewarm or generation request. This is a new cold start.

## Memory and stability

The Fast Engine must enforce one generation at a time.

Before a new request, `WanFastManager` checks whether the engine is healthy and whether the previous request released transient buffers. If initialization or request setup fails because of memory/resource pressure, the manager stops the Fast Engine cleanly and offers/uses the existing CLI fallback.

OOM/native crashes must not be treated as acceptable optimization trade-offs. The persistent runtime should remain isolated from the React Native UI process where practical so a native inference failure does not necessarily terminate the entire app.

## Performance profiles

The UI exposes three generation profiles while preserving advanced step/frame controls:

### Fast

Goal: shortest practical generation time.

- prioritizes lower compute cost;
- uses the lowest validated step/frame combination suitable for a usable result;
- may use a lighter validated inference profile if device testing proves it beneficial.

### Balanced

Default profile.

- balances latency and quality;
- maps to the current practical baseline unless benchmarking identifies a better validated configuration.

### Quality

- favors visual quality over latency;
- uses higher validated step/frame settings;
- explicitly allows longer execution time.

No profile may claim a fixed multiplier such as "2x" or "10x" until measured on-device.

## Progress model

The engine progress contract is independent from the user's configured step count.

The current native engine may emit internal units such as `completed=223 total=242`; therefore the UI must render progress from the engine-reported `completed/total` values rather than requiring `total == requestedSteps`.

UI phases:

- Inicializando motor
- Carregando modelos
- Pronto
- Gerando
- Finalizando

During generation, the percentage is derived from engine-native progress where available. Diagnostic text remains bounded and user-visible for runtime debugging.

## Performance telemetry

All timing is local diagnostic telemetry, not analytics upload.

For every generation record:

- engine mode: `fast` or `cli-fallback`;
- cold start vs warm start;
- engine-start duration;
- model-load duration if measurable;
- time to first generation progress;
- inference/generation duration;
- total request duration;
- requested steps;
- requested frames;
- output success/failure;
- fallback reason when applicable.

This data is used to compare the old and new engines on the same device and prompt.

## Fallback policy

Use the Fast Engine by default only after runtime validation.

Fallback triggers include:

- persistent engine fails to start;
- model loading fails;
- persistent runtime becomes unhealthy;
- request cannot be accepted because of resource failure;
- generation exits unexpectedly before producing output.

A fallback generation uses the existing CLI implementation without changing user prompt/seed/step/frame settings unless the engine contract requires a documented compatibility adjustment.

Cancellation initiated by the user is not considered a failure and must not automatically trigger fallback.

## UI behavior

The existing Video screen remains the user-facing entry point.

Additions:

- Fast / Balanced / Quality profile selector;
- explicit engine state badge/message;
- actual native generation percentage;
- cold/warm indicator in diagnostic/result metadata;
- fallback notice when the CLI path was used;
- benchmark timing after successful generation.

Dubbing, captions, playback, and MP4 export remain downstream of successful video generation and should not be rearchitected for this feature.

## Error handling

Errors are classified into:

- startup;
- model load;
- Vulkan/runtime;
- memory/resource;
- generation;
- cancellation;
- shutdown.

The manager must preserve the first actionable native diagnostic and avoid replacing it with a generic error when possible.

A failed shutdown must force process termination for the persistent runtime before a later restart is attempted.

## Testing strategy

### Contract tests

Add RED-first tests for:

- Fast Engine state transitions;
- one-generation-at-a-time serialization;
- reuse across two consecutive requests;
- background shutdown;
- cancellation;
- progress using arbitrary engine totals such as `223/242`;
- fallback selection;
- no fallback on user cancellation;
- telemetry classification as cold/warm;
- preservation of current Video Studio contracts.

### Native compile/build gates

Verify:

- Android ARM64 build;
- Vulkan-linked persistent runtime;
- current CLI fallback still builds;
- TypeScript checks;
- Video Studio Android compile;
- APK packaging.

### Device validation

Use the same prompt/settings for baseline and Fast Engine measurements on the POCO X6 5G.

Run at minimum:

1. current CLI baseline generation;
2. Fast Engine cold generation after fresh foreground start;
3. immediate second Fast Engine generation without minimizing the app;
4. background the app and confirm engine shutdown;
5. return and confirm next generation is classified as cold;
6. intentionally exercise a recoverable Fast Engine failure and verify CLI fallback;
7. verify dubbing/captions/export after a Fast Engine-generated video.

## Acceptance criteria

The Fast Engine is eligible to become the default only when real-device evidence proves all of the following:

1. At least one complete video is generated successfully through the persistent engine.
2. A second consecutive generation reuses the engine/model rather than fully reloading it.
3. Warm-start time is measurably better than the current CLI baseline.
4. Backgrounding the app releases the Fast Engine/model state.
5. Cancellation works without corrupting later generations.
6. CLI fallback remains functional.
7. Dubbing, captions, playback, and MP4 export show no regression.
8. No new reproducible app-level crash/OOM is introduced.

## Rollout

Phase 1: keep CLI as default and expose Fast Engine only behind an internal feature flag/test path.

Phase 2: collect POCO X6 cold/warm/fallback evidence.

Phase 3: if acceptance criteria pass, make Fast Engine the default and retain CLI fallback.

If the persistent engine is not measurably faster or is less stable, keep the current CLI path as default and use findings to target narrower optimizations instead.

## Non-goals

This design does not:

- replace Wan with a cloud provider;
- introduce paid inference credits;
- keep the model resident while the app is backgrounded;
- redesign PT-BR TTS/captions/export;
- promise a fixed speed multiplier before benchmarking;
- remove the existing CLI engine.
