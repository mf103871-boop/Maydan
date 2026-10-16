import Foundation
import StoreKit
import UIKit

private final class AppPolicyRedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

/// No policy is persisted: an unreachable server, unavailable storefront or
/// revoked policy cannot strand a player behind yesterday's mandatory screen.
@MainActor
final class AppUpdateCoordinator {
    private weak var host: UIViewController?
    private let canPresent: () -> Bool
    private let setBlocked: (Bool) -> Void
    private let permitInitialLoad: () -> Void
    private let redirectBlocker = AppPolicyRedirectBlocker()
    private lazy var http: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 2.5
        configuration.timeoutIntervalForResource = 3
        configuration.waitsForConnectivity = false
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration, delegate: redirectBlocker, delegateQueue: nil)
    }()
    private var task: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var generation = AppUpdateCheckGeneration()
    private var observers: [NSObjectProtocol] = []
    private var panel: AppUpdatePanel?
    private var started = false
    private var initialLoadPermitted = false
    private var requiredPolicy: AppUpdatePolicy?
    var isCoveringGame: Bool { panel != nil }
#if targetEnvironment(simulator)
    // Finite local scenarios, compiled out of every device binary. They exercise
    // the mounted panel and real Retry action without changing production policy.
    private let simulatorFixture = ProcessInfo.processInfo.environment["MAYDAN_SIMULATOR_APP_POLICY"] == "required-then-offline"
    private var simulatorOffline = false
    private var simulatorTimer: Timer?
#endif

    init(host: UIViewController, canPresent: @escaping () -> Bool,
         setBlocked: @escaping (Bool) -> Void, permitInitialLoad: @escaping () -> Void) {
        self.host = host
        self.canPresent = canPresent
        self.setBlocked = setBlocked
        self.permitInitialLoad = permitInitialLoad
    }

    deinit {
        task?.cancel()
        deadline?.cancel()
        observers.forEach { NotificationCenter.default.removeObserver($0) }
#if targetEnvironment(simulator)
        simulatorTimer?.invalidate()
#endif
    }

    func start() {
        guard !started else { return }
        started = true
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.check() }
        })
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.cancelCheck() }
        })
        showChecking()
        check()
#if targetEnvironment(simulator)
        if simulatorFixture {
            simulatorTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.recordSimulatorState() }
            }
        }
