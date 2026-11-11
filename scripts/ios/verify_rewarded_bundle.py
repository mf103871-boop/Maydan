"""Verify actual simulator, archive or exported IPA Rewarded metadata."""
from __future__ import annotations

import json
import os
import plistlib
import sys

from verify_runtime_dependencies import Bundle, require

SAMPLE_APP = "ca-app-pub-3940256099942544~1458002511"
SAMPLE_UNIT = "ca-app-pub-3940256099942544/1712485313"
ORIGINS = {
    "testflight": "https://maydan-mafia-preview.mf103871.workers.dev",
    "testflight-owned": "https://maydan-mafia-preview.mf103871.workers.dev",
    "live": "https://maydan-game.mf103871.workers.dev",
}


def verify(bundle, env):
    mode = env.get("IOS_REWARDED_MODE") or "off"
    info = plistlib.loads(bundle.read("Info.plist"))
    native = json.loads(bundle.read("www/native-config.json"))
    require(info.get("CFBundleIdentifier") == "Maydan", "Unexpected App Store bundle identifier")
    require("NSUserTrackingUsageDescription" not in info, "Unexpected advertising tracking declaration")
    require(not info.get("NSAppTransportSecurity", {}).get("NSAllowsArbitraryLoads"), "Unexpected broad ATS exception")
    if mode == "off":
        require("GADApplicationIdentifier" not in info and "MaydanRewardedMode" not in info and "rewarded" not in native,
                "Standard build contains Rewarded settings")
        return

    require(mode in ORIGINS and native.get("apiOrigin") == ORIGINS[mode], "Rewarded mode and API origin disagree")
    app_id = env.get("IOS_ADMOB_APP_ID") or (SAMPLE_APP if mode == "testflight" else None)
    unit = SAMPLE_UNIT if mode == "testflight" else env.get("IOS_ADMOB_REWARDED_UNIT_ID")
    expected_config = {"mode": mode, "appId": app_id, "adUnit": unit}
    test_version = env.get("IOS_ADMOB_TEST_VERSION")
    if mode == "testflight-owned":
        require(test_version and test_version == env.get("IOS_VERSION") == info.get("CFBundleShortVersionString")
                == info.get("MaydanRewardedTestVersion"), "Owned TestFlight is not the verified AdMob test app version")
        expected_config["testVersion"] = test_version
    else:
        require("MaydanRewardedTestVersion" not in info, "Unexpected AdMob test app version")
    require(app_id and unit and native.get("rewarded") == expected_config,
            "Bundled Rewarded configuration differs from the release inputs")
    require(info.get("MaydanRewardedMode") == mode and info.get("GADApplicationIdentifier") == app_id
            and info.get("MaydanRewardedUnit") == unit and info.get("GADDelayAppMeasurementInit") is True,
            "Rewarded Info.plist configuration differs from the release inputs")
    networks = {item.get("SKAdNetworkIdentifier") for item in info.get("SKAdNetworkItems", [])}
    require("cstr6suwn9.skadnetwork" in networks, "Google's SKAdNetwork identifier is missing")


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Pass an existing .app or .ipa")
    bundle = Bundle(sys.argv[1])
    try:
        verify(bundle, os.environ)
        print("Signed Rewarded bundle configuration verified.")
    finally:
        bundle.close()


if __name__ == "__main__":
    main()
