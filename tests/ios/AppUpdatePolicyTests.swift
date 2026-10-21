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
        expect(AppUpdatePolicy.isIdleMenu(url: URL(string: "maydan://app/index.html")), "hashless bundled entry is home")
        expect(AppUpdatePolicy.isIdleMenu(url: URL(string: "maydan://app/")), "trusted hashless root is home")
        expect(AppUpdatePolicy.isIdleMenu(url: URL(string: "maydan://app/index.html#/")), "explicit home hash remains idle")
        expect(AppUpdatePolicy.isIdleMenu(url: URL(string: "maydan://app/index.html#/game/badeeha")), "trusted game details remain idle")
        expect(!AppUpdatePolicy.isIdleMenu(url: nil), "absent document remains unsafe")
        for value in ["https://app/index.html", "maydan://other/index.html", "maydan://app/auth",
                      "maydan://app/index.html?code=secret", "maydan://user@app/index.html", "maydan://app:443/index.html",
                      "maydan://app/index.html#/auth?code=secret", "maydan://app/index.html#/play/badeeha",
                      "maydan://app/index.html#/room/123456", "maydan://app/index.html#/friends/group/abc",
                      "maydan://app/index.html#/settings", "maydan://app/index.html#/unknown"] {
            expect(!AppUpdatePolicy.isIdleMenu(url: URL(string: value)), "never cover untrusted or sensitive document \(value)")
        }
        let release22 = policy(["minimumVersion": "1.8", "minimumBuild": 22])
        expect(required(release22, "1.7.1", "13"), "actual public build 13 requires the verified 1.8 build 22")
        expect(required(release22, "1.8", "21"), "same release with older build requires update")
        expect(!required(release22, "1.8.0", "22"), "current release 22 is allowed")
        if case .unavailable = AppUpdatePolicy.decision(data: Data("broken".utf8), installedVersion: "1.7.1", installedBuild: "13") {
            expect(true, "invalid transport payload remains retryable")
        } else { expect(false, "invalid payload must not complete a valid allowed check") }
        if case .allowed = AppUpdatePolicy.decision(data: policy(["enabled": false, "minimumBuild": 0, "minimumVersion": NSNull()]), installedVersion: "1.7.1", installedBuild: "13") {
            expect(true, "explicit server disable completes without retry churn")
        } else { expect(false, "disabled policy must be an allowed decision") }
        var retry = AppUpdateRetryState()
        expect(!retry.needsCheck && retry.nextAutomaticDelay() == nil, "no spontaneous checks before activation")
        retry.beginCycle()
        expect(retry.needsCheck, "foreground cycle records pending work")
        expect(retry.nextAutomaticDelay() == 1_000_000_000, "nil storefront first retry is bounded at one second")
        retry.deferCheck()
        expect(retry.nextAutomaticDelay() == 3_000_000_000, "deferral or timer does not replenish retry budget")
        expect(retry.nextAutomaticDelay() == 10_000_000_000, "third retry uses final backoff")
        expect(retry.automaticRetries == 3 && retry.nextAutomaticDelay() == nil, "automatic retry count is capped at three")
        retry.deferCheck()
        expect(retry.needsCheck && retry.nextAutomaticDelay() == nil, "pending recovery events do not restart exhausted timers")
        retry.complete()
        expect(!retry.needsCheck && retry.nextAutomaticDelay() == nil, "valid policy removes pending work")
        retry.beginCycle()
        expect(retry.automaticRetries == 0 && retry.nextAutomaticDelay() == 1_000_000_000, "only a fresh foreground or user cycle resets the budget")
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
