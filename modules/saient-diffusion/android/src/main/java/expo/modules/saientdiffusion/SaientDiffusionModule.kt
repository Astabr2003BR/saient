package expo.modules.saientdiffusion

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.StatFs
import android.provider.DocumentsContract
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val MAX_IMPORT_BYTES = 7_500_000_000L
private const val MAX_IMPORT_ENTRIES = 2_000
private const val MAX_IMPORT_DEPTH = 8
private const val ENGINE_PORT = 18_799
private const val MODEL_HOST = "saient.co.uk"
private const val DOWNLOAD_HEADROOM_BYTES = 134_217_728L
private const val WAN_PACK_ID = "wan2.1-t2v-1.3b-q4-v1"
private const val WAN_WIDTH = 416
private const val WAN_HEIGHT = 240
private const val WAN_FPS = 8

// Upstream Wan2.1 recommends --sample_shift 8 for T2V-1.3B (range 8-12). Shipping 3.0
// left the flow-matching schedule with too little time in the high-noise structural
// phase, so subjects never resolved into solid bodies — they came out ghost-like.
private const val WAN_FLOW_SHIFT = "8.0"

// Wan2.1's own default negative prompt (wan/configs/shared_config.py upstream). Most of
// its clauses target human anatomy failures — extra fingers, poorly drawn hands/faces,
// deformed, disfigured, malformed limbs, fused fingers, three legs — plus 整体发灰
// ("overall gray") and 过曝 ("overexposed"), which are exactly the washed-out, garish
// artefacts we were shipping. Sending an empty negative prompt threw all of that away,
// which is why non-human subjects held up far better than people did.
private const val WAN_DEFAULT_NEGATIVE =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，" +
    "JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，" +
    "手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走"

private data class RemoteModelFile(
  val path: String,
  val url: String,
  val bytes: Long,
  val sha256: String,
)

// Self-hosted on the Saient Pi (nginx /models/ -> /var/www/saient/models/).
private fun modelFile(path: String) = "https://$MODEL_HOST/models/sdxl-fp16-v1/$path"

private val REMOTE_MODEL_FILES = listOf(
  RemoteModelFile("model_index.json", modelFile("model_index.json"), 609, "6d7b93508390ab91ac5bfbe4aeb4dc2d83f7bb1b05fb069d714b5b0c75f70d44"),
  RemoteModelFile("scheduler/scheduler_config.json", modelFile("scheduler/scheduler_config.json"), 479, "af3e45a949aff8b8341ab8b811429ec03fee857a700a1d9477363e4fff9666e2"),
  RemoteModelFile("text_encoder/config.json", modelFile("text_encoder/config.json"), 565, "39b8b2e4b1949e36969caa425b6c81c68bace99198dd9078ce05d16ad401fe7f"),
  RemoteModelFile("text_encoder/model.fp16.safetensors", modelFile("text_encoder/model.fp16.safetensors"), 246_144_152, "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd"),
  RemoteModelFile("text_encoder_2/config.json", modelFile("text_encoder_2/config.json"), 575, "a892d1c3a69a7e9247a24de2bc1d5891e3109a54696e53be20093af671072c34"),
  RemoteModelFile("text_encoder_2/model.fp16.safetensors", modelFile("text_encoder_2/model.fp16.safetensors"), 1_389_382_176, "ec310df2af79c318e24d20511b601a591ca8cd4f1fce1d8dff822a356bcdb1f4"),
  RemoteModelFile("tokenizer/merges.txt", modelFile("tokenizer/merges.txt"), 524_619, "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a"),
  RemoteModelFile("tokenizer/vocab.json", modelFile("tokenizer/vocab.json"), 1_059_962, "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349"),
  RemoteModelFile("tokenizer_2/merges.txt", modelFile("tokenizer_2/merges.txt"), 524_619, "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a"),
  RemoteModelFile("tokenizer_2/vocab.json", modelFile("tokenizer_2/vocab.json"), 1_059_962, "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349"),
  RemoteModelFile("unet/config.json", modelFile("unet/config.json"), 1_680, "30ebc70750223e59006f7f2b4e1e6c102570aa19a9c4ae3e1fbe7591332dbae6"),
  RemoteModelFile("unet/diffusion_pytorch_model.fp16.safetensors", modelFile("unet/diffusion_pytorch_model.fp16.safetensors"), 5_135_149_760, "83e012a805b84c7ca28e5646747c90a243c65c8ba4f070e2d7ddc9d74661e139"),
  RemoteModelFile("vae/config.json", modelFile("vae/config.json"), 631, "f18b16fa4381c90ab44a3d7abd2e90afd05a2c31b8ca69998bc93c6453aeb7b7"),
  RemoteModelFile("vae/diffusion_pytorch_model.fp16.safetensors", modelFile("vae/diffusion_pytorch_model.fp16.safetensors"), 167_335_310, "216de6908bf4a9d16fdbef9e57c405c7e01e97fe5a5188dba3c3a5c306797fc0"),
)
private val REMOTE_MODEL_BYTES = REMOTE_MODEL_FILES.sumOf { it.bytes }

private fun wanModelFile(path: String) = "https://$MODEL_HOST/models/$WAN_PACK_ID/$path"

