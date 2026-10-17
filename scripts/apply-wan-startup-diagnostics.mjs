import fs from "node:fs";

const nativePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";
const typesPath = "modules/saient-diffusion/src/SaientDiffusionModule.ts";
const uiPath = "app/(tabs)/video.tsx";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one source block, found ${count}.`);
  return source.replace(before, after);
}

let types = fs.readFileSync(typesPath, "utf8");
types = replaceOnce(
  types,
  `export type VideoProgress = {\n  completed: number;\n  total: number;\n};`,
  `export type VideoProgress = {\n  phase: "preparing" | "starting" | "loading" | "denoising";\n  message: string;\n  detail?: string;\n  completed: number;\n  total: number;\n};`,
  "VideoProgress type",
);
fs.writeFileSync(typesPath, types);

let native = fs.readFileSync(nativePath, "utf8");

const helperMarker = `  private fun sha256(file: File): String {`;
const helper = `  private fun sendVideoProgress(\n    phase: String,\n    message: String,\n    completed: Int,\n    total: Int,\n    detail: String? = null,\n  ) {\n    sendEvent(\n      "onVideoProgress",\n      mapOf(\n        "phase" to phase,\n        "message" to message,\n        "detail" to (detail ?: ""),\n        "completed" to completed.coerceIn(0, total),\n        "total" to total,\n      ),\n    )\n  }\n\n`;
if (!native.includes("private fun sendVideoProgress(")) {
  const count = native.split(helperMarker).length - 1;
  if (count !== 1) throw new Error(`Wan progress helper marker: expected 1, found ${count}.`);
  native = native.replace(helperMarker, helper + helperMarker);
}

const videoStart = native.indexOf("  private fun generateVideo(options: VideoGenerationOptions)");
const videoEnd = native.indexOf("  private fun waitForChatEngineToStop()", videoStart);
if (videoStart < 0 || videoEnd < 0) throw new Error("Could not isolate generateVideo().");
let video = native.slice(videoStart, videoEnd);

video = replaceOnce(
  video,
  `    val started = System.nanoTime()\n    val logs = ArrayDeque<String>()\n    try {\n      if (!wasPaused) {`,
  `    val started = System.nanoTime()\n    val logs = ArrayDeque<String>()\n    try {\n      sendVideoProgress("preparing", "Liberando memória para o Wan", 0, options.steps)\n      if (!wasPaused) {`,
  "Wan preparing stage",
);

video = replaceOnce(
  video,
  `      if (cancellationRequested) throw DiffusionException("Video generation cancelled.")\n      val process = ProcessBuilder(arguments).redirectErrorStream(true).start()`,
  `      if (cancellationRequested) throw DiffusionException("Video generation cancelled.")\n      sendVideoProgress("starting", "Iniciando motor Wan", 0, options.steps)\n      val process = ProcessBuilder(arguments).redirectErrorStream(true).start()`,
  "Wan starting stage",
);

video = replaceOnce(
  video,
  `      synchronized(processLock) {\n        activeProcess = process\n        if (cancellationRequested) process.destroy()\n      }\n      val progress = Regex("SAIENT_WAN_PROGRESS completed=(\\\\d+) total=(\\\\d+)")`,
  `      synchronized(processLock) {\n        activeProcess = process\n        if (cancellationRequested) process.destroy()\n      }\n      sendVideoProgress("loading", "Carregando modelos e preparando Vulkan", 0, options.steps)\n      val progress = Regex("SAIENT_WAN_PROGRESS completed=(\\\\d+) total=(\\\\d+)")\n      var denoisingStarted = false`,
  "Wan loading stage",
);

video = replaceOnce(
  video,
  `          val match = progress.matchEntire(line.trim())\n          if (match != null && match.groupValues[2].toInt() == options.steps) {\n            sendEvent(\n              "onVideoProgress",\n              mapOf(\n                "completed" to match.groupValues[1].toInt(),\n                "total" to options.steps,\n              ),\n            )\n          }`,
  `          val match = progress.matchEntire(line.trim())\n          if (match != null && match.groupValues[2].toInt() == options.steps) {\n            val completed = match.groupValues[1].toInt()\n            denoisingStarted = true\n            sendVideoProgress("denoising", "Processando $completed de ${options.steps}", completed, options.steps)\n          } else if (!denoisingStarted && line.isNotBlank()) {\n            sendVideoProgress(\n              "loading",\n              "Carregando modelos e preparando Vulkan",\n              0,\n              options.steps,\n              line.take(240),\n            )\n          }`,
  "Wan native log diagnostics",
);

native = native.slice(0, videoStart) + video + native.slice(videoEnd);
fs.writeFileSync(nativePath, native);

let ui = fs.readFileSync(uiPath, "utf8");
ui = replaceOnce(
  ui,
  `  const generationFraction = progress && progress.total > 0 ? progress.completed / progress.total : 0;`,
  `  const generationFraction = progress?.phase === "denoising" && progress.total > 0\n    ? progress.completed / progress.total\n    : 0;`,
  "Wan UI fraction",
);

ui = replaceOnce(
  ui,
  `              <View style={styles.progressTop}>\n                <Text style={styles.progressLabel}>{progress ? \`Processando ${progress.completed} de ${progress.total}\` : "Carregando Wan"}</Text>\n                <Text style={styles.progressPct}>{Math.round(generationFraction * 100)}%</Text>\n              </View>\n              <View style={styles.track}><View style={[styles.fill, { width: \`${Math.round(generationFraction * 100)}%\` }]} /></View>\n              <Text style={styles.progressHint}>O chat fica descarregado da memória até o processo nativo de vídeo terminar.</Text>`,
  `              <View style={styles.progressTop}>\n                <Text style={styles.progressLabel}>{progress?.message ?? "Preparando Wan"}</Text>\n                <Text style={styles.progressPct}>\n                  {progress?.phase === "denoising" ? \`${Math.round(generationFraction * 100)}%\` : "…"}\n                </Text>\n              </View>\n              <View style={styles.track}><View style={[styles.fill, { width: \`${Math.round(generationFraction * 100)}%\` }]} /></View>\n              {progress?.detail ? (\n                <Text style={styles.progressHint} numberOfLines={2}>Diagnóstico: {progress.detail}</Text>\n              ) : (\n                <Text style={styles.progressHint}>O app agora mostra em qual etapa o Wan está antes do primeiro passo de difusão.</Text>\n              )}`,
  "Wan UI startup diagnostics",
);
fs.writeFileSync(uiPath, ui);

console.log("Applied Wan startup diagnostics: staged native status, bounded engine detail, and phase-aware UI progress.");
