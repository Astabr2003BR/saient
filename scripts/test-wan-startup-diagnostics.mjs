import assert from "node:assert/strict";
import fs from "node:fs";

const nativePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
const typesPath = "modules/saient-diffusion/src/SaientDiffusionModule.ts";
const uiPath = "app/(tabs)/video.tsx";

for (const path of [nativePath, typesPath, uiPath]) {
  assert.equal(fs.existsSync(path), true, `missing ${path}`);
}

const native = fs.readFileSync(nativePath, "utf8");
const types = fs.readFileSync(typesPath, "utf8");
const ui = fs.readFileSync(uiPath, "utf8");

assert.match(types, /phase:\s*"preparing"\s*\|\s*"starting"\s*\|\s*"loading"\s*\|\s*"denoising"/,
  "VideoProgress must expose Wan startup phases before diffusion begins.");
assert.match(types, /message:\s*string/,
  "VideoProgress must expose a human-readable startup status message.");

for (const required of [
  'sendVideoProgress("preparing", "Liberando memória para o Wan"',
  'sendVideoProgress("starting", "Iniciando motor Wan"',
  'sendVideoProgress("loading", "Carregando modelos e preparando Vulkan"',
  'sendVideoProgress("denoising",',
]) {
  assert.equal(native.includes(required), true, `missing native Wan diagnostic stage: ${required}`);
}

assert.match(ui, /progress\?\.message\s*\?\?\s*"Preparando Wan"/,
  "Video UI must show the exact native startup stage instead of a generic 0% label.");
assert.match(ui, /progress\?\.phase\s*===\s*"denoising"/,
  "Video UI must only present diffusion percentage once denoising actually starts.");

console.log("Wan startup diagnostics contract passed.");
