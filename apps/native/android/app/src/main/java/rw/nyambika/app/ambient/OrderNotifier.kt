package rw.nyambika.app.ambient

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import rw.nyambika.app.MainActivity
import rw.nyambika.app.R

/**
 * The Android side of the ambient moment: one ongoing notification per order that updates in place.
 * On Android 16+ it is a promoted **Live Update** (ProgressStyle with four segments, status chip);
 * older versions get a standard ongoing notification with a progress bar.
 */
object OrderNotifier {
    const val CHANNEL_ORDERS = "orders"
    const val CHANNEL_GENERAL = "general"

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ORDERS, ctx.getString(R.string.channel_orders), NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = ctx.getString(R.string.channel_orders_desc)
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CHANNEL_GENERAL, ctx.getString(R.string.channel_general), NotificationManager.IMPORTANCE_HIGH))
    }

    private fun notificationId(orderId: String) = 0x4E59 xor orderId.hashCode()

    private fun openOrder(ctx: Context, orderId: String): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nyambika://orders/$orderId"), ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(ctx, orderId.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** Show or update the order's ongoing notification; `alert` re-alerts (paid / on the way / delivered). */
    fun show(ctx: Context, info: OrderInfo, state: OrderProgress, alert: Boolean) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannels(ctx)
        val id = notificationId(info.orderId)
        val nm = NotificationManagerCompat.from(ctx)
        if (state.phase == "AWAITING_PAYMENT") return

        val notification = if (Build.VERSION.SDK_INT >= 36) liveUpdate(ctx, info, state, alert) else compat(ctx, info, state, alert)
        try {
            nm.notify(id, notification)
        } catch (_: SecurityException) {
            // Permission revoked between the check and the call.
        }
    }

    fun end(ctx: Context, orderId: String) {
        NotificationManagerCompat.from(ctx).cancel(notificationId(orderId))
    }

    private fun compat(ctx: Context, info: OrderInfo, s: OrderProgress, alert: Boolean): Notification =
        NotificationCompat.Builder(ctx, CHANNEL_ORDERS)
            .setSmallIcon(R.drawable.ic_stat_nyambika)
            .setColor(0xFFF2B84B.toInt())
            .setContentTitle(s.headline)
            .setContentText(listOf(info.code, s.detail).filter { it.isNotBlank() }.joinToString(" · "))
            .setSubText(s.stepLabels.getOrNull(s.stepIndex))
            .setProgress(100, (s.progress * 100).toInt(), false)
            .setOngoing(!s.finished)
            .setAutoCancel(s.finished)
            .setOnlyAlertOnce(!alert)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(openOrder(ctx, info.orderId))
            .setTimeoutAfter(if (s.finished) 4 * 3600_000L else 0L)
            .build()

    /** Android 16 Live Update: four equal segments (Paid · Making/Cutting · On the way/Sewing · Delivery). */
    @Suppress("NewApi")
    private fun liveUpdate(ctx: Context, info: OrderInfo, s: OrderProgress, alert: Boolean): Notification {
        val segments = List(4) { i ->
            Notification.ProgressStyle.Segment(25).setColor(if (i <= s.stepIndex) 0xFF34D399.toInt() else 0x33FFFFFF)
        }
        val points = (1..3).map { Notification.ProgressStyle.Point(it * 25).setColor(0xFFF2B84B.toInt()) }
        val style = Notification.ProgressStyle()
            .setStyledByProgress(false)
            .setProgressSegments(segments)
            .setProgressPoints(points)
            .setProgress((s.progress * 100).toInt())
        return Notification.Builder(ctx, CHANNEL_ORDERS)
            .setSmallIcon(R.drawable.ic_stat_nyambika)
            .setContentTitle(s.headline)
            .setContentText(listOf(info.code, s.detail).filter { it.isNotBlank() }.joinToString(" · "))
            .setStyle(style)
            .setOngoing(!s.finished)
            .setAutoCancel(s.finished)
            .setOnlyAlertOnce(!alert)
            .setRequestPromotedOngoing(!s.finished)
            .setShortCriticalText(s.stepLabels.getOrNull(s.stepIndex) ?: "")
            .setContentIntent(openOrder(ctx, info.orderId))
            .setTimeoutAfter(if (s.finished) 4 * 3600_000L else 0L)
            .build()
    }
}