private val REMOTE_WAN_FILES = listOf(
  RemoteModelFile("wan2.1_t2v_1.3B_Q4_K.gguf", wanModelFile("wan2.1_t2v_1.3B_Q4_K.gguf"), 816_061_024, "65181afff758fba25cf311399ccb0638a746f8e0e6533e07a84a5a23e0c12318"),
  // Q2_K quantisation of UMT5-XXL destroyed the conditioning detail humans need: subjects
  // failed to hold an identity across frames and dissolved mid-clip. Q4_K_M fixes it.
  RemoteModelFile("umt5-xxl-encoder-Q4_K_M.gguf", wanModelFile("umt5-xxl-encoder-Q4_K_M.gguf"), 3_655_145_312, "17cf97a5bbbc60a646d6105b832b6f657ce904a8a1ad970e4b59df0c67584a40"),
  RemoteModelFile("wan_2.1_vae.safetensors", wanModelFile("wan_2.1_vae.safetensors"), 253_815_318, "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b"),
)

private val REMOTE_WAN_BYTES = REMOTE_WAN_FILES.sumOf { it.bytes }

private class DiffusionException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

class GenerationOptions : Record {
  @Field var prompt: String = ""
  @Field var negativePrompt: String = ""
  @Field var steps: Int = 4
  @Field var guidance: Double = 5.0
  @Field var seed: Long = 0
}

class VideoGenerationOptions : Record {
  @Field var prompt: String = ""
  @Field var negativePrompt: String = ""
  @Field var steps: Int = 1
  @Field var guidance: Double = 6.0
  @Field var seed: Long = 0
  @Field var frames: Int = 5
}

private data class ImportBudget(var entries: Int = 0, var bytes: Long = 0)

class SaientDiffusionModule : Module() {
  private val processLock = Any()
  @Volatile private var activeProcess: Process? = null
  @Volatile private var cancellationRequested = false
  @Volatile private var generationReserved = false
  @Volatile private var modelTransferReserved = false
  @Volatile private var downloadCancellationRequested = false
  @Volatile private var activeDownloadConnection: HttpURLConnection? = null

  private val wanChatPauseCoordinatorLazy = lazy {
    WanChatPauseCoordinator(context()) { waitForChatEngineToStop() }
  }
  private val wanFastManagerLazy = lazy {
    WanFastManager(context(), wanChatPauseCoordinatorLazy.value)
  }
  private val wanFastManager by wanFastManagerLazy

  override fun definition() = ModuleDefinition {
    Name("SaientDiffusion")
    Events("onProgress", "onVideoProgress", "onDownloadProgress")

    AsyncFunction("getStatus") Coroutine { ->
      withContext(Dispatchers.IO) { status() }
    }

    AsyncFunction("importModelTree") Coroutine { treeUri: String ->
      withContext(Dispatchers.IO) { importModelTree(treeUri) }
    }

    AsyncFunction("downloadModel") Coroutine { ->
      withContext(Dispatchers.IO) { downloadModel() }
    }

    AsyncFunction("cancelModelDownload") {
      synchronized(processLock) {
        if (!modelTransferReserved) return@AsyncFunction false
        downloadCancellationRequested = true
        activeDownloadConnection?.disconnect()
        true
      }
    }

    AsyncFunction("removeModel") Coroutine { ->
      withContext(Dispatchers.IO) {
        synchronized(processLock) {
          if (generationReserved || activeProcess?.isAlive == true || modelTransferReserved) {
            throw DiffusionException("Cancel the active image task before removing its model.")
          }
        }
        modelRoot().deleteRecursively()
        legacyModelRoot().deleteRecursively()
        inactiveMarker().delete()
        legacyInactiveMarker().delete()
        status()
      }
    }

    AsyncFunction("setModelActive") Coroutine { active: Boolean ->
      withContext(Dispatchers.IO) { changeModelActive(active) }
    }

    AsyncFunction("generate") Coroutine { options: GenerationOptions ->
      withContext(Dispatchers.IO) { generate(options) }
    }

    AsyncFunction("cancelGeneration") {
      synchronized(processLock) {
        val process = activeProcess
        if (!generationReserved && process?.isAlive != true) return@AsyncFunction false
        cancellationRequested = true
        if (process?.isAlive == true) {
          process.destroy()
          if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly()
        }
        true
      }
    }

    AsyncFunction("getVideoStatus") Coroutine { ->
      withContext(Dispatchers.IO) { videoStatus() }
    }

    AsyncFunction("getWanFastStatus") Coroutine { ->
      withContext(Dispatchers.IO) { wanFastManager.status() }
    }

    AsyncFunction("startWanFastEngine") Coroutine { ->
      withContext(Dispatchers.IO) { wanFastManager.start() }
    }

    AsyncFunction("stopWanFastEngine") Coroutine { ->
      withContext(Dispatchers.IO) { wanFastManager.stop() }
    }

    AsyncFunction("downloadVideoModel") Coroutine { ->
      withContext(Dispatchers.IO) { downloadVideoModel() }
    }

    AsyncFunction("removeVideoModel") Coroutine { ->
      withContext(Dispatchers.IO) {
        synchronized(processLock) {
          if (generationReserved || activeProcess?.isAlive == true || modelTransferReserved) {
            throw DiffusionException("Cancel the active task before removing the Wan model.")
          }
        }
        videoModelRoot().deleteRecursively()
        videoInactiveMarker().delete()
        videoStatus()
      }
    }

    AsyncFunction("setVideoModelActive") Coroutine { active: Boolean ->
      withContext(Dispatchers.IO) { changeVideoModelActive(active) }
    }

    AsyncFunction("generateVideo") Coroutine { options: VideoGenerationOptions ->
      withContext(Dispatchers.IO) { generateVideo(options) }
    }

    OnActivityEntersBackground {
      if (wanFastManagerLazy.isInitialized()) {
        Thread({ wanFastManager.stop() }, "saient-wan-fast-background-stop").apply {
          isDaemon = true
          start()
        }
      }
    }

    OnDestroy {
      if (wanFastManagerLazy.isInitialized()) wanFastManager.forceStop()
      synchronized(processLock) {
        cancellationRequested = true
        activeProcess?.destroyForcibly()
        downloadCancellationRequested = true
        activeDownloadConnection?.disconnect()
        activeDownloadConnection = null
        activeProcess = null
        generationReserved = false
        modelTransferReserved = false
      }
    }
  }

