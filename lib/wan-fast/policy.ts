export type WanProfile = "fast" | "balanced" | "quality";
export type WanStartKind = "cold" | "warm";
export type WanEngineMode = "fast" | "cli-fallback" | "cli";
export type WanFallbackReason = "cancelled" | "startup" | "runtime" | "memory" | "generation";

export function resolveWanProfile(profile: WanProfile): { steps: number; frames: number } {
  switch (profile) {
    case "fast":
      return { steps: 8, frames: 5 };
    case "balanced":
      return { steps: 8, frames: 17 };
    case "quality":
      return { steps: 12, frames: 17 };
  }
}

export function wanProgressFraction(completed: number, total: number): number {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, completed / total));
}

export function shouldWanFallback(reason: WanFallbackReason): boolean {
  return reason !== "cancelled";
}
