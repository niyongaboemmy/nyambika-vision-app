package rw.nyambika.app.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import rw.nyambika.app.MainActivity
import rw.nyambika.app.ambient.WidgetOrderStore

private val Ink = Color(0xFF0B0A0F)
private val Txt = Color(0xFFF5EFE8)
private val Mut = Color(0xFFA79E96)
private val Gold = Color(0xFFF2B84B)

/** Home-screen widget (Jetpack Glance): the order on its way, or "Today's look" when nothing is. */
class TodayWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snap = WidgetOrderStore.load(context)
        provideContent {
            GlanceTheme {
                Content(snap)
            }
        }
    }

    @Composable
    private fun Content(snap: WidgetOrderStore.Snapshot?) {
        val uri = snap?.let { "nyambika://orders/${it.info.orderId}" } ?: "nyambika://looks/try"
        val open = actionStartActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setClassName("rw.nyambika.app", MainActivity::class.java.name))
        Column(
            modifier = GlanceModifier.fillMaxSize().background(ColorProvider(Ink)).cornerRadius(24.dp).padding(14.dp).clickable(open),
            verticalAlignment = Alignment.Top,
        ) {
            if (snap != null) {
                Text("🧵", style = TextStyle(fontSize = 20.sp))
                Spacer(GlanceModifier.height(6.dp))
                Text(snap.state.headline, maxLines = 3, style = TextStyle(color = ColorProvider(Txt), fontWeight = FontWeight.Bold, fontSize = 14.sp))
                Text(snap.state.detail, maxLines = 1, style = TextStyle(color = ColorProvider(Mut), fontSize = 12.sp))
                Spacer(GlanceModifier.height(8.dp))
                LinearProgressIndicator(
                    progress = snap.state.progress.toFloat(),
                    modifier = GlanceModifier.fillMaxWidth().height(6.dp),
                    color = ColorProvider(Gold),
                    backgroundColor = ColorProvider(Color(0x26FFFFFF)),
                )
                Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 4.dp)) {
                    Text(snap.state.stepLabels.getOrNull(snap.state.stepIndex) ?: "", style = TextStyle(color = ColorProvider(Txt), fontSize = 11.sp))
                }
            } else {
                Text("✨", style = TextStyle(fontSize = 22.sp))
                Spacer(GlanceModifier.height(6.dp))
                Text("Today's look", style = TextStyle(color = ColorProvider(Txt), fontWeight = FontWeight.Bold, fontSize = 16.sp))
                Text("Ask the Muse: Rwandan makers, on your twin.", maxLines = 2, style = TextStyle(color = ColorProvider(Mut), fontSize = 12.sp))
            }
        }
    }

    companion object {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        fun refresh(context: Context) {
            val app = context.applicationContext
            scope.launch {
                if (GlanceAppWidgetManager(app).getGlanceIds(TodayWidget::class.java).isNotEmpty()) TodayWidget().updateAll(app)
            }
        }
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}
