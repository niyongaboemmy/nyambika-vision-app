package rw.nyambika.app.ambient

import org.json.JSONArray
import org.json.JSONObject

/**
 * Mirrors `LiveActivityContentState` / `LiveActivityAttributes` in packages/contracts/src/ambient.ts
 * (and `OrderProgressState` / `OrderInfo` in Swift). The API sends it already localised (RW/EN/FR).
 */
data class OrderInfo(val orderId: String, val code: String, val makerName: String, val itemTitle: String) {
    fun toJson(): JSONObject = JSONObject()
        .put("orderId", orderId).put("code", code).put("makerName", makerName).put("itemTitle", itemTitle)

    companion object {
        fun from(o: JSONObject) = OrderInfo(
            orderId = o.getString("orderId"),
            code = o.optString("code"),
            makerName = o.optString("makerName"),
            itemTitle = o.optString("itemTitle"),
        )
    }
}

data class OrderProgress(
    val status: String,
    /** AWAITING_PAYMENT | ACTIVE | DONE | STOPPED */
    val phase: String,
    val stepIndex: Int,
    val progress: Double,
    val headline: String,
    val detail: String,
    val stepLabels: List<String>,
    /** UNIX seconds */
    val readyBy: Long?,
    /** UNIX seconds */
    val updatedAt: Long,
) {
    val finished: Boolean get() = phase == "DONE" || phase == "STOPPED"

    fun toJson(): JSONObject = JSONObject()
        .put("status", status).put("phase", phase).put("stepIndex", stepIndex).put("progress", progress)
        .put("headline", headline).put("detail", detail).put("stepLabels", JSONArray(stepLabels))
        .put("readyBy", readyBy ?: JSONObject.NULL).put("updatedAt", updatedAt)

    companion object {
        fun from(o: JSONObject): OrderProgress {
            val labels = o.optJSONArray("stepLabels") ?: JSONArray()
            return OrderProgress(
                status = o.optString("status"),
                phase = o.optString("phase", "ACTIVE"),
                stepIndex = o.optInt("stepIndex", 0),
                progress = o.optDouble("progress", 0.0).coerceIn(0.0, 1.0),
                headline = o.optString("headline"),
                detail = o.optString("detail"),
                stepLabels = (0 until labels.length()).map { labels.optString(it) },
                readyBy = if (o.isNull("readyBy")) null else o.optLong("readyBy"),
                updatedAt = o.optLong("updatedAt"),
            )
        }
    }
}
