import AuthenticationServices
import UIKit

enum AuthError: Error {
    case cancelled
    case failed
    case busy
}

/// الدخول بحساب Apple أصليًا (ASAuthorizationController)، وبقية المزوّدين عبر
/// ASWebAuthenticationSession التي تعود إلى `maydan://auth?code=…`.
final class AuthCoordinator: NSObject,
    ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding,
    ASWebAuthenticationPresentationContextProviding {

    private let anchor: () -> ASPresentationAnchor
    private var appleContinuation: CheckedContinuation<[String: Any], Error>?
    private var appleController: ASAuthorizationController?
    private var webSession: ASWebAuthenticationSession?

    init(anchor: @escaping () -> ASPresentationAnchor) {
        self.anchor = anchor
        super.init()
    }

    // MARK: - Sign in with Apple

    /// الحمولة التي يتوقعها `POST /api/auth/apple/native`: identityToken وauthorizationCode
    /// والاسم والبريد (يصلان في أول دخول فقط، لذلك يُمرَّران للخادم ليحفظهما).
    @MainActor
    func signInWithApple() async throws -> [String: Any] {
        guard appleContinuation == nil else { throw AuthError.busy }
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        appleController = controller
        return try await withCheckedThrowingContinuation { continuation in
            appleContinuation = continuation
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let continuation = appleContinuation else { return }
        appleContinuation = nil
        appleController = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            continuation.resume(throwing: AuthError.failed)
            return
        }
        var payload: [String: Any] = ["identityToken": identityToken, "user": credential.user]
        if let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8) {
            payload["authorizationCode"] = code
        }
        if let name = credential.fullName {
            var parts: [String: String] = [:]
            if let given = name.givenName, !given.isEmpty { parts["givenName"] = given }
            if let family = name.familyName, !family.isEmpty { parts["familyName"] = family }
            if !parts.isEmpty { payload["fullName"] = parts }
        }
        if let email = credential.email, !email.isEmpty {
            payload["email"] = email
        }
        continuation.resume(returning: payload)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let continuation = appleContinuation else { return }
        appleContinuation = nil
        appleController = nil
        if let authorizationError = error as? ASAuthorizationError, authorizationError.code == .canceled {
            continuation.resume(throwing: AuthError.cancelled)
        } else {
            continuation.resume(throwing: AuthError.failed)
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor() }

    // MARK: - Web providers (Google) via the API host

    /// يفتح صفحة بدء الدخول على الخادم ويعيد رابط العودة `maydan://auth?code=…`.
    @MainActor
    func openAuth(url: URL) async throws -> URL {
        webSession?.cancel()
        return try await withCheckedThrowingContinuation { continuation in
            var finished = false
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: NativeConfig.authCallbackScheme) { callback, error in
                guard !finished else { return }
                finished = true
                if let callback {
                    continuation.resume(returning: callback)
                } else if let sessionError = error as? ASWebAuthenticationSessionError, sessionError.code == .canceledLogin {
                    continuation.resume(throwing: AuthError.cancelled)
                } else {
                    continuation.resume(throwing: AuthError.failed)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            webSession = session
            if !session.start() {
                finished = true
                continuation.resume(throwing: AuthError.failed)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor() }
}
