package expo.modules.saientdiffusion

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Base64InputStream
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

private const val WAN_FAST_HOST = "127.0.0.1"
private const val WAN_FAST_PORT = 18_801
private const val WAN_FAST_START_TIMEOUT_MS = 180_000L
private const val WAN_FAST_CAPABILITIES_MAX_CHARS = 65_536
private const val WAN_FAST_SMALL_RESPONSE_MAX_CHARS = 65_536
private const val WAN_FAST_POLL_INTERVAL_MS = 500L
private const val WAN_FAST_MAX_B64_CHARS = 64 * 1024 * 1024
private const val WAN_FAST_JOB_RESPONSE_MAX_CHARS = WAN_FAST_MAX_B64_CHARS + 131_072
private const val WAN_FAST_WIDTH = 416
private const val WAN_FAST_HEIGHT = 240
private const val WAN_FAST_FPS = 8
private const val WAN_FAST_FLOW_SHIFT = 8.0
private const val WAN_FAST_MIN_WEBM_BYTES = 1_000L
private val WAN_FAST_JOB_ID = Regex("""^job_[A-Za-z0-9_-]{1,120}$""")
private val WAN_FAST_PROGRESS = Regex("""SAIENT_WAN_PROGRESS completed=(\d+) total=(\d+)""")

enum class WanFastState {
  STOPPED,
  STARTING,
  LOADING,
  READY,
  GENERATING,
  STOPPING,
  FAILED,
}

private data class WanFastHttpResponse(
  val code: Int,
  val body: String,
)

