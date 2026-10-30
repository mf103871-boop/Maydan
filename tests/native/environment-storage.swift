import Foundation

@main
enum EnvironmentStorageChecks {
    static func main() {
        let production = NativeConfig(apiOrigin: "https://maydan-game.mf103871.workers.dev", productIds: [])
        let preview = NativeConfig(apiOrigin: "https://maydan-mafia-preview.mf103871.workers.dev", productIds: [])
        let other = NativeConfig(apiOrigin: "https://another-preview.example.test", productIds: [])
        let missing = NativeConfig(apiOrigin: "", productIds: [])
        for key in ["Maydan.social.session", "maydan.social.deviceId", "maydan.trials.marks", "maydan.social.privateTurn"] {
            precondition(production.scopedStorageKey(key) == key)
            let scoped = preview.scopedStorageKey(key)
            precondition(scoped != key && scoped == preview.scopedStorageKey(key))
            precondition(scoped != other.scopedStorageKey(key) && scoped != missing.scopedStorageKey(key))
            precondition(!scoped.contains("/") && !scoped.contains("+") && !scoped.contains("="))
            precondition(missing.scopedStorageKey(key) != key)
        }
        precondition(preview.isTrustedAuthURL(URL(string: "https://maydan-mafia-preview.mf103871.workers.dev/api/auth")!))
        precondition(!preview.isTrustedAuthURL(URL(string: "https://maydan-game.mf103871.workers.dev/api/auth")!))
        print("Native environment storage and auth origin checks passed.")
    }
}
