package expo.modules.saientvideostudio

import android.graphics.Color
import android.graphics.Typeface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.text.Layout
import android.text.Spannable
import android.text.SpannableString
import android.text.style.AlignmentSpan
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.OverlaySettings
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlin.math.abs
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val DEFAULT_LOCALE = "pt-BR"
private const val MIN_SPEECH_RATE = 0.5
private const val MAX_SPEECH_RATE = 2.0
private const val MAX_CAPTION_CHARS = 500
private const val MAX_OUTPUT_NAME_CHARS = 64
private const val AUDIO_DURATION_TOLERANCE_MS = 1_000L

private class VideoStudioException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

class SpeechSynthesisOptions : Record {
  @Field var text: String = ""
  @Field var locale: String = DEFAULT_LOCALE
  @Field var voiceName: String? = null
  @Field var speechRate: Double = 1.0
}

class ExportAudioSegment : Record {
  @Field var uri: String = ""
  @Field var startMs: Long = 0
  @Field var durationMs: Long = 0
}

class ExportCaption : Record {
  @Field var text: String = ""
  @Field var startMs: Long = 0
  @Field var endMs: Long = 0
}

class ExportDubbedVideoOptions : Record {
  @Field var videoUri: String = ""
  @Field var audioSegments: List<ExportAudioSegment> = emptyList()
  @Field var captions: List<ExportCaption> = emptyList()
  @Field var outputName: String = "saient-video"
}

private data class ValidatedAudioSegment(
  val file: File,
  val startMs: Long,
  val durationMs: Long,
)

private data class ValidatedCaption(
  val startUs: Long,
  val endUs: Long,
  val styledText: SpannableString,
)

private data class PreparedExport(
  val videoFile: File,
  val videoDurationMs: Long,
  val audioSegments: List<ValidatedAudioSegment>,
  val captions: List<ValidatedCaption>,
  val outputFile: File,
)

@UnstableApi
class SaientVideoStudioModule : Module() {
  private val synthesisLock = Any()
  @Volatile private var synthesisReserved = false
  @Volatile private var cancellationRequested = false
  @Volatile private var activeTts: TextToSpeech? = null
  @Volatile private var activeCompletion: CompletableDeferred<Unit>? = null
  @Volatile private var activeFile: File? = null

  private val exportLock = Any()
  @Volatile private var exportReserved = false
  @Volatile private var activeTransformer: Transformer? = null
  @Volatile private var activeExportCompletion: CompletableDeferred<Unit>? = null
  @Volatile private var activeExportFile: File? = null

  override fun definition() = ModuleDefinition {
    Name("SaientVideoStudio")

    AsyncFunction("getOfflineVoices") Coroutine { localeTag: String ->
      withContext(Dispatchers.IO) {
        val tts = createTts()
        try {
          offlineVoices(tts, localeTag).map(::voiceMap)
        } finally {
          tts.shutdown()
        }
      }
    }

    AsyncFunction("synthesizeSpeechSegment") Coroutine { options: SpeechSynthesisOptions ->
      synthesize(options)
    }

    AsyncFunction("cancelSpeechSynthesis") {
      cancelActiveSynthesis()
    }

    AsyncFunction("exportDubbedVideo") Coroutine { options: ExportDubbedVideoOptions ->
      exportDubbedVideo(options)
    }

    AsyncFunction("cancelVideoExport") Coroutine { ->
      withContext(Dispatchers.Main.immediate) { cancelActiveExport() }
    }

    OnDestroy {
      cancelActiveSynthesis(releaseImmediately = true)
      val transformer = activeTransformer
      val completion = activeExportCompletion
      val output = activeExportFile
      if (transformer != null || completion != null) {
        context().mainExecutor.execute {
          transformer?.cancel()
          completion?.completeExceptionally(VideoStudioException("Video export cancelled."))
          output?.delete()
        }
      }
    }
  }

  private fun context() =
    requireNotNull(appContext.reactContext) { "Android context is unavailable." }

  private suspend fun createTts(): TextToSpeech = withContext(Dispatchers.Main.immediate) {
    val initialization = CompletableDeferred<Int>()
    val tts = TextToSpeech(context()) { status ->
      initialization.complete(status)
    }
    try {
      val status = initialization.await()
      if (status != TextToSpeech.SUCCESS) {
        throw VideoStudioException("Android text-to-speech could not be initialized.")
      }
      tts
    } catch (error: Throwable) {
      tts.shutdown()
      throw error
    }
  }