#endif
    }

    func audioActivityChanged() {
        guard SocialCoordinator.shared.isBusyForAppUpdate else { return }
        cancelCheck()
        allowGame()
    }

    private func cancelCheck() {
        _ = generation.advance()
        task?.cancel(); task = nil
        deadline?.cancel(); deadline = nil
    }

    private func check() {
        cancelCheck()
        guard UIApplication.shared.applicationState == .active else { return }
        guard !SocialCoordinator.shared.isBusyForAppUpdate, canPresent() else { allowGame(); return }
#if targetEnvironment(simulator)
        if simulatorFixture {
            let fixture = Data(#"{"schemaVersion":1,"enabled":true,"minimumBuild":999999,"minimumVersion":"999.0","appStoreId":"6808385717","message":"يتوفر تحديث مطلوب لميدان. حدّث التطبيق للمتابعة."}"#.utf8)
            if !simulatorOffline, let policy = AppUpdatePolicy.required(data: fixture,
                installedVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                installedBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") {
                showRequired(policy)
            } else { allowGame() }
            return
        }
#endif
        guard let storefront = SKPaymentQueue.default().storefront?.countryCode,
              storefront.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
              var url = URLComponents(string: NativeConfig.shared.apiOrigin), url.scheme == "https", url.host != nil else {
            allowGame(); return
        }
        url.path = "/api/app-policy/ios"
        url.queryItems = [URLQueryItem(name: "storefront", value: storefront),
                          URLQueryItem(name: "osVersion", value: UIDevice.current.systemVersion)]
        guard let endpoint = url.url else { allowGame(); return }
        let attempt = generation.value
        if requiredPolicy != nil { panel?.setChecking(true) }
        // A separate deadline also covers DNS/transport implementations that
        // outlive URLSession's own timeout. Late completions cannot re-lock UI.
        deadline = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { return }
            guard let self, self.generation.accepts(attempt) else { return }
            self.cancelCheck()
            self.allowGame()
        }
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            var request = URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2.5)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("maydan://app", forHTTPHeaderField: "Origin")
            var policy: AppUpdatePolicy?
            do {
                let (data, response) = try await self.http.data(for: request)
                if let response = response as? HTTPURLResponse, response.statusCode == 200,
                   response.url == endpoint, data.count <= 8_192 {
                    policy = AppUpdatePolicy.required(data: data,
                        installedVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                        installedBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "")
                }
            } catch { /* Offline, cancellation and malformed data all fail open. */ }
            guard !Task.isCancelled, self.generation.accepts(attempt) else { return }
            self.deadline?.cancel(); self.deadline = nil
            self.task = nil
            guard UIApplication.shared.applicationState == .active,
                  !SocialCoordinator.shared.isBusyForAppUpdate, self.canPresent(), let policy else {
                self.allowGame(); return
            }
            self.showRequired(policy)
        }
    }

    private func showChecking() {
        guard !initialLoadPermitted else { return }
        let view = makePanel()
        view.configure(message: "نجهّز ميدان…", required: false)
        view.setChecking(true)
    }

    private func showRequired(_ policy: AppUpdatePolicy) {
        requiredPolicy = policy
        let view = makePanel()
        view.configure(message: policy.message, required: true)
        view.setChecking(false)
        UIAccessibility.post(notification: .screenChanged, argument: view.heading)
    }

    private func makePanel() -> AppUpdatePanel {
        if let panel { return panel }
        let view = AppUpdatePanel()
        view.onUpdate = { [weak self] in self?.openStore() }
        view.onRetry = { [weak self] in self?.check() }
        guard let host else { return view }
        host.view.addSubview(view)
        view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            view.topAnchor.constraint(equalTo: host.view.topAnchor),
            view.bottomAnchor.constraint(equalTo: host.view.bottomAnchor),
            view.leadingAnchor.constraint(equalTo: host.view.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: host.view.trailingAnchor)
        ])
        panel = view
        setBlocked(true)
        return view
    }

    private func allowGame() {
        requiredPolicy = nil
        panel?.removeFromSuperview(); panel = nil
        setBlocked(false)
        if !initialLoadPermitted {
            initialLoadPermitted = true
            permitInitialLoad()
        }
    }

    private func openStore() {
        // Server content never controls a URL or a custom scheme.
        UIApplication.shared.open(AppUpdatePolicy.appStoreURL, options: [:]) { [weak self] opened in
            Task { @MainActor in
                if !opened { self?.panel?.setHint("تعذّر فتح App Store. تأكد من الاتصال وحاول مجددًا.") }
            }
        }
    }

#if targetEnvironment(simulator)
    private func recordSimulatorState() {
        guard simulatorFixture, let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let folder = documents.appendingPathComponent("app-update-fixture", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let command = folder.appendingPathComponent("command.txt")
            if (try? String(contentsOf: command, encoding: .utf8)) == "retry-offline" {
                try? FileManager.default.removeItem(at: command)
                simulatorOffline = true
                panel?.performSimulatorRetry()
            }
            var snapshot: [String: Any] = ["fixture": "required-then-offline", "blocked": requiredPolicy != nil,
                "initialLoadPermitted": initialLoadPermitted, "offline": simulatorOffline]
            if let panel { snapshot["panel"] = panel.simulatorSnapshot() }
            else { snapshot["panel"] = NSNull() }
            try JSONSerialization.data(withJSONObject: snapshot).write(to: folder.appendingPathComponent("state.json"), options: .atomic)
        } catch { /* The external gate fails if it cannot read view evidence. */ }
    }
#endif
}

