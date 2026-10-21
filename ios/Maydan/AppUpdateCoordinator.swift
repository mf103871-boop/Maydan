import Foundation
import Network
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
    private var retryTask: Task<Void, Never>?
    private var storefrontLookup: Task<Void, Never>?
    private var storefrontUpdates: Task<Void, Never>?
    private var waitingStorefrontAttempt: UInt64?
    private var currentAttempt: UInt64?
    private var retryState = AppUpdateRetryState()
    private let network = NWPathMonitor()
    private var networkSatisfied: Bool?
    private var lastAudioBusy = false
    private var keyboardVisible = false
    private var privateTurn = false
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
    private var simulatorStorefrontAttempts = 0
    private var simulatorObservedUnavailableStorefront = false
    private var simulatorRequestCount = 0
    private var simulatorLastRequest: [String: String]?
    private var simulatorPhase = "idle"
    private var simulatorFailOpenReason: String?
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
        retryTask?.cancel()
        storefrontLookup?.cancel()
        storefrontUpdates?.cancel()
        network.cancel()
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
            Task { @MainActor in self?.beginCycle() }
        })
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.retryState.deferCheck()
                self?.cancelCheck()
            }
        })
        observers.append(center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.keyboardVisible = true
                self.deferUntilSafe()
            }
        })
        observers.append(center.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.keyboardVisible = false; self?.resumePending() }
        })
        lastAudioBusy = SocialCoordinator.shared.isBusyForAppUpdate
        observeConnectivity()
        observeStorefrontUpdates()
        showChecking()
        beginCycle()
#if targetEnvironment(simulator)
        if simulatorFixture {
            simulatorTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.recordSimulatorState() }
            }
        }
