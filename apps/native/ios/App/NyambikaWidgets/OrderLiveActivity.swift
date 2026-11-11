import ActivityKit
import SwiftUI
import WidgetKit

/// Lock-screen Live Activity + Dynamic Island for an order in progress (prototype v2 · 17).
/// "Uwase is sewing your dress · Live activity · sewing · ready Thursday", Paid · Cutting · Sewing · Delivery.
struct OrderLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: OrderActivityAttributes.self) { context in
            OrderLockScreenView(info: context.attributes, state: context.state, stale: context.isStale)
                .activityBackgroundTint(Brand.ink.opacity(0.92))
                .activitySystemActionForegroundColor(Brand.txt)
                .widgetURL(Brand.orderURL(context.attributes.orderId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    SpoolBadge(size: 40)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.code)
                        .font(.caption2.monospaced())
                        .foregroundStyle(Brand.mut)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.headline)
                        .font(.system(.subheadline, design: .rounded).weight(.heavy))
                        .lineLimit(2)
                        .foregroundStyle(Brand.txt)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    StepsBar(state: context.state)
                }
            } compactLeading: {
                Text("🧵")
            } compactTrailing: {
                ProgressView(value: context.state.progress)
                    .progressViewStyle(.circular)
                    .tint(Brand.gold)
                    .frame(width: 18, height: 18)
            } minimal: {
                ProgressView(value: context.state.progress)
                    .progressViewStyle(.circular)
                    .tint(Brand.gold)
            }
            .widgetURL(Brand.orderURL(context.attributes.orderId))
            .keylineTint(Brand.gold)
        }
    }
}

struct OrderLockScreenView: View {
    let info: OrderActivityAttributes
    let state: OrderProgressState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                SpoolBadge(size: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.headline)
                        .font(.system(.headline, design: .rounded).weight(.black))
                        .foregroundStyle(Brand.txt)
                        .lineLimit(2)
                    Text(stale ? info.code : ["Live activity", state.detail].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.subheadline)
                        .foregroundStyle(Brand.mut)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            if state.stepIndex >= 0 && state.phase != "STOPPED" {
                StepsBar(state: state)
            }
        }
        .padding(16)
        .accessibilityElement(children: .combine)
    }
}

struct StepsBar: View {
    let state: OrderProgressState

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                ForEach(Array(state.stepLabels.enumerated()), id: \.offset) { i, label in
                    Text(label)
                        .font(.caption)
                        .fontWeight(i <= state.stepIndex ? .semibold : .regular)
                        .foregroundStyle(i <= state.stepIndex ? Brand.txt : Brand.mut)
                        .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : i == state.stepLabels.count - 1 ? .trailing : .center)
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.15))
                    Capsule()
                        .fill(LinearGradient(colors: [Brand.mint, Brand.gold], startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(8, geo.size.width * state.progress))
                }
            }
            .frame(height: 8)
        }
    }
}

struct SpoolBadge: View {
    let size: CGFloat
    var body: some View {
        Text("🧵")
            .font(.system(size: size * 0.5))
            .frame(width: size, height: size)
            .background(LinearGradient(colors: [Brand.terra, Brand.violet], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    }
}

enum Brand {
    static let ink = Color(red: 0.043, green: 0.039, blue: 0.059)
    static let txt = Color(red: 0.961, green: 0.937, blue: 0.910)
    static let mut = Color(red: 0.655, green: 0.620, blue: 0.588)
    static let gold = Color(red: 0.949, green: 0.722, blue: 0.294)
    static let mint = Color(red: 0.204, green: 0.827, blue: 0.600)
    static let terra = Color(red: 0.878, green: 0.439, blue: 0.247)
    static let violet = Color(red: 0.545, green: 0.361, blue: 0.965)

    static func orderURL(_ id: String) -> URL? { URL(string: "nyambika://orders/\(id)") }
}
