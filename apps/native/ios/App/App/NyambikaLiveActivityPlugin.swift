import Capacitor
import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// `NyambikaLiveActivity` Capacitor plugin (E38): starts/updates/ends the order Live Activity from the
/// web app (lib/native.ts, components/ambient-order.tsx), reports ActivityKit push tokens so the API can
/// update the activity over APNs while the app is closed, and mirrors the order to the widget.
@objc(NyambikaLiveActivityPlugin)
public class NyambikaLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NyambikaLiveActivityPlugin"
    public let jsName = "NyambikaLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidgetOrder", returnType: CAPPluginReturnPromise),
    ]

    private var observers: [String: Task<Void, Never>] = [:]

    override public func load() {
        #if canImport(ActivityKit)
        if #available(iOS 17.2, *) {
            // iOS 17.2+: the server can start the activity itself when payment lands (push-to-start).
            observers["__start"] = Task { [weak self] in
                for await data in Activity<OrderActivityAttributes>.pushToStartTokenUpdates {
                    self?.notifyListeners("pushToStartToken", data: ["token": Self.hex(data)], retainUntilConsumed: true)
                }
            }
        }
        if #available(iOS 16.2, *) {
            // Activities started by push-to-start (or before a relaunch) still need their update tokens reported.
            for activity in Activity<OrderActivityAttributes>.activities { observe(activity) }
            observers["__new"] = Task { [weak self] in
                for await activity in Activity<OrderActivityAttributes>.activityUpdates { self?.observe(activity) }
            }
        }
        #endif
    }

    deinit { observers.values.forEach { $0.cancel() } }

    static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

    static func decode<T: Decodable>(_ type: T.Type, _ object: JSObject?) throws -> T {
        guard let object else { throw NSError(domain: "NyambikaLiveActivity", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing payload"]) }
        let data = try JSONSerialization.data(withJSONObject: object)
        return try JSONDecoder().decode(T.self, from: data)
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            var pushToStart = false
            if #available(iOS 17.2, *) { pushToStart = true }
            call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled, "pushToStart": pushToStart])
            return
        }
        #endif
        call.resolve(["supported": false, "pushToStart": false])
    }

    @objc func start(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return call.resolve(["activityId": ""]) }
        do {
            let info = try Self.decode(OrderInfo.self, call.getObject("attributes"))
            let state = try Self.decode(OrderProgressState.self, call.getObject("state"))
            // Idempotent per order: the web app calls start on every render of an active order.
            if let existing = Activity<OrderActivityAttributes>.activities.first(where: { $0.attributes.orderId == info.orderId }) {
                Task { await existing.update(ActivityContent(state: state, staleDate: Self.stale(state))) }
                return call.resolve(["activityId": existing.id])
            }
            guard ActivityAuthorizationInfo().areActivitiesEnabled, !state.isFinished else { return call.resolve(["activityId": ""]) }
            let activity = try Activity.request(
                attributes: OrderActivityAttributes(info),
                content: ActivityContent(state: state, staleDate: Self.stale(state)),
                pushType: .token
            )
            observe(activity)
            call.resolve(["activityId": activity.id])
        } catch {
            call.reject("Could not start the live activity", nil, error)
        }
        #else
        call.resolve(["activityId": ""])
        #endif
    }

    @objc func update(_ call: CAPPluginCall) {
        apply(call, end: false)
    }

    @objc func end(_ call: CAPPluginCall) {
        apply(call, end: true)
    }

    @objc func setWidgetOrder(_ call: CAPPluginCall) {
        if call.getBool("clear") == true {
            WidgetOrderStore.save(nil)
            return call.resolve()
        }
        do {
            let info = try Self.decode(OrderInfo.self, call.getObject("attributes"))
            let state = try Self.decode(OrderProgressState.self, call.getObject("state"))
            WidgetOrderStore.save(.init(info: info, state: state))
            call.resolve()
        } catch {
            call.reject("Bad widget payload", nil, error)
        }
    }

    private func apply(_ call: CAPPluginCall, end: Bool) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return call.resolve() }
        guard let orderId = call.getString("orderId") else { return call.reject("orderId is required") }
        do {
            let state = try Self.decode(OrderProgressState.self, call.getObject("state"))
            let matches = Activity<OrderActivityAttributes>.activities.filter { $0.attributes.orderId == orderId }
            Task {
                for activity in matches {
                    let content = ActivityContent(state: state, staleDate: Self.stale(state))
                    if end || state.isFinished {
                        await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(4 * 3600)))
                    } else {
                        await activity.update(content)
                    }
                }
            }
            call.resolve()
        } catch {
            call.reject("Bad live activity payload", nil, error)
        }
        #else
        call.resolve()
        #endif
    }

    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    private func observe(_ activity: Activity<OrderActivityAttributes>) {
        let orderId = activity.attributes.orderId
        guard observers[activity.id] == nil else { return }
        observers[activity.id] = Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                self?.notifyListeners("activityToken", data: ["orderId": orderId, "token": Self.hex(token)], retainUntilConsumed: true)
            }
        }
    }

    static func stale(_ s: OrderProgressState) -> Date? {
        // If no update arrives for a day the system greys the activity out instead of showing stale progress.
        Date().addingTimeInterval(24 * 3600)
    }
    #endif
}