@MainActor
private final class AppUpdatePanel: UIView {
    let heading = UILabel()
    private let message = UILabel()
    private let hint = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let update = UIButton(type: .system)
    private let retry = UIButton(type: .system)
    var onUpdate: (() -> Void)?
    var onRetry: (() -> Void)?

    init() {
        super.init(frame: .zero)
        backgroundColor = UIColor(red: 1, green: 247 / 255, blue: 231 / 255, alpha: 1)
        accessibilityViewIsModal = true
        semanticContentAttribute = .forceRightToLeft
        heading.text = "ميدان"
        heading.font = .preferredFont(forTextStyle: .largeTitle)
        heading.accessibilityTraits = .header
        message.font = .preferredFont(forTextStyle: .title2)
        hint.font = .preferredFont(forTextStyle: .body)
        for label in [heading, message, hint] {
            label.numberOfLines = 0
            label.textAlignment = .center
            label.adjustsFontForContentSizeCategory = true
            label.textColor = UIColor(red: 56 / 255, green: 35 / 255, blue: 76 / 255, alpha: 1)
        }
        var primary = UIButton.Configuration.filled()
        primary.title = "تحديث من App Store"
        primary.baseBackgroundColor = UIColor(red: 0, green: 123 / 255, blue: 133 / 255, alpha: 1)
        primary.cornerStyle = .large
        update.configuration = primary
        var secondary = UIButton.Configuration.bordered()
        secondary.title = "إعادة التحقق"
        secondary.cornerStyle = .large
        retry.configuration = secondary
        update.titleLabel?.adjustsFontForContentSizeCategory = true
        retry.titleLabel?.adjustsFontForContentSizeCategory = true
        update.addTarget(self, action: #selector(updateTapped), for: .touchUpInside)
        retry.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        update.accessibilityHint = "يفتح صفحة ميدان في متجر التطبيقات"
        retry.accessibilityHint = "يتحقق مجددًا من توفر التحديث المطلوب"
        let scroll = UIScrollView()
        let stack = UIStackView(arrangedSubviews: [heading, message, spinner, update, retry, hint])
        stack.axis = .vertical; stack.spacing = 22
        scroll.translatesAutoresizingMaskIntoConstraints = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scroll); scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 48),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -48),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -28),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -56),
            update.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
            retry.heightAnchor.constraint(greaterThanOrEqualToConstant: 52)
        ])
    }

    required init?(coder: NSCoder) { return nil }
    override func accessibilityPerformEscape() -> Bool { true }
    func configure(message text: String, required: Bool) {
        heading.text = required ? "تحديث ميدان مطلوب" : "ميدان"
        message.text = text
        hint.text = required ? "تبقى بياناتك ومحفوظاتك كما هي بعد التحديث." : ""
        update.isHidden = !required
        retry.isHidden = !required
    }
    func setChecking(_ checking: Bool) {
        checking ? spinner.startAnimating() : spinner.stopAnimating()
        spinner.isHidden = !checking
        retry.isEnabled = !checking
    }
    func setHint(_ text: String) { hint.text = text; UIAccessibility.post(notification: .announcement, argument: text) }
    @objc private func updateTapped() { onUpdate?() }
    @objc private func retryTapped() { onRetry?() }
#if targetEnvironment(simulator)
    func performSimulatorRetry() { retry.sendActions(for: .touchUpInside) }
    func simulatorSnapshot() -> [String: Any] {
        func button(_ value: UIButton) -> [String: Any] {
            let frame = value.convert(value.bounds, to: self)
            return ["title": value.configuration?.title ?? "", "hidden": value.isHidden,
                    "enabled": value.isEnabled, "width": frame.width, "height": frame.height,
                    "accessible": value.isAccessibilityElement]
        }
        return ["heading": heading.text ?? "", "message": message.text ?? "",
                "mounted": window != nil, "width": bounds.width, "height": bounds.height,
                "modalAccessibility": accessibilityViewIsModal,
                "update": button(update), "retry": button(retry)]
    }
#endif
}
