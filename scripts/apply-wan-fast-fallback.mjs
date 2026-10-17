import fs from "node:fs";

const modulePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
const typesPath = "modules/saient-diffusion/src/SaientDiffusionModule.ts";
const indexPath = "modules/saient-diffusion/index.ts";

function requireReplace(source, anchor, replacement, label) {
  if (!source.includes(anchor)) throw new Error(`${label} anchor not found.`);
  return source.replace(anchor, replacement);
}

let source = fs.readFileSync(modulePath, "utf8");

if (!source.includes('AsyncFunction("generateSmartLocalVideo")')) {
  const bridgeAnchor = `    AsyncFunction("generateFastLocalVideo") Coroutine { options: VideoGenerationOptions ->\n      withContext(Dispatchers.IO) {\n        wanFastManager.generate(options) { completed, total, detail ->\n          sendVideoProgress("denoising", "Processando $completed de $total", completed, total, detail)\n        }\n      }\n    }\n\n    AsyncFunction("cancelFastLocalVideo") Coroutine { ->\n      withContext(Dispatchers.IO) { wanFastManager.cancelGeneration() }\n    }\n\n    AsyncFunction("generateVideo") Coroutine { options: VideoGenerationOptions ->\n      withContext(Dispatchers.IO) { generateVideo(options) }\n    }`;
  const bridgeReplacement = `    AsyncFunction("generateFastLocalVideo") Coroutine { options: VideoGenerationOptions ->\n      withContext(Dispatchers.IO) { generateFastVideo(options) }\n    }\n\n    AsyncFunction("cancelFastLocalVideo") Coroutine { ->\n      withContext(Dispatchers.IO) { wanFastManager.cancelGeneration() }\n    }\n\n    AsyncFunction("generateSmartLocalVideo") Coroutine { options: VideoGenerationOptions ->\n      withContext(Dispatchers.IO) { generateSmartVideo(options) }\n    }\n\n    AsyncFunction("cancelSmartLocalVideo") Coroutine { ->\n      withContext(Dispatchers.IO) { cancelSmartVideo() }\n    }\n\n    AsyncFunction("generateVideo") Coroutine { options: VideoGenerationOptions ->\n      withContext(Dispatchers.IO) { generateVideo(options) }\n    }`;
  source = requireReplace(source, bridgeAnchor, bridgeReplacement, "Wan Smart bridge");
}

if (!source.includes("private fun generateVideoReserved(")) {
  const signature = "  private fun generateVideo(options: VideoGenerationOptions): Map<String, Any> {";
  const replacement = `  private fun generateVideo(options: VideoGenerationOptions): Map<String, Any> {\n    reserveWanGeneration()\n    return try {\n      generateVideoReserved(options)\n    } finally {\n      releaseWanGeneration()\n    }\n  }\n\n  private fun generateVideoReserved(options: VideoGenerationOptions): Map<String, Any> {`;
  source = requireReplace(source, signature, replacement, "CLI reserved generation");

  const functionStart = source.indexOf("  private fun generateVideoReserved(");
  const functionEnd = source.indexOf("\n  private fun waitForChatEngineToStop", functionStart);
  if (functionStart < 0 || functionEnd < 0) throw new Error("CLI reserved function bounds not found.");
  let cli = source.slice(functionStart, functionEnd);

  const reservation = `    synchronized(processLock) {\n      if (modelTransferReserved) throw DiffusionException("Wait for the model transfer to finish.")\n      if (generationReserved || activeProcess?.isAlive == true) {\n        throw DiffusionException("Another local generation is already running.")\n      }\n      generationReserved = true\n      cancellationRequested = false\n    }\n\n`;
  if (!cli.includes(reservation)) throw new Error("CLI reservation block not found.");
  cli = cli.replace(reservation, "");

  const release = `      synchronized(processLock) {\n        activeProcess = null\n        cancellationRequested = false\n        generationReserved = false\n      }\n      if (!wasPaused) pausedMarker.delete()`;
  if (!cli.includes(release)) throw new Error("CLI reservation release block not found.");
  cli = cli.replace(
    release,
    `      synchronized(processLock) {\n        activeProcess = null\n      }\n      if (!wasPaused) pausedMarker.delete()`,
  );
  source = source.slice(0, functionStart) + cli + source.slice(functionEnd);
}