/** Owns one persistent sd-server process for the current Android foreground session. */
class WanFastManager(
  private val context: Context,
  private val pauseCoordinator: WanChatPauseCoordinator,
) {
  private val lock = Any()

  @Volatile private var state = WanFastState.STOPPED
  @Volatile private var process: Process? = null
  @Volatile private var stopRequested = false
  @Volatile private var pauseLeaseHeld = false
  @Volatile private var sessionId: String? = null
  @Volatile private var generationCount = 0
  @Volatile private var lastError: String? = null
  @Volatile private var lastNativeDetail: String? = null
  @Volatile private var activeJobId: String? = null
  @Volatile private var cancelRequested = false
  @Volatile private var progressListener: ((Int, Int, String?) -> Unit)? = null

  private fun fastBinary(): File =
    File(context.applicationInfo.nativeLibraryDir, "libquartz-wan-fast.so")

  private fun videoModelRoot(): File =
    File(context.filesDir, "diffusion/wan2.1-t2v-1.3b")

  private fun videoInactiveMarker(): File =
    File(context.filesDir, "diffusion/.wan2.1-inactive")

  fun status(): Map<String, Any?> {
    var releasePause = false
    synchronized(lock) {
      val process = process
      if ((state == WanFastState.READY || state == WanFastState.GENERATING || state == WanFastState.LOADING) &&
        process?.isAlive != true
      ) {
        this.process = null
        state = WanFastState.FAILED
        lastError = lastError ?: "Wan Fast Engine process exited unexpectedly."
        if (pauseLeaseHeld) {
          pauseLeaseHeld = false
          releasePause = true
        }
      }
    }
    if (releasePause) pauseCoordinator.release()
    synchronized(lock) {
      return statusLocked()
    }
  }

  fun start(): Map<String, Any?> {
    synchronized(lock) {
      val process = process
      if (state == WanFastState.READY && process?.isAlive == true) return statusLocked()
      if ((state == WanFastState.STARTING || state == WanFastState.LOADING) && process?.isAlive == true) {
        return statusLocked()
      }
      if (state == WanFastState.STOPPING) return statusLocked()

      validateRuntimeFiles()
      stopRequested = false
      state = WanFastState.STARTING
      lastError = null
      lastNativeDetail = null
    }

    try {
      pauseCoordinator.acquire()
      synchronized(lock) {
        if (stopRequested) {
          state = WanFastState.STOPPED
          pauseCoordinator.release()
          return statusLocked()
        }
        pauseLeaseHeld = true
      }

      val launched = ProcessBuilder(serverArguments())
        .redirectErrorStream(true)
        .start()

      synchronized(lock) {
        if (stopRequested) {
          launched.destroyForcibly()
          if (pauseLeaseHeld) {
            pauseLeaseHeld = false
            pauseCoordinator.release()
          }
          state = WanFastState.STOPPED
          return statusLocked()
        }
        process = launched
        sessionId = UUID.randomUUID().toString()
        generationCount = 0
        state = WanFastState.LOADING
      }
      startOutputDrain(launched)

      val deadline = System.currentTimeMillis() + WAN_FAST_START_TIMEOUT_MS
      while (System.currentTimeMillis() < deadline) {
        synchronized(lock) {
          if (stopRequested) return statusLocked()
          val process = process
          if (process?.isAlive != true) {
            throw IllegalStateException(lastNativeDetail ?: "Wan Fast Engine exited during startup.")
          }
        }
        if (capabilitiesSupportVideo()) {
          synchronized(lock) {
            if (!stopRequested && process?.isAlive == true) {
              state = WanFastState.READY
              return statusLocked()
            }
            return statusLocked()
          }
        }
        Thread.sleep(250)
      }
      throw IllegalStateException(lastNativeDetail ?: "Wan Fast Engine startup timed out.")
    } catch (error: Exception) {
      return failAndCleanup(error)
    }
  }

  fun generate(
    options: VideoGenerationOptions,
    onProgress: (completed: Int, total: Int, detail: String?) -> Unit,
  ): Map<String, Any?> {
    validateGenerationOptions(options)
    if (videoInactiveMarker().exists()) {
      throw IllegalStateException("The Wan video model is inactive. Activate it before generating.")
    }

    val requestStartedNs = System.nanoTime()
    val wasWarm = synchronized(lock) {
      state == WanFastState.READY && process?.isAlive == true
    }
    val engineStartNs = System.nanoTime()
    val startedStatus = start()
    val engineStartMs = nanosToMillis(System.nanoTime() - engineStartNs)
    if (startedStatus["state"] != "ready") {
      throw IllegalStateException(
        (startedStatus["lastError"] as? String) ?: "Wan Fast Engine could not become ready.",
      )
    }

    val currentSessionId: String
    synchronized(lock) {
      if (stopRequested || process?.isAlive != true || state != WanFastState.READY) {
        throw IllegalStateException("Wan Fast Engine is not ready for generation.")
      }
      if (activeJobId != null) throw IllegalStateException("Another Wan Fast generation is already running.")
      state = WanFastState.GENERATING
      cancelRequested = false
      progressListener = onProgress
      currentSessionId = requireNotNull(sessionId) { "Wan Fast Engine session is unavailable." }
    }

    val firstProgressNs = AtomicLong(0L)
    progressListener = { completed, total, detail ->
      firstProgressNs.compareAndSet(0L, System.nanoTime())
      onProgress(completed, total, detail)
    }

    val outputDirectory = File(context.filesDir, "remote-generations").apply { mkdirs() }
    val output = File(outputDirectory, "saient-wan-fast-${System.currentTimeMillis()}.webm")
    val partial = File(output.path + ".part")
    partial.delete()
    output.delete()
    val generationStartedNs = System.nanoTime()

    try {
      val submission = postJson(
        "/sdcpp/v1/vid_gen",
        buildGenerationRequest(options),
        WAN_FAST_SMALL_RESPONSE_MAX_CHARS,
      )
      if (submission.code != HttpURLConnection.HTTP_ACCEPTED) {
        throw IllegalStateException("Wan Fast job submission failed with HTTP ${submission.code}: ${submission.body.take(300)}")
      }
      val submitted = JSONObject(submission.body)
      val jobId = submitted.optString("id").trim()
      if (!WAN_FAST_JOB_ID.matches(jobId)) throw IllegalStateException("Wan Fast returned an invalid job id.")
      if (submitted.optString("kind") != "vid_gen") throw IllegalStateException("Wan Fast returned the wrong job kind.")
      val pollUrl = submitted.optString("poll_url")
      val expectedPollUrl = "/sdcpp/v1/jobs/$jobId"
      if (pollUrl != expectedPollUrl) throw IllegalStateException("Wan Fast returned an unsafe poll_url.")
      synchronized(lock) {
        if (stopRequested) throw IllegalStateException("Video generation cancelled.")
        activeJobId = jobId
      }

      while (true) {
        Thread.sleep(WAN_FAST_POLL_INTERVAL_MS)
        if (stopRequested) throw IllegalStateException("Video generation cancelled.")
        val poll = getJson(expectedPollUrl, WAN_FAST_JOB_RESPONSE_MAX_CHARS)
        if (poll.code != HttpURLConnection.HTTP_OK) {
          throw IllegalStateException("Wan Fast job polling failed with HTTP ${poll.code}: ${poll.body.take(300)}")
        }
        val job = JSONObject(poll.body)
        if (job.optString("id") != jobId || job.optString("kind") != "vid_gen") {
          throw IllegalStateException("Wan Fast returned mismatched job metadata.")
        }
        when (job.optString("status")) {
          "queued", "generating" -> continue
          "cancelled" -> throw IllegalStateException("Video generation cancelled.")
          "failed" -> {
            val error = job.optJSONObject("error")?.optString("message")?.take(500)
            throw IllegalStateException(error?.ifBlank { null } ?: "Wan Fast generation failed.")
          }
          "completed" -> {
            val result = job.optJSONObject("result")
              ?: throw IllegalStateException("Wan Fast completed without a result payload.")
            decodeCompletedWebm(result, options.frames, partial, output)
            val completedCount = synchronized(lock) {
              generationCount += 1
              generationCount
            }
            val finishedNs = System.nanoTime()
            val generationMs = nanosToMillis(finishedNs - generationStartedNs)
            val totalMs = nanosToMillis(finishedNs - requestStartedNs)
            val firstNs = firstProgressNs.get()
            val timings = mutableMapOf<String, Any>(
              "engineStartMs" to engineStartMs,
              "generationMs" to generationMs,
              "totalMs" to totalMs,
            )
            if (firstNs > 0L) timings["timeToFirstProgressMs"] = nanosToMillis(firstNs - requestStartedNs)
            return mapOf(
              "uri" to Uri.fromFile(output).toString(),
              "elapsedSeconds" to totalMs / 1000.0,
              "steps" to options.steps,
              "seed" to options.seed.toDouble(),
              "width" to WAN_FAST_WIDTH,
              "height" to WAN_FAST_HEIGHT,
              "frames" to options.frames,
              "fps" to WAN_FAST_FPS,
              "engineMode" to "fast",
              "startKind" to if (wasWarm) "warm" else "cold",
              "engineSessionId" to currentSessionId,
              "generationCount" to completedCount,
              "timings" to timings,
            )
          }
          else -> throw IllegalStateException("Wan Fast returned an unknown job status.")
        }
      }
    } catch (error: Exception) {
      partial.delete()
      output.delete()
      throw error
    } finally {
      synchronized(lock) {
        activeJobId = null
        cancelRequested = false
        progressListener = null
        if (state == WanFastState.GENERATING) {
          state = if (process?.isAlive == true && !stopRequested) WanFastState.READY else WanFastState.FAILED
        }
      }
    }
  }

  fun cancelGeneration(): Boolean {
    val jobId = synchronized(lock) { activeJobId } ?: return false
    val response = runCatching {
      postJson("/sdcpp/v1/jobs/$jobId/cancel", null, WAN_FAST_SMALL_RESPONSE_MAX_CHARS)
    }.getOrNull() ?: return false
    if (response.code != HttpURLConnection.HTTP_OK) return false
    synchronized(lock) {
      if (activeJobId == jobId) cancelRequested = true
    }
    return true
  }

  fun stop(): Map<String, Any?> {
    val processToStop: Process?
    var releasePause = false
    synchronized(lock) {
      stopRequested = true
      cancelRequested = true
      activeJobId = null
      progressListener = null
      if (state == WanFastState.STOPPED && process?.isAlive != true && !pauseLeaseHeld) {
        return statusLocked()
      }
      state = WanFastState.STOPPING
      processToStop = process
      process = null
      if (pauseLeaseHeld) {
        pauseLeaseHeld = false
        releasePause = true
      }
    }

    stopProcess(processToStop, forceImmediately = false)
    if (releasePause) pauseCoordinator.release()

    synchronized(lock) {
      state = WanFastState.STOPPED
      sessionId = null
      generationCount = 0
      lastNativeDetail = null
      return statusLocked()
    }
  }

  fun forceStop() {
    val processToStop: Process?
    synchronized(lock) {
      stopRequested = true
      cancelRequested = true
      activeJobId = null
      progressListener = null
      state = WanFastState.STOPPING
      processToStop = process
      process = null
      pauseLeaseHeld = false
    }
    stopProcess(processToStop, forceImmediately = true)
    pauseCoordinator.forceReleaseAll()
    synchronized(lock) {
      state = WanFastState.STOPPED
      sessionId = null
      generationCount = 0
      lastNativeDetail = null
    }
  }

  private fun validateRuntimeFiles() {
    val binary = fastBinary()
    if (!binary.isFile) throw IllegalStateException("Wan Fast Engine binary is missing.")
    val root = videoModelRoot()
    val required = listOf(
      "wan2.1_t2v_1.3B_Q4_K.gguf",
      "wan_2.1_vae.safetensors",
      "umt5-xxl-encoder-Q4_K_M.gguf",
    )
    val missing = required.firstOrNull { !File(root, it).isFile }
    if (missing != null) throw IllegalStateException("Wan model pack is missing $missing.")
  }

  private fun validateGenerationOptions(options: VideoGenerationOptions) {
    val prompt = options.prompt.trim()
    val negative = options.negativePrompt.trim()
    if (prompt.isEmpty() || prompt.length > 1_000 || negative.length > 1_000) {
      throw IllegalStateException("Prompt text must be between 1 and 1,000 characters.")
    }
    if (options.steps !in 1..20) throw IllegalStateException("Wan generation supports 1 to 20 steps.")
    if (!options.guidance.isFinite() || options.guidance !in 0.0..30.0) {
      throw IllegalStateException("Guidance must be between 0 and 30.")
    }
    if (options.seed !in 0..2_147_483_647L) {
      throw IllegalStateException("Seed must be between 0 and 2147483647.")
    }
    if (options.frames !in 5..41 || (options.frames - 1) % 4 != 0) {
      throw IllegalStateException("Wan frame count must be 5 to 41 in 4-frame increments.")
    }
  }

  private fun buildGenerationRequest(options: VideoGenerationOptions): JSONObject {
    val userNegative = options.negativePrompt.trim()
    val negative = combineWanNegativePrompt(userNegative)
    val guidance = JSONObject().put("txt_cfg", options.guidance)
    val sampleParams = JSONObject()
      .put("sample_method", "euler")
      .put("sample_steps", options.steps)
      .put("flow_shift", WAN_FAST_FLOW_SHIFT)
      .put("guidance", guidance)
    return JSONObject()
      .put("prompt", options.prompt.trim())
      .put("negative_prompt", negative)
      .put("width", WAN_FAST_WIDTH)
      .put("height", WAN_FAST_HEIGHT)
      .put("seed", options.seed)
      .put("video_frames", options.frames)
      .put("fps", WAN_FAST_FPS)
      .put("sample_params", sampleParams)
      .put("vae_tiling_params", JSONObject().put("enabled", true))
      .put("output_format", "webm")
  }

  private fun serverArguments(): List<String> {
    val root = videoModelRoot()
    return listOf(
      fastBinary().path,
      "--listen-ip", WAN_FAST_HOST,
      "--listen-port", WAN_FAST_PORT.toString(),
      "--diffusion-model", File(root, "wan2.1_t2v_1.3B_Q4_K.gguf").path,
      "--vae", File(root, "wan_2.1_vae.safetensors").path,
      "--t5xxl", File(root, "umt5-xxl-encoder-Q4_K_M.gguf").path,
      "--threads", "6",
      "--diffusion-fa",
      "--backend", "te=cpu,vae=cpu,diffusion=vulkan0",
      "--params-backend", "diffusion=cpu,te=disk,vae=cpu",
      "--max-vram", "vulkan0=-0.75",
      "--mmap",
      "--vae-tiling",
    )
  }

  private fun startOutputDrain(process: Process) {
    Thread({
      runCatching {
        process.inputStream.bufferedReader().useLines { lines ->
          lines.forEach { line ->
            if (line.isNotBlank()) lastNativeDetail = line.take(240)
            val match = WAN_FAST_PROGRESS.find(line)
            if (match != null) {
              val completed = match.groupValues[1].toIntOrNull()
              val total = match.groupValues[2].toIntOrNull()
              if (completed != null && total != null && total > 0) {
                progressListener?.invoke(completed, total, line.take(240))
              }
            }
          }
        }
      }
    }, "saient-wan-fast-log").apply {
      isDaemon = true
      start()
    }
  }

  private fun capabilitiesSupportVideo(): Boolean = runCatching {
    val connection = openLocalConnection("/sdcpp/v1/capabilities")
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = 750
      connection.readTimeout = 1_250
      if (connection.responseCode != HttpURLConnection.HTTP_OK) return@runCatching false
      val body = readBoundedText(connection, WAN_FAST_CAPABILITIES_MAX_CHARS)
      val modes = JSONObject(body).optJSONArray("supported_modes") ?: return@runCatching false
      (0 until modes.length()).any { modes.optString(it) == "vid_gen" }
    } finally {
      connection.disconnect()
    }
  }.getOrDefault(false)

  private fun postJson(path: String, body: JSONObject?, maxChars: Int): WanFastHttpResponse {
    val connection = openLocalConnection(path)
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 2_000
      connection.readTimeout = 5_000
      connection.setRequestProperty("Accept", "application/json")
      if (body != null) {
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.outputStream.bufferedWriter(StandardCharsets.UTF_8).use { writer ->
          writer.write(body.toString())
        }
      }
      val code = connection.responseCode
      return WanFastHttpResponse(code, readBoundedText(connection, maxChars))
    } finally {
      connection.disconnect()
    }
  }

  private fun getJson(path: String, maxChars: Int): WanFastHttpResponse {
    val connection = openLocalConnection(path)
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = 2_000
      connection.readTimeout = 5_000
      connection.setRequestProperty("Accept", "application/json")
      val code = connection.responseCode
      return WanFastHttpResponse(code, readBoundedText(connection, maxChars))
    } finally {
      connection.disconnect()
    }
  }

  private fun openLocalConnection(path: String): HttpURLConnection {
    if (!path.startsWith("/sdcpp/v1/") || path.contains("://") || path.contains("..")) {
      throw IllegalArgumentException("Unsafe Wan Fast local path.")
    }
    return (URL("http://$WAN_FAST_HOST:$WAN_FAST_PORT$path").openConnection() as HttpURLConnection).apply {
      instanceFollowRedirects = false
    }
  }

  private fun readBoundedText(connection: HttpURLConnection, maxChars: Int): String {
    val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
    if (stream == null) return ""
    stream.bufferedReader().use { reader ->
      val result = StringBuilder()
      val buffer = CharArray(4_096)
      while (result.length <= maxChars) {
        val count = reader.read(buffer)
        if (count < 0) break
        if (result.length + count > maxChars) {
          throw IllegalStateException("Wan Fast Engine response is too large.")
        }
        result.append(buffer, 0, count)
      }
      return result.toString()
    }
  }

  private fun decodeCompletedWebm(
    result: JSONObject,
    expectedFrames: Int,
    partial: File,
    output: File,
  ) {
    if (result.optString("output_format") != "webm" || result.optString("mime_type") != "video/webm") {
      throw IllegalStateException("Wan Fast returned an unexpected output format.")
    }
    if (result.optInt("fps", -1) != WAN_FAST_FPS || result.optInt("frame_count", -1) != expectedFrames) {
      throw IllegalStateException("Wan Fast returned unexpected video metadata.")
    }
    val b64 = result.optString("b64_json")
    if (b64.isEmpty() || b64.length > WAN_FAST_MAX_B64_CHARS) {
      throw IllegalStateException("Wan Fast returned an invalid or oversized WebM payload.")
    }
    partial.parentFile?.mkdirs()
    val encoded = ByteArrayInputStream(b64.toByteArray(StandardCharsets.US_ASCII))
    Base64InputStream(encoded, Base64.DEFAULT).use { input ->
      partial.outputStream().buffered().use { outputStream ->
        input.copyTo(outputStream, 64 * 1024)
      }
    }
    if (!partial.isFile || partial.length() < WAN_FAST_MIN_WEBM_BYTES || !hasWebmHeader(partial)) {
      partial.delete()
      throw IllegalStateException("Wan Fast returned an invalid WebM file.")
    }
    output.delete()
    if (!partial.renameTo(output)) {
      partial.delete()
      throw IllegalStateException("Could not finalize Wan Fast WebM output.")
    }
  }

  private fun hasWebmHeader(file: File): Boolean {
    val header = ByteArray(4)
    val count = file.inputStream().use { it.read(header) }
    return count == 4 &&
      header[0].toInt() and 0xff == 0x1a &&
      header[1].toInt() and 0xff == 0x45 &&
      header[2].toInt() and 0xff == 0xdf &&
      header[3].toInt() and 0xff == 0xa3
  }

  private fun failAndCleanup(error: Exception): Map<String, Any?> {
    val processToStop: Process?
    var releasePause = false
    synchronized(lock) {
      processToStop = process
      process = null
      activeJobId = null
      progressListener = null
      if (pauseLeaseHeld) {
        pauseLeaseHeld = false
        releasePause = true
      }
      if (stopRequested) {
        state = WanFastState.STOPPED
      } else {
        state = WanFastState.FAILED
        lastError = error.message?.take(500) ?: "Wan Fast Engine failed."
      }
    }
    stopProcess(processToStop, forceImmediately = true)
    if (releasePause) pauseCoordinator.release()
    synchronized(lock) {
      return statusLocked()
    }
  }

  private fun stopProcess(process: Process?, forceImmediately: Boolean) {
    if (process?.isAlive != true) return
    if (forceImmediately) {
      process.destroyForcibly()
      runCatching { process.waitFor(2, TimeUnit.SECONDS) }
      return
    }
    process.destroy()
    if (!runCatching { process.waitFor(5, TimeUnit.SECONDS) }.getOrDefault(false)) {
      process.destroyForcibly()
      runCatching { process.waitFor(2, TimeUnit.SECONDS) }
    }
  }

  private fun statusLocked(): Map<String, Any?> {
    val process = process
    val alive = process?.isAlive == true
    val healthy = alive && (state == WanFastState.READY || state == WanFastState.GENERATING)
    val message = when (state) {
      WanFastState.STOPPED -> "Wan Fast Engine parado."
      WanFastState.STARTING -> "Iniciando motor Wan."
      WanFastState.LOADING -> "Carregando modelos e preparando Vulkan."
      WanFastState.READY -> "Wan Fast Engine pronto."
      WanFastState.GENERATING -> "Wan Fast Engine gerando vídeo."
      WanFastState.STOPPING -> "Encerrando Wan Fast Engine."
      WanFastState.FAILED -> lastError ?: "Wan Fast Engine falhou."
    }
    return mapOf(
      "state" to state.name.lowercase(),
      "available" to fastBinary().isFile,
      "healthy" to healthy,
      "sessionId" to sessionId,
      "generationCount" to generationCount,
      "message" to message,
      "lastError" to lastError,
    )
  }

  private fun nanosToMillis(nanos: Long): Double = nanos / 1_000_000.0
}
