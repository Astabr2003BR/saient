import assert from "node:assert/strict";
import fs from "node:fs";

const indexPath = "modules/saient-video-studio/index.ts";
const bridgePath = "modules/saient-video-studio/src/SaientVideoStudioModule.ts";
const gradlePath = "modules/saient-video-studio/android/build.gradle";
const kotlinPath = "modules/saient-video-studio/android/src/main/java/expo/modules/saientvideostudio/SaientVideoStudioModule.kt";

for (const path of [indexPath, bridgePath, gradlePath, kotlinPath]) {
  assert.equal(fs.existsSync(path), true, `missing ${path}`);
}

const index = fs.readFileSync(indexPath, "utf8");
assert.match(index, /export function exportDubbedVideo\b/);
assert.match(index, /export function cancelVideoExport\b/);

const bridge = fs.readFileSync(bridgePath, "utf8");
for (const shape of [
  /audioSegments: ExportAudioSegment\[\]/,
  /captions: ExportCaption\[\]/,
  /outputName: string/,
  /videoUri: string/,
  /exportDubbedVideo\(options: ExportDubbedVideoOptions\)/,
  /cancelVideoExport\(\): Promise<boolean>/,
]) {
  assert.match(bridge, shape);
}

const gradle = fs.readFileSync(gradlePath, "utf8");
for (const artifact of ["media3-transformer", "media3-effect", "media3-common"]) {
  assert.match(gradle, new RegExp(`androidx\\.media3:${artifact}:1\\.11\\.1`), `${artifact} must be pinned to 1.11.1`);
}
assert.match(gradle, /JavaVersion\.VERSION_1_8/);

const kotlin = fs.readFileSync(kotlinPath, "utf8");
for (const api of ["exportDubbedVideo", "cancelVideoExport"]) {
  assert.match(kotlin, new RegExp(`AsyncFunction\\(\"${api}\"\\)`), `missing native API ${api}`);
}
for (const token of [
  "Transformer.Builder",
  "Composition.Builder",
  "EditedMediaItemSequence",
  "OverlayEffect",
  "TextOverlay",
  "addGap",
  "MimeTypes.AUDIO_AAC",
  "MimeTypes.VIDEO_H264",
  "MediaMetadataRetriever",
]) {
  assert.ok(kotlin.includes(token), `missing export implementation token: ${token}`);
}
assert.match(kotlin, /narrationDurationMs\s*>\s*videoDurationMs/);
assert.match(kotlin, /transformer\.cancel\(\)/);
assert.match(kotlin, /\.mp4/);
assert.match(kotlin, /delete\(\)/);

console.log("dubbed MP4 export native contract passed");
