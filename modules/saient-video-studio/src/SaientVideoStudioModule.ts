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

export type ExportAudioSegment = {
  uri: string;
  startMs: number;
  durationMs: number;
};

export type ExportCaption = {
  text: string;
  startMs: number;
  endMs: number;
};

export type ExportDubbedVideoOptions = {
  videoUri: string;
  audioSegments: ExportAudioSegment[];
  captions: ExportCaption[];
  outputName: string;
};

export type ExportDubbedVideoResult = {
  uri: string;
  durationMs: number;
  fileBytes: number;
  audioSegmentCount: number;
  captionCount: number;
};

declare class SaientVideoStudioModule extends NativeModule<Record<string, never>> {
  getOfflineVoices(locale: string): Promise<OfflineVoice[]>;
  synthesizeSpeechSegment(options: SpeechSynthesisOptions): Promise<SynthesizedSegment>;
  cancelSpeechSynthesis(): Promise<boolean>;
  exportDubbedVideo(options: ExportDubbedVideoOptions): Promise<ExportDubbedVideoResult>;
  cancelVideoExport(): Promise<boolean>;
}

export default requireOptionalNativeModule<SaientVideoStudioModule>("SaientVideoStudio");