  private fun context(): Context =
    requireNotNull(appContext.reactContext) { "Android context is unavailable." }

  private fun engineBinary(): File =
    File(context().applicationInfo.nativeLibraryDir, "libquartz.so")

  private fun videoEngineBinary(): File =
    File(context().applicationInfo.nativeLibraryDir, "libquartz-wan.so")

  private fun diffusionDir(): File = File(context().filesDir, "diffusion")

  private fun modelRoot(): File = File(diffusionDir(), "sdxl")

  private fun legacyModelRoot(): File = File(diffusionDir(), "sd15")

  private fun videoModelRoot(): File = File(diffusionDir(), "wan2.1-t2v-1.3b")

  private fun inactiveMarker(): File = File(diffusionDir(), ".sdxl-inactive")

  private fun legacyInactiveMarker(): File = File(diffusionDir(), ".sd15-inactive")

  private fun videoInactiveMarker(): File = File(diffusionDir(), ".wan2.1-inactive")

  private fun status(): Map<String, Any> {
    val binary = engineBinary()
    if (!binary.isFile) {
      return statusMap(false, false, false, false, 0, "Quartz engine binary is missing.")
    }
    val root = modelRoot()
    if (!root.isDirectory) {
      val legacy = legacyModelRoot()
      if (legacy.isDirectory) {
        return statusMap(
          true,
          true,
          false,
          false,
          directoryBytes(legacy),
          "The old SD1.5 pack is installed. Download SDXL to replace it.",
        )
      }
      return statusMap(true, false, false, false, 0, "Download the Saient SDXL image model.")
    }
    val bytes = directoryBytes(root)
    val inspection = inspectPack(root)
    val active = inspection.first && !inactiveMarker().exists()
    return statusMap(
      true,
      true,
      inspection.first,
      active,
      bytes,
      if (!inspection.first) inspection.second
      else if (active) "Saient SDXL FP16 pack active."
      else "Saient SDXL FP16 pack is inactive.",
    )
  }

  private fun videoStatus(): Map<String, Any> {
    val binary = videoEngineBinary()
    if (!binary.isFile) {
      return statusMap(false, false, false, false, 0, "Wan Vulkan engine binary is missing.")
    }
    val root = videoModelRoot()
    if (!root.isDirectory) {
      return statusMap(true, false, false, false, 0, "Download the Wan2.1 video model pack.")
    }
    val bytes = directoryBytes(root)
    val inspection = inspectVideoPack(root)
    val active = inspection.first && !videoInactiveMarker().exists()
    return statusMap(
      true,
      true,
      inspection.first,
      active,
      bytes,
      if (!inspection.first) inspection.second
      else if (active) "Wan2.1 T2V 1.3B low-memory pack active."
      else "Wan2.1 video model is inactive.",
    )
  }

  private fun statusMap(
    available: Boolean,
    installed: Boolean,
    valid: Boolean,
    active: Boolean,
    modelBytes: Long,
    message: String,
  ) = mapOf(
    "available" to available,
    "installed" to installed,
    "valid" to valid,
    "active" to active,
    "modelBytes" to modelBytes.toDouble(),
    "message" to message,
  )

  private fun changeModelActive(active: Boolean): Map<String, Any> {
    reserveModelTransfer("Cancel image generation before changing the image model state.")
    return try {
      if (active) {
        val inspection = inspectPack(modelRoot())
        if (!inspection.first) throw DiffusionException(inspection.second)
        inactiveMarker().delete()
      } else {
        inactiveMarker().parentFile?.mkdirs()
        inactiveMarker().writeText("1")
      }
      status()
    } finally {
      releaseModelTransfer()
    }
  }

  private fun changeVideoModelActive(active: Boolean): Map<String, Any> {
    reserveModelTransfer("Cancel generation before changing the Wan model state.")
    return try {
      if (active) {
        val inspection = inspectVideoPack(videoModelRoot())
        if (!inspection.first) throw DiffusionException(inspection.second)
        videoInactiveMarker().delete()
      } else {
        videoInactiveMarker().parentFile?.mkdirs()
        videoInactiveMarker().writeText("1")
      }
      videoStatus()
    } finally {
      releaseModelTransfer()
    }
  }

  private fun reserveModelTransfer(message: String) {
    synchronized(processLock) {
      if (modelTransferReserved) throw DiffusionException("An image model transfer is already active.")
      if (generationReserved || activeProcess?.isAlive == true) throw DiffusionException(message)
      modelTransferReserved = true
      downloadCancellationRequested = false
    }
  }

  private fun releaseModelTransfer() {
    synchronized(processLock) {
      activeDownloadConnection?.disconnect()
      activeDownloadConnection = null
      downloadCancellationRequested = false
      modelTransferReserved = false
    }
  }

