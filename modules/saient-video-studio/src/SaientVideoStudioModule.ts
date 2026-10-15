import { NativeModule, requireOptionalNativeModule } from "expo";

export type OfflineVoice = {
  name: string;
  locale: string;
  quality: number;
  latency: number;
  features: string[];
  networkRequired: false;
};

export type SpeechSynthesisOptions = {
  text: string;
  locale?: string;
  voiceName?: string;
  speechRate: number;
};

export type SynthesizedSegment = {
  uri: string;
  durationMs: number;
  text: string;
  locale: string;
  voiceName: string;
  speechRate: number;
};

declare class SaientVideoStudioModule extends NativeModule<Record<string, never>> {
  getOfflineVoices(locale: string): Promise<OfflineVoice[]>;
  synthesizeSpeechSegment(options: SpeechSynthesisOptions): Promise<SynthesizedSegment>;
  cancelSpeechSynthesis(): Promise<boolean>;
}

export default requireOptionalNativeModule<SaientVideoStudioModule>("SaientVideoStudio");
