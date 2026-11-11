// Signature stub of the parts of Capacitor 8.5.3 the app sources use (copied from
// node_modules/@capacitor/ios/Capacitor/Capacitor/*.{h,swift}). Lets `scripts/swift-check.sh`
// typecheck the app's Swift on a machine where xcodebuild/SPM cannot run. Not shipped.
import Foundation
import UIKit

public typealias JSObject = [String: Any]
public typealias PluginCallResultData = [String: Any]
public let CAPPluginReturnPromise = "promise"

open class CAPPluginMethod: NSObject {
    public init(name: String, returnType: String) {}
}

public protocol CAPBridgedPlugin: NSObjectProtocol {
    var identifier: String { get }
    var jsName: String { get }
    var pluginMethods: [CAPPluginMethod] { get }
}

open class CAPPluginCall: NSObject {
    public func getObject(_ key: String) -> JSObject? { nil }
    public func getString(_ key: String) -> String? { nil }
    public func getBool(_ key: String) -> Bool? { nil }
    public func resolve() {}
    public func resolve(_ data: PluginCallResultData = [:]) {}
    public func reject(_ message: String, _ code: String? = nil, _ error: Error? = nil, _ data: PluginCallResultData? = nil) {}
}

open class CAPPlugin: NSObject {
    public override init() {}
    open func load() {}
    public func notifyListeners(_ eventName: String, data: [String: Any]?) {}
    public func notifyListeners(_ eventName: String, data: [String: Any]?, retainUntilConsumed: Bool) {}
}

public protocol CAPBridgeProtocol: AnyObject {
    func registerPluginInstance(_ pluginInstance: CAPPlugin)
}

open class CAPBridgeViewController: UIViewController {
    public var bridge: CAPBridgeProtocol? { nil }
    open func capacitorDidLoad() {}
}

public final class SceneDelegateProxy {
    public static let shared = SceneDelegateProxy()
    public func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {}
    public func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {}
    public func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {}
}

extension Notification.Name {
    public static let capacitorDidRegisterForRemoteNotifications = Notification.Name("CapacitorDidRegisterForRemoteNotificationsNotification")
    public static let capacitorDidFailToRegisterForRemoteNotifications = Notification.Name("CapacitorDidFailToRegisterForRemoteNotificationsNotification")
}
