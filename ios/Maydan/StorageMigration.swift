import UIKit
import WebKit

/// انتقال محفوظات `localStorage` من أصل `file://` القديم إلى أصل `maydan://app` مرة واحدة.
/// يحمّل صفحة `www/migrate.html` (يولّدها `scripts/ios/prepare.mjs`) في عرض مخفي على
/// مخزن WebKit الافتراضي نفسه، فترسل الصفحة كل المدخلات عبر الجسر، ثم تُزرع في
/// الأصل الجديد بسكربت مستخدم قبل تشغيل اللعبة. لا يُعلَّم الانتقال منجزًا إلا بعد
/// إقرار الزرع والتحقق من كل كتابة. الفشل يبقى قابلًا للمحاولة ولا يحذف المخزن القديم.
final class StorageMigration: NSObject, WKScriptMessageHandler {
    struct Result {
        let entries: [String: String]
        let succeeded: Bool
    }

    private enum Keys {
        static let done = "maydan.storageMigration.done"
        static let attempts = "maydan.storageMigration.attempts"
    }

    private static let bridgeName = "maydan"
    private static let timeout: TimeInterval = 4

    private let directory: URL
    private let processPool: WKProcessPool
    private let defaults = UserDefaults.standard
    private var webView: WKWebView?
    private var completion: ((Result) -> Void)?
    private var timer: Timer?
    private var seedToken: String?
    private var expectedSeedCount = 0

    init(directory: URL, processPool: WKProcessPool) {
        self.directory = directory
        self.processPool = processPool
        super.init()
    }

    var isDone: Bool { defaults.bool(forKey: Keys.done) }

    func markDone() {
        defaults.set(true, forKey: Keys.done)
        defaults.removeObject(forKey: Keys.attempts)
    }

    /// يقرأ المخزن القديم ثم يستدعي الإكمال على الخيط الرئيسي. `succeeded == false` يعني
    /// أن الصفحة لم تردّ في الوقت المحدد؛ عندها لا يُعلَّم الانتقال منجزًا.
    func collect(in container: UIView, completion: @escaping (Result) -> Void) {
        let page = directory.appendingPathComponent("migrate.html")
        guard !isDone, FileManager.default.fileExists(atPath: page.path) else {
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
        webView.isHidden = true
        webView.isUserInteractionEnabled = false
        container.addSubview(webView)
        self.webView = webView
        webView.loadFileURL(page, allowingReadAccessTo: directory)

        timer = Timer.scheduledTimer(withTimeInterval: Self.timeout, repeats: false) { [weak self] _ in
            self?.finish(Result(entries: [:], succeeded: false))
        }
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
              let body = message.body as? [String: Any],
              body["type"] as? String == "migrate" else {
            return
        }
        guard body["succeeded"] as? Bool == true, let raw = body["entries"] as? [String: Any],
              raw.values.allSatisfy({ $0 is String }) else {
            finish(Result(entries: [:], succeeded: false))
            return
        }
        finish(Result(entries: raw.compactMapValues { $0 as? String }, succeeded: true))
    }

    private func finish(_ result: Result) {
        timer?.invalidate()
        timer = nil
        guard let completion else { return }
        self.completion = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.bridgeName)
        webView?.removeFromSuperview()
        webView = nil
        completion(result)
    }
}
