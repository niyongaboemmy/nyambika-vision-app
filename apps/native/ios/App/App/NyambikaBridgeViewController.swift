import Capacitor
import UIKit

/// Registers the app-local plugins (Capacitor discovers npm plugins itself, local ones need this).
class NyambikaBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NyambikaLiveActivityPlugin())
    }
}
