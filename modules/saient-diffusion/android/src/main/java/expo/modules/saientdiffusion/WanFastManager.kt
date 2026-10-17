package expo.modules.saientdiffusion

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.json.JSONObject

private const val WAN_FAST_HOST = "127.0.0.1"
private const val WAN_FAST_PORT = 18_801
private const val WAN_FAST_START_TIMEOUT_MS = 180_000L
private const val WAN_FAST_CAPABILITIES_MAX_CHARS = 65_536

enum class WanFastState {
  STOPPED,
  STARTING,
  LOADING,
  READY,
  GENERATING,
  STOPPING,
  FAILED,
}

/**
 * Owns one persistent sd-server process for the current Android foreground session.
 * Generation/job transport is added separately; this class establishes only lifecycle,
 * readiness, health, and deterministic model-memory teardown.
 */
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

  private fun fastBinary(): File =
    File(context.applicationInfo.nativeLibraryDir, "libquartz-wan-fast.so")

  private fun videoModelRoot(): File =
    File(context.filesDir, "diffusion/wan2.1-t2v-1.3b")

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

  fun stop(): Map<String, Any?> {
    val processToStop: Process?
    var releasePause = false
    synchronized(lock) {
      stopRequested = true
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
          }
        }
      }
    }, "saient-wan-fast-log").apply {
      isDaemon = true
      start()
    }
  }

  private fun capabilitiesSupportVideo(): Boolean = runCatching {
    val connection = URL("http://$WAN_FAST_HOST:$WAN_FAST_PORT/sdcpp/v1/capabilities")
      .openConnection() as HttpURLConnection
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

  private fun readBoundedText(connection: HttpURLConnection, maxChars: Int): String {
    connection.inputStream.bufferedReader().use { reader ->
      val result = StringBuilder()
      val buffer = CharArray(4_096)
      while (result.length <= maxChars) {
        val count = reader.read(buffer)
        if (count < 0) break
        if (result.length + count > maxChars) {
          throw IllegalStateException("Wan Fast Engine capabilities response is too large.")
        }
        result.append(buffer, 0, count)
      }
      return result.toString()
    }
  }

  private fun failAndCleanup(error: Exception): Map<String, Any?> {
    val processToStop: Process?
    var releasePause = false
    synchronized(lock) {
      processToStop = process
      process = null
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
}
