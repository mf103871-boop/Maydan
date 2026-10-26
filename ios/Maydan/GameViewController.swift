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
    private static let key = NativeConfig.shared.scopedStorageKey("maydan.trials.marks")
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
    case productsUnavailable = "APPLE_PRODUCTS_UNAVAILABLE"
    case notEligible = "NOT_ELIGIBLE"
    case invalid = "SIGNATURE"
}

final class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
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
    private var updateNavigationObservation: NSKeyValueObservation?
    private var bridgeProxy: WeakScriptMessageHandler?
    private var isRecoveringWebContent = false
    private var migration: StorageMigration?
    private var isCollectingMigration = false
    private var isCommittingMigration = false
    private var migrationSeedScript: WKUserScript?
    private var migrationSeedTimeout: Timer?
    private var migrationSeedNavigation: WKNavigation?
    private var migrationSeedWatchdog = StorageMigrationWatchdog()
    private var migrationProgressView: UIView?
    private var didChooseMigrationContinue = false
    private var migrationMayLoadGame: Bool { migration?.isDone == true || didChooseMigrationContinue }
    private var didLoadBundledGame = false
    private var drawingOrientation = DrawingOrientationPolicy()
    private var drawingWantsLandscape = false
    private var drawingRestoreOrientation: UIInterfaceOrientation?
    private var drawingOrientationExpiry: Timer?
    private var drawingForegroundObserver: NSObjectProtocol?
    private weak var edgeBackGesture: UIScreenEdgePanGestureRecognizer?
#if targetEnvironment(simulator)
    // An opt-in release gate, absent from device binaries. It observes the real
    // bundled app and media graph; no product debug bridge or network fixture.
    private let simulatorAudioFixture = ProcessInfo.processInfo.environment["MAYDAN_SIMULATOR_AUDIO"] == "streaming-recovery"
    private var simulatorAudioTimer: Timer?
    private var simulatorAudioReading = false
    private let simulatorOrientationFixture = ProcessInfo.processInfo.environment["MAYDAN_SIMULATOR_ORIENTATION"] == "lease-recovery"
    private var simulatorOrientationTimer: Timer?
    private var simulatorOrientationCommand: String?
    private var simulatorOrientationLastCommand: [String: String]?
    private var simulatorOrientationBaseline: Int?
    private let simulatorLaunchToken: String? = {
        guard let value = ProcessInfo.processInfo.environment["MAYDAN_SIMULATOR_LAUNCH_TOKEN"],
              let uuid = UUID(uuidString: value), uuid.uuidString.lowercased() == value else { return nil }
        return value
    }()
    private var simulatorLaunchRecorded = false
#endif
    private lazy var appUpdate = AppUpdateCoordinator(host: self, canPresent: { [weak self] in
        guard let self, self.presentedViewController == nil else { return false }
        return !self.didLoadBundledGame || (!self.webView.isLoading && AppUpdatePolicy.isIdleMenu(url: self.webView.url))
    }, setBlocked: { [weak self] blocked in
        guard let self else { return }
        self.webView.isUserInteractionEnabled = !blocked
        self.webView.accessibilityElementsHidden = blocked
        self.webView.setAllMediaPlaybackSuspended(blocked, completionHandler: nil)
    }, permitInitialLoad: { [weak self] in
        guard let self, !self.didLoadBundledGame else { return }
        self.didLoadBundledGame = true
        self.loadBundledGame()
    })
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
        // مقاطع الأسئلة تُعرض داخل الصفحة لا في مشغّل ملء الشاشة.
        configuration.allowsInlineMediaPlayback = true
        configuration.suppressesIncrementalRendering = false
        if let directory = Self.gameDirectory {
            configuration.setURLSchemeHandler(AppSchemeHandler(directory: directory), forURLScheme: AppSchemeHandler.scheme)
        }

        let bridgeProxy = WeakScriptMessageHandler(delegate: self)
        self.bridgeProxy = bridgeProxy
        configuration.userContentController.add(bridgeProxy, name: Constants.bridgeName)
