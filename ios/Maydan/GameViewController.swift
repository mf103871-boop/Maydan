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

final class GameViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private enum Constants {
        static let bridgeName = "maydan"
        static let maximumShareTextLength = 10_000
        static let backgroundColor = UIColor(
            red: 2 / 255,
            green: 6 / 255,
            blue: 23 / 255,
            alpha: 1
        )
    }

    private static let sharedProcessPool = WKProcessPool()

    private var webView: WKWebView!
    private var bridgeProxy: WeakScriptMessageHandler?
    private var isRecoveringWebContent = false

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

    private func loadBundledGame() {
        guard let url = Bundle.main.url(
            forResource: "index",
            withExtension: "html",
            subdirectory: "www"
        ) else {
            assertionFailure("Bundled game file is missing")
            showBundledGameMissingMessage()
            return
        }

        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
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

        // The game is fully bundled. Only its own local directory may navigate.
        decisionHandler(isTrustedGameURL(url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isRecoveringWebContent = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard !isRecoveringWebContent else { return }
        isRecoveringWebContent = true

        // Loading the bundled entry point recreates the UI; localStorage remains available so
        // the web app can offer to resume the saved match.
        DispatchQueue.main.async { [weak self] in
            self?.loadBundledGame()
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
            // No generic command execution, URL opening, file access, or arbitrary selectors.
            return
        }
    }

    private func isTrustedGameURL(_ url: URL) -> Bool {
        guard url.isFileURL,
              let directory = Bundle.main.url(
                forResource: "index",
                withExtension: "html",
                subdirectory: "www"
              )?.deletingLastPathComponent().standardizedFileURL else {
            return false
        }
        let candidate = url.standardizedFileURL.path
        let trustedPrefix = directory.path.hasSuffix("/") ? directory.path : directory.path + "/"
        return candidate.hasPrefix(trustedPrefix)
    }

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
