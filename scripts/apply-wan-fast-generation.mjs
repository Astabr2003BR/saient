import fs from "node:fs";

const modulePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
let source = fs.readFileSync(modulePath, "utf8");

if (!source.includes("internal fun combineWanNegativePrompt")) {
  const marker = "private data class RemoteModelFile(";
  if (!source.includes(marker)) throw new Error("Wan negative prompt helper anchor not found.");
  source = source.replace(
    marker,
    `internal fun combineWanNegativePrompt(userNegative: String): String =\n  if (userNegative.isEmpty()) WAN_DEFAULT_NEGATIVE else "$WAN_DEFAULT_NEGATIVE，$userNegative"\n\n${marker}`,
  );
}

if (!source.includes('AsyncFunction("generateFastLocalVideo")')) {
  const marker = `    AsyncFunction("generateVideo") Coroutine { options: VideoGenerationOptions ->\n      withContext(Dispatchers.IO) { generateVideo(options) }\n    }`;
  if (!source.includes(marker)) throw new Error("Wan Fast generation bridge anchor not found.");
  const fastBridge = `    AsyncFunction("generateFastLocalVideo") Coroutine { options: VideoGenerationOptions ->\n      withContext(Dispatchers.IO) {\n        wanFastManager.generate(options) { completed, total, detail ->\n          sendVideoProgress("denoising", "Processando $completed de $total", completed, total, detail)\n        }\n      }\n    }\n\n    AsyncFunction("cancelFastLocalVideo") Coroutine { ->\n      withContext(Dispatchers.IO) { wanFastManager.cancelGeneration() }\n    }\n\n${marker}`;
  source = source.replace(marker, fastBridge);
}

fs.writeFileSync(modulePath, source);
console.log("Applied Wan Fast generation bridge.");
