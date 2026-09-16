import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

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