  private fun downloadModel(): Map<String, Any> {
    reserveModelTransfer("Cancel image generation before downloading its model.")
    val parent = diffusionDir().apply { mkdirs() }
    val staging = File(parent, ".download-sdxl-fp16-v1").apply { mkdirs() }
    try {
      var completedBytes = 0L
      var partialBytes = 0L
      val verifiedTargets = mutableSetOf<String>()
      REMOTE_MODEL_FILES.forEach { remote ->
        val target = File(staging, remote.path)
        val partial = File(target.path + ".part")
        if (target.isFile && target.length() == remote.bytes && sha256(target) == remote.sha256) {
          completedBytes += remote.bytes
          verifiedTargets += remote.path
        } else {
          target.delete()
          if (partial.length() > remote.bytes) partial.delete()
          partialBytes += partial.length()
        }
      }
      val remainingBytes = REMOTE_MODEL_BYTES - completedBytes - partialBytes
      if (StatFs(parent.path).availableBytes < remainingBytes + DOWNLOAD_HEADROOM_BYTES) {
        throw DiffusionException(
          "Not enough free storage. The image model needs ${formatGigabytes(remainingBytes + DOWNLOAD_HEADROOM_BYTES)} GB more space.",
        )
      }

      REMOTE_MODEL_FILES.forEach { remote ->
        if (downloadCancellationRequested) throw DiffusionException("Model download cancelled.")
        val target = File(staging, remote.path)
        if (remote.path in verifiedTargets) {
          sendDownloadProgress(completedBytes, remote.path, REMOTE_MODEL_BYTES, "image")
          return@forEach
        }
        target.parentFile?.mkdirs()
        val partial = File(target.path + ".part")
        downloadRemoteFile(remote, partial, completedBytes, REMOTE_MODEL_BYTES, "image")
        if (partial.length() != remote.bytes) {
          throw DiffusionException("${remote.path} downloaded with the wrong size.")
        }
        if (sha256(partial) != remote.sha256) {
          partial.delete()
          throw DiffusionException("${remote.path} failed its SHA-256 integrity check.")
        }
        target.delete()
        if (!partial.renameTo(target)) {
          throw DiffusionException("Could not finalize ${remote.path}.")
        }
        completedBytes += remote.bytes
        sendDownloadProgress(completedBytes, remote.path, REMOTE_MODEL_BYTES, "image")
      }

      val inspection = inspectPack(staging)
      if (!inspection.first) throw DiffusionException(inspection.second)
      val installed = modelRoot()
      val backup = File(parent, ".backup-${UUID.randomUUID()}")
      if (installed.exists() && !installed.renameTo(backup)) {
        throw DiffusionException("Could not stage the currently installed image model.")
      }
      if (!staging.renameTo(installed)) {
        if (backup.exists()) backup.renameTo(installed)
        throw DiffusionException("Could not install the downloaded image model atomically.")
      }
      backup.deleteRecursively()
      legacyModelRoot().deleteRecursively()
      inactiveMarker().delete()
      legacyInactiveMarker().delete()
      return status()
    } catch (error: Exception) {
      if (downloadCancellationRequested) throw DiffusionException("Model download cancelled.", error)
      throw if (error is CodedException) error else DiffusionException(
        "Model download failed. Saient will resume the saved partial download next time.",
        error,
      )
    } finally {
      releaseModelTransfer()
    }
  }

  private fun downloadVideoModel(): Map<String, Any> {
    reserveModelTransfer("Cancel generation before downloading the Wan model.")
    val parent = diffusionDir().apply { mkdirs() }
    val staging = File(parent, ".download-$WAN_PACK_ID").apply { mkdirs() }
    try {
      var completedBytes = 0L
      var partialBytes = 0L
      val verifiedTargets = mutableSetOf<String>()
      REMOTE_WAN_FILES.forEach { remote ->
        val target = File(staging, remote.path)
        val partial = File(target.path + ".part")
        if (target.isFile && target.length() == remote.bytes && sha256(target) == remote.sha256) {
          completedBytes += remote.bytes
          verifiedTargets += remote.path
        } else {
          target.delete()
          if (partial.length() > remote.bytes) partial.delete()
          partialBytes += partial.length()
        }
      }
      val remainingBytes = REMOTE_WAN_BYTES - completedBytes - partialBytes
      if (StatFs(parent.path).availableBytes < remainingBytes + DOWNLOAD_HEADROOM_BYTES) {
        throw DiffusionException(
          "Not enough free storage. The Wan pack needs ${formatGigabytes(remainingBytes + DOWNLOAD_HEADROOM_BYTES)} GB more space.",
        )
      }

      REMOTE_WAN_FILES.forEach { remote ->
        if (downloadCancellationRequested) throw DiffusionException("Model download cancelled.")
        val target = File(staging, remote.path)
        if (remote.path in verifiedTargets) {
          sendDownloadProgress(completedBytes, remote.path, REMOTE_WAN_BYTES, "video")
          return@forEach
        }
        target.parentFile?.mkdirs()
        val partial = File(target.path + ".part")
        downloadRemoteFile(remote, partial, completedBytes, REMOTE_WAN_BYTES, "video")
        if (partial.length() != remote.bytes) {
          throw DiffusionException("${remote.path} downloaded with the wrong size.")
        }
        if (sha256(partial) != remote.sha256) {
          partial.delete()
          throw DiffusionException("${remote.path} failed its SHA-256 integrity check.")
        }
        target.delete()
        if (!partial.renameTo(target)) throw DiffusionException("Could not finalize ${remote.path}.")
        completedBytes += remote.bytes
        sendDownloadProgress(completedBytes, remote.path, REMOTE_WAN_BYTES, "video")
      }

      File(staging, ".verified-pack").writeText(WAN_PACK_ID)
      val inspection = inspectVideoPack(staging)
      if (!inspection.first) throw DiffusionException(inspection.second)
      val installed = videoModelRoot()
      val backup = File(parent, ".backup-wan-${UUID.randomUUID()}")
      if (installed.exists() && !installed.renameTo(backup)) {
        throw DiffusionException("Could not stage the currently installed Wan pack.")
      }
      if (!staging.renameTo(installed)) {
        if (backup.exists()) backup.renameTo(installed)
        throw DiffusionException("Could not install the Wan model atomically.")
      }
      backup.deleteRecursively()
      videoInactiveMarker().delete()
      return videoStatus()
    } catch (error: Exception) {
      if (downloadCancellationRequested) throw DiffusionException("Model download cancelled.", error)
      throw if (error is CodedException) error else DiffusionException(
        "Wan download failed. Saient will resume the saved partial download next time.",
        error,
      )
    } finally {
      releaseModelTransfer()
    }
  }

