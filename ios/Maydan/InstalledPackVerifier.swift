import CryptoKit
import Foundation
import WebKit

/// Serves only numbered batches from the immutable, installed inventory. No
/// paths, URLs, game information or account data are accepted from JavaScript.
final class InstalledPackVerifier: NSObject, WKScriptMessageHandlerWithReply {
    private let reader: InstalledPackReader

    init(directory: URL) { reader = InstalledPackReader(directory: directory) }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
              AppSchemeHandler.isAppURL(url), url.path == "/index.html" || url.path == "/",
              let batch = message.body as? Int, batch >= 0 else {
            replyHandler(nil, "Invalid installed game request")
            return
        }
        Task {
            do {
                let result = try await reader.verify(batch: batch)
                replyHandler(result, nil)
            } catch {
                replyHandler(nil, "Installed game could not be verified")
            }
        }
    }
}

private actor InstalledPackReader {
    private struct File: Decodable { let file: String; let bytes: Int; let sha256: String }
    private struct Inventory: Decodable {
        let schema: Int
        let totalBytes, totalFiles: Int
        let groups: [[File]]
    }
    private enum PackError: Error { case invalid }
    private static let hexDigits = Array("0123456789abcdef".utf8)
    private let directory: URL
    private var inventory: Inventory?
    private var trustedReceipt = false
    private var receiptURL: URL?
    private var receiptKey: Data?
    private var verifiedGroups = Set<Int>()

    init(directory: URL) { self.directory = directory.standardizedFileURL }

    private func matchesDigest(of data: Data, expected: String) -> Bool {
        let hex = Self.hexDigits
        var bytes = expected.utf8.makeIterator()
        for byte in SHA256.hash(data: data) {
            guard bytes.next() == hex[Int(byte >> 4)],
                  bytes.next() == hex[Int(byte & 0x0f)] else { return false }
        }
        return bytes.next() == nil
    }

    private func readReceipt(for manifest: Data) {
        do {
            let files = FileManager.default
            var folder = try files.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                       appropriateFor: nil, create: true).appendingPathComponent("MaydanInstalledPack", isDirectory: true)
            try files.createDirectory(at: folder, withIntermediateDirectories: true)
            var properties = URLResourceValues()
            properties.isExcludedFromBackup = true
            try folder.setResourceValues(properties)
            let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
            let identity = ["v1", Bundle.main.bundleIdentifier ?? "", build, directory.path, folder.path,
                            SHA256.hash(data: manifest).map { String(format: "%02x", $0) }.joined()].joined(separator: "\n")
            let key = Data(identity.utf8)
            let url = folder.appendingPathComponent("verified")
            receiptURL = url
            receiptKey = key
            trustedReceipt = (try? Data(contentsOf: url)) == key
        } catch {
            // Restricted storage or unavailable backup exclusion forces a full scan.
        }
    }

    func verify(batch: Int) throws -> [String: Int] {
        if inventory == nil {
            let url = directory.appendingPathComponent("native-game-pack.json")
            let raw = try Data(contentsOf: url)
            let manifest = try JSONDecoder().decode(Inventory.self, from: raw)
            guard manifest.schema == 1, !manifest.groups.isEmpty, manifest.groups.allSatisfy({ !$0.isEmpty }),
                  manifest.totalFiles > 0, manifest.totalBytes > 0,
                  manifest.groups.reduce(0, { $0 + $1.count }) == manifest.totalFiles,
                  manifest.groups.joined().reduce(0, { $0 + $1.bytes }) == manifest.totalBytes else { throw PackError.invalid }
            readReceipt(for: raw)
            inventory = manifest
        }
        guard let manifest = inventory, manifest.groups.indices.contains(batch) else { throw PackError.invalid }
        if batch == 0, trustedReceipt {
            return ["batch": 0, "batches": 1, "bytes": manifest.totalBytes, "files": manifest.totalFiles,
                    "totalBytes": manifest.totalBytes, "totalFiles": manifest.totalFiles, "receipt": 1]
        }
        var bytes = 0
        let group = manifest.groups[batch]
        guard !group.isEmpty else { throw PackError.invalid }
        for file in group {
            let url = directory.appendingPathComponent(file.file).standardizedFileURL
            guard url.path.hasPrefix(directory.path + "/") else { throw PackError.invalid }
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            guard data.count == file.bytes, matchesDigest(of: data, expected: file.sha256) else {
                throw PackError.invalid
            }
            bytes += file.bytes
        }
        verifiedGroups.insert(batch)
        if !trustedReceipt, verifiedGroups.count == manifest.groups.count {
            trustedReceipt = true
            if let receiptKey, let receiptURL { try? receiptKey.write(to: receiptURL, options: .atomic) }
        }
        return ["batch": batch, "batches": manifest.groups.count, "bytes": bytes, "files": group.count,
                "totalBytes": manifest.totalBytes, "totalFiles": manifest.totalFiles]
    }
}
