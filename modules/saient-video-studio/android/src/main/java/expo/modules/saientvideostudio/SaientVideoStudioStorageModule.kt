package expo.modules.saientvideostudio

import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val MAX_STORAGE_OUTPUT_NAME_CHARS = 64

private class VideoStudioStorageException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

class SaientVideoStudioStorageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SaientVideoStudioStorage")

    AsyncFunction("promoteExport") Coroutine { uri: String, outputName: String ->
      withContext(Dispatchers.IO) { promoteExport(uri, outputName) }
    }

    AsyncFunction("cleanupSynthesizedSegments") Coroutine { uris: List<String> ->
      withContext(Dispatchers.IO) { cleanupSynthesizedSegments(uris) }
    }
  }

  private fun context() =
    requireNotNull(appContext.reactContext) { "Android context is unavailable." }

  private fun promoteExport(uriString: String, outputName: String): Map<String, Any> {
    val source = requireOwnedFileInRoot(
      uriString,
      File(context().cacheDir, "video-studio/exports"),
      "temporary video export",
    )
    if (!source.name.endsWith(".mp4", ignoreCase = true)) {
      throw VideoStudioStorageException("Temporary video export must be an MP4 file.")
    }

    val destinationRoot = File(context().filesDir, "video-studio/exports")
    if (!destinationRoot.mkdirs() && !destinationRoot.isDirectory) {
      throw VideoStudioStorageException("Could not create persistent video export storage.")
    }

    val baseName = safeOutputBaseName(outputName)
    val destination = File(destinationRoot, "$baseName-${UUID.randomUUID()}.mp4")
    val staging = File(destinationRoot, ".${destination.name}.part")
    try {
      staging.delete()
      source.copyTo(staging, overwrite = false)
      if (!staging.isFile || staging.length() <= 0L || staging.length() != source.length()) {
        throw VideoStudioStorageException("Persistent MP4 copy did not match the temporary export.")
      }
      if (!staging.renameTo(destination)) {
        throw VideoStudioStorageException("Could not atomically finalize the persistent MP4 export.")
      }
      source.delete()
      return mapOf(
        "uri" to Uri.fromFile(destination).toString(),
        "fileBytes" to destination.length(),
      )
    } catch (error: Throwable) {
      staging.delete()
      if (destination.exists() && destination.length() <= 0L) destination.delete()
      throw if (error is CodedException) error else VideoStudioStorageException(
        "Could not persist the exported MP4.",
        error,
      )
    }
  }

  private fun cleanupSynthesizedSegments(uriStrings: List<String>): Map<String, Int> {
    val root = File(context().cacheDir, "video-studio/tts").canonicalFile
    var deleted = 0
    var skipped = 0

    uriStrings.distinct().forEach { uriString ->
      val file = runCatching { fileFromUri(uriString).canonicalFile }.getOrNull()
      if (file == null || !isInsideRoot(file, root) || !file.isFile) {
        skipped++
        return@forEach
      }
      if (file.delete()) {
        deleted++
        val parent = file.parentFile?.canonicalFile
        if (parent != null && parent.parentFile?.canonicalFile == root) {
          parent.delete()
        }
      } else {
        skipped++
      }
    }

    return mapOf("deleted" to deleted, "skipped" to skipped)
  }

  private fun requireOwnedFileInRoot(uriString: String, root: File, label: String): File {
    val file = fileFromUri(uriString).canonicalFile
    val canonicalRoot = root.canonicalFile
    if (!isInsideRoot(file, canonicalRoot)) {
      throw VideoStudioStorageException("$label is outside its allowed app-owned storage root.")
    }
    if (!file.isFile || !file.canRead()) {
      throw VideoStudioStorageException("$label is missing or unreadable.")
    }
    return file
  }

  private fun fileFromUri(uriString: String): File {
    val uri = Uri.parse(uriString)
    if (!uri.scheme.equals("file", ignoreCase = true)) {
      throw VideoStudioStorageException("Only app-owned file URIs are accepted.")
    }
    val path = uri.path ?: throw VideoStudioStorageException("Local file URI has no path.")
    return File(path)
  }

  private fun isInsideRoot(file: File, root: File): Boolean =
    file.path == root.path || file.path.startsWith(root.path + File.separator)

  private fun safeOutputBaseName(requested: String): String {
    val raw = requested.trim().removeSuffix(".mp4")
    val sanitized = raw
      .replace(Regex("[^A-Za-z0-9._-]+"), "-")
      .trim('-', '.', '_')
      .take(MAX_STORAGE_OUTPUT_NAME_CHARS)
    return sanitized.ifEmpty { "saient-video" }
  }
}