  private fun downloadRemoteFile(
    remote: RemoteModelFile,
    partial: File,
    completedBytes: Long,
    totalBytes: Long,
    model: String,
  ) {
    val url = URL(remote.url)
    if (url.protocol != "https" || url.host != MODEL_HOST) {
      throw DiffusionException("Refusing an untrusted image model download URL.")
    }
    var failures = 0
    while (partial.length() < remote.bytes) {
      if (downloadCancellationRequested) throw DiffusionException("Model download cancelled.")
      val offset = partial.length()
      val connection = (url.openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = true
        connectTimeout = 20_000
        readTimeout = 30_000
        requestMethod = "GET"
        setRequestProperty("Accept-Encoding", "identity")
        setRequestProperty("User-Agent", "Saient-Android/0.1")
        if (offset > 0) setRequestProperty("Range", "bytes=$offset-")
      }
      synchronized(processLock) { activeDownloadConnection = connection }
      try {
        val response = connection.responseCode
        if (offset > 0 && response == HttpURLConnection.HTTP_OK) {
          partial.delete()
          failures = 0
          continue
        }
        if (response != HttpURLConnection.HTTP_OK && response != HttpURLConnection.HTTP_PARTIAL) {
          throw IOException("Model download returned HTTP $response.")
        }
        if (offset == 0L && response == HttpURLConnection.HTTP_PARTIAL) {
          throw IOException("Model download returned an unexpected partial response.")
        }
        FileOutputStream(partial, offset > 0).buffered(1024 * 1024).use { output ->
          connection.inputStream.buffered(1024 * 1024).use { input ->
            val buffer = ByteArray(1024 * 1024)
            var lastEvent = 0L
            while (true) {
              if (downloadCancellationRequested) throw DiffusionException("Model download cancelled.")
              val count = input.read(buffer)
              if (count < 0) break
              output.write(buffer, 0, count)
              if (partial.length() > remote.bytes) {
                throw IOException("Model download exceeded its declared size.")
              }
              val now = System.nanoTime()
              if (now - lastEvent >= 250_000_000L) {
                sendDownloadProgress(completedBytes + partial.length(), remote.path, totalBytes, model)
                lastEvent = now
              }
            }
          }
        }
        if (partial.length() < remote.bytes) throw IOException("Model download ended early.")
        failures = 0
      } catch (error: CodedException) {
        throw error
      } catch (error: IOException) {
        if (downloadCancellationRequested) throw DiffusionException("Model download cancelled.", error)
        failures++
        if (failures >= 4) throw error
        Thread.sleep(500L * failures)
      } finally {
        connection.disconnect()
        synchronized(processLock) {
          if (activeDownloadConnection === connection) activeDownloadConnection = null
        }
      }
    }
  }

  private fun sendDownloadProgress(completedBytes: Long, currentFile: String, totalBytes: Long, model: String) {
    sendEvent(
      "onDownloadProgress",
      mapOf(
        "completedBytes" to completedBytes.coerceIn(0, totalBytes).toDouble(),
        "totalBytes" to totalBytes.toDouble(),
        "currentFile" to currentFile,
        "model" to model,
      ),
    )
  }

