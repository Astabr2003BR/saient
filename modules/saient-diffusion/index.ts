import SaientDiffusionModule, {
  type DiffusionGenerationOptions,
  type DiffusionGenerationResult,
  type DiffusionDownloadProgress,
  type DiffusionProgress,
  type DiffusionStatus,
  type VideoGenerationOptions,
  type VideoGenerationResult,
  type VideoProgress,
  type WanFastState,
  type WanFastStatus,
  type WanGenerationTimings,
  type WanFastVideoResult,
} from "./src/SaientDiffusionModule";

function requiredModule() {
  if (!SaientDiffusionModule) {
    throw new Error("This build does not include Saient's Android diffusion runtime.");
  }
  return SaientDiffusionModule;
}

export function diffusionAvailable(): boolean {
  return SaientDiffusionModule != null;
}

export function getDiffusionStatus(): Promise<DiffusionStatus> {
  return requiredModule().getStatus();
}

export function importDiffusionModelTree(treeUri: string): Promise<DiffusionStatus> {
  return requiredModule().importModelTree(treeUri);
}

export function downloadDiffusionModel(): Promise<DiffusionStatus> {
  return requiredModule().downloadModel();
}

export function cancelDiffusionModelDownload(): Promise<boolean> {
  return requiredModule().cancelModelDownload();
}

export function removeDiffusionModel(): Promise<DiffusionStatus> {
  return requiredModule().removeModel();
}

export function setDiffusionModelActive(active: boolean): Promise<DiffusionStatus> {
  return requiredModule().setModelActive(active);
}

export function generateLocalImage(
  options: DiffusionGenerationOptions,
): Promise<DiffusionGenerationResult> {
  return requiredModule().generate(options);
}

export function cancelLocalImage(): Promise<boolean> {
  return requiredModule().cancelGeneration();
}

export function getVideoStatus(): Promise<DiffusionStatus> {
  return requiredModule().getVideoStatus();
}

export function downloadVideoModel(): Promise<DiffusionStatus> {
  return requiredModule().downloadVideoModel();
}

export function removeVideoModel(): Promise<DiffusionStatus> {
  return requiredModule().removeVideoModel();
}

export function setVideoModelActive(active: boolean): Promise<DiffusionStatus> {
  return requiredModule().setVideoModelActive(active);
}

export function generateLocalVideo(
  options: VideoGenerationOptions,
): Promise<VideoGenerationResult> {
  return requiredModule().generateVideo(options);
}

export function cancelLocalVideo(): Promise<boolean> {
  return requiredModule().cancelGeneration();
}

export function getWanFastStatus(): Promise<WanFastStatus> {
  return requiredModule().getWanFastStatus();
}

export function startWanFastEngine(): Promise<WanFastStatus> {
  return requiredModule().startWanFastEngine();
}

export function stopWanFastEngine(): Promise<WanFastStatus> {
  return requiredModule().stopWanFastEngine();
}

export function generateFastLocalVideo(
  options: VideoGenerationOptions,
): Promise<WanFastVideoResult> {
  return requiredModule().generateFastLocalVideo(options);
}

export function cancelFastLocalVideo(): Promise<boolean> {
  return requiredModule().cancelFastLocalVideo();
}

export function addDiffusionProgressListener(listener: (event: DiffusionProgress) => void) {
  return requiredModule().addListener("onProgress", listener);
}

export function addDiffusionDownloadProgressListener(
  listener: (event: DiffusionDownloadProgress) => void,
) {
  return requiredModule().addListener("onDownloadProgress", listener);
}

export function addVideoProgressListener(listener: (event: VideoProgress) => void) {
  return requiredModule().addListener("onVideoProgress", listener);
}

export type {
  DiffusionGenerationOptions,
  DiffusionGenerationResult,
  DiffusionDownloadProgress,
  DiffusionProgress,
  DiffusionStatus,
  VideoGenerationOptions,
  VideoGenerationResult,
  VideoProgress,
  WanFastState,
  WanFastStatus,
  WanGenerationTimings,
  WanFastVideoResult,
};
