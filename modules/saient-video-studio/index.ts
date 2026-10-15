import SaientVideoStudioModule, {
  type OfflineVoice,
  type SpeechSynthesisOptions,
  type SynthesizedSegment,
} from "./src/SaientVideoStudioModule";

function requiredModule() {
  if (!SaientVideoStudioModule) {
    throw new Error("This build does not include Saient's Android video-studio runtime.");
  }
  return SaientVideoStudioModule;
}

export function videoStudioAvailable(): boolean {
  return SaientVideoStudioModule != null;
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

export type { OfflineVoice, SpeechSynthesisOptions, SynthesizedSegment };
