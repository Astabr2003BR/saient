import assert from "node:assert/strict";
import fs from "node:fs";

const videoPath = "app/(tabs)/video.tsx";
const policyPath = "lib/wan-fast/policy.ts";
assert.equal(fs.existsSync(videoPath), true, `missing ${videoPath}`);
assert.equal(fs.existsSync(policyPath), true, `missing ${policyPath}`);

const video = fs.readFileSync(videoPath, "utf8");

assert.match(video, /generateSmartLocalVideo/,
  "Video UI must import/use smart Fast-first generation");
assert.match(video, /cancelSmartLocalVideo/,
  "Video UI must cancel the smart path when beta mode is active");
assert.match(video, /startWanFastEngine/,
  "Video UI must be able to prewarm the persistent engine");
assert.match(video, /getWanFastStatus/,
  "Video UI must read persistent engine state for diagnostics");
assert.match(video, /resolveWanProfile/,
  "Video UI must use the shared Fast/Balanced/Quality policy");

assert.match(video, /const \[fastEngineEnabled, setFastEngineEnabled\] = useState\(false\)/,
  "Fast Engine beta must be OFF by default");
assert.match(video, /Motor rápido \(teste\)/,
  "UI must clearly label the persistent engine as a test/beta path");
assert.match(video, />Rápido</,
  "UI must expose the Fast profile");
assert.match(video, />Equilibrado</,
  "UI must expose the Balanced profile");
assert.match(video, />Qualidade</,
  "UI must expose the Quality profile");
assert.match(video, /resolveWanProfile\("fast"\)/,
  "Fast profile must resolve through shared policy");
assert.match(video, /resolveWanProfile\("balanced"\)/,
  "Balanced profile must resolve through shared policy");
assert.match(video, /resolveWanProfile\("quality"\)/,
  "Quality profile must resolve through shared policy");

assert.match(video, /fastEngineEnabled[\s\S]{0,1000}status\?\.active[\s\S]{0,1600}startWanFastEngine\(\)/,
  "prewarm must be conditional on beta enabled and active Wan model");
assert.doesNotMatch(video, /stopWanFastEngine/,
  "changing/focusing tabs must not unload Fast Engine; native background lifecycle owns shutdown");

assert.match(video, /fastEngineEnabled\s*\?\s*generateSmartLocalVideo\s*:\s*generateLocalVideo/,
  "Generate must select Smart Fast-first vs current CLI based on beta switch");
assert.match(video, /fastEngineEnabled\s*\?\s*cancelSmartLocalVideo\s*:\s*cancelLocalVideo/,
  "Cancel must target the same engine mode as the active request");

assert.match(video, /progress\.completed\s*\/\s*progress\.total/,
  "generation percentage must use engine-native completed/total values");
assert.doesNotMatch(video, /progress\.total\s*===\s*steps/,
  "native progress total must not be tied to requested step count");

assert.match(video, /fastStateLabel/,
  "UI must map Fast Engine lifecycle state to user-facing labels");
for (const label of ["Inicializando motor", "Carregando modelos", "Pronto", "Gerando", "Finalizando"]) {
  assert.ok(video.includes(label), `missing Fast Engine state label: ${label}`);
}
assert.match(video, /engineMode/,
  "successful Smart result must display engine mode metadata");
assert.match(video, /startKind/,
  "successful Smart result must display cold/warm metadata");
assert.match(video, /timings\.totalMs/,
  "successful Smart result must display measured total time");
assert.match(video, /timeToFirstProgressMs/,
  "successful Smart result must display first-progress latency when available");
assert.match(video, /fallbackReason/,
  "CLI fallback must be visible to the user");

assert.match(video, /runVideoStudioPostProcess/,
  "PT-BR post-processing must remain wired");
assert.match(video, /videoUri:\s*result\.uri/,
  "Smart generation must preserve the existing result URI contract for dubbing/export");
assert.match(video, /Dublagem PT-BR/,
  "PT-BR dubbing UI must remain present");
assert.match(video, /Dublar e exportar/,
  "MP4 export action must remain present");

console.log("Wan Fast UI contract passed.");
