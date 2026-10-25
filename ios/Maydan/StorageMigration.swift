import Foundation

/// A cold WebKit process must first load its document; only then do we wait
/// for its storage acknowledgement. Generations reject old timers/readiness.
struct StorageMigrationWatchdog {
    enum Phase: String { case loading, awaitingResult }
    static let loadingBudget: TimeInterval = 30
    static let resultBudget: TimeInterval = 8
    private(set) var generation: UInt64 = 0
    private(set) var phase: Phase?
    private(set) var deadline: TimeInterval = 0

    var isActive: Bool { phase != nil }

    mutating func begin(at now: TimeInterval) -> UInt64 {
        generation &+= 1
        phase = .loading
        deadline = now + Self.loadingBudget
        return generation
    }

    mutating func documentReady(generation expected: UInt64, at now: TimeInterval) -> Bool {
        guard expected == generation, phase == .loading else { return false }
        phase = .awaitingResult
        deadline = min(deadline + Self.resultBudget, now + Self.resultBudget)
        return true
    }

    func remaining(generation expected: UInt64, at now: TimeInterval) -> TimeInterval? {
        guard expected == generation, isActive else { return nil }
        return max(0, deadline - now)
    }

    func hasExpired(generation expected: UInt64, at now: TimeInterval) -> Bool {
        guard let remaining = remaining(generation: expected, at: now) else { return false }
        return remaining == 0
    }

    @discardableResult
    mutating func finish(generation expected: UInt64) -> Bool {
        guard expected == generation, isActive else { return false }
        phase = nil
        return true
    }
}

#if canImport(UIKit) && canImport(WebKit)
import UIKit
import WebKit

