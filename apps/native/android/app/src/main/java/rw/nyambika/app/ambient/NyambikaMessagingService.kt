package rw.nyambika.app.ambient

import com.capacitorjs.plugins.pushnotifications.MessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import rw.nyambika.app.widget.TodayWidget

/**
 * Replaces the push plugin's service (see AndroidManifest `tools:node="remove"`), keeps its behaviour
 * (tokens + events to the web app) and adds the ambient part: FCM data messages carrying an order
 * state update the ongoing Live Update and the widget, even when the app is closed.
 * Payload shape: apps/api/src/common/push/providers.ts → fcmMessage().
 */
class NyambikaMessagingService : MessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        val data = remoteMessage.data
        val order = data["order"] ?: return
        val state = data["state"] ?: return
        try {
            val info = OrderInfo.from(JSONObject(order))
            val progress = OrderProgress.from(JSONObject(state))
            OrderNotifier.show(this, info, progress, alert = data["alert"] == "1")
            WidgetOrderStore.save(this, WidgetOrderStore.Snapshot(info, progress))
            TodayWidget.refresh(this)
        } catch (_: Exception) {
            // Malformed payloads are ignored; the web timeline stays the source of truth.
        }
    }
}
