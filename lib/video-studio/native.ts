import {
  cancelSpeechSynthesis,
  cancelVideoExport,
  cleanupSynthesizedSegments,
  exportDubbedVideo,
  promoteVideoStudioExport,
  synthesizeSpeechSegment,
  videoStudioAvailable,
} from "@/modules/saient-video-studio";
import {
  runVideoStudioPostProcess,
  type VideoStudioPostProcessOptions,
  type VideoStudioPostProcessResult,
} from "./pipeline";

export function nativeVideoStudioAvailable(): boolean {
  return videoStudioAvailable();
}

export function generatedVideoDurationMs(frames: number, fps: number): number {
  if (!Number.isFinite(frames) || frames <= 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new RangeError("Generated video frames and fps must be positive finite numbers.");
  }
  return Math.round((frames / fps) * 1000);
}

export function runNativeVideoStudioPostProcess(
  options: VideoStudioPostProcessOptions,
): Promise<VideoStudioPostProcessResult> {
  if (!nativeVideoStudioAvailable()) {
    throw new Error("This build does not include Saient Video Studio native support.");
  }

  return runVideoStudioPostProcess(options, {
    synthesizeSpeechSegment,
    exportDubbedVideo,
    promoteVideoStudioExport,
    cleanupSynthesizedSegments,
    cancelSpeechSynthesis,
    cancelVideoExport,
  });
}
