import { NativeModule, requireOptionalNativeModule } from "expo";

export type DiffusionProgress = {
  phase: "encoding" | "denoising" | "decoding";
  completed: number;
  total: number;
};

export type DiffusionDownloadProgress = {
  completedBytes: number;
  totalBytes: number;
  currentFile: string;
  model?: "image" | "video";
};

export type DiffusionStatus = {
  available: boolean;
  installed: boolean;
  valid: boolean;
  active: boolean;
  modelBytes: number;
  message: string;
};

export type DiffusionGenerationOptions = {
  prompt: string;
  negativePrompt?: string;
  steps: number;
  guidance: number;
  seed: number;
};

export type DiffusionGenerationResult = {
  uri: string;
  elapsedSeconds: number;
  steps: number;
  seed: number;
  width: number;
  height: number;
};

export type VideoProgress = {
  phase: "preparing" | "starting" | "loading" | "denoising";
  message: string;
  detail?: string;
  completed: number;
  total: number;
};

export type VideoGenerationOptions = {
  prompt: string;
  negativePrompt?: string;
  steps: number;
  guidance: number;
  seed: number;
  frames: number;
};

export type VideoGenerationResult = {
  uri: string;
  elapsedSeconds: number;
  steps: number;
  seed: number;
  width: number;
  height: number;
  frames: number;
  fps: number;
};

export type WanFastState =
  | "stopped"
  | "starting"
  | "loading"
  | "ready"
  | "generating"
  | "stopping"
  | "failed";

export type WanFastStatus = {
  state: WanFastState;
  available: boolean;
  healthy: boolean;
  sessionId?: string;
  generationCount: number;
  message: string;
  lastError?: string;
};

export type WanGenerationTimings = {
  engineStartMs: number;
  timeToFirstProgressMs?: number;
  generationMs: number;
  totalMs: number;
};

export type WanFastVideoResult = VideoGenerationResult & {
  engineMode: "fast";
  startKind: "cold" | "warm";
  engineSessionId: string;
  generationCount: number;
  timings: WanGenerationTimings;
};

type DiffusionEvents = {
  onProgress: (event: DiffusionProgress) => void;
  onVideoProgress: (event: VideoProgress) => void;
  onDownloadProgress: (event: DiffusionDownloadProgress) => void;
};

declare class SaientDiffusionModule extends NativeModule<DiffusionEvents> {
  getStatus(): Promise<DiffusionStatus>;
  importModelTree(treeUri: string): Promise<DiffusionStatus>;
  downloadModel(): Promise<DiffusionStatus>;
  cancelModelDownload(): Promise<boolean>;
  removeModel(): Promise<DiffusionStatus>;
  setModelActive(active: boolean): Promise<DiffusionStatus>;
  generate(options: DiffusionGenerationOptions): Promise<DiffusionGenerationResult>;
  cancelGeneration(): Promise<boolean>;
  getVideoStatus(): Promise<DiffusionStatus>;
  downloadVideoModel(): Promise<DiffusionStatus>;
  removeVideoModel(): Promise<DiffusionStatus>;
  setVideoModelActive(active: boolean): Promise<DiffusionStatus>;
  generateVideo(options: VideoGenerationOptions): Promise<VideoGenerationResult>;
  getWanFastStatus(): Promise<WanFastStatus>;
  startWanFastEngine(): Promise<WanFastStatus>;
  stopWanFastEngine(): Promise<WanFastStatus>;
  generateFastLocalVideo(options: VideoGenerationOptions): Promise<WanFastVideoResult>;
  cancelFastLocalVideo(): Promise<boolean>;
}

export default requireOptionalNativeModule<SaientDiffusionModule>("SaientDiffusion");
