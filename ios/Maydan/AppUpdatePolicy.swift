import Foundation

/// Pure decisions shared by the native gate and executable Swift regression tests.
/// A missing, disabled or malformed policy always permits the installed game.
struct AppUpdatePolicy: Decodable {
    static let appStoreID = "6808385717"
    static let appStoreURL = URL(string: "https://apps.apple.com/app/id6808385717")!

    let schemaVersion: Int
    let enabled: Bool
    let minimumBuild: Int
    let minimumVersion: String?
    let appStoreId: String
    let message: String

    static func required(data: Data, installedVersion: String, installedBuild: String) -> AppUpdatePolicy? {
        guard data.count <= 8_192,
              let policy = try? JSONDecoder().decode(Self.self, from: data),
              policy.schemaVersion == 1, policy.enabled, policy.appStoreId == appStoreID,
              (1...999_999).contains(policy.minimumBuild),
              let minimum = versionParts(policy.minimumVersion), let current = versionParts(installedVersion),
              let build = buildNumber(installedBuild),
              (1...400).contains(policy.message.trimmingCharacters(in: .whitespacesAndNewlines).count),
              !policy.message.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) && $0 != "\n" }) else { return nil }
        // A later marketing version is never forced backwards because its build
        // numbering differs. Within one release, the required build still matters.
        let olderVersion = current.lexicographicallyPrecedes(minimum)
        return olderVersion || (current == minimum && build < policy.minimumBuild) ? policy : nil
    }

    static func versionParts(_ value: String?) -> [Int]? {
        guard let value, value.count <= 24,
              value.range(of: "^[0-9]{1,6}(\\.[0-9]{1,6}){0,2}$", options: .regularExpression) != nil else { return nil }
        let parts = value.split(separator: ".").compactMap { Int($0) }
        return parts + Array(repeating: 0, count: 3 - parts.count)
    }

    static func buildNumber(_ value: String) -> Int? {
        guard value.range(of: "^[0-9]{1,6}$", options: .regularExpression) != nil,
              let number = Int(value), number > 0 else { return nil }
        return number
    }

    /// Only idle navigation surfaces may be covered on foreground return. An
    /// existing local/online game, auth flow or account management remains intact.
    static func isIdleMenu(fragment: String?) -> Bool {
        guard let fragment else { return false }
        let path = fragment.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return ["", "/", "/about"].contains(path) || path.range(of: "^/game/[a-z0-9-]+$", options: .regularExpression) != nil
    }
}

/// Cancellation alone does not stop an already-completing response. Every
/// callback must also carry the generation of the check that produced it.
struct AppUpdateCheckGeneration {
    private(set) var value: UInt64 = 0
    mutating func advance() -> UInt64 { value &+= 1; return value }
    func accepts(_ candidate: UInt64) -> Bool { candidate == value }
}
