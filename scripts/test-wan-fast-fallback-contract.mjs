import assert from "node:assert/strict";
import fs from "node:fs";

const modulePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
const typesPath = "modules/saient-diffusion/src/SaientDiffusionModule.ts";
const indexPath = "modules/saient-diffusion/index.ts";

for (const path of [modulePath, typesPath, indexPath]) {
  assert.equal(fs.existsSync(path), true, `missing ${path}`);
}

const module = fs.readFileSync(modulePath, "utf8");
const types = fs.readFileSync(typesPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");

assert.match(module, /AsyncFunction\("generateSmartLocalVideo"/,
  "native module must expose one smart Fast-first generation entry point");
assert.match(module, /AsyncFunction\("cancelSmartLocalVideo"/,
  "native module must expose smart cancellation");
assert.match(module, /private fun generateSmartVideo\(/,
  "smart orchestration must live in one native helper");
assert.match(module, /private fun generateFastVideoReserved\(/,
  "Fast generation must support execution while one outer reservation is already held");
assert.match(module, /private fun generateVideoReserved\(/,
  "CLI generation must support execution while one outer reservation is already held");
assert.match(module, /private fun reserveWanGeneration\(/,
  "Fast and CLI paths must share one generation reservation");
assert.match(module, /private fun releaseWanGeneration\(/,
  "shared reservation must always be releasable");

const smartStart = module.indexOf("private fun generateSmartVideo(");
assert.notEqual(smartStart, -1, "missing smart orchestration helper");
const smartTail = module.slice(smartStart, smartStart + 9000);
assert.match(smartTail, /wanFastManager\.generate\(options\)/,
  "smart generation must attempt the persistent Fast Engine first");
assert.match(smartTail, /if \(cancellationRequested\)[\s\S]{0,500}Video generation cancelled/,
  "explicit user cancellation must terminate the smart request before fallback");
assert.match(smartTail, /wanChatPauseCoordinatorLazy\.value\.acquire\(\)/,
  "fallback transition must hold a shared chat-pause lease");
const stopIndex = smartTail.indexOf("wanFastManager.stop()")
const cliIndex = smartTail.indexOf("generateVideoReserved(options)")
assert.ok(stopIndex >= 0 && cliIndex > stopIndex,
  "Fast Engine must stop and release its model/Vulkan context before CLI fallback starts");
assert.match(smartTail, /wanChatPauseCoordinatorLazy\.value\.release\(\)/,
  "fallback transition must release the shared chat-pause lease");
assert.match(smartTail, /fallback\["engineMode"\]\s*=\s*"cli-fallback"|"engineMode"\s+to\s+"cli-fallback"/,
  "fallback result must identify cli-fallback mode");
assert.match(smartTail, /"fallbackReason"/,
  "fallback result must preserve a bounded Fast Engine failure reason");
assert.match(smartTail, /"timings"/,
  "fallback result must include timing metadata");

assert.match(types, /export type WanSmartVideoResult\s*=\s*VideoGenerationResult/,
  "TypeScript must expose the smart result contract");
assert.match(types, /engineMode:\s*"fast"\s*\|\s*"cli-fallback"/,
  "smart result must identify fast vs CLI fallback");
assert.match(types, /fallbackReason\?:\s*string/,
  "smart result must expose an optional fallback reason");
assert.match(types, /generateSmartLocalVideo\(options: VideoGenerationOptions\): Promise<WanSmartVideoResult>/,
  "typed native module must expose smart generation");
assert.match(types, /cancelSmartLocalVideo\(\): Promise<boolean>/,
  "typed native module must expose smart cancellation");
assert.match(index, /export function generateSmartLocalVideo\(/,
  "public bridge must export smart generation");
assert.match(index, /export function cancelSmartLocalVideo\(/,
  "public bridge must export smart cancellation");

console.log("Wan Fast fallback contract passed.");
