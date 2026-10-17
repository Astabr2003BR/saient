import fs from "node:fs";

const modulePath = "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one source block, found ${count}.`);
  return source.replace(before, after);
}

let source = fs.readFileSync(modulePath, "utf8");

source = replaceOnce(
  source,
  `  @Volatile private var activeDownloadConnection: HttpURLConnection? = null\n\n  override fun definition() = ModuleDefinition {`,
  `  @Volatile private var activeDownloadConnection: HttpURLConnection? = null\n\n  private val wanChatPauseCoordinatorLazy = lazy {\n    WanChatPauseCoordinator(context()) { waitForChatEngineToStop() }\n  }\n  private val wanFastManagerLazy = lazy {\n    WanFastManager(context(), wanChatPauseCoordinatorLazy.value)\n  }\n  private val wanFastManager by wanFastManagerLazy\n\n  override fun definition() = ModuleDefinition {`,
  "Wan Fast manager fields",
);

source = replaceOnce(
  source,
  `    AsyncFunction("getVideoStatus") Coroutine { ->\n      withContext(Dispatchers.IO) { videoStatus() }\n    }\n\n    AsyncFunction("downloadVideoModel") Coroutine { ->`,
  `    AsyncFunction("getVideoStatus") Coroutine { ->\n      withContext(Dispatchers.IO) { videoStatus() }\n    }\n\n    AsyncFunction("getWanFastStatus") Coroutine { ->\n      withContext(Dispatchers.IO) { wanFastManager.status() }\n    }\n\n    AsyncFunction("startWanFastEngine") Coroutine { ->\n      withContext(Dispatchers.IO) { wanFastManager.start() }\n    }\n\n    AsyncFunction("stopWanFastEngine") Coroutine { ->\n      withContext(Dispatchers.IO) { wanFastManager.stop() }\n    }\n\n    AsyncFunction("downloadVideoModel") Coroutine { ->`,
  "Wan Fast bridge functions",
);

source = replaceOnce(
  source,
  `    AsyncFunction("generateVideo") Coroutine { options: VideoGenerationOptions ->\n      withContext(Dispatchers.IO) { generateVideo(options) }\n    }\n\n    OnDestroy {\n      synchronized(processLock) {`,
  `    AsyncFunction("generateVideo") Coroutine { options: VideoGenerationOptions ->\n      withContext(Dispatchers.IO) { generateVideo(options) }\n    }\n\n    OnActivityEntersBackground {\n      if (wanFastManagerLazy.isInitialized()) {\n        Thread({ wanFastManager.stop() }, "saient-wan-fast-background-stop").apply {\n          isDaemon = true\n          start()\n        }\n      }\n    }\n\n    OnDestroy {\n      if (wanFastManagerLazy.isInitialized()) wanFastManager.forceStop()\n      synchronized(processLock) {`,
  "Wan Fast Android lifecycle hooks",
);

fs.writeFileSync(modulePath, source);
console.log("Applied Wan Fast native lifecycle bridge.");
