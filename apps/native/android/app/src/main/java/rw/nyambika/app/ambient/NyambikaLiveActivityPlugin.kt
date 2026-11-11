package rw.nyambika.app.ambient

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import rw.nyambika.app.widget.TodayWidget

/**
 * Same JS contract as the iOS `NyambikaLiveActivity` plugin (lib/native.ts): on Android "start" and
 * "update" drive the ongoing Live Update notification and the widget; there are no push tokens to report
 * because FCM data messages update it directly (NyambikaMessagingService).
 */
@CapacitorPlugin(name = "NyambikaLiveActivity")
class NyambikaLiveActivityPlugin : Plugin() {

    private fun payload(call: PluginCall): Pair<OrderInfo, OrderProgress>? {
        val attrs = call.getObject("attributes") ?: return null
        val state = call.getObject("state") ?: return null
        return OrderInfo.from(JSONObject(attrs.toString())) to OrderProgress.from(JSONObject(state.toString()))
    }

    @PluginMethod
    fun isSupported(call: PluginCall) {
        call.resolve(JSObject().put("supported", true).put("pushToStart", false))
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val (info, state) = payload(call) ?: return call.reject("attributes and state are required")
        OrderNotifier.show(context, info, state, alert = false)
        call.resolve(JSObject().put("activityId", info.orderId))
    }

    @PluginMethod
    fun update(call: PluginCall) {
        val orderId = call.getString("orderId") ?: return call.reject("orderId is required")
        val state = call.getObject("state") ?: return call.reject("state is required")
        val snap = WidgetOrderStore.load(context)
        val info = snap?.info?.takeIf { it.orderId == orderId } ?: OrderInfo(orderId, "", "", "")
        OrderNotifier.show(context, info, OrderProgress.from(JSONObject(state.toString())), alert = false)
        call.resolve()
    }

    @PluginMethod
    fun end(call: PluginCall) {
        val orderId = call.getString("orderId") ?: return call.reject("orderId is required")
        OrderNotifier.end(context, orderId)
        call.resolve()
    }

    @PluginMethod
    fun setWidgetOrder(call: PluginCall) {
        if (call.getBoolean("clear", false) == true) {
            WidgetOrderStore.save(context, null)
        } else {
            val (info, state) = payload(call) ?: return call.reject("attributes and state are required")
            WidgetOrderStore.save(context, WidgetOrderStore.Snapshot(info, state))
        }
        TodayWidget.refresh(context)
        call.resolve()
    }
}
