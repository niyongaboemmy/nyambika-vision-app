#!/bin/sh
# Typechecks the iOS Swift sources with swiftc against the iOS Simulator SDK (no xcodebuild, no SPM,
# no signing). The widget extension compiles against the real SDK; the app target compiles against
# the real SDK plus a Capacitor signature stub (scripts/swift-check/CapacitorStub.swift).
# A full `xcodebuild` on a Mac with a working Xcode is still required before release.
set -eu
cd "$(dirname "$0")/.."
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
OUT="${TMPDIR:-/tmp}/nyambika-swift-check"
mkdir -p "$OUT"
I=ios/App

echo "· widget extension (WidgetKit + ActivityKit, iOS 17)"
xcrun swiftc -typecheck -sdk "$SDK" -target arm64-apple-ios17.0-simulator -application-extension -parse-as-library \
  "$I/Shared/OrderActivityAttributes.swift" "$I/Shared/WidgetOrderStore.swift" \
  "$I/NyambikaWidgets/NyambikaWidgetsBundle.swift" "$I/NyambikaWidgets/OrderLiveActivity.swift" "$I/NyambikaWidgets/TodayWidget.swift"

echo "· Capacitor stub module"
xcrun swiftc -emit-module -module-name Capacitor -sdk "$SDK" -target arm64-apple-ios15.0-simulator -parse-as-library \
  -emit-module-path "$OUT/Capacitor.swiftmodule" scripts/swift-check/CapacitorStub.swift

echo "· app target (plugin, bridge, delegates; iOS 15 deployment target)"
xcrun swiftc -typecheck -sdk "$SDK" -target arm64-apple-ios15.0-simulator -I "$OUT" \
  "$I/Shared/OrderActivityAttributes.swift" "$I/Shared/WidgetOrderStore.swift" \
  "$I/App/AppDelegate.swift" "$I/App/SceneDelegate.swift" "$I/App/NyambikaBridgeViewController.swift" "$I/App/NyambikaLiveActivityPlugin.swift"

echo "Swift typecheck OK"
