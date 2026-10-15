import assert from "node:assert/strict";
import fs from "node:fs";

const path = "app/(tabs)/video.tsx";
assert.equal(fs.existsSync(path), true, `missing ${path}`);
const source = fs.readFileSync(path, "utf8");

for (const symbol of [
  "getOfflineVoices",
  "synthesizeSpeechSegment",
  "cancelSpeechSynthesis",
  "exportDubbedVideo",
  "cancelVideoExport",
  "promoteVideoStudioExport",
  "cleanupSynthesizedSegments",
  "videoStudioAvailable",
]) {
  assert.match(source, new RegExp(`\\b${symbol}\\b`), `video screen must use ${symbol}`);
}
assert.match(source, /runVideoStudioPostProcess/);
assert.match(source, /type OfflineVoice/);
assert.match(source, /type VideoStudioPipelinePhase/);
assert.match(source, /useState\(""\).*narration|\[narration, setNarration\]/s);
assert.match(source, /\[voices, setVoices\]/);
assert.match(source, /\[selectedVoice, setSelectedVoice\]/);
assert.match(source, /\[speechRate, setSpeechRate\]/);
assert.match(source, /\[captionsEnabled, setCaptionsEnabled\]/);
assert.match(source, /getOfflineVoices\("pt-BR"\)/);
assert.match(source, /result\.frames\s*\/\s*result\.fps\s*\*\s*1000/);
assert.match(source, /videoUri:\s*result\.uri/);
assert.match(source, /locale:\s*"pt-BR"/);
assert.match(source, /voiceName:\s*selectedVoice/);
assert.match(source, /captionsEnabled/);
assert.match(source, /synthesizeSpeechSegment,\s*exportDubbedVideo,\s*promoteVideoStudioExport,\s*cleanupSynthesizedSegments/s);
assert.match(source, /cancelSpeechSynthesis\(\)/);
assert.match(source, /cancelVideoExport\(\)/);
assert.match(source, /Dublagem PT-BR/);
assert.match(source, /Legendas/);
assert.match(source, /Dublar e exportar/);
assert.match(source, /Nenhuma voz PT-BR sem internet/);
assert.match(source, /Vídeo final/);

const forbiddenEnglishUi = [
  "Add the Wan video pack",
  "Download the quantized Wan2.1",
  "offline after setup",
  "Downloading ",
  "Download Wan pack",
  "Connecting to Saient Pi",
  "Cancel download",
  "model details",
  "mobile pack",
  '"Active"',
  '"Inactive"',
  ">Activate<",
  "Remove Wan model?",
  "Generated videos stay on the phone.",
  "Motion prompt",
  "Avoid (optional)",
  ">Steps<",
  "Length at 8 fps",
  "Start with 5 frames at Standard",
  ">Seed<",
  ">Random<",
  "`Processing ${",
  '"Loading Wan"',
  "Chat is unloaded until the native video process exits.",
  "Cancel generation",
  "Generate on phone",
  '"Checking"',
  '"Ready"',
  '"Model needed"',
  ">Video<",
  " frames · ",
  " steps · ",
  "Video final",
];

for (const text of forbiddenEnglishUi) {
  assert.equal(source.includes(text), false, `video screen still contains English UI text: ${text}`);
}

console.log("video studio PT-BR dubbing UI contract passed");
