import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    // MARK: Push (E38) — @capacitor/push-notifications hands the raw APNs token to the web app,
    // which registers it with POST /push/devices (transport APNS). No Firebase SDK on iOS.

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    /// Silent order updates (`content-available`) refresh the home-screen widget even when the app is closed.
    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        guard let order = userInfo["order"] as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: ["info": order["attributes"] ?? [:], "state": order["state"] ?? [:]]),
              let snap = try? JSONDecoder().decode(WidgetOrderStore.Snapshot.self, from: data) else {
            return completionHandler(.noData)
        }
        WidgetOrderStore.save(snap)
        completionHandler(.newData)
    }
}
