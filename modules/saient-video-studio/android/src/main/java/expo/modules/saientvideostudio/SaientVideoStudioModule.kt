package expo.modules.saientvideostudio

import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

private const val DEFAULT_LOCALE = "pt-BR"
private const val MIN_SPEECH_RATE = 0.5
private const val MAX_SPEECH_RATE = 2.0

private class VideoStudioException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

class SpeechSynthesisOptions : Record {
  @Field var text: String = ""
  @Field var locale: String = DEFAULT_LOCALE
  @Field var voiceName: String? = null
  @Field var speechRate: Double = 1.0
}

class SaientVideoStudioModule : Module() {
  private val synthesisLock = Any()
  @Volatile private var synthesisReserved = false
  @Volatile private var cancellationRequested = false
  @Volatile private var activeTts: TextToSpeech? = null
  @Volatile private var activeCompletion: CompletableDeferred<Unit>? = null
  @Volatile private var activeFile: File? = null

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

    OnDestroy {
      cancelActiveSynthesis(releaseImmediately = true)
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
    val locale = Locale.forLanguageTag(localeTag)
    val effective = if (locale.language.isBlank()) Locale.forLanguageTag(normalized) else locale
    if (effective.language.isBlank()) {
      throw VideoStudioException("Invalid TTS locale: $localeTag")
    }
    return effective
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

  private fun mediaDurationMs(file: File): Long {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.absolutePath)
      val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
        ?.toLongOrNull()
        ?: throw VideoStudioException("Could not read synthesized audio duration.")
      if (duration <= 0L) throw VideoStudioException("Synthesized audio duration is invalid.")
      return duration
    } finally {
      retriever.release()
    }
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
}
