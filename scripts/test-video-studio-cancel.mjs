import assert from "node:assert/strict";
import { runVideoStudioPostProcess } from "../lib/video-studio/pipeline.ts";

const calls = [];
let releaseSynthesis;
const synthesisStarted = new Promise((resolve) => {
  releaseSynthesis = resolve;
});

const deps = {
  async synthesizeSpeechSegment(options) {
    calls.push(["synthesize", options]);
    releaseSynthesis();
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      uri: "file:///cache/video-studio/tts/job-1/segment.wav",
      durationMs: 500,
      text: options.text,
      locale: options.locale ?? "pt-BR",
      voiceName: options.voiceName ?? "pt-br-offline",
      speechRate: options.speechRate,
    };
  },
  async exportDubbedVideo() {
    calls.push(["export"]);
    throw new Error("export must not run after cancellation");
  },
  async promoteVideoStudioExport() {
    calls.push(["promote"]);
    throw new Error("promote must not run after cancellation");
  },
  async cleanupSynthesizedSegments(uris) {
    calls.push(["cleanup", [...uris]]);
    return { deleted: uris.length, skipped: 0 };
  },
  async cancelSpeechSynthesis() {
    calls.push(["cancelSpeech"]);
    return true;
  },
  async cancelVideoExport() {
    calls.push(["cancelExport"]);
    return false;
  },
};

const controller = new AbortController();
const operation = runVideoStudioPostProcess({
  videoUri: "file:///files/remote-generations/wan.webm",
  videoDurationMs: 1000,
  narration: "Cancelar esta dublagem.",
  captionsEnabled: true,
  outputName: "cancelled",
  signal: controller.signal,
}, deps);

await synthesisStarted;
controller.abort();

await assert.rejects(operation, /cancel/i);
assert.ok(calls.some(([name]) => name === "cancelSpeech"));
assert.ok(calls.some(([name]) => name === "cancelExport"));
assert.equal(calls.some(([name]) => name === "export"), false);
assert.equal(calls.some(([name]) => name === "promote"), false);
const cleanup = calls.find(([name]) => name === "cleanup");
assert.ok(cleanup, "cleanup must run after a synthesized file is returned during cancellation");
assert.deepEqual(cleanup[1], ["file:///cache/video-studio/tts/job-1/segment.wav"]);

console.log("video studio cancellation contract passed");
