import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Wire model shared by the app (plugin) and the widget extension.
///
/// Mirrors `LiveActivityContentState` / `LiveActivityAttributes` in `packages/contracts/src/ambient.ts`
/// field for field. The API sends `content-state` in exactly this shape over APNs (push type
/// `liveactivity`), already localised (RW/EN/FR), so no order logic lives on the device.
public struct OrderProgressState: Codable, Hashable {
    public var status: String
    /// AWAITING_PAYMENT | ACTIVE | DONE | STOPPED
    public var phase: String
    /// -1 before payment, then 0...3
    public var stepIndex: Int
    /// 0...1
    public var progress: Double
    public var headline: String
    public var detail: String
    /// Always four labels, e.g. Paid · Cutting · Sewing · Delivery
    public var stepLabels: [String]
    /// UNIX seconds
    public var readyBy: Int?
    /// UNIX seconds
    public var updatedAt: Int

    public var isFinished: Bool { phase == "DONE" || phase == "STOPPED" }
}

public struct OrderInfo: Codable, Hashable {
    public var orderId: String
    public var code: String
    public var makerName: String
    public var itemTitle: String
}

#if canImport(ActivityKit)
@available(iOS 16.2, *)
public struct OrderActivityAttributes: ActivityAttributes {
    public typealias ContentState = OrderProgressState

    public var orderId: String
    public var code: String
    public var makerName: String
    public var itemTitle: String

    public init(_ info: OrderInfo) {
        orderId = info.orderId
        code = info.code
        makerName = info.makerName
        itemTitle = info.itemTitle
    }
}
#endif