  private fun sendVideoProgress(
    phase: String,
    message: String,
    completed: Int,
    total: Int,
    detail: String? = null,
  ) {
    sendEvent(
      "onVideoProgress",
      mapOf(
        "phase" to phase,
        "message" to message,
        "detail" to (detail ?: ""),
        "completed" to completed.coerceIn(0, total),
        "total" to total,
      ),
    )
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered(1024 * 1024).use { input ->
      val buffer = ByteArray(1024 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }

  private fun formatGigabytes(bytes: Long): String = "%.2f".format(bytes / 1_000_000_000.0)

  private fun importModelTree(treeUriString: String): Map<String, Any> {
    reserveModelTransfer("Cancel image generation before importing another model pack.")
    return try {
      importModelTreeReserved(treeUriString)
    } finally {
      releaseModelTransfer()
    }
  }

  private fun importModelTreeReserved(treeUriString: String): Map<String, Any> {
    val treeUri = Uri.parse(treeUriString)
    if (treeUri.scheme != "content") {
      throw DiffusionException("Android's folder picker did not return a content URI.")
    }
    val resolver = context().contentResolver
    runCatching {
      resolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    val parent = diffusionDir().apply { mkdirs() }
    val temporary = File(parent, ".import-${UUID.randomUUID()}")
    val backup = File(parent, ".backup-${UUID.randomUUID()}")
    temporary.mkdirs()
    try {
      val rootId = DocumentsContract.getTreeDocumentId(treeUri)
      val budget = ImportBudget()
      copyDocumentChildren(treeUri, rootId, temporary, budget, 0)
      val candidate = findPackRoot(temporary)
        ?: throw DiffusionException(
          "That folder is not a Saient SDXL pack. Select the folder containing model_index.json.",
        )
      val inspection = inspectPack(candidate)
      if (!inspection.first) throw DiffusionException(inspection.second)

      val installed = modelRoot()
      if (installed.exists() && !installed.renameTo(backup)) {
        throw DiffusionException("Could not stage the currently installed image model.")
      }
      if (!candidate.renameTo(installed)) {
        if (backup.exists()) backup.renameTo(installed)
        throw DiffusionException("Could not install the validated image model atomically.")
      }
      backup.deleteRecursively()
      legacyModelRoot().deleteRecursively()
      temporary.deleteRecursively()
      inactiveMarker().delete()
      legacyInactiveMarker().delete()
      return status()
    } catch (error: Exception) {
      temporary.deleteRecursively()
      if (!modelRoot().exists() && backup.exists() && !backup.renameTo(modelRoot())) {
        throw DiffusionException(
          "Model import failed and the previous pack remains at ${backup.path} for recovery.",
          error,
        )
      }
      throw if (error is CodedException) error else DiffusionException("Model import failed.", error)
    }
  }

  private fun copyDocumentChildren(
    treeUri: Uri,
    parentDocumentId: String,
    destination: File,
    budget: ImportBudget,
    depth: Int,
  ) {
    if (depth > MAX_IMPORT_DEPTH) throw DiffusionException("Model folder nesting is too deep.")
    val resolver = context().contentResolver
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId)
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
    )
    val cursor = resolver.query(childrenUri, projection, null, null, null)
      ?: throw DiffusionException("Android could not read the selected model folder.")
    cursor.use {
      val idColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
      val nameColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      val typeColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
      while (it.moveToNext()) {
        budget.entries++
        if (budget.entries > MAX_IMPORT_ENTRIES) {
          throw DiffusionException("The selected folder contains too many files.")
        }
        val documentId = it.getString(idColumn)
        val name = safeEntryName(it.getString(nameColumn))
        val mimeType = it.getString(typeColumn)
        val target = File(destination, name)
        if (mimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
          if (!target.mkdir()) throw DiffusionException("Could not create model folder $name.")
          copyDocumentChildren(treeUri, documentId, target, budget, depth + 1)
        } else {
          val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
          resolver.openInputStream(documentUri).use { input ->
            if (input == null) throw DiffusionException("Could not open model file $name.")
            target.outputStream().buffered(1024 * 1024).use { output ->
              val buffer = ByteArray(1024 * 1024)
              while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                budget.bytes += count
                if (budget.bytes > MAX_IMPORT_BYTES) {
                  throw DiffusionException("The selected model folder exceeds 7.5 GB.")
                }
                output.write(buffer, 0, count)
              }
            }
          }
        }
      }
    }
  }

  private fun safeEntryName(name: String?): String {
    val value = name?.trim().orEmpty()
    if (value.isEmpty() || value == "." || value == ".." || value.length > 180 ||
      value.contains('/') || value.contains('\\') || value.contains('\u0000')
    ) {
      throw DiffusionException("The selected folder contains an unsafe filename.")
    }
    return value
  }

  private fun findPackRoot(root: File): File? {
    if (File(root, "model_index.json").isFile) return root
    val matches = root.walkTopDown()
      .maxDepth(3)
      .filter { it.isFile && it.name == "model_index.json" }
      .mapNotNull { it.parentFile }
      .distinctBy { it.canonicalPath }
      .toList()
    return matches.singleOrNull()
  }

  private fun inspectPack(root: File): Pair<Boolean, String> {
    val binary = engineBinary()
    if (!binary.isFile) return false to "Quartz engine binary is missing."
    val process = ProcessBuilder(binary.path, "--inspect-sdxl", root.path)
      .redirectErrorStream(true)
      .start()
    if (!process.waitFor(60, TimeUnit.SECONDS)) {
      process.destroyForcibly()
      return false to "Model validation timed out."
    }
    val output = process.inputStream.bufferedReader().use { it.readText() }.trim()
    return if (process.exitValue() == 0 && Regex("validation\\s+: passed").containsMatchIn(output)) {
      true to output
    } else {
      false to (output.lineSequence().lastOrNull()?.take(500) ?: "Model validation failed.")
    }
  }

  private fun inspectVideoPack(root: File): Pair<Boolean, String> {
    if (!videoEngineBinary().isFile) return false to "Wan Vulkan engine binary is missing."
    REMOTE_WAN_FILES.forEach { expected ->
      val file = File(root, expected.path)
      if (!file.isFile) return false to "Wan pack is missing ${expected.path}."
      if (file.length() != expected.bytes) return false to "Wan pack has the wrong size for ${expected.path}."
    }
    val marker = File(root, ".verified-pack")
    if (!marker.isFile || marker.readText().trim() != WAN_PACK_ID) {
      return false to "Wan pack has not passed Saient's integrity verification. Download it again."
    }
    return true to "Wan pack validation passed."
  }