#if targetEnvironment(simulator)
        if let token = simulatorLaunchToken {
            let payload = Self.json(["token": token])
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__maydanSimulatorLaunchToken = (\(payload)).token;",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if simulatorAudioFixture {
            configuration.userContentController.addUserScript(WKUserScript(
                source: Self.simulatorAudioScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
#endif

        let webView = WKWebView(frame: .zero, configuration: configuration)
        self.webView = webView
        updateNavigationObservation = webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in
                self?.appUpdate.navigationChanged()
                if let self, !DrawingOrientationPolicy.isRoomURL(self.webView.url) { self.releaseDrawingOrientation() }
            }
        }
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
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
        self.edgeBackGesture = edgeBackGesture
        containerView.addGestureRecognizer(edgeBackGesture)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        drawingForegroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.restoreDrawingOrientationIfPossible() }
        }
        // تجديدات الاشتراك والمشتريات المعلّقة تصل هنا خارج الشراء المباشر؛ الويب يرسل توقيعها للخادم.
        StoreManager.shared.onTransaction = { [weak self] jws in
            self?.emit(event: "transaction", payload: ["jws": jws])
        }
        StoreManager.shared.startListening()
        SocialCoordinator.shared.onEvent = { [weak self] name, payload in
            self?.emit(event: name, payload: payload)
        }
        SocialCoordinator.shared.onAudioActivityChange = { [weak self] in
            self?.appUpdate.audioActivityChanged()
        }
        SocialCoordinator.shared.onAudioLifecycle = { [weak self] payload in
            self?.evaluate("window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle', {detail: \(Self.json(payload))}));")
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        appUpdate.start()
        appUpdate.navigationChanged()
#if targetEnvironment(simulator)
        if simulatorOrientationFixture, simulatorOrientationTimer == nil {
            simulatorOrientationTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.recordSimulatorOrientation() }
            }
        }
#endif
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(
            forName: Constants.bridgeName
        )
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        bridgeProxy?.delegate = nil
        updateNavigationObservation?.invalidate()
        drawingOrientationExpiry?.invalidate()
        migrationSeedTimeout?.invalidate()
        if let drawingForegroundObserver { NotificationCenter.default.removeObserver(drawingForegroundObserver) }
#if targetEnvironment(simulator)
        simulatorAudioTimer?.invalidate()
        simulatorOrientationTimer?.invalidate()
