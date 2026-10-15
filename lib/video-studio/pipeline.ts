import { buildCaptionTimeline, segmentNarration } from "./script.ts";

export type VideoStudioPipelinePhase =
  | "synthesizing"
  | "exporting"
  | "promoting"
  | "cleanup"
  | "done";

export type VideoStudioPipelineProgress = {
  phase: VideoStudioPipelinePhase;
  completed?: number;
  total?: number;
};

export type VideoStudioPostProcessOptions = {
  videoUri: string;
  videoDurationMs: number;
  narration: string;
  locale?: string;
  voiceName?: string;
  speechRate?: number;
  captionsEnabled?: boolean;
  outputName: string;
  gapMs?: number;
  signal?: AbortSignal;
  onProgress?: (event: VideoStudioPipelineProgress) => void;
};

export type PipelineSynthesizedSegment = {
  uri: string;
  durationMs: number;
  text: string;
  locale: string;
  voiceName: string;
  speechRate: number;
};

export type PipelineCleanupResult = {
  deleted: number;
  skipped: number;
};

export type VideoStudioPipelineDependencies = {
  synthesizeSpeechSegment(options: {
    text: string;
    locale?: string;
    voiceName?: string;
    speechRate: number;
  }): Promise<PipelineSynthesizedSegment>;
  exportDubbedVideo(options: {
    videoUri: string;
    audioSegments: Array<{ uri: string; startMs: number; durationMs: number }>;
    captions: Array<{ text: string; startMs: number; endMs: number }>;
    outputName: string;
  }): Promise<{
    uri: string;
    durationMs: number;
    fileBytes: number;
    audioSegmentCount: number;
    captionCount: number;
  }>;
  promoteVideoStudioExport(uri: string, outputName: string): Promise<{
    uri: string;
    fileBytes: number;
  }>;
  cleanupSynthesizedSegments(uris: string[]): Promise<PipelineCleanupResult>;
  cancelSpeechSynthesis?(): Promise<boolean>;
  cancelVideoExport?(): Promise<boolean>;
};

export type VideoStudioPostProcessResult = {
  uri: string;
  fileBytes: number;
  audioSegmentCount: number;
  captionCount: number;
  cleanup?: PipelineCleanupResult;
  cleanupWarning?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateOptions(options: VideoStudioPostProcessOptions) {
  if (!options.videoUri.trim()) throw new Error("Video URI is empty.");
  if (!Number.isFinite(options.videoDurationMs) || options.videoDurationMs <= 0) {
    throw new RangeError("Video duration must be a positive finite number.");
  }
  if (!options.outputName.trim()) throw new Error("Output name is empty.");
  const speechRate = options.speechRate ?? 1;
  if (!Number.isFinite(speechRate) || speechRate < 0.5 || speechRate > 2) {
    throw new RangeError("Speech rate must be between 0.5 and 2.0.");
  }
}

function cancellationError() {
  return new Error("Video Studio post-process cancelled.");
}

export async function runVideoStudioPostProcess(
  options: VideoStudioPostProcessOptions,
  dependencies: VideoStudioPipelineDependencies,
): Promise<VideoStudioPostProcessResult> {
  validateOptions(options);

  const segments = segmentNarration(options.narration);
  if (segments.length === 0) throw new Error("Narration is empty.");

  const locale = options.locale?.trim() || "pt-BR";
  const speechRate = options.speechRate ?? 1;
  const captionsEnabled = options.captionsEnabled ?? true;
  const gapMs = options.gapMs ?? 80;
  const synthesized: PipelineSynthesizedSegment[] = [];
  const tempUris: string[] = [];
  let result: VideoStudioPostProcessResult | undefined;
  let operationError: unknown;

  const throwIfCancelled = () => {
    if (options.signal?.aborted) throw cancellationError();
  };

  const cancelNativeWork = () => {
    try {
      if (dependencies.cancelSpeechSynthesis) {
        void dependencies.cancelSpeechSynthesis().catch(() => false);
      }
    } catch {
      // Cancellation is best-effort; the AbortSignal remains authoritative.
    }
    try {
      if (dependencies.cancelVideoExport) {
        void dependencies.cancelVideoExport().catch(() => false);
      }
    } catch {
      // Cancellation is best-effort; the AbortSignal remains authoritative.
    }
  };

  const onAbort = () => cancelNativeWork();
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    throwIfCancelled();

    for (let index = 0; index < segments.length; index += 1) {
      throwIfCancelled();
      options.onProgress?.({ phase: "synthesizing", completed: index, total: segments.length });
      const item = await dependencies.synthesizeSpeechSegment({
        text: segments[index].text,
        locale,
        voiceName: options.voiceName,
        speechRate,
      });
      if (!item.uri?.trim()) throw new Error(`Synthesized segment ${index} returned an empty URI.`);
      if (!Number.isFinite(item.durationMs) || item.durationMs <= 0) {
        throw new Error(`Synthesized segment ${index} returned an invalid duration.`);
      }
      synthesized.push(item);
      tempUris.push(item.uri);
      throwIfCancelled();
      options.onProgress?.({ phase: "synthesizing", completed: index + 1, total: segments.length });
    }

    const timeline = buildCaptionTimeline(
      segments,
      synthesized.map((item) => item.durationMs),
      gapMs,
    );
    const narrationEndMs = timeline.at(-1)?.endMs ?? 0;
    if (narrationEndMs > options.videoDurationMs) {
      throw new Error(
        `Narration is longer than the video (${narrationEndMs}ms > ${Math.round(options.videoDurationMs)}ms).`,
      );
    }

    const audioSegments = timeline.map((caption, index) => ({
      uri: synthesized[index].uri,
      startMs: caption.startMs,
      durationMs: synthesized[index].durationMs,
    }));
    const captions = captionsEnabled
      ? timeline.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }))
      : [];

    throwIfCancelled();
    options.onProgress?.({ phase: "exporting" });
    const draft = await dependencies.exportDubbedVideo({
      videoUri: options.videoUri,
      audioSegments,
      captions,
      outputName: options.outputName,
    });
    throwIfCancelled();
    if (!draft.uri?.trim()) throw new Error("Video export returned an empty URI.");

    options.onProgress?.({ phase: "promoting" });
    const promoted = await dependencies.promoteVideoStudioExport(draft.uri, options.outputName);
    throwIfCancelled();
    if (!promoted.uri?.trim()) throw new Error("Persistent video promotion returned an empty URI.");
    if (!Number.isFinite(promoted.fileBytes) || promoted.fileBytes <= 0) {
      throw new Error("Persistent video promotion returned an invalid file size.");
    }

    result = {
      uri: promoted.uri,
      fileBytes: promoted.fileBytes,
      audioSegmentCount: audioSegments.length,
      captionCount: captions.length,
    };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (tempUris.length > 0) {
      options.onProgress?.({ phase: "cleanup" });
      try {
        const cleanup = await dependencies.cleanupSynthesizedSegments(tempUris);
        if (result) result.cleanup = cleanup;
      } catch (cleanupError) {
        if (result) {
          result.cleanupWarning = errorMessage(cleanupError);
        } else if (!operationError) {
          throw cleanupError;
        }
      }
    }
    options.signal?.removeEventListener("abort", onAbort);
  }

  if (!result) throw new Error("Video Studio pipeline ended without a result.");
  options.onProgress?.({ phase: "done" });
  return result;
}