if (!source.includes("private fun reserveWanGeneration(")) {
  const marker = "  private fun generateVideo(options: VideoGenerationOptions): Map<String, Any> {";
  const helpers = `  private fun reserveWanGeneration() {\n    synchronized(processLock) {\n      if (modelTransferReserved) throw DiffusionException("Wait for the model transfer to finish.")\n      if (generationReserved || activeProcess?.isAlive == true) {\n        throw DiffusionException("Another local generation is already running.")\n      }\n      generationReserved = true\n      cancellationRequested = false\n    }\n  }\n\n  private fun releaseWanGeneration() {\n    synchronized(processLock) {\n      cancellationRequested = false\n      generationReserved = false\n    }\n  }\n\n  private fun generateFastVideo(options: VideoGenerationOptions): Map<String, Any?> {\n    reserveWanGeneration()\n    return try {\n      generateFastVideoReserved(options)\n    } finally {\n      releaseWanGeneration()\n    }\n  }\n\n  private fun generateFastVideoReserved(options: VideoGenerationOptions): Map<String, Any?> =\n    wanFastManager.generate(options) { completed, total, detail ->\n      sendVideoProgress("denoising", "Processando $completed de $total", completed, total, detail)\n    }\n\n  private fun generateSmartVideo(options: VideoGenerationOptions): Map<String, Any?> {\n    reserveWanGeneration()\n    val requestStartedNs = System.nanoTime()\n    val fastWasWarm = wanFastManager.status()["state"] == "ready"\n    return try {\n      try {\n        wanFastManager.generate(options) { completed, total, detail ->\n          sendVideoProgress("denoising", "Processando $completed de $total", completed, total, detail)\n        }\n      } catch (error: Exception) {\n        if (cancellationRequested || error.message?.contains("cancelled", ignoreCase = true) == true) {\n          throw DiffusionException("Video generation cancelled.", error)\n        }\n        val fallbackReason = error.message\n          ?.replace(Regex("""\\s+"""), " ")\n          ?.trim()\n          ?.take(240)\n          ?.ifBlank { null }\n          ?: "Wan Fast Engine failed."\n\n        wanChatPauseCoordinatorLazy.value.acquire()\n        try {\n          wanFastManager.stop()\n          if (cancellationRequested) throw DiffusionException("Video generation cancelled.", error)\n          val fallbackStartedNs = System.nanoTime()\n          val fallback = generateVideoReserved(options).toMutableMap()\n          val finishedNs = System.nanoTime()\n          val generationMs = ((finishedNs - fallbackStartedNs) / 1_000_000L).coerceAtLeast(0L)\n          val totalMs = ((finishedNs - requestStartedNs) / 1_000_000L).coerceAtLeast(0L)\n          val fastAttemptMs = ((fallbackStartedNs - requestStartedNs) / 1_000_000L).coerceAtLeast(0L)\n          fallback["engineMode"] = "cli-fallback"\n          fallback["startKind"] = if (fastWasWarm) "warm" else "cold"\n          fallback["fallbackReason"] = fallbackReason\n          fallback["timings"] = mapOf(\n            "engineStartMs" to fastAttemptMs,\n            "generationMs" to generationMs,\n            "totalMs" to totalMs,\n          )\n          fallback\n        } finally {\n          wanChatPauseCoordinatorLazy.value.release()\n        }\n      }\n    } finally {\n      releaseWanGeneration()\n    }\n  }\n\n  private fun cancelSmartVideo(): Boolean {\n    val cliProcess: Process?\n    synchronized(processLock) {\n      if (!generationReserved && activeProcess?.isAlive != true) return false\n      cancellationRequested = true\n      cliProcess = activeProcess\n    }\n\n    val fastCancelled = wanFastManager.cancelGeneration()\n    if (!fastCancelled) {\n      val fastState = wanFastManager.status()["state"] as? String\n      if (fastState == "starting" || fastState == "loading" || fastState == "generating") {\n        wanFastManager.stop()\n      }\n    }\n    if (cliProcess?.isAlive == true) {\n      cliProcess.destroy()\n      if (!cliProcess.waitFor(2, TimeUnit.SECONDS)) cliProcess.destroyForcibly()\n    }\n    return true\n  }\n\n${marker}`;
  source = requireReplace(source, marker, helpers, "Wan Smart helpers");
}