#endif
    }

    override var prefersStatusBarHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { drawingWantsLandscape ? .landscape : .allButUpsideDown }

    private static func orientationMask(_ orientation: UIInterfaceOrientation?) -> UIInterfaceOrientationMask? {
        switch orientation {
        case .portrait: return .portrait
        case .landscapeLeft: return .landscapeLeft
        case .landscapeRight: return .landscapeRight
        default: return nil
        }
    }

    private func releaseDrawingOrientation(_ lease: String? = nil) {
        guard drawingOrientation.release(lease) else { return }
        drawingOrientationExpiry?.invalidate(); drawingOrientationExpiry = nil
        drawingWantsLandscape = false
        edgeBackGesture?.isEnabled = true
        setNeedsUpdateOfSupportedInterfaceOrientations()
        restoreDrawingOrientationIfPossible()
    }

    private func restoreDrawingOrientationIfPossible() {
        guard drawingOrientation.lease == nil, !drawingWantsLandscape,
              let restore = Self.orientationMask(drawingRestoreOrientation),
              let scene = view.window?.windowScene, UIApplication.shared.applicationState == .active else { return }
        drawingRestoreOrientation = nil
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: restore)) { _ in /* normal device rotation remains available */ }
    }

    private func applyDrawingOrientation(lease: String, generation: UInt64) {
        guard drawingOrientation.accepts(lease, generation: generation), let scene = view.window?.windowScene else { return }
        if drawingRestoreOrientation == nil { drawingRestoreOrientation = scene.interfaceOrientation }
        drawingWantsLandscape = true
        // The expanded board reaches the physical edge. Its ink gesture must
        // not also trigger room navigation; the visible room button stays usable.
        edgeBackGesture?.isEnabled = false
        setNeedsUpdateOfSupportedInterfaceOrientations()
        drawingOrientationExpiry?.invalidate()
        // A turn lasts 60 seconds with up to a 15-second disconnection pause. A finite safety
        // lease also releases a hung web surface; no preference is persisted.
        drawingOrientationExpiry = Timer.scheduledTimer(withTimeInterval: 90, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.drawingOrientation.accepts(lease, generation: generation) else { return }
                self.releaseDrawingOrientation(lease)
            }
        }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape)) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.drawingOrientation.accepts(lease, generation: generation) else { return }
                // iOS may decline the requested geometry. Keep focus ownership
                // and edge protection, while allowing ordinary manual rotation.
                self.drawingWantsLandscape = false
                self.setNeedsUpdateOfSupportedInterfaceOrientations()
            }
        }
    }

    private func requestDrawingOrientation(id: String, payload: [String: Any]) {
        guard payload["game"] as? String == "ersomha", let active = payload["active"] as? Bool,
              let lease = payload["lease"] as? String, DrawingOrientationPolicy.validLease(lease) else {
            reply(id, error: .invalid); return
        }
        if !active {
            releaseDrawingOrientation(lease)
            reply(id, result: ["released": true]); return
        }
        guard UIDevice.current.userInterfaceIdiom == .phone,
              UIApplication.shared.applicationState == .active, !appUpdate.isCoveringGame,
              DrawingOrientationPolicy.isRoomURL(webView.url), let generation = drawingOrientation.acquire(lease) else {
            reply(id, result: ["requested": false]); return
        }
        // Only the real current drawer's explicitly expanded surface may rotate
        // the phone. The trusted-main-frame guard runs before this command.
        let eligible = "Boolean(document.querySelector('[data-design-screen=\"ersomha.draw.drawer\"][data-ersomha-drawing-focus=\"true\"] .ers-canvas-panel.is-drawer'))"
        webView.evaluateJavaScript(eligible) { [weak self] value, error in
            guard let self, self.drawingOrientation.accepts(lease, generation: generation) else { return }
            guard error == nil, value as? Bool == true, DrawingOrientationPolicy.isRoomURL(self.webView.url) else {
                self.releaseDrawingOrientation(lease); self.reply(id, result: ["requested": false]); return
            }
            self.applyDrawingOrientation(lease: lease, generation: generation)
            // Acceptance is not an assertion of rotation. Web UI measures its
            // actual viewport and keeps a manual-rotation hint if iOS declines.
            self.reply(id, result: ["requested": true])
        }
    }

    override func accessibilityPerformEscape() -> Bool {
        guard !appUpdate.isCoveringGame else { return true }
        invokeWebBack()
        return true
    }

    // MARK: - Loading

    private func loadBundledGame() {
        guard !isCollectingMigration, !isCommittingMigration else { return }
        didChooseMigrationContinue = false
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
        isCollectingMigration = true
        showMigrationProgress()
        migration.collect(in: view) { [weak self] result in
            guard let self else { return }
            self.isCollectingMigration = false
            guard result.succeeded else { self.showMigrationRecovery(); return }
            // A genuinely empty read is complete; failed/partial reads never
            // reach this path. No game defaults have been created yet.
            if result.entries.isEmpty {
                StorageMigration.trace("read-verified-empty")
                migration.markDone()
                self.hideMigrationProgress()
                self.webView.load(URLRequest(url: AppSchemeHandler.entryURL))
                return
            }
            guard let script = migration.seedScript(entries: result.entries) else { self.showMigrationRecovery(); return }
            self.migrationSeedScript = script
            self.isCommittingMigration = true
            self.webView.configuration.userContentController.addUserScript(script)
            let generation = self.migrationSeedWatchdog.begin(at: ProcessInfo.processInfo.systemUptime)
            StorageMigration.trace("seed-loading")
            self.armMigrationSeedWatchdog(generation: generation)
            self.migrationSeedNavigation = self.webView.load(URLRequest(url: AppSchemeHandler.migrationURL))
        }
    }

    private func armMigrationSeedWatchdog(generation: UInt64) {
        migrationSeedTimeout?.invalidate()
        guard let delay = migrationSeedWatchdog.remaining(generation: generation, at: ProcessInfo.processInfo.systemUptime) else { return }
        migrationSeedTimeout = Timer.scheduledTimer(withTimeInterval: max(0.01, delay), repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.migrationSeedWatchdog.hasExpired(generation: generation, at: ProcessInfo.processInfo.systemUptime) else { return }
                StorageMigration.trace(self.migrationSeedWatchdog.phase == .loading ? "seed-timeout-loading" : "seed-timeout-result")
                self.finishMigrationSeed(succeeded: false)
            }
        }
    }

    private func finishMigrationSeed(succeeded: Bool) {
        guard isCommittingMigration else { return }
        migrationSeedWatchdog.finish(generation: migrationSeedWatchdog.generation)
        StorageMigration.trace(succeeded ? "seed-result-verified" : "seed-failed")
        isCommittingMigration = false
        isRecoveringWebContent = false
        migrationSeedNavigation = nil
        migrationSeedTimeout?.invalidate()
        migrationSeedTimeout = nil
        migration?.abandonSeed()
        if !succeeded { webView.stopLoading() }
        if let seed = migrationSeedScript {
            let controller = webView.configuration.userContentController
            let retained = controller.userScripts.filter { $0.source != seed.source }
            controller.removeAllUserScripts()
            retained.forEach { controller.addUserScript($0) }
            migrationSeedScript = nil
        }
        if succeeded { hideMigrationProgress(); webView.load(URLRequest(url: AppSchemeHandler.entryURL)) }
        else { showMigrationRecovery() }
    }

    private func showMigrationProgress() {
        guard migrationProgressView == nil else { return }
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.startAnimating()
        let label = UILabel()
        label.text = "جاري تجهيز اللعبة والمحفوظات…"
        label.textColor = .darkGray
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.textAlignment = .center
        label.numberOfLines = 0
        let progress = UIStackView(arrangedSubviews: [spinner, label])
        progress.axis = .vertical
        progress.spacing = 12
        progress.translatesAutoresizingMaskIntoConstraints = false
        progress.isAccessibilityElement = true
        progress.accessibilityLabel = label.text
        view.addSubview(progress)
        NSLayoutConstraint.activate([
            progress.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            progress.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            progress.leadingAnchor.constraint(greaterThanOrEqualTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            progress.trailingAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24)
        ])
        migrationProgressView = progress
    }

    private func hideMigrationProgress() {
        migrationProgressView?.removeFromSuperview()
        migrationProgressView = nil
    }

    private func showMigrationRecovery() {
        hideMigrationProgress()
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "تعذر نقل المحفوظات القديمة",
            message: "محفوظاتك القديمة لم تُحذف. أعد المحاولة، وحرّر مساحة إن كانت ممتلئة. المتابعة الآن تفتح اللعبة دون إكمال النقل؛ وقد تتقدم إعداداتك وحفظك الجديد على القديم عند المحاولة لاحقًا.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "إعادة المحاولة", style: .default) { [weak self] _ in self?.loadBundledGame() })
        alert.addAction(UIAlertAction(title: "المتابعة الآن", style: .cancel) { [weak self] _ in
            guard let self else { return }
            self.didChooseMigrationContinue = true
            self.webView.load(URLRequest(url: AppSchemeHandler.entryURL))
        })
        present(alert, animated: true)
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
        guard !appUpdate.isCoveringGame else { return }
        guard gesture.state == .ended else { return }
        invokeWebBack()
    }

    private func invokeWebBack() {
        let script = "typeof window.maydanNavigateBack === 'function' ? Boolean(window.maydanNavigateBack()) : false"
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

        // اللعبة مدمجة كاملة: أصلها وحده يتنقّل داخل العرض. رابط داخلي بـ target="_blank"
        // (targetFrame == nil) لا نافذة له في WKWebView، فيُفتح في العرض نفسه بدل أن يضيع.
        if isTrustedGameURL(url) {
            if navigationAction.targetFrame == nil {
                webView.load(URLRequest(url: url))
                decisionHandler(.cancel)
                return
            }
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
        if navigationAction.navigationType == .linkActivated, Self.isExternalLink(url) {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    /// https أو mailto فقط تُسلَّم للنظام؛ لا مخططات أخرى (tel، javascript، ملفات) من صفحة اللعبة.
    private static func isExternalLink(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "https" || scheme == "mailto"
    }

    // MARK: - WKUIDelegate

    /// روابط `target="_blank"` وwindow.open: لا نافذة ثانية في الغلاف. رابط اللعبة يُحمَّل في
    /// العرض نفسه، والرابط الخارجي (تراخيص الأصوات في «عن ميدان» مثلًا) يُفتح في Safari.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isTrustedGameURL(url) {
                webView.load(URLRequest(url: url))
            } else if Self.isExternalLink(url) {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !isCollectingMigration else { return }
        isRecoveringWebContent = false
        if isCommittingMigration, let current = migrationSeedNavigation, navigation === current {
            let generation = migrationSeedWatchdog.generation
            if migrationSeedWatchdog.documentReady(generation: generation, at: ProcessInfo.processInfo.systemUptime) {
                StorageMigration.trace("seed-awaiting-result")
                armMigrationSeedWatchdog(generation: generation)
            }
            return
        }
        guard !isCommittingMigration, migrationMayLoadGame, webView.url != AppSchemeHandler.migrationURL else { return }
        SocialCoordinator.shared.webAudioReady()
        appUpdate.navigationChanged()
#if targetEnvironment(simulator)
        if simulatorAudioFixture, simulatorAudioTimer == nil {
            simulatorAudioTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.recordSimulatorAudio() }
            }
        }
#endif
    }

