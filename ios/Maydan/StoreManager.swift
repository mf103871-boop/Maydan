import Foundation
import StoreKit
import UIKit

struct StoreProductInfo {
    let id: String
    let price: String
    let period: String

    var json: [String: Any] { ["id": id, "price": price, "period": period] }
}

enum StoreError: Error {
    case cancelled
    case pending
    case unknownProduct
    case unverified
    case failed
}

/// StoreKit 2: المنتجات، الشراء بربط المعاملة بحساب ميدان (`appAccountToken`)، الاستعادة،
/// وإدارة الاشتراك. المعاملات تُنهى بعد إبلاغ الويب بتوقيعها (JWS)، والخادم يتحقق
/// منها بإعادة الجلب من App Store Server API، فلا ثقة بما يدّعيه الجهاز.
final class StoreManager {
    static let shared = StoreManager()

    /// تُستدعى على الخيط الرئيسي لكل معاملة موثّقة تصل خارج الشراء المباشر (تجديد، شراء معلّق اكتمل، جهاز آخر).
    var onTransaction: ((String) -> Void)?

    private var updatesTask: Task<Void, Never>?
    private var cache: [String: Product] = [:]

    private init() {}

    func startListening() {
        updatesTask?.cancel()
        updatesTask = Task.detached(priority: .background) { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                guard case .verified(let transaction) = result else { continue }
                let jws = result.jwsRepresentation
                await MainActor.run { self.onTransaction?(jws) }
                await transaction.finish()
            }
        }
    }

    func products(ids: [String]) async throws -> [StoreProductInfo] {
        guard !ids.isEmpty else { return [] }
        let products = try await Product.products(for: ids)
        for product in products {
            cache[product.id] = product
        }
        return products.map { StoreProductInfo(id: $0.id, price: $0.displayPrice, period: Self.periodText($0)) }
    }

    /// يعيد JWS المعاملة الموثّقة.
    @MainActor
    func purchase(productId: String, appAccountToken: UUID?, from viewController: UIViewController) async throws -> String {
        let product: Product
        if let cached = cache[productId] {
            product = cached
        } else {
            guard let found = try await Product.products(for: [productId]).first else { throw StoreError.unknownProduct }
            cache[productId] = found
            product = found
        }

        var options: Set<Product.PurchaseOption> = []
        if let token = appAccountToken {
            options.insert(.appAccountToken(token))
        }

        let result: Product.PurchaseResult
        if #available(iOS 18.2, *) {
            result = try await product.purchase(confirmIn: viewController, options: options)
        } else {
            result = try await product.purchase(options: options)
        }

        switch result {
        case .success(let verification):
            guard case .verified(let transaction) = verification else { throw StoreError.unverified }
            await transaction.finish()
            return verification.jwsRepresentation
        case .userCancelled:
            throw StoreError.cancelled
        case .pending:
            throw StoreError.pending
        @unknown default:
            throw StoreError.failed
        }
    }

    /// مزامنة مع المتجر ثم كل الاستحقاقات الحالية الموثّقة (JWS لكل واحدة).
    func restore() async throws -> [String] {
        try await AppStore.sync()
        var list: [String] = []
        for await result in Transaction.currentEntitlements {
            guard case .verified = result else { continue }
            list.append(result.jwsRepresentation)
        }
        return list
    }

    @MainActor
    func manageSubscriptions(in scene: UIWindowScene) async throws {
        try await AppStore.showManageSubscriptions(in: scene)
    }

    private static func periodText(_ product: Product) -> String {
        guard let period = product.subscription?.subscriptionPeriod else { return "" }
        switch period.unit {
        case .day:
            return period.value == 1 ? "يوميًا" : "كل \(period.value) أيام"
        case .week:
            return period.value == 1 ? "أسبوعيًا" : "كل \(period.value) أسابيع"
        case .month:
            return period.value == 1 ? "شهريًا" : "كل \(period.value) أشهر"
        case .year:
            return period.value == 1 ? "سنويًا" : "كل \(period.value) سنوات"
        @unknown default:
            return ""
        }
    }
}