source = source.replaceAll(
  String.raw`Regex("\s+")`,
  String.raw`Regex("""\s+""")`,
);

fs.writeFileSync(modulePath, source);

let types = fs.readFileSync(typesPath, "utf8");
if (!types.includes("export type WanSmartVideoResult")) {
  const typeAnchor = `export type WanFastVideoResult = VideoGenerationResult & {\n  engineMode: "fast";\n  startKind: "cold" | "warm";\n  engineSessionId: string;\n  generationCount: number;\n  timings: WanGenerationTimings;\n};`;
  const typeReplacement = `${typeAnchor}\n\nexport type WanSmartVideoResult = VideoGenerationResult & {\n  engineMode: "fast" | "cli-fallback";\n  startKind: "cold" | "warm";\n  engineSessionId?: string;\n  generationCount?: number;\n  fallbackReason?: string;\n  timings: WanGenerationTimings;\n};`;
  types = requireReplace(types, typeAnchor, typeReplacement, "Wan Smart result type");
}
if (!types.includes("generateSmartLocalVideo(options: VideoGenerationOptions): Promise<WanSmartVideoResult>")) {
  const methodAnchor = `  generateFastLocalVideo(options: VideoGenerationOptions): Promise<WanFastVideoResult>;\n  cancelFastLocalVideo(): Promise<boolean>;`;
  const methodReplacement = `${methodAnchor}\n  generateSmartLocalVideo(options: VideoGenerationOptions): Promise<WanSmartVideoResult>;\n  cancelSmartLocalVideo(): Promise<boolean>;`;
  types = requireReplace(types, methodAnchor, methodReplacement, "Wan Smart native methods");
}
fs.writeFileSync(typesPath, types);

let index = fs.readFileSync(indexPath, "utf8");
if (!index.includes("type WanSmartVideoResult,")) {
  index = requireReplace(
    index,
    "  type WanFastVideoResult,\n} from \"./src/SaientDiffusionModule\";",
    "  type WanFastVideoResult,\n  type WanSmartVideoResult,\n} from \"./src/SaientDiffusionModule\";",
    "Wan Smart import",
  );
}
if (!index.includes("export function generateSmartLocalVideo(")) {
  const functionAnchor = `export function cancelFastLocalVideo(): Promise<boolean> {\n  return requiredModule().cancelFastLocalVideo();\n}`;
  const functionReplacement = `${functionAnchor}\n\nexport function generateSmartLocalVideo(\n  options: VideoGenerationOptions,\n): Promise<WanSmartVideoResult> {\n  return requiredModule().generateSmartLocalVideo(options);\n}\n\nexport function cancelSmartLocalVideo(): Promise<boolean> {\n  return requiredModule().cancelSmartLocalVideo();\n}`;
  index = requireReplace(index, functionAnchor, functionReplacement, "Wan Smart public functions");
}
if (!index.includes("  WanSmartVideoResult,\n};")) {
  index = requireReplace(
    index,
    "  WanFastVideoResult,\n};",
    "  WanFastVideoResult,\n  WanSmartVideoResult,\n};",
    "Wan Smart type export",
  );
}
fs.writeFileSync(indexPath, index);

console.log("Applied Wan Fast smart fallback orchestration.");