  private fun localeFromTag(localeTag: String): Locale {
    val normalized = localeTag.trim().ifEmpty { DEFAULT_LOCALE }
    val locale = Locale.forLanguageTag(normalized)
    if (locale.language.isBlank()) {
      throw VideoStudioException("Invalid TTS locale: $localeTag")
    }
    return locale
  }

  private fun offlineVoices(tts: TextToSpeech, localeTag: String): List<Voice> {
    val locale = localeFromTag(localeTag)
    return (tts.voices ?: emptySet())
      .asSequence()
      .filter { voice ->
        !voice.isNetworkConnectionRequired &&
          voice.locale.language.equals(locale.language, ignoreCase = true) &&
          (locale.country.isBlank() || voice.locale.country.equals(locale.country, ignoreCase = true))
      }
      .sortedWith(
        compareByDescending<Voice> { it.quality }
          .thenBy { it.latency }
          .thenBy { it.name },
      )
      .toList()
  }

  private fun voiceMap(voice: Voice): Map<String, Any> = mapOf(
    "name" to voice.name,
    "locale" to voice.locale.toLanguageTag(),
    "quality" to voice.quality,
    "latency" to voice.latency,
    "features" to voice.features.toList().sorted(),
    "networkRequired" to false,
  )

  private fun chooseOfflineVoice(
    tts: TextToSpeech,
    localeTag: String,
    requestedName: String?,
  ): Voice {
    val voices = offlineVoices(tts, localeTag)
    if (voices.isEmpty()) {
      throw VideoStudioException(
        "No offline $localeTag voice is installed. Install a Brazilian-Portuguese offline voice in Android text-to-speech settings.",
      )
    }
    if (requestedName.isNullOrBlank()) return voices.first()
    return voices.firstOrNull { it.name == requestedName }
      ?: throw VideoStudioException(
        "The selected voice '$requestedName' is unavailable offline for $localeTag.",
      )
  }

  private suspend fun synthesize(options: SpeechSynthesisOptions): Map<String, Any> =
    withContext(Dispatchers.IO) {
      val text = options.text.trim()
      if (text.isEmpty()) throw VideoStudioException("Narration text cannot be empty.")
      if (text.length > TextToSpeech.getMaxSpeechInputLength()) {
        throw VideoStudioException(
          "Narration segment exceeds Android's ${TextToSpeech.getMaxSpeechInputLength()} character TTS limit.",
        )
      }
      if (!options.speechRate.isFinite() || options.speechRate < MIN_SPEECH_RATE || options.speechRate > MAX_SPEECH_RATE) {
        throw VideoStudioException("speechRate must be between $MIN_SPEECH_RATE and $MAX_SPEECH_RATE.")
      }

      reserveSynthesis()
      var tts: TextToSpeech? = null
      var output: File? = null
      var completed = false
      try {
        tts = createTts()
        synchronized(synthesisLock) {
          if (cancellationRequested) throw VideoStudioException("Speech synthesis cancelled.")
          activeTts = tts
        }

        val localeTag = options.locale.trim().ifEmpty { DEFAULT_LOCALE }
        val voice = chooseOfflineVoice(tts, localeTag, options.voiceName)
        if (tts.setVoice(voice) != TextToSpeech.SUCCESS) {
          throw VideoStudioException("Android rejected the selected offline voice '${voice.name}'.")
        }
        if (tts.setSpeechRate(options.speechRate.toFloat()) != TextToSpeech.SUCCESS) {
          throw VideoStudioException("Android rejected speech rate ${options.speechRate}.")
        }

        val jobDir = File(context().cacheDir, "video-studio/tts/${UUID.randomUUID()}")
        if (!jobDir.mkdirs() && !jobDir.isDirectory) {
          throw VideoStudioException("Could not create app-owned TTS temporary storage.")
        }
        output = File(jobDir, "segment.wav")
        synchronized(synthesisLock) { activeFile = output }

        val utteranceId = UUID.randomUUID().toString()
        val completion = CompletableDeferred<Unit>()
        synchronized(synthesisLock) { activeCompletion = completion }
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(id: String?) = Unit

          override fun onDone(id: String?) {
            if (id == utteranceId) completion.complete(Unit)
          }

          @Deprecated("Deprecated by Android but still required on older API contracts")
          override fun onError(id: String?) {
            if (id == utteranceId) {
              completion.completeExceptionally(VideoStudioException("Android TTS failed to synthesize narration."))
            }
          }

          override fun onError(id: String?, errorCode: Int) {
            if (id == utteranceId) {
              completion.completeExceptionally(
                VideoStudioException("Android TTS failed with error code $errorCode."),
              )
            }
          }

          override fun onStop(id: String?, interrupted: Boolean) {
            if (id == utteranceId) {
              completion.completeExceptionally(VideoStudioException("Speech synthesis cancelled."))
            }
          }
        })