/// انتقال محفوظات `localStorage` من أصل `file://` القديم إلى أصل `maydan://app` مرة واحدة.
/// يحمّل صفحة `www/migrate.html` (يولّدها `scripts/ios/prepare.mjs`) في عرض مخفي على
/// مخزن WebKit الافتراضي نفسه، فترسل الصفحة كل المدخلات عبر الجسر، ثم تُزرع في
/// الأصل الجديد بسكربت مستخدم قبل تشغيل اللعبة. لا يُعلَّم الانتقال منجزًا إلا بعد
/// إقرار الزرع والتحقق من كل كتابة. الفشل يبقى قابلًا للمحاولة ولا يحذف المخزن القديم.
final class StorageMigration: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    struct Result {
        let entries: [String: String]
        let succeeded: Bool
    }

    private enum Keys {
        static let done = "maydan.storageMigration.done"
        static let attempts = "maydan.storageMigration.attempts"
    }

    private static let bridgeName = "maydan"

    private let directory: URL
    private let processPool: WKProcessPool
    private let defaults = UserDefaults.standard
    private var webView: WKWebView?
    private var completion: ((Result) -> Void)?
    private var timer: Timer?
    private var watchdog = StorageMigrationWatchdog()
    private var readerNavigation: WKNavigation?
    private var seedToken: String?
    private var expectedSeedCount = 0

    init(directory: URL, processPool: WKProcessPool) {
        self.directory = directory
        self.processPool = processPool
        super.init()
    }

    var isDone: Bool { defaults.bool(forKey: Keys.done) }

    // Only fixed phase labels are logged, never storage names, values or URLs.
    static func trace(_ phase: String) {
        // Direct stderr writes remain visible when simctl redirects output and
        // the process is terminated before buffered stdout would be flushed.
        FileHandle.standardError.write(Data("Maydan migration: \(phase)\n".utf8))
    }

    func markDone() {
        defaults.set(true, forKey: Keys.done)
        defaults.removeObject(forKey: Keys.attempts)
    }

    /// يقرأ المخزن القديم ثم يستدعي الإكمال على الخيط الرئيسي. `succeeded == false` يعني
    /// أن الصفحة لم تردّ في الوقت المحدد؛ عندها لا يُعلَّم الانتقال منجزًا.
    func collect(in container: UIView, completion: @escaping (Result) -> Void) {
        guard self.completion == nil else {
            completion(Result(entries: [:], succeeded: false))
            return
        }
        let page = directory.appendingPathComponent("migrate.html")
        guard !isDone, FileManager.default.fileExists(atPath: page.path) else {
            if !isDone { Self.trace("read-page-missing") }
            completion(Result(entries: [:], succeeded: isDone))
            return
        }
        // A failed previous launch must never turn an unread store into an
        // empty, successful one. Retry is explicit or on the next launch.
        self.completion = completion

        let configuration = WKWebViewConfiguration()
        configuration.processPool = processPool
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(self, name: Self.bridgeName)

        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
        webView.navigationDelegate = self
        webView.isHidden = true
        webView.isUserInteractionEnabled = false
        container.addSubview(webView)
        self.webView = webView
        let generation = watchdog.begin(at: ProcessInfo.processInfo.systemUptime)
        Self.trace("read-loading")
        armWatchdog(generation: generation)
        readerNavigation = webView.loadFileURL(page, allowingReadAccessTo: directory)
    }

    func cancelCollection() {
        guard watchdog.isActive else { return }
        Self.trace("read-cancelled")
        finish(Result(entries: [:], succeeded: false), generation: watchdog.generation)
    }

    private func armWatchdog(generation: UInt64) {
        timer?.invalidate()
        guard let delay = watchdog.remaining(generation: generation, at: ProcessInfo.processInfo.systemUptime) else { return }
        timer = Timer.scheduledTimer(withTimeInterval: max(0.01, delay), repeats: false) { [weak self] _ in
            guard let self, self.watchdog.hasExpired(generation: generation, at: ProcessInfo.processInfo.systemUptime) else { return }
            Self.trace(self.watchdog.phase == .loading ? "read-timeout-loading" : "read-timeout-result")
            self.finish(Result(entries: [:], succeeded: false), generation: generation)
        }
    }

    func webView(_ candidate: WKWebView, didFinish navigation: WKNavigation!) {
        guard candidate === webView, let current = readerNavigation, navigation === current else { return }
        let generation = watchdog.generation
        if watchdog.documentReady(generation: generation, at: ProcessInfo.processInfo.systemUptime) {
            Self.trace("read-awaiting-result")
            armWatchdog(generation: generation)
        }
    }

    func webView(_ candidate: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        readerFailed(candidate, navigation: navigation)
    }

    func webView(_ candidate: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        readerFailed(candidate, navigation: navigation)
    }

    private func readerFailed(_ candidate: WKWebView, navigation: WKNavigation?) {
        guard candidate === webView, let current = readerNavigation, navigation === current else { return }
        Self.trace("read-navigation-failed")
        finish(Result(entries: [:], succeeded: false), generation: watchdog.generation)
    }

    func webViewWebContentProcessDidTerminate(_ candidate: WKWebView) {
        guard candidate === webView else { return }
        Self.trace("read-process-terminated")
        finish(Result(entries: [:], succeeded: false), generation: watchdog.generation)
    }

    /// سكربت يزرع المدخلات في الأصل الجديد قبل أي سطر من اللعبة، دون الكتابة فوق مفتاح موجود.
    func seedScript(entries: [String: String]) -> WKUserScript? {
        // Pairs also preserve keys such as __proto__ in the JS literal.
        let pairs = entries.keys.sorted().map { [$0, entries[$0]!] }
        guard let data = try? JSONSerialization.data(withJSONObject: pairs),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        let token = UUID().uuidString.lowercased()
        seedToken = token
        expectedSeedCount = entries.count
        let source = """
        (function () {
          var succeeded = false, verified = 0;
          try {
            var entries = \(json);
            for (var i = 0; i < entries.length; i += 1) {
              var key = entries[i][0], value = entries[i][1];
              if (localStorage.getItem(key) === null) {
                localStorage.setItem(key, value);
                if (localStorage.getItem(key) !== value) throw new Error('Migration write not retained');
              }
              verified += 1;
            }
            succeeded = true;
          } catch (error) {}
          try { window.webkit.messageHandlers.maydan.postMessage({ type: 'migrationSeedResult',
            token: '\(token)', succeeded: succeeded, verifiedCount: verified }); } catch (error) {}
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    /// nil rejects stale/foreign messages. Only the current, fully verified
    /// seed may commit; navigation completion is not a storage acknowledgement.
    func acceptSeedResult(_ payload: [String: Any]) -> Bool? {
        guard let token = seedToken, payload["token"] as? String == token else { return nil }
        let succeeded = payload["succeeded"] as? Bool == true && payload["verifiedCount"] as? Int == expectedSeedCount
        seedToken = nil
        if succeeded { markDone() }
        return succeeded
    }

    func abandonSeed() { seedToken = nil }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.bridgeName,
              message.webView === webView, message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.standardizedFileURL == directory.appendingPathComponent("migrate.html").standardizedFileURL,
              watchdog.isActive,
              let body = message.body as? [String: Any],
              body["type"] as? String == "migrate" else {
            return
        }
        guard body["succeeded"] as? Bool == true, let raw = body["entries"] as? [String: Any],
              raw.values.allSatisfy({ $0 is String }) else {
            Self.trace("read-result-failed")
            finish(Result(entries: [:], succeeded: false), generation: watchdog.generation)
            return
        }
        Self.trace("read-result-verified")
        finish(Result(entries: raw.compactMapValues { $0 as? String }, succeeded: true), generation: watchdog.generation)
    }

    private func finish(_ result: Result, generation: UInt64) {
        guard watchdog.finish(generation: generation) else { return }
        timer?.invalidate()
        timer = nil
        readerNavigation = nil
        guard let completion else { return }
        self.completion = nil
        webView?.navigationDelegate = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.bridgeName)
        webView?.stopLoading()
        webView?.removeFromSuperview()
        webView = nil
        completion(result)
    }
}
#endif
