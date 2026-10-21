import Foundation

/// A lease belongs to one mounted drawing surface. Late callbacks or cleanup
/// from an earlier round must not rotate or unlock a newer surface.
struct DrawingOrientationPolicy {
    private(set) var lease: String?
    private(set) var generation: UInt64 = 0

    static func validLease(_ value: String) -> Bool {
        value.range(of: "^ers-[a-zA-Z0-9_-]{1,56}$", options: .regularExpression) != nil
    }

    static func isRoomURL(_ url: URL?) -> Bool {
        guard let url, url.scheme?.lowercased() == "maydan", url.host?.lowercased() == "app",
              url.user == nil, url.password == nil, url.port == nil,
              ["/", "/index.html"].contains(url.path),
              let fragment = url.fragment else { return false }
        let route = fragment.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
        return route.range(of: "^/room/[0-9]{6}$", options: .regularExpression) != nil
    }

    @discardableResult
    mutating func acquire(_ value: String) -> UInt64? {
        guard Self.validLease(value) else { return nil }
        generation &+= 1
        lease = value
        return generation
    }

    func accepts(_ value: String, generation candidate: UInt64) -> Bool {
        lease == value && generation == candidate
    }

    @discardableResult
    mutating func release(_ value: String? = nil) -> Bool {
        guard lease != nil, value == nil || lease == value else { return false }
        generation &+= 1
        lease = nil
        return true
    }
}
