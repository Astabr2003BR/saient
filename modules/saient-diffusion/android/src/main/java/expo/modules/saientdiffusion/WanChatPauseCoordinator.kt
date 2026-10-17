package expo.modules.saientdiffusion

import android.content.Context
import java.io.File

/**
 * Owns the shared Quartz chat pause marker while a long-lived Wan runtime is resident.
 *
 * The marker may already have been created by another owner. In that case this
 * coordinator waits for Quartz to stop, but never deletes a marker it did not create.
 */
class WanChatPauseCoordinator(
  private val context: Context,
  private val waitForChatEngineToStop: () -> Boolean,
) {
  private val lock = Any()
  private var leaseCount = 0
  private var createdMarker = false

  private fun pauseMarker(): File = File(context.filesDir, "models/.paused")

  fun acquire() {
    synchronized(lock) {
      if (leaseCount > 0) {
        leaseCount += 1
        return
      }

      val marker = pauseMarker()
      createdMarker = false
      if (!marker.exists()) {
        marker.parentFile?.mkdirs()
        marker.writeText("1")
        createdMarker = true
      }

      if (!waitForChatEngineToStop()) {
        if (createdMarker) marker.delete()
        createdMarker = false
        throw IllegalStateException("Quartz could not unload the chat model for Wan Fast Engine.")
      }

      leaseCount = 1
    }
  }

  fun release() {
    synchronized(lock) {
      if (leaseCount <= 0) return
      leaseCount -= 1
      if (leaseCount > 0) return

      val marker = pauseMarker()
      if (createdMarker) {
        marker.delete()
      }
      createdMarker = false
    }
  }

  fun forceReleaseAll() {
    synchronized(lock) {
      leaseCount = 0
      val marker = pauseMarker()
      if (createdMarker) {
        marker.delete()
      }
      createdMarker = false
    }
  }
}
