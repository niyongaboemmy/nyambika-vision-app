import SwiftUI
import WidgetKit

/// Home-screen / lock-screen widget: the order in progress, or "Today's look" when nothing is on the way.
/// Reads only the order status the app wrote to the App Group (WidgetOrderStore); never a twin or look image.
struct TodayEntry: TimelineEntry {
    let date: Date
    let order: WidgetOrderStore.Snapshot?
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), order: .init(
            info: OrderInfo(orderId: "preview", code: "NY-3F9A21", makerName: "Uwase Couture", itemTitle: "dress"),
            state: OrderProgressState(status: "IN_PREPARATION", phase: "ACTIVE", stepIndex: 2, progress: 0.55,
                                      headline: "Uwase Couture is sewing your dress", detail: "sewing · ready Thursday",
                                      stepLabels: ["Paid", "Cutting", "Sewing", "Delivery"], readyBy: nil, updatedAt: 0)))
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : TodayEntry(date: Date(), order: WidgetOrderStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        // Pushes reload the timeline immediately; the hourly refresh only ages out finished orders.
        let entry = TodayEntry(date: Date(), order: WidgetOrderStore.load())
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    var body: some View {
        Group {
            if let order = entry.order {
                switch family {
                case .accessoryRectangular:
                    VStack(alignment: .leading, spacing: 2) {
                        Text(order.state.headline).font(.headline).lineLimit(1)
                        ProgressView(value: order.state.progress)
                        Text(order.state.detail).font(.caption2).lineLimit(1)
                    }
                case .systemSmall:
                    VStack(alignment: .leading, spacing: 8) {
                        SpoolBadge(size: 32)
                        Text(order.state.headline)
                            .font(.system(.footnote, design: .rounded).weight(.heavy))
                            .foregroundStyle(Brand.txt)
                            .lineLimit(3)
                        Spacer(minLength: 0)
                        ProgressView(value: order.state.progress).tint(Brand.gold)
                    }
                default:
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 10) {
                            SpoolBadge(size: 36)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(order.state.headline)
                                    .font(.system(.subheadline, design: .rounded).weight(.heavy))
                                    .foregroundStyle(Brand.txt)
                                    .lineLimit(2)
                                Text(order.state.detail).font(.caption).foregroundStyle(Brand.mut).lineLimit(1)
                            }
                        }
                        StepsBar(state: order.state)
                    }
                }
            } else {
                TodaysLookPrompt(compact: family != .systemMedium)
            }
        }
        .widgetURL(URL(string: entry.order.map { "nyambika://orders/\($0.info.orderId)" } ?? "nyambika://looks/try"))
        .containerBackground(for: .widget) {
            LinearGradient(colors: [Brand.ink, Color(red: 0.18, green: 0.10, blue: 0.22)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
}

/// No order on the way: invite a look for today (opens the Muse; the look renders privately in the app).
struct TodaysLookPrompt: View {
    let compact: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("✨").font(.title2)
            Text("Today's look")
                .font(.system(.headline, design: .rounded).weight(.black))
                .foregroundStyle(Brand.txt)
            if !compact {
                Text("Ask the Muse: Rwandan makers, on your twin.")
                    .font(.caption)
                    .foregroundStyle(Brand.mut)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "rw.nyambika.today", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Nyambika")
        .description("Your order on the way, or today's look.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}
