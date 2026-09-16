import UIKit
import WebKit

/// انتقال محفوظات `localStorage` من أصل `file://` القديم إلى أصل `maydan://app` مرة واحدة.
/// يحمّل صفحة `www/migrate.html` (يولّدها `scripts/ios/prepare.mjs`) في عرض مخفي على
/// مخزن WebKit الافتراضي نفسه، فترسل الصفحة كل المدخلات عبر الجسر، ثم تُزرع في
/// الأصل الجديد بسكربت مستخدم قبل تشغيل اللعبة. لا يُعلَّم الانتقال منجزًا إلا بعد
/// نجاح الزرع، ويُعاد بحدّ أقصى ثلاث محاولات.
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
    private static let maximumAttempts = 3

    private let directory: URL
    private let processPool: WKProcessPool
    private let defaults = UserDefaults.standard
    private var webView: WKWebView?
    private var completion: ((Result) -> Void)?
    private var timer: Timer?

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
        let attempts = defaults.integer(forKey: Keys.attempts)
        guard !isDone, attempts < Self.maximumAttempts, FileManager.default.fileExists(atPath: page.path) else {
            // لا صفحة انتقال أو استُنفدت المحاولات: نكمل بلا زرع ونغلق الباب.
            completion(Result(entries: [:], succeeded: true))
            return
        }
        defaults.set(attempts + 1, forKey: Keys.attempts)
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
    static func seedScript(entries: [String: String]) -> WKUserScript? {
        guard !entries.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: entries),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        let source = """
        (function () {
          try {
            var entries = \(json);
            for (var key in entries) {
              if (Object.prototype.hasOwnProperty.call(entries, key) && localStorage.getItem(key) === null) {
                localStorage.setItem(key, entries[key]);
              }
            }
          } catch (error) {}
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.bridgeName,
              message.webView === webView,
              let body = message.body as? [String: Any],
              body["type"] as? String == "migrate" else {
            return
        }
        let raw = body["entries"] as? [String: Any] ?? [:]
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
