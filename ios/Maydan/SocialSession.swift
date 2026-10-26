import Foundation
import Security

enum SocialNativeError: Error {
    case failed(String)
    var code: String { if case .failed(let code) = self { return code }; return "NETWORK" }
}

/// The only native credential is the user's revocable Maydan session. LiveKit and
/// APNs signing secrets never enter the app. This remains available while locked
/// after the first device unlock, so a real incoming call can be answered.
@MainActor
final class SocialSession: NSObject, URLSessionTaskDelegate {
    struct Credential: Codable {
        let userId: String
        var token: String
        var previous: [String]
    }
    private static let service = NativeConfig.shared.scopedStorageKey("Maydan.social.session")
    private(set) var credential: Credential?
    var onRotation: ((String, String, String) -> Void)?
    let deviceId: String
    private lazy var http: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 25
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    override init() {
        let key = NativeConfig.shared.scopedStorageKey("maydan.social.deviceId")
        if let stored = UserDefaults.standard.string(forKey: key), UUID(uuidString: stored) != nil {
            deviceId = stored
        } else {
            deviceId = UUID().uuidString.lowercased()
            UserDefaults.standard.set(deviceId, forKey: key)
        }
        super.init()
        var query = Self.query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data {
            credential = try? JSONDecoder().decode(Credential.self, from: data)
        }
    }

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: "current"]
    }

    static func validToken(_ value: String) -> Bool {
        value.range(of: "^mdn1\\.[a-f0-9]{16}\\.[A-Za-z0-9_-]{16,128}$", options: .regularExpression) != nil
    }

    func set(userId: String, token: String) throws {
        guard UUID(uuidString: userId) != nil, Self.validToken(token) else {
            throw SocialNativeError.failed("AUTH_REQUIRED")
        }
        if let current = credential, current.userId == userId, current.previous.contains(token) { return }
        let prior = credential?.userId == userId ? Array(((credential?.previous ?? []) + [credential!.token]).suffix(8)) : []
        try persist(Credential(userId: userId, token: token, previous: prior))
    }

    private func persist(_ value: Credential) throws {
        let data = try JSONEncoder().encode(value)
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(Self.query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(Self.query.merging(attributes, uniquingKeysWith: { _, new in new }) as CFDictionary, nil) == errSecSuccess else {
                throw SocialNativeError.failed("SESSION_STORAGE")
            }
        } else if status != errSecSuccess { throw SocialNativeError.failed("SESSION_STORAGE") }
        credential = value
    }

    func clear() {
        credential = nil
        SecItemDelete(Self.query as CFDictionary)
    }

    func snapshot() -> [String: Any] {
        var result: [String: Any] = ["deviceId": deviceId]
        if let credential {
            result["userId"] = credential.userId
            result["token"] = credential.token
        }
        return result
    }

    func request(_ path: String, method: String = "POST", body: [String: Any] = [:], retiring: Credential? = nil) async throws -> [String: Any] {
        let gameVoice = method == "POST" && path.range(of: "^/api/rooms/[0-9]{6}/voice$", options: .regularExpression) != nil
        guard (path.hasPrefix("/api/social/") || gameVoice), !path.contains(".."), !path.contains("?"),
              let origin = URL(string: NativeConfig.shared.apiOrigin), origin.scheme == "https",
              let url = URL(string: path, relativeTo: origin)?.absoluteURL,
              NativeConfig.shared.isTrustedAuthURL(url), let auth = retiring ?? credential else {
            throw SocialNativeError.failed("AUTH_REQUIRED")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(auth.token)", forHTTPHeaderField: "Authorization")
        request.setValue("maydan://app", forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method != "GET" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await http.data(for: request)
        guard let response = response as? HTTPURLResponse, data.count <= 1_048_576 else {
            throw SocialNativeError.failed("NETWORK")
        }
        guard retiring != nil || credential?.userId == auth.userId else { throw SocialNativeError.failed("AUTH_REQUIRED") }
        // Rotation headers also accompany 4xx responses and must not be discarded.
        if retiring == nil, let next = response.value(forHTTPHeaderField: "x-maydan-session"), Self.validToken(next),
           var current = credential, current.token == auth.token {
            current.previous = Array((current.previous + [current.token]).suffix(8))
            current.token = next
            try persist(current)
            onRotation?(current.userId, next, auth.token)
        }
        let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(response.statusCode) else {
            throw SocialNativeError.failed(result["error"] as? String ?? "NETWORK")
        }
        return result
    }

    // Never forward a bearer token to a redirected destination, even if its URL
    // looks like an API response. All native endpoints have fixed HTTPS paths.
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask,
                                willPerformHTTPRedirection response: HTTPURLResponse,
                                newRequest request: URLRequest,
                                completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