        if (tts.synthesizeToFile(text, Bundle(), output, utteranceId) != TextToSpeech.SUCCESS) {
          throw VideoStudioException("Android TTS refused the synthesis request.")
        }
        completion.await()
        if (!output.isFile || output.length() <= 0L) {
          throw VideoStudioException("Android TTS completed without creating a usable audio file.")
        }

        val durationMs = mediaDurationMs(output)
        completed = true
        mapOf(
          "uri" to Uri.fromFile(output).toString(),
          "durationMs" to durationMs,
          "text" to text,
          "locale" to voice.locale.toLanguageTag(),
          "voiceName" to voice.name,
          "speechRate" to options.speechRate,
        )
      } finally {
        synchronized(synthesisLock) {
          activeCompletion = null
          activeTts = null
          activeFile = null
          synthesisReserved = false
          cancellationRequested = false
        }
        tts?.shutdown()
        if (!completed) output?.parentFile?.deleteRecursively()
      }
    }

  private suspend fun exportDubbedVideo(options: ExportDubbedVideoOptions): Map<String, Any> {
    val prepared = withContext(Dispatchers.IO) { prepareExport(options) }
    val completion = CompletableDeferred<Unit>()

    try {
      withContext(Dispatchers.Main.immediate) {
        reserveExport()
        val videoEffects = if (prepared.captions.isEmpty()) {
          Effects.EMPTY
        } else {
          val captionOverlay = createCaptionOverlay(prepared.captions)
          Effects(emptyList(), listOf(OverlayEffect(listOf(captionOverlay))))
        }

        val videoItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(prepared.videoFile)))
          .setRemoveAudio(true)
          .setEffects(videoEffects)
          .build()
        val videoSequence = EditedMediaItemSequence.Builder(videoItem).build()

        val audioSequenceBuilder = EditedMediaItemSequence.Builder()
          .experimentalSetForceAudioTrack(true)
        var cursorMs = 0L
        for (segment in prepared.audioSegments) {
          if (segment.startMs > cursorMs) {
            audioSequenceBuilder.addGap(msToUs(segment.startMs - cursorMs))
          }
          val audioItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(segment.file)))
            .setRemoveVideo(true)
            .build()
          audioSequenceBuilder.addItem(audioItem)
          cursorMs = segment.startMs + segment.durationMs
        }
        if (cursorMs < prepared.videoDurationMs) {
          audioSequenceBuilder.addGap(msToUs(prepared.videoDurationMs - cursorMs))
        }
        val audioSequence = audioSequenceBuilder.build()
        val composition = Composition.Builder(videoSequence, audioSequence).build()

        val transformer = Transformer.Builder(context())
          .setAudioMimeType(MimeTypes.AUDIO_AAC)
          .setVideoMimeType(MimeTypes.VIDEO_H264)
          .addListener(object : Transformer.Listener {
            override fun onCompleted(composition: Composition, result: ExportResult) {
              completion.complete(Unit)
            }

            override fun onError(
              composition: Composition,
              result: ExportResult,
              exception: ExportException,
            ) {
              completion.completeExceptionally(
                VideoStudioException("Media3 could not export the dubbed MP4: ${exception.message}", exception),
              )
            }
          })
          .build()

        synchronized(exportLock) {
          activeTransformer = transformer
          activeExportCompletion = completion
          activeExportFile = prepared.outputFile
        }
        prepared.outputFile.delete()
        transformer.start(composition, prepared.outputFile.absolutePath)
      }

      completion.await()
      if (!prepared.outputFile.isFile || prepared.outputFile.length() <= 0L) {
        throw VideoStudioException("Media3 completed without creating a usable MP4 file.")
      }
      return mapOf(
        "uri" to Uri.fromFile(prepared.outputFile).toString(),
        "durationMs" to prepared.videoDurationMs,
        "fileBytes" to prepared.outputFile.length(),
        "audioSegmentCount" to prepared.audioSegments.size,
        "captionCount" to prepared.captions.size,
      )
    } catch (error: Throwable) {
      prepared.outputFile.delete()
      throw error
    } finally {
      withContext(Dispatchers.Main.immediate) {
        synchronized(exportLock) {
          activeTransformer = null
          activeExportCompletion = null
          activeExportFile = null
          exportReserved = false
        }
      }
    }
  }

  private fun prepareExport(options: ExportDubbedVideoOptions): PreparedExport {
    val videoFile = requireOwnedLocalFile(options.videoUri, "video")
    val videoDurationMs = mediaDurationMs(videoFile)

    var audioCursorMs = 0L
    var narrationDurationMs = 0L
    val audioSegments = options.audioSegments.mapIndexed { index, segment ->
      if (segment.startMs < 0L) {
        throw VideoStudioException("Audio segment $index has a negative start time.")
      }
      if (segment.durationMs <= 0L) {
        throw VideoStudioException("Audio segment $index has an invalid duration.")
      }
      val file = requireOwnedLocalFile(segment.uri, "audio segment $index")
      val actualDurationMs = mediaDurationMs(file)
      if (abs(actualDurationMs - segment.durationMs) > AUDIO_DURATION_TOLERANCE_MS) {
        throw VideoStudioException("Audio segment $index duration no longer matches its synthesized file.")
      }
      if (segment.startMs < audioCursorMs) {
        throw VideoStudioException("Audio segments overlap or are out of order at index $index.")
      }
      val endMs = safeAddMs(segment.startMs, actualDurationMs, "audio segment $index")
      audioCursorMs = endMs
      narrationDurationMs = endMs
      ValidatedAudioSegment(file, segment.startMs, actualDurationMs)
    }
    if (narrationDurationMs > videoDurationMs) {
      throw VideoStudioException(
        "The narration is longer than the generated video (${narrationDurationMs}ms > ${videoDurationMs}ms). Shorten the script or generate a longer clip.",
      )
    }

    var captionCursorMs = 0L
    val captions = options.captions.mapIndexed { index, caption ->
      val text = caption.text.trim()
      if (text.isEmpty()) throw VideoStudioException("Caption $index is empty.")
      if (text.length > MAX_CAPTION_CHARS) {
        throw VideoStudioException("Caption $index exceeds $MAX_CAPTION_CHARS characters.")
      }
      if (caption.startMs < 0L || caption.endMs <= caption.startMs) {
        throw VideoStudioException("Caption $index has an invalid time range.")
      }
      if (caption.startMs < captionCursorMs) {
        throw VideoStudioException("Captions overlap or are out of order at index $index.")
      }
      if (caption.endMs > videoDurationMs) {
        throw VideoStudioException("Caption $index ends after the video.")
      }
      captionCursorMs = caption.endMs
      ValidatedCaption(
        startUs = msToUs(caption.startMs),
        endUs = msToUs(caption.endMs),
        styledText = styledCaption(text),
      )
    }

    val exportDir = File(context().cacheDir, "video-studio/exports")
    if (!exportDir.mkdirs() && !exportDir.isDirectory) {
      throw VideoStudioException("Could not create app-owned video export storage.")
    }
    val outputFile = File(exportDir, "${safeOutputBaseName(options.outputName)}-${UUID.randomUUID()}.mp4")
    return PreparedExport(videoFile, videoDurationMs, audioSegments, captions, outputFile)
  }

  private fun createCaptionOverlay(captions: List<ValidatedCaption>): TextOverlay {
    val blank = SpannableString(" ").apply {
      setSpan(ForegroundColorSpan(Color.TRANSPARENT), 0, length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    val settings = StaticOverlaySettings.Builder()
      .setOverlayFrameAnchor(0f, -1f)
      .setBackgroundFrameAnchor(0f, -0.82f)
      .build()
    return object : TextOverlay() {
      override fun getText(presentationTimeUs: Long): SpannableString =
        captions.firstOrNull { presentationTimeUs >= it.startUs && presentationTimeUs < it.endUs }
          ?.styledText
          ?: blank

      override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings = settings
    }
  }

  private fun styledCaption(text: String): SpannableString {
    val wrapped = wrapCaption(text)
    return SpannableString(wrapped).apply {
      val flags = Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
      setSpan(ForegroundColorSpan(Color.WHITE), 0, length, flags)
      setSpan(BackgroundColorSpan(Color.argb(190, 0, 0, 0)), 0, length, flags)
      setSpan(StyleSpan(Typeface.BOLD), 0, length, flags)
      setSpan(RelativeSizeSpan(0.55f), 0, length, flags)
      setSpan(AlignmentSpan.Standard(Layout.Alignment.ALIGN_CENTER), 0, length, flags)
    }
  }

  private fun wrapCaption(text: String, targetLineChars: Int = 34): String {
    val words = text.split(Regex("\\s+")).filter { it.isNotBlank() }
    if (words.isEmpty()) return ""
    val lines = mutableListOf<String>()
    val current = StringBuilder()
    for (word in words) {
      if (current.isNotEmpty() && current.length + 1 + word.length > targetLineChars) {
        lines += current.toString()
        current.clear()
      }
      if (current.isNotEmpty()) current.append(' ')
      current.append(word)
    }
    if (current.isNotEmpty()) lines += current.toString()
    return lines.joinToString("\n")
  }

  private fun safeOutputBaseName(requested: String): String {
    val raw = requested.trim().removeSuffix(".mp4")
    val sanitized = raw
      .replace(Regex("[^A-Za-z0-9._-]+"), "-")
      .trim('-', '.', '_')
      .take(MAX_OUTPUT_NAME_CHARS)
    return sanitized.ifEmpty { "saient-video" }
  }

  private fun requireOwnedLocalFile(uriString: String, label: String): File {
    val uri = Uri.parse(uriString)
    if (!uri.scheme.equals("file", ignoreCase = true)) {
      throw VideoStudioException("$label must be an app-owned local file URI.")
    }
    val path = uri.path ?: throw VideoStudioException("$label URI has no file path.")
    val file = try {
      File(path).canonicalFile
    } catch (error: Exception) {
      throw VideoStudioException("Could not resolve $label path.", error)
    }
    val roots = listOfNotNull(
      context().filesDir,
      context().cacheDir,
      context().externalCacheDir,
      context().getExternalFilesDir(null),
    ).map { it.canonicalFile }
    val owned = roots.any { root ->
      file.path == root.path || file.path.startsWith(root.path + File.separator)
    }
    if (!owned) throw VideoStudioException("$label is outside app-owned storage.")
    if (!file.isFile || !file.canRead()) throw VideoStudioException("$label file is missing or unreadable.")
    return file
  }

  private fun mediaDurationMs(file: File): Long {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.absolutePath)
      val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
        ?.toLongOrNull()
        ?: throw VideoStudioException("Could not read media duration for ${file.name}.")
      if (duration <= 0L) throw VideoStudioException("Media duration is invalid for ${file.name}.")
      return duration
    } finally {
      retriever.release()
    }
  }

  private fun msToUs(valueMs: Long): Long {
    if (valueMs < 0L || valueMs > Long.MAX_VALUE / 1_000L) {
      throw VideoStudioException("Media timestamp is outside the supported range.")
    }
    return valueMs * 1_000L
  }

  private fun safeAddMs(startMs: Long, durationMs: Long, label: String): Long {
    if (durationMs > Long.MAX_VALUE - startMs) {
      throw VideoStudioException("$label timing exceeds the supported range.")
    }
    return startMs + durationMs
  }

  private fun reserveSynthesis() {
    synchronized(synthesisLock) {
      if (synthesisReserved) {
        throw VideoStudioException("Another speech synthesis is already running.")
      }
      synthesisReserved = true
      cancellationRequested = false
    }
  }

  private fun cancelActiveSynthesis(releaseImmediately: Boolean = false): Boolean {
    val tts: TextToSpeech?
    val completion: CompletableDeferred<Unit>?
    val file: File?
    synchronized(synthesisLock) {
      if (!synthesisReserved) return false
      cancellationRequested = true
      tts = activeTts
      completion = activeCompletion
      file = activeFile
    }
    tts?.stop()
    completion?.completeExceptionally(VideoStudioException("Speech synthesis cancelled."))
    file?.parentFile?.deleteRecursively()
    if (releaseImmediately) tts?.shutdown()
    return true
  }

  private fun reserveExport() {
    synchronized(exportLock) {
      if (exportReserved) throw VideoStudioException("Another video export is already running.")
      exportReserved = true
    }
  }

  private fun cancelActiveExport(): Boolean {
    val transformer: Transformer?
    val completion: CompletableDeferred<Unit>?
    val output: File?
    synchronized(exportLock) {
      if (!exportReserved) return false
      transformer = activeTransformer
      completion = activeExportCompletion
      output = activeExportFile
    }
    transformer?.cancel()
    completion?.completeExceptionally(VideoStudioException("Video export cancelled."))
    output?.delete()
    return true
  }
}