#endif
    }

    private func observeConnectivity() {
#if targetEnvironment(simulator)
        guard !simulatorFixture else { return }
#endif
        network.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                let recovered = self.networkSatisfied == false && satisfied
                self.networkSatisfied = satisfied
                if recovered { self.retryState.deferCheck(); self.resumePending() }
            }
        }
        network.start(queue: DispatchQueue(label: "maydan.update-connectivity"))
    }

    func audioActivityChanged(commandCompleted: Bool = false) {
        let busy = SocialCoordinator.shared.isBusyForAppUpdate
        guard busy != lastAudioBusy else {
            // Permission denial can clear `starting` without ever emitting a
            // busy event. Explicit command completion is a recovery signal;
            // repeated speaking snapshots are not.
            if commandCompleted && !busy { resumePending() }
            return
        }
        lastAudioBusy = busy
        if busy { deferUntilSafe() }
        else { resumePending() }
    }

    private func observeStorefrontUpdates() {
#if targetEnvironment(simulator)
        guard !simulatorFixture else { return }
#endif
        storefrontUpdates = Task { @MainActor [weak self] in
            for await storefront in Storefront.updates {
                guard !Task.isCancelled else { return }
                self?.storefrontChanged(storefront.countryCode)
            }
        }
    }

    func navigationChanged() {
        guard started else { return }
        guard safeToCheck else {
            if SocialCoordinator.shared.isBusyForAppUpdate { lastAudioBusy = true }
            // A same-document route change can occur during StoreKit/HTTP work.
            // Invalidate it immediately, rather than waiting for its completion.
            if currentAttempt != nil || requiredPolicy != nil || retryTask != nil { deferUntilSafe() }
            return
        }
        resumePending()
    }

    func setPrivateTurn(_ value: Bool) {
        guard privateTurn != value else { return }
        privateTurn = value
        if value { deferUntilSafe() }
        else { resumePending() }
    }

    private var safeToCheck: Bool {
        !SocialCoordinator.shared.isBusyForAppUpdate && !privateTurn && !keyboardVisible && canPresent()
    }

    private func beginCycle() {
        cancelCheck()
        retryState.beginCycle()
        check()
    }

    private func deferUntilSafe() {
        guard started, retryState.needsCheck || currentAttempt != nil || requiredPolicy != nil else { return }
        lastAudioBusy = SocialCoordinator.shared.isBusyForAppUpdate
        retryState.deferCheck()
        cancelCheck()
        allowGame()
#if targetEnvironment(simulator)
        simulatorPhase = "deferred"
#endif
    }

    private func resumePending() {
        guard started, retryState.needsCheck, currentAttempt == nil,
              UIApplication.shared.applicationState == .active else { return }
        guard safeToCheck else {
            if SocialCoordinator.shared.isBusyForAppUpdate { lastAudioBusy = true }
            return
        }
        // Coalesce URL/keyboard/social notifications in the same UI transition.
        // This does not reset or replenish the finite failure-retry budget.
        retryTask?.cancel()
        retryTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: 150_000_000) } catch { return }
            guard let self else { return }
            self.retryTask = nil
            self.check()
        }
    }

    private func scheduleAutomaticRetry() {
        guard retryTask == nil, UIApplication.shared.applicationState == .active,
              safeToCheck, let delay = retryState.nextAutomaticDelay() else { return }
        retryTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            guard let self else { return }
            self.retryTask = nil
            self.check()
        }
    }

    private func storefrontChanged(_ country: String) {
        guard started else { return }
        retryState.deferCheck()
        guard UIApplication.shared.applicationState == .active, safeToCheck else { return }
        // An update supplies a fresh StoreKit value even if an older current
        // lookup ignores cancellation. No second lookup task is created.
        cancelCheck()
        check(storefrontHint: country)
    }

    private func cancelCheck() {
        _ = generation.advance()
        task?.cancel(); task = nil
        deadline?.cancel(); deadline = nil
        retryTask?.cancel(); retryTask = nil
        waitingStorefrontAttempt = nil
        currentAttempt = nil
    }

    private func check(storefrontHint: String? = nil) {
        guard currentAttempt == nil, UIApplication.shared.applicationState == .active else { return }
        guard safeToCheck else { deferUntilSafe(); return }
        retryTask?.cancel(); retryTask = nil
        let attempt = generation.advance()
        currentAttempt = attempt
        if requiredPolicy != nil { panel?.setChecking(true) }
#if targetEnvironment(simulator)
        simulatorPhase = "checking-storefront"
        simulatorFailOpenReason = nil
#endif
        // One absolute deadline starts BEFORE Storefront.current. Cancellation-
        // insensitive StoreKit or transport work cannot extend the UI deadline.
        deadline = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { return }
            guard let self, self.generation.accepts(attempt), self.currentAttempt == attempt else { return }
            self.failOpen(reason: "timeout", attempt: attempt)
        }
        if let storefrontHint { receiveStorefront(storefrontHint, attempt: attempt) }
        else {
            waitingStorefrontAttempt = attempt
            startStorefrontLookup()
        }
    }

    private func startStorefrontLookup() {
        // At most one StoreKit lookup exists, even if StoreKit ignores task
        // cancellation across repeated foreground/timeouts. A completed result
        // is consumed only by its original, still-current waiting generation.
        guard storefrontLookup == nil, let lookupAttempt = waitingStorefrontAttempt else { return }
#if targetEnvironment(simulator)
        simulatorStorefrontAttempts += 1
        let fixture = simulatorFixture
        let fixtureMissing = !simulatorObservedUnavailableStorefront
#endif
        storefrontLookup = Task { @MainActor [weak self] in
            let country: String?
#if targetEnvironment(simulator)
            if fixture {
                // First launch fails open, then ordinary retry must use the
                // production endpoint/decoder/UI path to display the panel.
                try? await Task.sleep(nanoseconds: 100_000_000)
                country = fixtureMissing ? nil : "JOR"
            } else { country = await Storefront.current?.countryCode }
#else
            country = await Storefront.current?.countryCode
#endif
            guard let self else { return }
            self.storefrontLookup = nil
            guard let attempt = self.waitingStorefrontAttempt else { return }
            guard attempt == lookupAttempt else {
                // Do not turn a late result from a canceled generation into a
                // fresh country's proof. Start one fresh lookup if still needed.
                self.startStorefrontLookup()
                return
            }
            self.waitingStorefrontAttempt = nil
            self.receiveStorefront(country, attempt: attempt)
        }
    }

    private func receiveStorefront(_ country: String?, attempt: UInt64) {
        guard generation.accepts(attempt), currentAttempt == attempt else { return }
        guard UIApplication.shared.applicationState == .active, safeToCheck else { deferUntilSafe(); return }
        guard let country, country.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil else {
#if targetEnvironment(simulator)
            if simulatorFixture { simulatorObservedUnavailableStorefront = true }
#endif
            failOpen(reason: "storefront-unavailable", attempt: attempt); return
        }
        guard var url = URLComponents(string: NativeConfig.shared.apiOrigin), url.scheme == "https", url.host != nil else {
            failOpen(reason: "configuration", attempt: attempt); return
        }
        url.path = "/api/app-policy/ios"
        url.queryItems = [URLQueryItem(name: "storefront", value: country),
                          URLQueryItem(name: "osVersion", value: UIDevice.current.systemVersion)]
        guard let endpoint = url.url else { failOpen(reason: "configuration", attempt: attempt); return }
#if targetEnvironment(simulator)
        simulatorPhase = "checking-policy"
        simulatorRequestCount += 1
        simulatorLastRequest = ["storefront": country, "osVersion": UIDevice.current.systemVersion]
#endif
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            var request = URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2.5)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("maydan://app", forHTTPHeaderField: "Origin")
            do {
                let (data, response) = try await self.loadPolicy(request)
                guard !Task.isCancelled, self.generation.accepts(attempt), self.currentAttempt == attempt else { return }
                guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                      response.url == endpoint, data.count <= 8_192 else {
                    self.failOpen(reason: "response", attempt: attempt); return
                }
                let decision = AppUpdatePolicy.decision(data: data,
                    installedVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                    installedBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "")
                guard UIApplication.shared.applicationState == .active, self.safeToCheck else { self.deferUntilSafe(); return }
                switch decision {
                case let .required(policy):
                    self.completeCheck()
                    self.retryState.complete()
                    self.showRequired(policy)
                case .allowed:
                    self.completeCheck()
                    self.retryState.complete()
                    self.allowGame()
#if targetEnvironment(simulator)
                    self.simulatorPhase = "allowed"
#endif
                case .unavailable:
                    self.failOpen(reason: "invalid-policy", attempt: attempt)
                }
            } catch {
                guard !Task.isCancelled, self.generation.accepts(attempt), self.currentAttempt == attempt else { return }
                self.failOpen(reason: "network", attempt: attempt)
            }
        }
    }

    private func loadPolicy(_ request: URLRequest) async throws -> (Data, URLResponse) {
#if targetEnvironment(simulator)
        if simulatorFixture {
            // Provider injection only: check/deadline/generation/endpoint/decoder
            // and mounted native controls execute exactly as in production.
            try await Task.sleep(nanoseconds: 100_000_000)
            if simulatorOffline { throw URLError(.notConnectedToInternet) }
            let data = Data(#"{"schemaVersion":1,"enabled":true,"minimumBuild":999999,"minimumVersion":"999.0","appStoreId":"6808385717","message":"يتوفر تحديث مطلوب لميدان. حدّث التطبيق للمتابعة."}"#.utf8)
            return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                         headerFields: ["Content-Type": "application/json", "Cache-Control": "no-store"])!)
        }