#if targetEnvironment(simulator)
    private func recordSimulatorLaunchReady(_ payload: [String: Any], pageURL: URL) {
        guard !simulatorLaunchRecorded, let token = simulatorLaunchToken,
              payload["token"] as? String == token,
              !isCollectingMigration, !isCommittingMigration, migration?.isDone == true,
              pageURL.path == AppSchemeHandler.entryURL.path,
              payload["initialized"] as? Bool == true, payload["route"] as? String == "home",
              payload["gameCardCount"] as? Int == 7 else { return }
        let receipt: [String: Any] = ["token": token, "pid": ProcessInfo.processInfo.processIdentifier,
            "ready": true, "phase": "home-ready", "route": "home", "gameCardCount": 7,
            "initialized": true, "migrationComplete": true]
        do {
            let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("MaydanLaunchSmoke", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
                .write(to: directory.appendingPathComponent("ready.json"), options: .atomic)
            simulatorLaunchRecorded = true
        } catch { print("Maydan launch readiness: receipt-write-failed") }
    }

    /// CI injects only lease commands. Orientation and WK viewport values below
    /// are read from UIKit after its real geometry request; none are fabricated.
    private func recordSimulatorOrientation() {
        guard simulatorOrientationFixture, let scene = view.window?.windowScene,
              let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let folder = documents.appendingPathComponent("drawing-orientation-fixture", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let commandURL = folder.appendingPathComponent("command.json")
            if let data = try? Data(contentsOf: commandURL),
               let command = try? JSONSerialization.jsonObject(with: data) as? [String: String],
               let id = command["id"], id.count <= 64, id != simulatorOrientationCommand,
               let name = command["command"], ["portrait", "acquire-first", "acquire-next", "release-stale", "release-current"].contains(name) {
                simulatorOrientationCommand = id
                simulatorOrientationLastCommand = command
                try FileManager.default.removeItem(at: commandURL)
                switch name {
                case "portrait":
                    releaseDrawingOrientation()
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
                case "acquire-first", "acquire-next":
                    let lease = name == "acquire-first" ? "ers-simulator-first" : "ers-simulator-next"
                    if let generation = drawingOrientation.acquire(lease) { applyDrawingOrientation(lease: lease, generation: generation) }
                case "release-stale": releaseDrawingOrientation("ers-simulator-first")
                case "release-current": releaseDrawingOrientation("ers-simulator-next")
                default: break
                }
            }
            if simulatorOrientationLastCommand?["command"] == "portrait", scene.interfaceOrientation == .portrait {
                simulatorOrientationBaseline = scene.interfaceOrientation.rawValue
            }
            let state: [String: Any] = [
                "fixture": "drawing-orientation-lease",
                "generatedAt": Int(Date().timeIntervalSince1970 * 1000),
                "lastCommand": simulatorOrientationLastCommand ?? [:],
                "baselineRaw": simulatorOrientationBaseline.map { $0 as Any } ?? NSNull(),
                "orientationRaw": scene.interfaceOrientation.rawValue,
                "landscape": scene.interfaceOrientation.isLandscape,
                "webWidth": webView.bounds.width,
                "webHeight": webView.bounds.height,
                "supportedMask": supportedInterfaceOrientations.rawValue,
                "edgeBackEnabled": edgeBackGesture?.isEnabled ?? false,
                "lease": drawingOrientation.lease.map { $0 as Any } ?? NSNull(),
                "generation": drawingOrientation.generation,
                "gameLoaded": didLoadBundledGame && !webView.isLoading && webView.url != nil,
                "eligibilityInjected": true,
                "geometryInjected": false
            ]
            try Self.json(state).write(to: folder.appendingPathComponent("state.json"), atomically: true, encoding: .utf8)
        } catch { /* missing measurements fail the external release gate */ }
    }

    private func recordSimulatorAudio() {
        guard simulatorAudioFixture, !simulatorAudioReading,
              let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let folder = documents.appendingPathComponent("audio-stream-fixture", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let commandURL = folder.appendingPathComponent("command.json")
            var command: [String: String]?
            if let data = try? Data(contentsOf: commandURL),
               let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: String],
               let name = parsed["command"], ["activate", "background", "foreground", "replace-context"].contains(name),
               let id = parsed["id"], id.count <= 64 {
                command = parsed
                try FileManager.default.removeItem(at: commandURL)
            }
            let action = command.map { "window.__maydanAudioSmoke?.perform(\(Self.json($0)));" } ?? ""
            simulatorAudioReading = true
            webView.evaluateJavaScript(action + "JSON.stringify(window.__maydanAudioSmoke?.snapshot() || {error:'audio instrumentation missing'});") { [weak self] value, error in
                self?.simulatorAudioReading = false
                let state = (value as? String) ?? Self.json(["error": error?.localizedDescription ?? "No measured audio state"])
                try? state.write(to: folder.appendingPathComponent("state.json"), atomically: true, encoding: .utf8)
            }
        } catch {
            let state = Self.json(["error": "Simulator audio evidence file failed: \(error.localizedDescription)"])
            try? state.write(to: folder.appendingPathComponent("state.json"), atomically: true, encoding: .utf8)
        }
    }

    private static let simulatorAudioScript = #"""
    (() => {
      const proof = {fixture:'streaming-recovery',contexts:[],media:[],decoded:[],errors:[],lastCommand:null};
      const NativeAC = window.AudioContext || window.webkitAudioContext;
      proof.webAudioSupported = typeof NativeAC === 'function';
      // This simulator is owned by the release gate and has no player account.
      localStorage.setItem('maydan:platform:settings', JSON.stringify({soundOn:true,soundVolume:.75,voiceOn:false,musicOn:true,musicVolume:.5,musicLevel:2,splashSeen:true,reducedMotion:true}));
      if (proof.webAudioSupported) {
        class MeasuredAudioContext extends NativeAC {
          constructor(options) { super(options); proof.contexts.push(this); }
          createMediaElementSource(media) {
            const node = super.createMediaElementSource(media);
            proof.media.push({media,context:this});
            return node;
          }
          createDynamicsCompressor() {
            const node = super.createDynamicsCompressor(), meter = super.createAnalyser();
            meter.fftSize = 256; node.connect(meter); this.proofMeter = meter;
            return node;
          }
          decodeAudioData(bytes, success, failure) {
            const record = buffer => { if (buffer) proof.decoded.push(buffer.duration); return buffer; };
            // Promise-only recording avoids counting the same decode twice when
            // production supports both the promise and callback Web Audio APIs.
            const result = super.decodeAudioData(bytes, success, failure);
            if (result && typeof result.then === 'function') result.then(record, () => {});
            return result;
          }
        }
        window.AudioContext = MeasuredAudioContext;
        if (window.webkitAudioContext === NativeAC) window.webkitAudioContext = MeasuredAudioContext;
      }
      const lifecycle = state => window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle',{detail:{state,shouldResume:true}}));
      proof.perform = ({id,command}) => {
        proof.lastCommand = {id,command};
        if (command === 'activate') document.dispatchEvent(new Event('pointerdown',{bubbles:true}));
        if (command === 'background') lifecycle('background');
        if (command === 'foreground') { lifecycle('foreground'); document.dispatchEvent(new Event('pointerdown',{bubbles:true})); }
        if (command === 'replace-context') {
          const context = proof.contexts.at(-1);
          if (!context) { proof.errors.push('No context to replace'); return; }
          Promise.resolve(context.close()).then(() => {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('pointerdown',{bubbles:true}));
          }, error => proof.errors.push(String(error)));
        }
      };
      proof.snapshot = () => {
        const context = proof.contexts.at(-1), samples = new Float32Array(256);
        context?.proofMeter?.getFloatTimeDomainData(samples);
        return {fixture:proof.fixture,generatedAt:Date.now(),documentURL:location.href,webAudioSupported:proof.webAudioSupported,
          lastCommand:proof.lastCommand,contextCount:proof.contexts.length,contextState:context?.state || null,
          contextTime:context?.currentTime || 0,rms:Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length),
          decodedCount:proof.decoded.length,decodedMaxSeconds:Math.max(0,...proof.decoded),errors:proof.errors.slice(),
          media:proof.media.map(({media,context:owner})=>({url:media.currentSrc || media.src,duration:Number.isFinite(media.duration)?media.duration:null,
            time:media.currentTime,paused:media.paused,readyState:media.readyState,error:media.error?.code || null,
            contextIndex:proof.contexts.indexOf(owner),contextState:owner.state}))};
      };
      window.addEventListener('unhandledrejection',event=>proof.errors.push(String(event.reason)));
      window.__maydanAudioSmoke = proof;
    })();
    """#
#endif

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // A failed staging process has not earned permission to initialize the
        // game. Clear the token/script/timer and retain explicit recovery.
        if isCollectingMigration {
            // This callback is for the main view, but the hidden reader may
            // share its process. Never initialize defaults before its proof.
            migration?.cancelCollection()
            return
        }
        if isCommittingMigration {
            finishMigrationSeed(succeeded: false)
            return
        }
        if webView.url == AppSchemeHandler.migrationURL {
            showMigrationRecovery()
            return
        }
        // A failed collection may leave the main URL blank. A subsequent
        // process callback must not bypass the visible recovery choice.
        guard didLoadBundledGame, migrationMayLoadGame else { return }
        guard !isRecoveringWebContent else { return }
        isRecoveringWebContent = true
        releaseDrawingOrientation()
        SocialCoordinator.shared.webDidReload()

        // Loading the bundled entry point recreates the UI; localStorage remains available so
        // the web app can offer to resume the saved match.
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.isCollectingMigration, !self.isCommittingMigration,
                  self.didLoadBundledGame, self.migrationMayLoadGame,
                  self.webView.url != AppSchemeHandler.migrationURL else { return }
            self.webView.load(URLRequest(url: AppSchemeHandler.entryURL))
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard isCommittingMigration, let current = migrationSeedNavigation, navigation === current else { return }
        finishMigrationSeed(succeeded: false)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard isCommittingMigration, let current = migrationSeedNavigation, navigation === current else { return }
        finishMigrationSeed(succeeded: false)
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
#if targetEnvironment(simulator)
        case "simulatorGameReady":
            recordSimulatorLaunchReady(payload, pageURL: pageURL)
#endif
        case "migrationSeedResult":
            guard isCommittingMigration, pageURL == AppSchemeHandler.migrationURL,
                  let succeeded = migration?.acceptSeedResult(payload) else { return }
            finishMigrationSeed(succeeded: succeeded)
        case "gameAudioResume":
            SocialCoordinator.shared.resumeGameAudioFromGesture()
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
        let socialCommands: Set<String> = [
            "socialStoredSession", "socialSession", "socialLogout", "socialNotifications",
            "socialCallConnect", "socialCallMute", "socialCallSpeaker", "socialCallEnd", "socialCallResumeAudio", "socialCallPauseGame",
            "socialVoiceStart", "socialVoiceStop", "socialVoiceCancel", "socialAudioPrivacy"
        ]
        if socialCommands.contains(command) {
            if command == "socialLogout" { releaseDrawingOrientation() }
            if command == "socialAudioPrivacy" { appUpdate.setPrivateTurn(payload["privateTurn"] as? Bool ?? false) }
            Task { @MainActor [weak self] in
                // Several native commands release busy state after their last
                // event (permission denial, recorder stop, failed connection).
                defer { self?.appUpdate.audioActivityChanged(commandCompleted: true) }
                do {
                    let result = try await SocialCoordinator.shared.handle(command, payload: payload)
                    self?.reply(id, result: result)
                } catch {
                    let body: [String: Any] = ["ok": false, "error": SocialCoordinator.errorCode(error)]
                    self?.evaluate("window.maydanNative && window.maydanNative.resolve(\(Self.json([id]))[0], \(Self.json(body)));")
                }
            }
            return
        }
        switch command {
        case "drawingOrientation":
            requestDrawingOrientation(id: id, payload: payload)
        case "storeStatus":
            reply(id, result: StoreManager.shared.catalogStatus())
        case "products":
            run(id) {
                await StoreManager.shared.catalog(ids: NativeConfig.shared.productIds)
            }
        case "storeProbe":
            run(id) {
                await StoreManager.shared.storeProbe(ids: NativeConfig.shared.productIds)
            }
        case "purchase":
            guard let productId = payload["productId"] as? String,
                  NativeConfig.shared.productIds.contains(productId) else {
                reply(id, error: .productsUnavailable)
                return
            }
            // appAccountToken = معرّف مستخدم ميدان (UUID) فيربط الخادم المعاملة بالحساب الصحيح.
            let token = (payload["userId"] as? String).flatMap { UUID(uuidString: $0) }
            guard token != nil else { reply(id, error: .notEligible); return }
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
        case "pendingTransactions":
            run(id) {
                return ["transactions": await StoreManager.shared.pendingTransactions()] as [String: Any]
            }
        case "finishTransaction":
            guard let jws = payload["jws"] as? String, !jws.isEmpty, jws.count <= 32_768 else {
                reply(id, error: .invalid)
                return
            }
            run(id) {
                await StoreManager.shared.finishTransaction(jws: jws)
                return ["finished": true] as [String: Any]
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

    private func run(_ id: String, _ work: @escaping @MainActor () async throws -> Any) {
        Task { @MainActor [weak self] in
            do {
                let result = try await work()
                self?.reply(id, result: result)
            } catch {
                if let syncError = error as? StoreSyncError {
                    self?.reply(id, error: Self.bridgeError(for: syncError.underlying),
                                diagnostics: StoreManager.restoreDiagnostics(syncError.underlying))
                } else {
                    self?.reply(id, error: Self.bridgeError(for: error))
                }
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
            return .productsUnavailable
        case AuthError.failed, AuthError.busy:
            return .provider
        default:
            return .network
        }
    }

    private func reply(_ id: String, result: Any? = nil, error: BridgeError? = nil,
                       diagnostics: [String: Any]? = nil) {
        var body: [String: Any] = ["ok": error == nil]
        if let result {
            body["result"] = result
        }
        if let error {
            body["error"] = error.rawValue
            if let diagnostics {
                body["diagnostics"] = diagnostics
            }
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
