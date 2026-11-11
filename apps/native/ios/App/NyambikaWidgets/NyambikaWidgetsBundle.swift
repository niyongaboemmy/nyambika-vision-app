import SwiftUI
import WidgetKit

/// Widget extension entry point (target `NyambikaWidgets`, bundle id rw.nyambika.app.widgets, iOS 17+).
@main
struct NyambikaWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        OrderLiveActivity()
    }
}
