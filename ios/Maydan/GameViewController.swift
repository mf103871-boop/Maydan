import AuthenticationServices
import StoreKit
import UIKit
import WebKit

/// Breaks WKUserContentController's strong reference to its message handler.
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

/// مرآة المباريات المجانية المستهلكة في UserDefaults: مسح بيانات WebKit لا يعيد التجربة.
/// الخادم يبقى مصدر الحقيقة للمسجَّلين؛ هذه للمجهول على هذا الجهاز.
enum TrialMirror {
    private static let key = "maydan.trials.marks"
    private static let maximumEntries = 32

    static func isValidGame(_ game: String) -> Bool {
        (1...32).contains(game.count) && game.allSatisfy { $0.isLetter && $0.isASCII && $0.isLowercase }
    }

    static func marks() -> [String: Bool] {
        let stored = UserDefaults.standard.dictionary(forKey: key) as? [String: Bool] ?? [:]
        return stored.filter { $0.value && isValidGame($0.key) }
    }

    @discardableResult
    static func mark(_ game: String) -> [String: Bool] {
        var current = marks()
        guard current[game] != true else { return current }
        guard current.count < maximumEntries else { return current }
        current[game] = true
        UserDefaults.standard.set(current, forKey: key)
        return current
    }
}

/// أكواد الرفض التي يفهمها الويب (`ACCOUNT_ERRORS` في `src/shared/account/errors.js`).
enum BridgeError: String {
    case cancelled = "PURCHASE_CANCELLED"
    case pending = "PURCHASE_PENDING"
    case provider = "PROVIDER"
    case network = "NETWORK"
    case notEligible = "NOT_ELIGIBLE"
    case invalid = "SIGNATURE"
}

final class GameViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private enum Constants {
        static let bridgeName = "maydan"
        static let maximumShareTextLength = 10_000
        static let backgroundColor = UIColor(
            red: 255 / 255,
            green: 247 / 255,
            blue: 231 / 255,
            alpha: 1
        )
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    private static let sharedProcessPool = WKProcessPool()

    /// مجلد `www` داخل الحزمة (يولّده `npm run ios:prepare`).
    private static var gameDirectory: URL? {
        Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www")?
            .deletingLastPathComponent()
            .standardizedFileURL
    }

    private var webView: WKWebView!
    private var bridgeProxy: WeakScriptMessageHandler?
    private var isRecoveringWebContent = false
    private var migration: StorageMigration?
    private var isCommittingMigration = false
    private lazy var auth = AuthCoordinator(anchor: { [weak self] in
        self?.view.window ?? ASPresentationAnchor()
    })

