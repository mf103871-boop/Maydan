import Foundation

/// إعداد الغلاف الذي يولّده `scripts/ios/prepare.mjs` في `www/native-config.json`:
/// أصل الـAPI الذي بُنيت الحزمة عليه (وهو الوحيد المسموح فتحه في متصفح المصادقة)
/// ومعرّفا منتجي الاشتراك. بلا الملف تعمل اللعبة، ولا يعمل الدخول ولا الشراء.
struct NativeConfig {
    static let authCallbackScheme = "maydan"
    static let authCallbackHost = "auth"

    let apiOrigin: String
    let productIds: [String]

    static let shared = NativeConfig.load()

    private struct File: Decodable {
        var apiOrigin: String?
        var products: [String: String]?
    }

    private static func load() -> NativeConfig {
        guard let url = Bundle.main.url(forResource: "native-config", withExtension: "json", subdirectory: "www"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data) else {
            return NativeConfig(apiOrigin: "", productIds: [])
        }
        let ids = (file.products ?? [:]).values.filter { !$0.isEmpty }.sorted()
        return NativeConfig(apiOrigin: file.apiOrigin ?? "", productIds: ids)
    }

    /// روابط https على مضيف الـAPI فقط تُفتح في متصفح المصادقة.
    func isTrustedAuthURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              let api = URL(string: apiOrigin),
              api.scheme?.lowercased() == "https",
              let apiHost = api.host?.lowercased(),
              let host = url.host?.lowercased() else {
            return false
        }
        return host == apiHost && url.port == api.port
    }

    /// `maydan://auth?code=…` (أو في الشظية) → الرمز، وإلا nil.
    static func authCode(from url: URL) -> String? {
        guard url.scheme?.lowercased() == authCallbackScheme, url.host?.lowercased() == authCallbackHost else {
            return nil
        }
        if let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            if let code = components.queryItems?.first(where: { $0.name == "code" })?.value, !code.isEmpty {
                return code
            }
            if let fragment = components.fragment,
               let code = URLComponents(string: "?\(fragment)")?.queryItems?.first(where: { $0.name == "code" })?.value,
               !code.isEmpty {
                return code
            }
        }
        return nil
    }
}
