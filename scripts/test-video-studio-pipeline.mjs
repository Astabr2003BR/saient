import assert from "node:assert/strict";
import { runVideoStudioPostProcess } from "../lib/video-studio/pipeline.ts";

function createDeps({ durations = [700, 600], failSynthesisAt = -1, failCleanup = false } = {}) {
  const calls = [];
  let synthIndex = 0;
  return {
    calls,
    deps: {
      async synthesizeSpeechSegment(options) {
        const index = synthIndex++;
        calls.push(["synthesize", index, options]);
        if (index === failSynthesisAt) throw new Error(`tts-${index}-failed`);
        return {
          uri: `file:///cache/video-studio/tts/job-${index}/segment.wav`,
          durationMs: durations[index] ?? 500,
          text: options.text,
          locale: options.locale ?? "pt-BR",
          voiceName: options.voiceName ?? "pt-br-offline",
          speechRate: options.speechRate,
        };
      },
      async exportDubbedVideo(options) {
        calls.push(["export", options]);
        return {
          uri: "file:///cache/video-studio/exports/draft.mp4",
          durationMs: 3000,
          fileBytes: 1234,
          audioSegmentCount: options.audioSegments.length,
          captionCount: options.captions.length,
        };
      },
      async promoteVideoStudioExport(uri, outputName) {
        calls.push(["promote", uri, outputName]);
        return { uri: "file:///files/video-studio/exports/final.mp4", fileBytes: 1200 };
      },
      async cleanupSynthesizedSegments(uris) {
        calls.push(["cleanup", [...uris]]);
        if (failCleanup) throw new Error("cleanup-failed");
        return { deleted: uris.length, skipped: 0 };
      },
    },
  };
}

{
  const { deps, calls } = createDeps();
  const phases = [];
  const result = await runVideoStudioPostProcess({
    videoUri: "file:///files/remote-generations/wan.webm",
    videoDurationMs: 3000,
    narration: "Primeira fala. Segunda fala!",
    locale: "pt-BR",
    voiceName: "pt-br-offline",
    speechRate: 1,
    captionsEnabled: true,
    outputName: "meu-video",
    gapMs: 80,
    onProgress: (event) => phases.push(event.phase),
  }, deps);

  assert.equal(result.uri, "file:///files/video-studio/exports/final.mp4");
  assert.equal(result.audioSegmentCount, 2);
  assert.equal(result.captionCount, 2);
  assert.deepEqual(result.cleanup, { deleted: 2, skipped: 0 });

  const exportCall = calls.find(([name]) => name === "export")[1];
  assert.deepEqual(exportCall.audioSegments.map(({ startMs, durationMs }) => [startMs, durationMs]), [
    [0, 700],
    [780, 600],
  ]);
  assert.deepEqual(exportCall.captions.map(({ startMs, endMs }) => [startMs, endMs]), [
    [0, 700],
    [780, 1380],
  ]);
  assert.deepEqual(calls.at(-1)[0], "cleanup");
  assert.ok(phases.includes("synthesizing"));
  assert.ok(phases.includes("exporting"));
  assert.ok(phases.includes("promoting"));
  assert.ok(phases.includes("cleanup"));
}

{
  const { deps, calls } = createDeps({ durations: [1800, 1700] });
  await assert.rejects(
    runVideoStudioPostProcess({
      videoUri: "file:///files/remote-generations/wan.webm",
      videoDurationMs: 3000,
      narration: "Primeira fala. Segunda fala.",
      captionsEnabled: true,
      outputName: "too-long",
    }, deps),
    /narration.*longer.*video/i,
  );
  assert.equal(calls.some(([name]) => name === "export"), false);
  assert.equal(calls.at(-1)[0], "cleanup");
  assert.equal(calls.at(-1)[1].length, 2);
}

{
  const { deps, calls } = createDeps({ failSynthesisAt: 1 });
  await assert.rejects(
    runVideoStudioPostProcess({
      videoUri: "file:///files/remote-generations/wan.webm",
      videoDurationMs: 3000,
      narration: "Primeira fala. Segunda fala.",
      captionsEnabled: true,
      outputName: "tts-fail",
    }, deps),
    /tts-1-failed/,
  );
  assert.equal(calls.some(([name]) => name === "export"), false);
  const cleanup = calls.at(-1);
  assert.equal(cleanup[0], "cleanup");
  assert.deepEqual(cleanup[1], ["file:///cache/video-studio/tts/job-0/segment.wav"]);
}

{
  const { deps, calls } = createDeps({ durations: [650] });
  const result = await runVideoStudioPostProcess({
    videoUri: "file:///files/remote-generations/wan.webm",
    videoDurationMs: 1000,
    narration: "Sem legenda.",
    captionsEnabled: false,
    outputName: "no-captions",
  }, deps);
  const exportCall = calls.find(([name]) => name === "export")[1];
  assert.deepEqual(exportCall.captions, []);
  assert.equal(result.captionCount, 0);
}

{
  const { deps } = createDeps({ durations: [650], failCleanup: true });
  const result = await runVideoStudioPostProcess({
    videoUri: "file:///files/remote-generations/wan.webm",
    videoDurationMs: 1000,
    narration: "Limpeza falha.",
    captionsEnabled: true,
    outputName: "cleanup-warning",
  }, deps);
  assert.equal(result.uri, "file:///files/video-studio/exports/final.mp4");
  assert.match(result.cleanupWarning ?? "", /cleanup-failed/);
}

await assert.rejects(
  runVideoStudioPostProcess({
    videoUri: "file:///files/remote-generations/wan.webm",
    videoDurationMs: 1000,
    narration: "   ",
    captionsEnabled: true,
    outputName: "empty",
  }, createDeps().deps),
  /narration.*empty/i,
);

console.log("video studio post-process pipeline contracts passed");
