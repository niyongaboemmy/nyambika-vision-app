import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// The latest order the home-screen widget shows, kept in the shared App Group.
/// Only order status text lives here: no twin, look image or measurement ever leaves the app (OP-5).
public enum WidgetOrderStore {
    public static let appGroup = "group.rw.nyambika.app"
    static let key = "nyambika.widget.order.v1"

    public struct Snapshot: Codable, Hashable {
        public var info: OrderInfo
        public var state: OrderProgressState
    }

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    public static func load() -> Snapshot? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        guard let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else { return nil }
        // A finished order lingers for a day, then the widget falls back to "Today's look".
        if snap.state.isFinished, Date().timeIntervalSince1970 - Double(snap.state.updatedAt) > 86_400 { return nil }
        return snap
    }

    public static func save(_ snap: Snapshot?) {
        if let snap, let data = try? JSONEncoder().encode(snap) {
            defaults?.set(data, forKey: key)
        } else {
            defaults?.removeObject(forKey: key)
        }
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
