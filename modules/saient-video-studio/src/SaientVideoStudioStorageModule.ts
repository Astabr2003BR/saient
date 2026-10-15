import { NativeModule, requireOptionalNativeModule } from "expo";

export type PromotedVideoStudioExport = {
  uri: string;
  fileBytes: number;
};

export type CleanupSynthesizedSegmentsResult = {
  deleted: number;
  skipped: number;
};

declare class SaientVideoStudioStorageModule extends NativeModule<Record<string, never>> {
  promoteExport(uri: string, outputName: string): Promise<PromotedVideoStudioExport>;
  cleanupSynthesizedSegments(uris: string[]): Promise<CleanupSynthesizedSegmentsResult>;
}

export default requireOptionalNativeModule<SaientVideoStudioStorageModule>("SaientVideoStudioStorage");
