#if MAYDAN_REWARDED_PREVIEW || MAYDAN_REWARDED_ADS
import GoogleMobileAds
import MessageUI
import StoreKit
import UIKit
import UserMessagingPlatform

/// The earned callback only changes the UI state. Only a signed server
/// callback can issue a ticket.
@MainActor
final class RewardedAdCoordinator: NSObject, FullScreenContentDelegate, MFMailComposeViewControllerDelegate {
    nonisolated static let sampleUnit = "ca-app-pub-3940256099942544/1712485313"
    nonisolated private static let samplePublisher = "3940256099942544"

    nonisolated static var isConfigured: Bool { configuredUnit != nil }

    nonisolated private static var mode: String? {
        Bundle.main.object(forInfoDictionaryKey: "MaydanRewardedMode") as? String
    }

    nonisolated static var configuredUnit: String? {
        if loopbackPort != nil { return sampleUnit }
#if MAYDAN_REWARDED_ADS
        guard Bundle.main.bundleIdentifier == "Maydan",
              let appID = Bundle.main.object(forInfoDictionaryKey: "GADApplicationIdentifier") as? String,
              appID.range(of: #"^ca-app-pub-[0-9]{16}~[0-9]{10}$"#, options: .regularExpression) != nil,
              let unit = Bundle.main.object(forInfoDictionaryKey: "MaydanRewardedUnit") as? String,
              unit.range(of: #"^ca-app-pub-[0-9]{16}/[0-9]{10}$"#, options: .regularExpression) != nil else { return nil }
        let origin = NativeConfig.shared.apiOrigin
        if mode == "testflight",
           origin == "https://maydan-mafia-preview.mf103871.workers.dev",
           unit == sampleUnit { return unit }
        let publisher = appID.split(separator: "~")[0]
        guard !publisher.hasSuffix(samplePublisher), publisher == unit.split(separator: "/")[0] else { return nil }
        if mode == "live", origin == "https://maydan-game.mf103871.workers.dev" { return unit }
        if mode == "testflight-owned", origin == "https://maydan-mafia-preview.mf103871.workers.dev",
           let verifiedVersion = Bundle.main.object(forInfoDictionaryKey: "MaydanRewardedTestVersion") as? String,
           verifiedVersion == Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
            return unit
        }
#endif
        return nil
    }

    nonisolated static var loopbackPort: Int? {
        guard Bundle.main.bundleIdentifier == "org.maydan.rewarded.preview",
              Bundle.main.object(forInfoDictionaryKey: "GADApplicationIdentifier") as? String
                == "ca-app-pub-3940256099942544~1458002511",
              let origin = URLComponents(string: NativeConfig.shared.apiOrigin),
              let port = origin.port, (1...65535).contains(port),
              origin.scheme == "http", origin.host == "127.0.0.1", origin.path.isEmpty,
              origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil else { return nil }
        return port
    }

    enum State: String {
        case pending, skipped, unavailable, blocked, busy, shown
        case privacyRequired = "privacy-required"
    }

    struct Result {
        let state: State
        let presented: Bool

        var payload: [String: Any] { ["state": state.rawValue, "presented": presented] }
    }

    private var consentRefresh: Task<Bool, Never>?
    private var mobileAdsStarted = false
    private var busy = false
    private var ad: RewardedAd?
    private var completion: CheckedContinuation<Result, Never>?
    private var presented = false
    private var earned = false
    private var hasImpression = false
    private(set) var consentRequested = false
    var onStatusChange: (() -> Void)?
    var onImpression: (() -> Void)?
    var onPresentationChange: ((Bool) -> Void)?

    var privacyOptionsRequired: Bool {
        ConsentInformation.shared.privacyOptionsRequirementStatus == .required
    }

    var status: [String: Any] {
        ["available": true, "privacyOptionsRequired": privacyOptionsRequired]
    }

    // WebKit's frame must be the app document, not merely a URL with the app scheme.
    static func isTrustedDocument(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme == "maydan" && parts.host == "app"
            && parts.user == nil && parts.password == nil && parts.port == nil && parts.query == nil
            && (parts.percentEncodedPath == "/" || parts.percentEncodedPath == "/index.html")
    }

    static func routePath(_ url: URL) -> String? {
        guard isTrustedDocument(url),
              let fragment = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedFragment else { return nil }
        return fragment.split(separator: "?", maxSplits: 1).first.map(String.init)
    }

    static func surface(_ url: URL) -> String? {
        guard let route = routePath(url) else { return nil }
        switch route {
        case "/entry/badeeha", "/entry/beep", "/entry/mamnoo", "/entry/jabeen", "/entry/fabraka", "/entry/meenfina", "/entry/ersomha", "/entry/mafia": return "game-entry"
        case "/game/badeeha", "/online/badeeha", "/online/meenfina", "/online/fabraka", "/online/ersomha", "/online/mafia": return "selection"
        case "/play/badeeha", "/play/beep", "/play/mamnoo", "/play/jabeen", "/play/fabraka", "/play/meenfina": return "local-start"
        default:
            return route.range(of: #"^/room/[0-9]{6}$"#, options: .regularExpression) != nil ? "room-lobby" : nil
        }
    }

    static func isValidToken(_ token: String) -> Bool {
        token.utf8.count == 64 && token.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    // Share an in-flight refresh between the foreground notification and a tapped offer.
    @discardableResult
    func refreshConsent() async -> Bool {
        consentRequested = true
        if let consentRefresh { return await consentRefresh.value }
        let refresh = Task { @MainActor in
            await withCheckedContinuation { continuation in
                ConsentInformation.shared.requestConsentInfoUpdate(with: RequestParameters()) { error in
                    continuation.resume(returning: error == nil)
                }
            }
        }
        consentRefresh = refresh
        let refreshed = await refresh.value
        consentRefresh = nil
        onStatusChange?()
        return refreshed
    }

    func show(
        token: String,
        unit: String?,
        host: UIViewController,
        isStillSafe: () async -> Bool,
        canPresent: () -> Bool
    ) async -> Result {
        guard Self.isValidToken(token), let expectedUnit = Self.configuredUnit, unit == expectedUnit else {
            return Result(state: .blocked, presented: false)
        }
        guard !busy else { return Result(state: .busy, presented: false) }
        busy = true
        defer { busy = false }
        guard await isStillSafe(), canPresent() else { return Result(state: .blocked, presented: false) }
        // StoreKit's signed environment separates the owned QA placement
        // from live distribution. AdMob Test apps must cover the exact QA
        // marketing version before that preview server enables attempts.
        if Self.mode == "live" || Self.mode == "testflight-owned" {
            let expectedEnvironment: AppStore.Environment = Self.mode == "live" ? .production : .sandbox
            guard let result = try? await AppTransaction.shared,
                  case let .verified(transaction) = result,
                  transaction.environment == expectedEnvironment,
                  transaction.bundleID == "Maydan",
                  await isStillSafe(), canPresent() else {
                return Result(state: .blocked, presented: false)
            }
        }

        if await refreshConsent() {
            guard await isStillSafe(), canPresent() else { return Result(state: .blocked, presented: false) }
            do { try await ConsentForm.loadAndPresentIfRequired(from: host) }
            catch {
                return Result(state: .privacyRequired, presented: false)
            }
            onStatusChange?()
        }
        // UMP may have a valid decision from an earlier session if a refresh failed.
        guard ConsentInformation.shared.canRequestAds else { return Result(state: .privacyRequired, presented: false) }
        guard await isStillSafe(), canPresent() else { return Result(state: .blocked, presented: false) }
        await startMobileAds()
        guard await isStillSafe(), canPresent(), ConsentInformation.shared.canRequestAds else {
            return Result(state: .blocked, presented: false)
        }

        let loaded: RewardedAd
        do { loaded = try await RewardedAd.load(with: expectedUnit, request: Request()) }
        catch { return Result(state: .unavailable, presented: false) }

        guard await isStillSafe(), canPresent(), ConsentInformation.shared.canRequestAds else {
            return Result(state: .blocked, presented: false)
        }
        do { try loaded.canPresent(from: host) }
        catch { return Result(state: .unavailable, presented: false) }

        let verification = ServerSideVerificationOptions()
        verification.customRewardText = token
        loaded.serverSideVerificationOptions = verification
        loaded.fullScreenContentDelegate = self
        presented = false
        earned = false
        ad = loaded
        return await withCheckedContinuation { continuation in
            completion = continuation
            loaded.present(from: host) { [weak self, weak loaded] in
                guard let self, let loaded, self.ad === loaded else { return }
                self.earned = true
            }
        }
    }

    func privacyOptions(host: UIViewController, canPresent: () -> Bool) async -> [String: Any] {
        guard !busy else { return privacyResult(.busy) }
        busy = true
        defer { busy = false }
        guard canPresent() else { return privacyResult(.blocked) }
        await refreshConsent()
        guard canPresent() else { return privacyResult(.blocked) }
        guard privacyOptionsRequired else { return privacyResult(.unavailable) }
        do { try await ConsentForm.presentPrivacyOptionsForm(from: host) }
        catch { return privacyResult(.unavailable) }
        onStatusChange?()
        return privacyResult(.shown)
    }

    func report(host: UIViewController, canPresent: () -> Bool) -> State {
        guard !busy else { return .busy }
        guard canPresent() else { return .blocked }
        guard hasImpression else { return .unavailable }
        let subject = "بلاغ عن إعلان غير ملائم في ميدان"
        let support = "mf103871@gmail.com"
        let prompt = "صِف الإعلان وسبب البلاغ دون إدخال معلومات شخصية:"
        if MFMailComposeViewController.canSendMail() {
            let mail = MFMailComposeViewController()
            mail.mailComposeDelegate = self
            mail.setToRecipients([support])
            mail.setSubject(subject)
            mail.setMessageBody(prompt, isHTML: false)
            host.present(mail, animated: true)
            return .shown
        }
        let share = UIActivityViewController(activityItems: ["\(subject)\nدعم ميدان: \(support)\n\(prompt)"], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = host.view
        share.popoverPresentationController?.sourceRect = CGRect(
            x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1
        )
        host.present(share, animated: true)
        return .shown
    }

    func mailComposeController(_ controller: MFMailComposeViewController,
                               didFinishWith result: MFMailComposeResult, error: Error?) {
        controller.dismiss(animated: true)
    }

    func adWillPresentFullScreenContent(_ fullScreenAd: FullScreenPresentingAd) {
        guard isCurrent(fullScreenAd) else { return }
        presented = true
        onPresentationChange?(true)
    }

    func adDidRecordImpression(_ fullScreenAd: FullScreenPresentingAd) {
        guard isCurrent(fullScreenAd) else { return }
        presented = true
        hasImpression = true
        onImpression?()
    }

    func adDidDismissFullScreenContent(_ fullScreenAd: FullScreenPresentingAd) {
        guard isCurrent(fullScreenAd) else { return }
        finish(earned ? .pending : .skipped)
    }

    func ad(_ fullScreenAd: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        guard isCurrent(fullScreenAd) else { return }
        finish(.unavailable)
    }

    private func isCurrent(_ fullScreenAd: FullScreenPresentingAd) -> Bool {
        guard let ad else { return false }
        return (fullScreenAd as AnyObject) === ad
    }

    private func finish(_ state: State) {
        let result = Result(state: state, presented: presented)
        let pending = completion
        completion = nil
        ad = nil
        if presented { onPresentationChange?(false) }
        pending?.resume(returning: result)
    }

    private func startMobileAds() async {
        guard !mobileAdsStarted else { return }
        let config = MobileAds.shared.requestConfiguration
        config.publisherPrivacyPersonalizationState = .disabled
        config.setPublisherFirstPartyIDEnabled(false)
        config.coarseLocationCollectionEnabled = false
        config.maxAdContentRating = GADMaxAdContentRating.general
        MobileAds.shared.disableMediationInitialization()
        _ = await MobileAds.shared.start()
        mobileAdsStarted = true
    }

    private func privacyResult(_ state: State) -> [String: Any] {
        ["state": state.rawValue, "privacyOptionsRequired": privacyOptionsRequired]
    }
}
#endif
