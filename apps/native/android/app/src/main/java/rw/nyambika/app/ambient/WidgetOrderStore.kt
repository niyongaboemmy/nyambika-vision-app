package rw.nyambika.app.ambient

import android.content.Context
import org.json.JSONObject

/** Latest order for the home-screen widget. Only status text, never a twin or look image (OP-5). */
object WidgetOrderStore {
    private const val PREFS = "nyambika_widget"
    private const val KEY = "order.v1"

    data class Snapshot(val info: OrderInfo, val state: OrderProgress)

    fun load(ctx: Context): Snapshot? {
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
        return try {
            val o = JSONObject(raw)
            val snap = Snapshot(OrderInfo.from(o.getJSONObject("info")), OrderProgress.from(o.getJSONObject("state")))
            // Finished orders linger a day, then the widget shows "Today's look".
            if (snap.state.finished && System.currentTimeMillis() / 1000 - snap.state.updatedAt > 86_400) null else snap
        } catch (_: Exception) {
            null
        }
    }

    fun save(ctx: Context, snap: Snapshot?) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        if (snap == null) prefs.remove(KEY) else prefs.putString(KEY, JSONObject().put("info", snap.info.toJson()).put("state", snap.state.toJson()).toString())
        prefs.apply()
    }
}
