import assert from "node:assert/strict";
import fs from "node:fs";

const managerPath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/WanFastManager.kt";
const modulePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
const typesPath = "modules/saient-diffusion/src/SaientDiffusionModule.ts";
const indexPath = "modules/saient-diffusion/index.ts";

for (const path of [managerPath, modulePath, typesPath, indexPath]) {
  assert.equal(fs.existsSync(path), true, `missing ${path}`);
}

const manager = fs.readFileSync(managerPath, "utf8");
const module = fs.readFileSync(modulePath, "utf8");
const types = fs.readFileSync(typesPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");

assert.match(manager, /WAN_FAST_POLL_INTERVAL_MS\s*=\s*500L/,
  "Fast generation must poll jobs at a bounded ~500 ms interval");
assert.match(manager, /WAN_FAST_MAX_B64_CHARS\s*=/,
  "Fast generation must cap encoded output before Base64 decoding");
assert.match(manager, /fun generate\(/,
  "Fast Manager must expose persistent generation");
assert.match(manager, /fun cancelGeneration\(/,
  "Fast Manager must expose active-job cancellation");
assert.match(manager, /\/sdcpp\/v1\/vid_gen/,
  "Fast Manager must submit to the pinned native vid_gen endpoint");
assert.match(manager, /requestMethod\s*=\s*"POST"/,
  "Fast generation must use POST for async job submission/cancellation");

for (const field of [
  '"prompt"',
  '"negative_prompt"',
  '"width"',
  '"height"',
  '"seed"',
  '"video_frames"',
  '"fps"',
  '"sample_params"',
  '"sample_method"',
  '"sample_steps"',
  '"flow_shift"',
  '"guidance"',
  '"txt_cfg"',
  '"vae_tiling_params"',
  '"enabled"',
  '"output_format"',
]) {
  assert.equal(manager.includes(field), true, `Fast vid_gen request must include ${field}`);
}
assert.match(manager, /"euler"/,
  "Fast request must preserve Euler sampling");
assert.match(manager, /416/,
  "Fast request must preserve the validated 416 width");
assert.match(manager, /240/,
  "Fast request must preserve the validated 240 height");
assert.match(manager, /8\.0/,
  "Fast request must preserve Wan flow shift 8.0");
assert.match(manager, /"webm"/,
  "Fast request must explicitly request WebM output");

assert.match(manager, /poll_url/,
  "Fast Manager must read the server-provided poll_url");
assert.match(manager, /expectedPollUrl|expected_poll_url/,
  "poll_url must be compared with the expected local job path before use");
assert.doesNotMatch(manager, /URL\(pollUrl\)|URL\(poll_url\)/,
  "Fast Manager must never open a server-provided URL directly");
assert.match(manager, /\/sdcpp\/v1\/jobs\//,
  "Fast Manager must poll and cancel through the fixed local jobs path");
assert.match(manager, /\/cancel/,
  "Fast Manager must call the pinned cancel endpoint");
assert.match(manager, /Thread\.sleep\(WAN_FAST_POLL_INTERVAL_MS\)/,
  "Fast Manager must not busy-loop while polling");

assert.match(manager, /SAIENT_WAN_PROGRESS completed=\(\\d\+\) total=\(\\d\+\)/,
  "persistent server stdout must parse arbitrary native progress totals");
assert.match(manager, /progressListener/,
  "Fast Manager must forward parsed native progress to the module");
assert.match(module, /sendVideoProgress\("denoising"/,
  "Fast native progress must reach the existing onVideoProgress event");

assert.match(manager, /video\/webm/,
  "completed jobs must require the WebM MIME type");
assert.match(manager, /b64_json/,
  "completed jobs must read the encoded container payload");
assert.match(manager, /frame_count/,
  "completed jobs must validate actual frame metadata");
assert.match(manager, /Base64InputStream/,
  "decoded WebM must stream to disk instead of allocating a full decoded byte array");
assert.match(manager, /\.part/,
  "Fast output must be written to a temporary partial file");
assert.match(manager, /renameTo\(/,
  "validated temporary output must be promoted only after validation");
assert.match(manager, /delete\(\)/,
  "partial output must be removable on failure/cancellation");

assert.match(module, /AsyncFunction\("generateFastLocalVideo"/,
  "native module must expose Fast generation");
assert.match(module, /AsyncFunction\("cancelFastLocalVideo"/,
  "native module must expose Fast cancellation");
assert.match(types, /export type WanGenerationTimings\s*=\s*\{/,
  "TypeScript must expose Fast timing metadata");
assert.match(types, /export type WanFastVideoResult\s*=\s*VideoGenerationResult/,
  "TypeScript must extend the existing video result contract");
for (const field of ["engineMode", "startKind", "engineSessionId", "generationCount", "timings"]) {
  assert.equal(types.includes(field), true, `WanFastVideoResult must expose ${field}`);
}
assert.match(types, /generateFastLocalVideo\(options: VideoGenerationOptions\): Promise<WanFastVideoResult>/,
  "typed native module must expose generateFastLocalVideo");
assert.match(types, /cancelFastLocalVideo\(\): Promise<boolean>/,
  "typed native module must expose cancelFastLocalVideo");
assert.match(index, /export function generateFastLocalVideo\(/,
  "public bridge must export Fast generation");
assert.match(index, /export function cancelFastLocalVideo\(/,
  "public bridge must export Fast cancellation");

console.log("Wan Fast generation contract passed.");
