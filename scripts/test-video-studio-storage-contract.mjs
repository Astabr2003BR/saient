import assert from "node:assert/strict";
import fs from "node:fs";

const files = {
  moduleConfig: "modules/saient-video-studio/expo-module.config.json",
  index: "modules/saient-video-studio/index.ts",
  bridge: "modules/saient-video-studio/src/SaientVideoStudioStorageModule.ts",
  kotlin: "modules/saient-video-studio/android/src/main/java/expo/modules/saientvideostudio/SaientVideoStudioStorageModule.kt",
};

for (const [label, path] of Object.entries(files)) {
  assert.equal(fs.existsSync(path), true, `${label} missing: ${path}`);
}

const moduleConfig = fs.readFileSync(files.moduleConfig, "utf8");
assert.match(moduleConfig, /expo\.modules\.saientvideostudio\.SaientVideoStudioStorageModule/);

const index = fs.readFileSync(files.index, "utf8");
assert.match(index, /export function promoteVideoStudioExport\b/);
assert.match(index, /export function cleanupSynthesizedSegments\b/);

const bridge = fs.readFileSync(files.bridge, "utf8");
assert.match(bridge, /requireOptionalNativeModule<SaientVideoStudioStorageModule>\("SaientVideoStudioStorage"\)/);
assert.match(bridge, /promoteExport\(uri: string, outputName: string\)/);
assert.match(bridge, /cleanupSynthesizedSegments\(uris: string\[\]\)/);

const kotlin = fs.readFileSync(files.kotlin, "utf8");
assert.match(kotlin, /Name\("SaientVideoStudioStorage"\)/);
assert.match(kotlin, /AsyncFunction\("promoteExport"\)/);
assert.match(kotlin, /AsyncFunction\("cleanupSynthesizedSegments"\)/);
assert.match(kotlin, /File\(context\(\)\.filesDir, "video-studio\/exports"\)/);
assert.match(kotlin, /File\(context\(\)\.cacheDir, "video-studio\/tts"\)/);
assert.match(kotlin, /canonicalFile/);
assert.match(kotlin, /copyTo\(/);
assert.match(kotlin, /source\.delete\(\)/);
assert.match(kotlin, /parentFile\?\.delete\(\)/);
assert.doesNotMatch(kotlin, /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/);

console.log("persistent video studio storage contract passed");
