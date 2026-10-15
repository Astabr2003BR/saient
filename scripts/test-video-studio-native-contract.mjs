import assert from "node:assert/strict";
import fs from "node:fs";

const files = {
  moduleConfig: "modules/saient-video-studio/expo-module.config.json",
  index: "modules/saient-video-studio/index.ts",
  bridge: "modules/saient-video-studio/src/SaientVideoStudioModule.ts",
  gradle: "modules/saient-video-studio/android/build.gradle",
  kotlin: "modules/saient-video-studio/android/src/main/java/expo/modules/saientvideostudio/SaientVideoStudioModule.kt",
  plugin: "plugins/withTextToSpeechQueries.js",
  appJson: "app.json",
};

for (const [label, path] of Object.entries(files)) {
  assert.equal(fs.existsSync(path), true, `${label} missing: ${path}`);
}

const moduleConfig = fs.readFileSync(files.moduleConfig, "utf8");
assert.match(moduleConfig, /expo\.modules\.saientvideostudio\.SaientVideoStudioModule/);

const index = fs.readFileSync(files.index, "utf8");
for (const symbol of [
  "getOfflineVoices",
  "synthesizeSpeechSegment",
  "cancelSpeechSynthesis",
]) {
  assert.match(index, new RegExp(`export function ${symbol}\\b`), `missing JS export ${symbol}`);
}

const bridge = fs.readFileSync(files.bridge, "utf8");
assert.match(bridge, /requireOptionalNativeModule<SaientVideoStudioModule>\("SaientVideoStudio"\)/);
assert.match(bridge, /locale: string/);
assert.match(bridge, /voiceName\??: string/);
assert.match(bridge, /speechRate: number/);
assert.match(bridge, /durationMs: number/);
assert.match(bridge, /uri: string/);

const kotlin = fs.readFileSync(files.kotlin, "utf8");
for (const api of ["getOfflineVoices", "synthesizeSpeechSegment", "cancelSpeechSynthesis"]) {
  assert.match(kotlin, new RegExp(`AsyncFunction\\(\"${api}\"\\)`), `missing native API ${api}`);
}
assert.match(kotlin, /Name\("SaientVideoStudio"\)/);
assert.match(kotlin, /!voice\.isNetworkConnectionRequired/);
assert.match(kotlin, /Locale\.forLanguageTag\((?:localeTag|normalized)\)/);
assert.match(kotlin, /synthesizeToFile/);
assert.match(kotlin, /UtteranceProgressListener/);
assert.match(kotlin, /MediaMetadataRetriever/);
assert.match(kotlin, /TextToSpeech\.getMaxSpeechInputLength\(\)/);
assert.match(kotlin, /cacheDir/);
assert.match(kotlin, /shutdown\(\)/);
assert.match(kotlin, /CompletableDeferred<Int>/, "TTS initialization must use an explicit completion signal");
assert.match(kotlin, /initialization\.await\(\)/, "TTS initialization must await the callback result");
assert.doesNotMatch(kotlin, /AtomicReference<TextToSpeech/, "TTS initialization must not depend on callback/reference ordering");
assert.doesNotMatch(kotlin, /http:\/\//i);
assert.doesNotMatch(kotlin, /https:\/\//i);

const plugin = fs.readFileSync(files.plugin, "utf8");
assert.match(plugin, /android\.intent\.action\.TTS_SERVICE/);

const appJson = fs.readFileSync(files.appJson, "utf8");
assert.match(appJson, /\.\/plugins\/withTextToSpeechQueries/);

console.log("offline PT-BR TTS native contract passed");