  private fun generate(options: GenerationOptions): Map<String, Any> {
    if (inactiveMarker().exists()) {
      throw DiffusionException("The SDXL image model is inactive. Activate it from Models before generating.")
    }
    val prompt = options.prompt.trim()
    val negative = options.negativePrompt.trim()
    if (prompt.isEmpty() || prompt.length > 1_000 || negative.length > 1_000) {
      throw DiffusionException("Prompt text must be between 1 and 1,000 characters.")
    }
    if (options.steps !in 4..20) {
      throw DiffusionException("Saient mobile generation supports 4 to 20 steps.")
    }
    if (!options.guidance.isFinite() || options.guidance !in 0.0..30.0) {
      throw DiffusionException("Guidance must be between 0 and 30.")
    }
    if (options.seed !in 0..2_147_483_647L) {
      throw DiffusionException("Seed must be between 0 and 2147483647.")
    }
    val root = modelRoot()
    val inspection = inspectPack(root)
    if (!inspection.first) throw DiffusionException(inspection.second)

    synchronized(processLock) {
      if (modelTransferReserved) {
        throw DiffusionException("Wait for the image model transfer to finish.")
      }
      if (generationReserved || activeProcess?.isAlive == true) {
        throw DiffusionException("An image is already generating.")
      }
      generationReserved = true
      cancellationRequested = false
    }

    val pausedMarker = File(context().filesDir, "models/.paused")
    val wasPaused = pausedMarker.exists()
    val outputDirectory = File(context().filesDir, "remote-generations").apply { mkdirs() }
    val output = File(outputDirectory, "saient-local-${System.currentTimeMillis()}.png")
    val arguments = listOf(
      engineBinary().path,
      "--inspect-sdxl", root.path,
      "--stage-vulkan",
      "--vulkan",
      "--generate-sdxl", prompt,
      "--negative-prompt", negative,
      "--steps", options.steps.toString(),
      "--guidance", options.guidance.toString(),
      "--seed", options.seed.toString(),
      "--resolution", "1024",
      "--output", output.path,
    )
    val started = System.nanoTime()
    val logs = ArrayDeque<String>()
    try {
      if (!wasPaused) {
        pausedMarker.parentFile?.mkdirs()
        pausedMarker.writeText("1")
        if (!waitForChatEngineToStop()) {
          throw DiffusionException("Quartz could not unload the chat model before image generation.")
        }
      }
      if (cancellationRequested) throw DiffusionException("Image generation cancelled.")
      val process = ProcessBuilder(arguments).redirectErrorStream(true).apply {
        environment()["QUARTZ_SD_VULKAN"] = "1"
        environment()["RAYON_NUM_THREADS"] = "6"
        environment()["QUARTZ_SD_STAGE"] = "1"
      }.start()
      synchronized(processLock) {
        activeProcess = process
        if (cancellationRequested) process.destroy()
      }
      val progress = Regex("SDXL progress: phase=(\\w+) completed=(\\d+) total=(\\d+)")
      process.inputStream.bufferedReader().useLines { lines ->
        lines.forEach { line ->
          if (logs.size >= 80) logs.removeFirst()
          logs.addLast(line.take(1_000))
          val match = progress.matchEntire(line)
          if (match != null) {
            sendEvent(
              "onProgress",
              mapOf(
                "phase" to match.groupValues[1],
                "completed" to match.groupValues[2].toInt(),
                "total" to match.groupValues[3].toInt(),
              ),
            )
          }
        }
      }
      val exitCode = process.waitFor()
      if (cancellationRequested) throw DiffusionException("Image generation cancelled.")
      if (exitCode != 0) {
        throw DiffusionException(logs.lastOrNull() ?: "Quartz image generation failed with exit $exitCode.")
      }
      if (!output.isFile || output.length() < 1_000) {
        throw DiffusionException("Quartz completed without a valid PNG output.")
      }
      return mapOf(
        "uri" to Uri.fromFile(output).toString(),
        "elapsedSeconds" to (System.nanoTime() - started) / 1_000_000_000.0,
        "steps" to options.steps,
        "seed" to options.seed.toDouble(),
        "width" to 1024,
        "height" to 1024,
      )
    } catch (error: Exception) {
      output.delete()
      if (cancellationRequested) throw DiffusionException("Image generation cancelled.", error)
      throw if (error is CodedException) error else DiffusionException("Image generation failed.", error)
    } finally {
      synchronized(processLock) {
        activeProcess = null
        cancellationRequested = false
        generationReserved = false
      }
      if (!wasPaused) pausedMarker.delete()
    }
  }

