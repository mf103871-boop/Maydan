import Foundation

@main
struct AppUpdatePolicyTests {
    static var checks = 0
    static func expect(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else { fatalError("FAIL: \(name)") }
        checks += 1
    }
    static func policy(_ changes: [String: Any] = [:]) -> Data {
        var value: [String: Any] = ["schemaVersion": 1, "enabled": true, "minimumBuild": 12,
            "minimumVersion": "1.7", "appStoreId": "6808385717", "message": "يتوفر تحديث مطلوب لميدان."]
        changes.forEach { value[$0.key] = $0.value }
        return try! JSONSerialization.data(withJSONObject: value)
    }
    static func required(_ data: Data, _ version: String = "1.7", _ build: String = "11") -> Bool {
        AppUpdatePolicy.required(data: data, installedVersion: version, installedBuild: build) != nil
    }
    static func main() {
        expect(required(policy()), "same marketing version, older build requires update")
        expect(!required(policy(), "1.7", "12"), "installed required build is allowed")
        expect(!required(policy(), "1.7.0", "13"), "equivalent version with newer build is allowed")
        expect(required(policy(), "1.6", "99"), "older marketing version still requires update")
        expect(!required(policy(), "1.8", "1"), "newer marketing version is never sent backwards")
        expect(!required(policy(), "1.10", "1"), "semantic numeric comparison, not lexical")
        expect(required(policy(["minimumVersion": "1.10"]), "1.9", "30"), "two-digit component compares numerically")
        expect(!required(policy(["enabled": false, "minimumBuild": 0, "minimumVersion": NSNull()])), "shipped inactive policy is harmless")
        expect(!required(policy(["schemaVersion": 2])), "unknown schema fails open")
        expect(!required(policy(["appStoreId": "999"])), "different app cannot block this game")
        expect(!required(policy(["minimumBuild": 0])), "zero required build fails open")
        expect(!required(policy(["minimumBuild": -1])), "negative required build fails open")
        expect(!required(policy(["minimumBuild": 12.5])), "fractional required build fails open")
        expect(!required(policy(["minimumBuild": "12"])), "string required build fails open")
        expect(!required(policy(["minimumVersion": "1.7-beta"])), "nonrelease version fails open")
        expect(!required(policy(["minimumVersion": NSNull()])), "active policy needs verified public version")
        expect(!required(policy(["message": "   "])), "empty mandatory message fails open")
        expect(!required(policy(["message": String(repeating: "س", count: 401)])), "oversize message fails open")
        expect(!required(policy(["message": "نص\u{0000}مخفي"])), "control characters fail open")
        expect(!required(Data("{broken".utf8)), "invalid JSON fails open")
        expect(!required(Data(repeating: 32, count: 8_193)), "oversize payload fails open")
        expect(!required(policy(), "invalid", "11"), "unknown installed version fails open")
        expect(!required(policy(), "1.7", "11.1"), "unknown installed build fails open")
        expect(!required(policy(), "1.7", ""), "absent installed build fails open")
        expect(AppUpdatePolicy.appStoreURL.absoluteString == "https://apps.apple.com/app/id6808385717", "fixed trusted App Store destination")
        for route in ["/play/badeeha", "/play/jabeen", "/online", "/online/fabraka", "/room/123456", "/auth", "/settings", "/friends", "/profile"] {
            expect(!AppUpdatePolicy.isIdleMenu(fragment: route), "preserve active or sensitive route \(route)")
        }
        expect(!AppUpdatePolicy.isIdleMenu(fragment: nil), "unknown web state never covered")
        expect(AppUpdatePolicy.isIdleMenu(fragment: "/"), "home is an idle surface")
        expect(AppUpdatePolicy.isIdleMenu(fragment: "/game/badeeha"), "game details has no running match")
        var generation = AppUpdateCheckGeneration()
        let startup = generation.advance()
        let foreground = generation.advance()
        expect(!generation.accepts(startup), "stale startup response cannot re-lock current UI")
        expect(generation.accepts(foreground), "latest foreground response is accepted")
        _ = generation.advance()
        expect(!generation.accepts(foreground), "timeout/background cancellation invalidates response")
        print("PASS: \(checks) native app-update decisions")
    }
}