    override func loadView() {
        let containerView = UIView(frame: .zero)
        containerView.backgroundColor = Constants.backgroundColor

        let configuration = WKWebViewConfiguration()
        configuration.processPool = Self.sharedProcessPool
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.suppressesIncrementalRendering = false
        if let directory = Self.gameDirectory {
            configuration.setURLSchemeHandler(AppSchemeHandler(directory: directory), forURLScheme: AppSchemeHandler.scheme)
        }

        let bridgeProxy = WeakScriptMessageHandler(delegate: self)
        self.bridgeProxy = bridgeProxy
        configuration.userContentController.add(bridgeProxy, name: Constants.bridgeName)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        self.webView = webView
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = Constants.backgroundColor
        webView.scrollView.backgroundColor = Constants.backgroundColor
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false

        containerView.addSubview(webView)
        view = containerView

        let safeArea = containerView.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: safeArea.topAnchor),
            webView.leadingAnchor.constraint(equalTo: safeArea.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safeArea.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: safeArea.bottomAnchor)
        ])

        let edgeBackGesture = UIScreenEdgePanGestureRecognizer(
            target: self,
            action: #selector(handleEdgeBackGesture(_:))
        )
        edgeBackGesture.edges = .right
        containerView.addGestureRecognizer(edgeBackGesture)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // تجديدات الاشتراك والمشتريات المعلّقة تصل هنا خارج الشراء المباشر؛ الويب يرسل توقيعها للخادم.
        StoreManager.shared.onTransaction = { [weak self] jws in
            self?.emit(event: "transaction", payload: ["jws": jws])
        }
        StoreManager.shared.startListening()
        loadBundledGame()
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(
            forName: Constants.bridgeName
        )
        webView?.navigationDelegate = nil
        bridgeProxy?.delegate = nil
    }

    override var prefersStatusBarHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }

    override func accessibilityPerformEscape() -> Bool {
        invokeWebBack()
        return true
    }

    // MARK: - Loading

    private func loadBundledGame() {
        guard let directory = Self.gameDirectory else {
            assertionFailure("Bundled game file is missing")
            showBundledGameMissingMessage()
            return
        }
        if migration == nil {
            migration = StorageMigration(directory: directory, processPool: Self.sharedProcessPool)
        }
        guard let migration, !migration.isDone else {
            webView.load(URLRequest(url: AppSchemeHandler.entryURL))
            return
        }
        // أول تشغيل بعد التحديث: انقل محفوظات file:// إلى الأصل الجديد قبل بدء اللعبة.
        migration.collect(in: view) { [weak self] result in
            guard let self else { return }
            if result.succeeded {
                if let script = StorageMigration.seedScript(entries: result.entries) {
                    self.webView.configuration.userContentController.addUserScript(script)
                    self.isCommittingMigration = true
                } else {
                    migration.markDone()
                }
            }
            self.webView.load(URLRequest(url: AppSchemeHandler.entryURL))
        }
    }

    private func showBundledGameMissingMessage() {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = "تعذر العثور على ملفات اللعبة داخل التطبيق."
        label.textColor = .white
        label.textAlignment = .center
        label.numberOfLines = 0
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24)
        ])
    }

    @objc private func handleEdgeBackGesture(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard gesture.state == .ended else { return }
        invokeWebBack()
    }

    private func invokeWebBack() {
        let script = "typeof window.maydanBack === 'function' ? Boolean(window.maydanBack()) : false"
        webView.evaluateJavaScript(script) { _, _ in }
    }

    // MARK: - WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        // اللعبة مدمجة كاملة: أصلها وحده يتنقّل داخل العرض.
        if isTrustedGameURL(url) {
            decisionHandler(.allow)
            return
        }
        // عودة مصادقة وصلت كتنقّل (لا كرابط عودة للجلسة): سلّم الرمز ولا تغادر.
        if let code = NativeConfig.authCode(from: url) {
            deliverAuthCode(code)
            decisionHandler(.cancel)
            return
        }
        // رابط خارجي نقره اللاعب (المصادر والتراخيص مثلًا) يُفتح في Safari لا داخل اللعبة.
        if navigationAction.navigationType == .linkActivated,
           let scheme = url.scheme?.lowercased(),
           scheme == "https" || scheme == "mailto" {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isRecoveringWebContent = false
        if isCommittingMigration {
            // زُرعت المحفوظات في الأصل الجديد وبدأت اللعبة بها: الانتقال منجز ولا يُعاد.
            isCommittingMigration = false
            migration?.markDone()
            webView.configuration.userContentController.removeAllUserScripts()
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard !isRecoveringWebContent else { return }
        isRecoveringWebContent = true

        // Loading the bundled entry point recreates the UI; localStorage remains available so
        // the web app can offer to resume the saved match.
        DispatchQueue.main.async { [weak self] in
            self?.webView.load(URLRequest(url: AppSchemeHandler.entryURL))
        }
    }

    // MARK: - Narrow native bridge

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Constants.bridgeName,
              message.webView === webView,
              message.frameInfo.isMainFrame,
              let pageURL = message.frameInfo.request.url,
              isTrustedGameURL(pageURL),
              let payload = message.body as? [String: Any],
              let type = payload["type"] as? String else {
            return
        }

        switch type {
        case "haptic":
            performHaptic(style: (payload["style"] as? String) ?? (payload["kind"] as? String))
        case "share":
            guard let text = payload["text"] as? String else { return }
            presentShareSheet(text: text)
        default:
            // أوامر بوعد: كل رسالة تحمل معرّفًا ويُردّ عليها عبر window.maydanNative.resolve.
            guard let id = payload["id"] as? String, !id.isEmpty, id.count <= 64 else { return }
            handle(command: type, id: id, payload: payload)
        }
    }

    private func isTrustedGameURL(_ url: URL) -> Bool {
        AppSchemeHandler.isAppURL(url)
    }

    // MARK: - Account and store commands

    private func handle(command: String, id: String, payload: [String: Any]) {
        switch command {
        case "products":
            run(id) {
                let list = try await StoreManager.shared.products(ids: NativeConfig.shared.productIds)
                return list.map(\.json) as [[String: Any]]
            }
        case "purchase":
            guard let productId = payload["productId"] as? String,
                  NativeConfig.shared.productIds.contains(productId) else {
                reply(id, error: .notEligible)
                return
            }
            // appAccountToken = معرّف مستخدم ميدان (UUID) فيربط الخادم المعاملة بالحساب الصحيح.
            let token = (payload["userId"] as? String).flatMap { UUID(uuidString: $0) }
            run(id) { [weak self] in
                guard let self else { throw StoreError.failed }
                let jws = try await StoreManager.shared.purchase(productId: productId, appAccountToken: token, from: self)
                return ["jws": jws] as [String: Any]
            }
        case "restore":
            run(id) {
                let transactions = try await StoreManager.shared.restore()
                return ["transactions": transactions] as [String: Any]
            }
        case "manageSubscriptions":
            run(id) { [weak self] in
                guard let self, let scene = self.view.window?.windowScene else { throw StoreError.failed }
                try await StoreManager.shared.manageSubscriptions(in: scene)
                return ["shown": true] as [String: Any]
            }
        case "signInApple":
            run(id) { [weak self] in
                guard let self else { throw AuthError.failed }
                return try await self.auth.signInWithApple() as [String: Any]
            }
        case "getTrials":
            reply(id, result: ["marks": TrialMirror.marks()])
        case "markTrial":
            guard let game = payload["game"] as? String, TrialMirror.isValidGame(game) else {
                reply(id, error: .invalid)
                return
            }
            reply(id, result: ["marks": TrialMirror.mark(game)])
        case "openAuth":
            // صفحة بدء الدخول على مضيف الـAPI فقط. الوعد يُحلّ فور فتح المتصفح، والرمز
            // (أو الإلغاء) يصل لاحقًا كحدث authReturn لأن الدخول قد يطول.
            guard let raw = payload["url"] as? String,
                  let url = URL(string: raw),
                  NativeConfig.shared.isTrustedAuthURL(url) else {
                reply(id, error: .notEligible)
                return
            }
            reply(id, result: ["started": true])
            Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    let callback = try await self.auth.openAuth(url: url)
                    if let code = NativeConfig.authCode(from: callback) {
                        self.deliverAuthCode(code)
                    } else {
                        self.emit(event: "authReturn", payload: ["error": BridgeError.provider.rawValue])
                    }
                } catch {
                    self.emit(event: "authReturn", payload: ["error": Self.bridgeError(for: error).rawValue])
                }
            }
        default:
            // No generic command execution, URL opening, file access, or arbitrary selectors.
            reply(id, error: .invalid)
        }
    }

    /// عودة المصادقة (من متصفح الجلسة أو من رابط `maydan://auth` خارجي).
    func deliverAuthCode(_ code: String) {
        emit(event: "authReturn", payload: ["code": code])
    }

    private func run(_ id: String, _ work: @escaping () async throws -> Any) {
        Task { @MainActor [weak self] in
            do {
                let result = try await work()
                self?.reply(id, result: result)
            } catch {
                self?.reply(id, error: Self.bridgeError(for: error))
            }
        }
    }

    private static func bridgeError(for error: Error) -> BridgeError {
        switch error {
        case StoreError.cancelled, AuthError.cancelled:
            return .cancelled
        case StoreError.pending:
            return .pending
        case StoreError.unknownProduct:
            return .notEligible
        case AuthError.failed, AuthError.busy:
            return .provider
        default:
            return .network
        }
    }

    private func reply(_ id: String, result: Any? = nil, error: BridgeError? = nil) {
        var body: [String: Any] = ["ok": error == nil]
        if let result {
            body["result"] = result
        }
        if let error {
            body["error"] = error.rawValue
        }
        evaluate("window.maydanNative && window.maydanNative.resolve(\(Self.json([id]))[0], \(Self.json(body)));")
    }

    private func emit(event name: String, payload: [String: Any]) {
        evaluate("window.maydanNative && window.maydanNative.event(\(Self.json([name]))[0], \(Self.json(payload)));")
    }

    private func evaluate(_ script: String) {
        webView.evaluateJavaScript(script) { _, _ in }
    }

    /// JSON آمن للحقن في JavaScript: المصفوفة تلفّ النص كي لا يُحقن شيء خارج سلسلة.
    private static func json(_ object: Any) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else {
            return "null"
        }
        return text
    }

    // MARK: - Haptics and sharing

    private func performHaptic(style: String?) {
        switch style?.lowercased() ?? "medium" {
        case "selection":
            let feedback = UISelectionFeedbackGenerator()
            feedback.prepare()
            feedback.selectionChanged()
        case "success":
            notify(.success)
        case "warning":
            notify(.warning)
        case "error":
            notify(.error)
        case "light":
            impact(.light)
        case "heavy":
            impact(.heavy)
        case "soft":
            impact(.soft)
        case "rigid":
            impact(.rigid)
        default:
            impact(.medium)
        }
    }

    private func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        let feedback = UIImpactFeedbackGenerator(style: style)
        feedback.prepare()
        feedback.impactOccurred()
    }

    private func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        let feedback = UINotificationFeedbackGenerator()
        feedback.prepare()
        feedback.notificationOccurred(type)
    }

    private func presentShareSheet(text rawText: String) {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty,
              text.count <= Constants.maximumShareTextLength,
              presentedViewController == nil else {
            return
        }

        let activityViewController = UIActivityViewController(
            activityItems: [text],
            applicationActivities: nil
        )
        if let popover = activityViewController.popoverPresentationController {
            popover.sourceView = webView
            popover.sourceRect = CGRect(
                x: webView.bounds.midX,
                y: webView.bounds.midY,
                width: 1,
                height: 1
            )
            popover.permittedArrowDirections = []
        }
        present(activityViewController, animated: true)
    }
}
