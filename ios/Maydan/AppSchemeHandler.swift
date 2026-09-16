import Foundation
import UniformTypeIdentifiers
import WebKit

/// يخدم `maydan://app/<path>` من مجلد `www` داخل الحزمة. بهذا تحصل اللعبة على أصل
/// حقيقي (`Origin: maydan://app`) يقبله خادم الغرف والحسابات في CORS، بدل `file://`
/// الذي لا يحمل أصلًا ولا يستطيع مناداة الشبكة. يدعم طلبات Range لأن مشغّل الصوت
/// والفيديو في WebKit يطلب المقاطع على أجزاء.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "maydan"
    static let host = "app"
    static let rootURL = URL(string: "\(scheme)://\(host)/")!
    static let entryURL = rootURL.appendingPathComponent("index.html")

    private struct Reply {
        let response: URLResponse
        let body: Data?
    }

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "webmanifest": "application/manifest+json; charset=utf-8",
        "txt": "text/plain; charset=utf-8",
        "svg": "image/svg+xml",
        "webp": "image/webp",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "ico": "image/x-icon",
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "wav": "audio/wav",
        "ogg": "audio/ogg",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "woff2": "font/woff2",
        "woff": "font/woff",
        "ttf": "font/ttf"
    ]

    private let directory: URL
    private let queue = DispatchQueue(label: "maydan.scheme", qos: .userInitiated, attributes: .concurrent)
    private let lock = NSLock()
    private var activeTasks = Set<ObjectIdentifier>()

    init(directory: URL) {
        self.directory = directory.standardizedFileURL
        super.init()
    }

    static func isAppURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == scheme && url.host?.lowercased() == host
    }

    // MARK: - WKURLSchemeHandler

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask)
        lock.lock()
        activeTasks.insert(identifier)
        lock.unlock()

        let request = urlSchemeTask.request
        queue.async { [weak self] in
            guard let self else { return }
            let reply = self.reply(for: request)
            DispatchQueue.main.async {
                // WebKit يرفض أي ردّ بعد stop؛ الإزالة والردّ كلاهما على الخيط الرئيسي فلا سباق.
                self.lock.lock()
                let stillActive = self.activeTasks.remove(identifier) != nil
                self.lock.unlock()
                guard stillActive else { return }
                urlSchemeTask.didReceive(reply.response)
                if let body = reply.body, !body.isEmpty {
                    urlSchemeTask.didReceive(body)
                }
                urlSchemeTask.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        lock.lock()
        activeTasks.remove(ObjectIdentifier(urlSchemeTask))
        lock.unlock()
    }

    // MARK: - Resolution

    private func reply(for request: URLRequest) -> Reply {
        let method = (request.httpMethod ?? "GET").uppercased()
        guard let url = request.url,
              Self.isAppURL(url),
              method == "GET" || method == "HEAD",
              let file = resolve(path: url.path),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            return notFound(request.url ?? Self.rootURL)
        }

        let total = data.count
        var headers: [String: String] = [
            "Content-Type": mimeType(for: file),
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache"
        ]

        if let header = request.value(forHTTPHeaderField: "Range"),
           let range = Self.byteRange(from: header, total: total) {
            let slice = data.subdata(in: range)
            headers["Content-Range"] = "bytes \(range.lowerBound)-\(range.upperBound - 1)/\(total)"
            headers["Content-Length"] = String(slice.count)
            return Reply(
                response: HTTPURLResponse(url: url, statusCode: 206, httpVersion: "HTTP/1.1", headerFields: headers)!,
                body: method == "HEAD" ? nil : slice
            )
        }

        headers["Content-Length"] = String(total)
        return Reply(
            response: HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!,
            body: method == "HEAD" ? nil : data
        )
    }

    private func notFound(_ url: URL) -> Reply {
        Reply(
            response: HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"])!,
            body: nil
        )
    }

    /// مسار الرابط → ملف داخل `www` فقط. أي محاولة صعود (`..`) أو خروج عن المجلد تُرفض.
    private func resolve(path rawPath: String) -> URL? {
        var path = rawPath.removingPercentEncoding ?? rawPath
        if path.isEmpty || path.hasSuffix("/") {
            path += "index.html"
        }
        let components = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard !components.isEmpty, !components.contains(".."), !components.contains(".") else { return nil }

        let candidate = directory.appendingPathComponent(components.joined(separator: "/")).standardizedFileURL
        let trustedPrefix = directory.path.hasSuffix("/") ? directory.path : directory.path + "/"
        guard candidate.path.hasPrefix(trustedPrefix) else { return nil }

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory) else { return nil }
        if isDirectory.boolValue {
            let index = candidate.appendingPathComponent("index.html")
            return FileManager.default.fileExists(atPath: index.path) ? index : nil
        }
        return candidate
    }

    private func mimeType(for file: URL) -> String {
        let ext = file.pathExtension.lowercased()
        if let known = Self.mimeTypes[ext] {
            return known
        }
        if let type = UTType(filenameExtension: ext)?.preferredMIMEType {
            return type
        }
        return "application/octet-stream"
    }

    /// `bytes=a-b` أو `bytes=a-` أو `bytes=-n` → مدى نصف مفتوح داخل الحجم؛ غير الصالح يعود nil فيُرسل الملف كاملًا.
    static func byteRange(from header: String, total: Int) -> Range<Int>? {
        let trimmed = header.trimmingCharacters(in: .whitespaces).lowercased()
        guard total > 0, trimmed.hasPrefix("bytes="), !trimmed.contains(",") else { return nil }
        let spec = trimmed.dropFirst("bytes=".count)
        let parts = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 2 else { return nil }

        if parts[0].isEmpty {
            guard let suffix = Int(parts[1]), suffix > 0 else { return nil }
            return max(0, total - suffix)..<total
        }
        guard let start = Int(parts[0]), start >= 0, start < total else { return nil }
        if parts[1].isEmpty {
            return start..<total
        }
        guard let end = Int(parts[1]), end >= start else { return nil }
        return start..<min(end + 1, total)
    }
}
