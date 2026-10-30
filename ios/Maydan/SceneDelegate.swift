import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var privacyCurtain: UIView?

    // UIKit snapshots can precede WebKit's visibilitychange/React render. An
    // opaque native cover protects roles, team chat and every presented panel.
    // It never changes the call or microphone state.
    func sceneWillResignActive(_ scene: UIScene) { coverPrivateContent() }
    func sceneDidEnterBackground(_ scene: UIScene) { coverPrivateContent() }
    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyCurtain?.removeFromSuperview()
        privacyCurtain = nil
    }

    private func coverPrivateContent() {
        guard let window else { return }
        if let privacyCurtain { window.bringSubviewToFront(privacyCurtain); return }
        let curtain = UIView(frame: window.bounds)
        curtain.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        curtain.backgroundColor = UIColor(red: 255/255, green: 247/255, blue: 231/255, alpha: 1)
        curtain.isOpaque = true
        curtain.isAccessibilityElement = true
        curtain.accessibilityViewIsModal = true
        curtain.accessibilityLabel = "ميدان"
        let label = UILabel()
        label.text = "ميدان"
        label.textColor = UIColor(red: 48/255, green: 34/255, blue: 68/255, alpha: 1)
        label.font = .boldSystemFont(ofSize: 36)
        label.translatesAutoresizingMaskIntoConstraints = false
        curtain.addSubview(label)
        NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: curtain.centerXAnchor), label.centerYAnchor.constraint(equalTo: curtain.centerYAnchor)])
        window.addSubview(curtain)
        privacyCurtain = curtain
    }

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let controller = GameViewController()
        window.rootViewController = controller
        window.backgroundColor = UIColor(red: 255/255, green: 247/255, blue: 231/255, alpha: 1)
        self.window = window
        window.makeKeyAndVisible()
        handle(connectionOptions.urlContexts, in: controller)
        if let response = connectionOptions.notificationResponse {
            SocialCoordinator.shared.openNotification(response.notification.request.content.userInfo)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let controller = window?.rootViewController as? GameViewController else { return }
        handle(URLContexts, in: controller)
    }

    /// عودة مصادقة وصلت من خارج ASWebAuthenticationSession (رابط فُتح في Safari مثلًا).
    private func handle(_ contexts: Set<UIOpenURLContext>, in controller: GameViewController) {
        for context in contexts {
            if let code = NativeConfig.authCode(from: context.url) {
                controller.deliverAuthCode(code)
            }
        }
    }
}
