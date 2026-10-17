import fs from "node:fs";

const modulePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
let source = fs.readFileSync(modulePath, "utf8");

const unsafeWrapper = `  private fun generateVideo(options: VideoGenerationOptions): Map<String, Any> {\n    reserveWanGeneration()\n    return try {\n      generateVideoReserved(options)\n    } finally {\n      releaseWanGeneration()\n    }\n  }`;

const safeWrapper = `  private fun generateVideo(options: VideoGenerationOptions): Map<String, Any> {\n    reserveWanGeneration()\n    return try {\n      wanChatPauseCoordinatorLazy.value.acquire()\n      try {\n        wanFastManager.stop()\n        generateVideoReserved(options)\n      } finally {\n        wanChatPauseCoordinatorLazy.value.release()\n      }\n    } finally {\n      releaseWanGeneration()\n    }\n  }`;

if (source.includes(safeWrapper)) {
  console.log("Wan CLI isolation already applied.");
  process.exit(0);
}
if (!source.includes(unsafeWrapper)) {
  throw new Error("Wan CLI generation wrapper anchor not found.");
}

source = source.replace(unsafeWrapper, safeWrapper);
fs.writeFileSync(modulePath, source);
console.log("Applied Wan CLI isolation from prewarmed Fast Engine.");