  private fun generateVideo(options: VideoGenerationOptions): Map<String, Any> {
    if (videoInactiveMarker().exists()) {
      throw DiffusionException("The Wan video model is inactive. Activate it before generating.")
    }
    val prompt = options.prompt.trim()
    val userNegative = options.negativePrompt.trim()
    if (prompt.isEmpty() || prompt.length > 1_000 || userNegative.length > 1_000) {
      throw DiffusionException("Prompt text must be between 1 and 1,000 characters.")
    }
    // Always keep Wan's own negative prompt as the quality floor; anything the user types
    // is appended to it rather than replacing it. Shipping a bare empty string here is what
    // let malformed faces, hands and limbs through unopposed.
    val negative =
      if (userNegative.isEmpty()) WAN_DEFAULT_NEGATIVE else "$WAN_DEFAULT_NEGATIVE，$userNegative"
    if (options.steps !in 1..20) throw DiffusionException("Wan generation supports 1 to 20 steps.")
    if (!options.guidance.isFinite() || options.guidance !in 0.0..30.0) {
      throw DiffusionException("Guidance must be between 0 and 30.")
    }
    if (options.seed !in 0..2_147_483_647L) {
      throw DiffusionException("Seed must be between 0 and 2147483647.")
    }
    if (options.frames !in 5..41 || (options.frames - 1) % 4 != 0) {
      throw DiffusionException("Wan frame count must be 5 to 41 in 4-frame increments.")
    }
    val root = videoModelRoot()
    val inspection = inspectVideoPack(root)
    if (!inspection.first) throw DiffusionException(inspection.second)

    synchronized(processLock) {
      if (modelTransferReserved) throw DiffusionException("Wait for the model transfer to finish.")
      if (generationReserved || activeProcess?.isAlive == true) {
        throw DiffusionException("Another local generation is already running.")
      }
      generationReserved = true
      cancellationRequested = false
    }

    val pausedMarker = File(context().filesDir, "models/.paused")
    val wasPaused = pausedMarker.exists()
    val outputDirectory = File(context().filesDir, "remote-generations").apply { mkdirs() }
    val output = File(outputDirectory, "saient-wan-${System.currentTimeMillis()}.webm")
    val arguments = listOf(
      videoEngineBinary().path,
      "--mode", "vid_gen",
      "--diffusion-model", File(root, "wan2.1_t2v_1.3B_Q4_K.gguf").path,
      "--vae", File(root, "wan_2.1_vae.safetensors").path,
      "--t5xxl", File(root, "umt5-xxl-encoder-Q4_K_M.gguf").path,
      "--prompt", prompt,
      "--negative-prompt", negative,
      "--cfg-scale", options.guidance.toString(),
      "--sampling-method", "euler",
      "--steps", options.steps.toString(),
      "--width", WAN_WIDTH.toString(),
      "--height", WAN_HEIGHT.toString(),
      "--video-frames", options.frames.toString(),
      "--fps", WAN_FPS.toString(),
      "--flow-shift", WAN_FLOW_SHIFT,
      "--seed", options.seed.toString(),
      "--threads", "6",
      "--diffusion-fa",
      "--backend", "te=cpu,vae=cpu,diffusion=vulkan0",
      "--params-backend", "diffusion=cpu,te=disk,vae=cpu",
      "--max-vram", "vulkan0=-0.75",
      "--mmap",
      "--vae-tiling",
      "--output", output.path,
    )
    val started = System.nanoTime()
    val logs = ArrayDeque<String>()
    try {
      sendVideoProgress("preparing", "Liberando memória para o Wan", 0, options.steps)
      if (!wasPaused) {
        pausedMarker.parentFile?.mkdirs()
        pausedMarker.writeText("1")
        if (!waitForChatEngineToStop()) {
          throw DiffusionException("Quartz could not unload the chat model before video generation.")
        }
      }
      if (cancellationRequested) throw DiffusionException("Video generation cancelled.")
      sendVideoProgress("starting", "Iniciando motor Wan", 0, options.steps)
      val process = ProcessBuilder(arguments).redirectErrorStream(true).start()
      synchronized(processLock) {
        activeProcess = process
        if (cancellationRequested) process.destroy()
      }
      sendVideoProgress("loading", "Carregando modelos e preparando Vulkan", 0, options.steps)
      val progress = Regex("SAIENT_WAN_PROGRESS completed=(\\d+) total=(\\d+)")
      var denoisingStarted = false
      process.inputStream.bufferedReader().useLines { lines ->
        lines.forEach { line ->
          if (logs.size >= 120) logs.removeFirst()
          logs.addLast(line.take(1_000))
          val match = progress.find(line)
          if (match != null) {
            val completed = match.groupValues[1].toInt()
            val total = match.groupValues[2].toInt()
            if (total > 0) {
              denoisingStarted = true
              sendVideoProgress("denoising", "Processando $completed de $total", completed, total)
            }
          } else if (!denoisingStarted && line.isNotBlank()) {
            sendVideoProgress(
              "loading",
              "Carregando modelos e preparando Vulkan",
              0,
              options.steps,
              line.take(240),
            )
          }
        }
      }
      val exitCode = process.waitFor()
      if (cancellationRequested) throw DiffusionException("Video generation cancelled.")
      if (exitCode != 0) {
        val reversedLogs = logs.reversed()
        val engineErrors = logs.filter { line -> line.contains("[ERROR") }
        val diagnostic = if (engineErrors.isNotEmpty()) {
          engineErrors.takeLast(6).joinToString("\n")
        } else {
          reversedLogs.firstOrNull { line ->
            line.contains("GGML_ASSERT") || line.contains("failed", ignoreCase = true)
          }
        }
        throw DiffusionException(diagnostic ?: logs.lastOrNull() ?: "Wan generation failed with exit $exitCode.")
      }
      if (!output.isFile || output.length() < 1_000) {
        throw DiffusionException("Wan completed without a valid WebM output.")
      }
      return mapOf(
        "uri" to Uri.fromFile(output).toString(),
        "elapsedSeconds" to (System.nanoTime() - started) / 1_000_000_000.0,
        "steps" to options.steps,
        "seed" to options.seed.toDouble(),
        "width" to WAN_WIDTH,
        "height" to WAN_HEIGHT,
        "frames" to options.frames,
        "fps" to WAN_FPS,
      )
    } catch (error: Exception) {
      output.delete()
      if (cancellationRequested) throw DiffusionException("Video generation cancelled.", error)
      throw if (error is CodedException) error else DiffusionException("Video generation failed.", error)
    } finally {
      synchronized(processLock) {
        activeProcess = null
        cancellationRequested = false
        generationReserved = false
      }
      if (!wasPaused) pausedMarker.delete()
    }
  }

  private fun waitForChatEngineToStop(): Boolean {
    // QuartzEngine reconciles its marker on a four-second poll. Waiting one full
    // interval also covers a chat process that is still loading and has not
    // opened its localhost port yet.
    Thread.sleep(4_250)
    repeat(12) {
      if (!chatEnginePortOpen()) return true
      Thread.sleep(250)
    }
    return !chatEnginePortOpen()
  }

  private fun chatEnginePortOpen(): Boolean = runCatching {
    Socket().use { socket ->
      socket.connect(InetSocketAddress("127.0.0.1", ENGINE_PORT), 150)
      true
    }
  }.getOrDefault(false)

  private fun directoryBytes(root: File): Long =
    root.walkTopDown().filter { it.isFile }.fold(0L) { total, file ->
      if (Long.MAX_VALUE - total < file.length()) Long.MAX_VALUE else total + file.length()
    }
}