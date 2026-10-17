import assert from "node:assert/strict";
import fs from "node:fs";

const managerPath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/WanFastManager.kt";
const pausePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/WanChatPauseCoordinator.kt";
const modulePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
const typesPath = "modules/saient-diffusion/src/SaientDiffusionModule.ts";
const indexPath = "modules/saient-diffusion/index.ts";

for (const path of [managerPath, pausePath, modulePath, typesPath, indexPath]) {
  assert.equal(fs.existsSync(path), true, `missing ${path}`);
}

const manager = fs.readFileSync(managerPath, "utf8");
const pause = fs.readFileSync(pausePath, "utf8");
const module = fs.readFileSync(modulePath, "utf8");
const types = fs.readFileSync(typesPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");

assert.match(manager, /private const val WAN_FAST_HOST\s*=\s*"127\.0\.0\.1"/,
  "Fast Engine host must be fixed to loopback");
assert.match(manager, /private const val WAN_FAST_PORT\s*=\s*18_801/,
  "Fast Engine must use dedicated port 18801");
assert.doesNotMatch(manager, /0\.0\.0\.0/,
  "Fast Engine must never bind a public/LAN interface");
assert.match(manager, /libquartz-wan-fast\.so/,
  "Fast Manager must launch the separately packaged server binary");
assert.match(manager, /enum class WanFastState[\s\S]*STOPPED[\s\S]*STARTING[\s\S]*LOADING[\s\S]*READY[\s\S]*GENERATING[\s\S]*STOPPING[\s\S]*FAILED/,
  "Fast Manager must expose the approved lifecycle states");
assert.match(manager, /\/sdcpp\/v1\/capabilities/,
  "Fast Manager readiness must use the capabilities endpoint");
assert.match(manager, /supported_modes/,
  "Fast Manager readiness must inspect supported_modes");
assert.match(manager, /vid_gen/,
  "Fast Manager must require video-generation capability");
assert.match(manager, /process\.isAlive/,
  "Fast Manager must re-check process liveness instead of caching stale ready state");
assert.match(manager, /--host[\s\S]*WAN_FAST_HOST/,
  "server launch must explicitly bind to the fixed loopback host");
assert.match(manager, /--port[\s\S]*WAN_FAST_PORT/,
  "server launch must explicitly use the dedicated Fast Engine port");

assert.match(pause, /class WanChatPauseCoordinator/,
  "chat pause marker ownership must live in a shared coordinator");
assert.match(pause, /leaseCount/,
  "pause ownership must be reference-counted");
assert.match(pause, /createdMarker/,
  "coordinator must remember whether it created the pause marker");
assert.match(pause, /fun acquire\(/,
  "coordinator must expose acquire()");
assert.match(pause, /fun release\(/,
  "coordinator must expose release()");
assert.match(pause, /if \(!marker\.exists\(\)\)/,
  "pre-existing pause markers must not be claimed as coordinator-owned");
assert.match(pause, /if \(createdMarker[\s\S]*marker\.delete\(\)/,
  "final release may remove only a marker created by the coordinator");

assert.match(module, /OnActivityEntersBackground\s*\{/,
  "Android activity background lifecycle must stop the persistent Fast Engine");
assert.match(module, /wanFastManager\.stop/,
  "background hook must stop the Fast Manager");
assert.match(module, /OnDestroy\s*\{[\s\S]*wanFastManager\.forceStop/,
  "module destruction must forcibly clean up any persistent Fast Engine");
assert.match(module, /AsyncFunction\("getWanFastStatus"/,
  "native bridge must expose Fast Engine status");
assert.match(module, /AsyncFunction\("startWanFastEngine"/,
  "native bridge must expose explicit Fast Engine start");
assert.match(module, /AsyncFunction\("stopWanFastEngine"/,
  "native bridge must expose explicit Fast Engine stop");

assert.match(types, /export type WanFastState\s*=/,
  "TypeScript bridge must type Fast Engine states");
for (const state of ["stopped", "starting", "loading", "ready", "generating", "stopping", "failed"]) {
  assert.equal(types.includes(`"${state}"`), true, `missing TypeScript Fast state ${state}`);
}
assert.match(types, /export type WanFastStatus\s*=\s*\{/,
  "TypeScript bridge must type Fast Engine status");
for (const field of ["available", "healthy", "generationCount", "message"]) {
  assert.match(types, new RegExp(`${field}\\??:`), `WanFastStatus must expose ${field}`);
}
assert.match(types, /getWanFastStatus\(\): Promise<WanFastStatus>/,
  "native module type must expose getWanFastStatus");
assert.match(types, /startWanFastEngine\(\): Promise<WanFastStatus>/,
  "native module type must expose startWanFastEngine");
assert.match(types, /stopWanFastEngine\(\): Promise<WanFastStatus>/,
  "native module type must expose stopWanFastEngine");

for (const fn of ["getWanFastStatus", "startWanFastEngine", "stopWanFastEngine"]) {
  assert.match(index, new RegExp(`export function ${fn}\\(`), `public bridge must export ${fn}`);
}

console.log("Wan Fast native lifecycle contract passed.");
