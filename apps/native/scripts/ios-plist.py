#!/usr/bin/env python3
"""E38: idempotently configure the iOS Info.plist files, entitlements and permission strings (RW/EN/FR).

Run from apps/native:  python3 scripts/ios-plist.py
Safe to re-run after `npx cap sync` (Capacitor does not rewrite these keys).
"""
import plistlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "ios" / "App"
APP_PLIST = ROOT / "App" / "Info.plist"
GROUP = "group.rw.nyambika.app"
DOMAINS = ["nyambika.rw", "www.nyambika.rw", "staging.nyambika.rw"]

# Permission strings. Kinyarwanda first (native review pending, see docs/native-release.md).
STRINGS = {
    "en": {
        "NSCameraUsageDescription": "Nyambika uses the camera to capture your private twin and product photos. Photos stay encrypted and are never shared with makers.",
        "NSMicrophoneUsageDescription": "Hold the mic to ask the Muse by voice. Your recording is turned into text and deleted straight away.",
        "NSPhotoLibraryUsageDescription": "Choose a photo for your twin or your products. Only the photo you pick is used.",
    },
    "rw": {
        "NSCameraUsageDescription": "Nyambika ikoresha kamera gufata ishusho yawe bwite (twin) n'amafoto y'ibicuruzwa. Amafoto abikwa mu ibanga kandi ntahabwa abadozi.",
        "NSMicrophoneUsageDescription": "Kanda kuri mikoro ubaze Muse mu ijwi. Ijwi ryawe rihindurwa inyandiko rigahita risibwa.",
        "NSPhotoLibraryUsageDescription": "Hitamo ifoto ya twin yawe cyangwa y'ibicuruzwa byawe. Ifoto uhisemo yonyine ni yo ikoreshwa.",
    },
    "fr": {
        "NSCameraUsageDescription": "Nyambika utilise l'appareil photo pour créer votre jumeau privé et photographier vos produits. Les photos restent chiffrées et ne sont jamais partagées avec les artisans.",
        "NSMicrophoneUsageDescription": "Maintenez le micro pour parler à la Muse. L'enregistrement est transcrit puis supprimé aussitôt.",
        "NSPhotoLibraryUsageDescription": "Choisissez une photo pour votre jumeau ou vos produits. Seule la photo choisie est utilisée.",
    },
}


def write_plist(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        plistlib.dump(data, f, sort_keys=False)


def main():
    with APP_PLIST.open("rb") as f:
        p = plistlib.load(f)
    p.update(STRINGS["en"])
    p["UIRequiredDeviceCapabilities"] = ["arm64"]
    p["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]
    p["NSSupportsLiveActivities"] = True
    p["UIBackgroundModes"] = ["remote-notification"]
    p["CFBundleURLTypes"] = [{"CFBundleURLName": "rw.nyambika.app", "CFBundleURLSchemes": ["nyambika"]}]
    p["WKAppBoundDomains"] = DOMAINS
    p["CFBundleLocalizations"] = ["rw", "en", "fr"]
    p["CFBundleAllowMixedLocalizations"] = True
    p["ITSAppUsesNonExemptEncryption"] = False
    p["UIStatusBarStyle"] = "UIStatusBarStyleLightContent"
    write_plist(APP_PLIST, p)

    for lang, s in STRINGS.items():
        lines = [f'"{k}" = "{v}";' for k, v in s.items()]
        (ROOT / "App" / f"{lang}.lproj").mkdir(exist_ok=True)
        (ROOT / "App" / f"{lang}.lproj" / "InfoPlist.strings").write_text("\n".join(lines) + "\n", encoding="utf-8")

    write_plist(ROOT / "App" / "App.entitlements", {
        "aps-environment": "development",
        "com.apple.developer.associated-domains": [f"applinks:{d}" for d in DOMAINS] + [f"webcredentials:{d}" for d in DOMAINS],
        "com.apple.security.application-groups": [GROUP],
    })
    write_plist(ROOT / "NyambikaWidgets" / "NyambikaWidgets.entitlements", {"com.apple.security.application-groups": [GROUP]})
    write_plist(ROOT / "NyambikaWidgets" / "Info.plist", {
        "CFBundleDevelopmentRegion": "$(DEVELOPMENT_LANGUAGE)",
        "CFBundleDisplayName": "Nyambika",
        "CFBundleExecutable": "$(EXECUTABLE_NAME)",
        "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": "$(PRODUCT_NAME)",
        "CFBundlePackageType": "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
        "CFBundleShortVersionString": "$(MARKETING_VERSION)",
        "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
        "NSExtension": {"NSExtensionPointIdentifier": "com.apple.widgetkit-extension"},
    })
    print("iOS plists, entitlements and InfoPlist.strings (rw/en/fr) written")


if __name__ == "__main__":
    main()