#endif
        return try await http.data(for: request)
    }

    private func completeCheck() {
        deadline?.cancel(); deadline = nil
        task = nil
        currentAttempt = nil
        waitingStorefrontAttempt = nil
    }

    private func failOpen(reason: String, attempt: UInt64) {
        guard generation.accepts(attempt), currentAttempt == attempt else { return }
        cancelCheck()
        retryState.deferCheck()
        allowGame()
#if targetEnvironment(simulator)
        simulatorPhase = "failed-open"
        simulatorFailOpenReason = reason
#endif
        scheduleAutomaticRetry()
    }

    private func showChecking() {
        guard !initialLoadPermitted else { return }
        let view = makePanel()
        view.configure(message: "نجهّز ميدان…", required: false)
        view.setChecking(true)
    }

    private func showRequired(_ policy: AppUpdatePolicy) {
        requiredPolicy = policy
#if targetEnvironment(simulator)
        simulatorPhase = "required"
        simulatorFailOpenReason = nil
#endif
        let view = makePanel()
        view.configure(message: policy.message, required: true)
        view.setChecking(false)
        UIAccessibility.post(notification: .screenChanged, argument: view.heading)
    }

    private func makePanel() -> AppUpdatePanel {
        if let panel { return panel }
        let view = AppUpdatePanel()
        view.onUpdate = { [weak self] in self?.openStore() }
        view.onRetry = { [weak self] in self?.beginCycle() }
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
                "initialLoadPermitted": initialLoadPermitted, "offline": simulatorOffline,
                "productionCheckPath": true, "requestCount": simulatorRequestCount,
                "storefrontAttempts": simulatorStorefrontAttempts, "phase": simulatorPhase,
                "observedUnavailableStorefront": simulatorObservedUnavailableStorefront,
                "generation": generation.value, "pendingRetry": retryTask != nil, "needsCheck": retryState.needsCheck,
                "automaticRetries": retryState.automaticRetries,
                "maximumAutomaticRetries": AppUpdateRetryState.delays.count]
            snapshot["lastRequest"] = simulatorLastRequest.map { $0 as Any } ?? NSNull()
            snapshot["failOpenReason"] = simulatorFailOpenReason.map { $0 as Any } ?? NSNull()
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
        update.isAccessibilityElement = true
        retry.isAccessibilityElement = true
        update.accessibilityLabel = "تحديث ميدان من متجر التطبيقات"
        retry.accessibilityLabel = "إعادة التحقق من التحديث"
        update.accessibilityTraits = .button
        retry.accessibilityTraits = .button
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
        layoutIfNeeded()
        func button(_ value: UIButton) -> [String: Any] {
            let frame = value.convert(value.bounds, to: self)
            return ["title": value.configuration?.title ?? "", "hidden": value.isHidden,
                    "enabled": value.isEnabled, "width": frame.width, "height": frame.height,
                    "accessible": value.isAccessibilityElement,
                    "accessibilityLabel": value.accessibilityLabel ?? "",
                    "buttonTrait": value.accessibilityTraits.contains(.button)]
        }
        return ["heading": heading.text ?? "", "message": message.text ?? "",
                "mounted": window != nil, "width": bounds.width, "height": bounds.height,
                "modalAccessibility": accessibilityViewIsModal,
                "update": button(update), "retry": button(retry)]
    }
#endif
}
