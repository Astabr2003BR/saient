import SaientVideoStudioModule, {
  type ExportAudioSegment,
  type ExportCaption,
  type ExportDubbedVideoOptions,
  type ExportDubbedVideoResult,
  type OfflineVoice,
  type SpeechSynthesisOptions,
  type SynthesizedSegment,
} from "./src/SaientVideoStudioModule";
import SaientVideoStudioStorageModule, {
  type CleanupSynthesizedSegmentsResult,
  type PromotedVideoStudioExport,
} from "./src/SaientVideoStudioStorageModule";

function requiredModule() {
  if (!SaientVideoStudioModule) {
    throw new Error("This build does not include Saient's Android video-studio runtime.");
  }
  return SaientVideoStudioModule;
}

function requiredStorageModule() {
  if (!SaientVideoStudioStorageModule) {
    throw new Error("This build does not include Saient's Android video-studio storage runtime.");
  }
  return SaientVideoStudioStorageModule;
}

export function videoStudioAvailable(): boolean {
  return SaientVideoStudioModule != null && SaientVideoStudioStorageModule != null;
}

export function getOfflineVoices(locale = "pt-BR"): Promise<OfflineVoice[]> {
  return requiredModule().getOfflineVoices(locale);
}

export function synthesizeSpeechSegment(
  options: SpeechSynthesisOptions,
): Promise<SynthesizedSegment> {
  return requiredModule().synthesizeSpeechSegment(options);
}

export function cancelSpeechSynthesis(): Promise<boolean> {
  return requiredModule().cancelSpeechSynthesis();
}

export function exportDubbedVideo(
  options: ExportDubbedVideoOptions,
): Promise<ExportDubbedVideoResult> {
  return requiredModule().exportDubbedVideo(options);
}

export function cancelVideoExport(): Promise<boolean> {
  return requiredModule().cancelVideoExport();
}

export function promoteVideoStudioExport(
  uri: string,
  outputName: string,
): Promise<PromotedVideoStudioExport> {
  return requiredStorageModule().promoteExport(uri, outputName);
}

export function cleanupSynthesizedSegments(
  uris: string[],
): Promise<CleanupSynthesizedSegmentsResult> {
  return requiredStorageModule().cleanupSynthesizedSegments(uris);
}

export type {
  CleanupSynthesizedSegmentsResult,
  ExportAudioSegment,
  ExportCaption,
  ExportDubbedVideoOptions,
  ExportDubbedVideoResult,
  OfflineVoice,
  PromotedVideoStudioExport,
  SpeechSynthesisOptions,
  SynthesizedSegment,
};
