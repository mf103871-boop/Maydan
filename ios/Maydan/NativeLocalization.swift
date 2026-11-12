import Foundation

/// UI language belongs to the player, independently of a room's content locale.
/// Native errors remain protocol codes; only text actually shown by the shell is localized.
enum NativeLocalization {
    private static var storageKey: String { NativeConfig.shared.scopedStorageKey("maydan.ui-locale") }
    static var locale: String {
        if let saved = UserDefaults.standard.string(forKey: storageKey), ["ar", "en"].contains(saved) { return saved }
        return Locale.preferredLanguages.first?.lowercased().hasPrefix("en") == true ? "en" : "ar"
    }
    static var isEnglish: Bool { locale == "en" }

    @discardableResult
    static func setLocale(_ value: String) -> Bool {
        guard value == "ar" || value == "en" else { return false }
        UserDefaults.standard.set(value, forKey: storageKey)
        return true
    }

    static func text(_ arabic: String) -> String { isEnglish ? english[arabic] ?? arabic : arabic }
    static func choose(_ arabic: String, _ english: String) -> String { isEnglish ? english : arabic }

    private static let english: [String: String] = [
        "ميدان": "Maydan",
        "مكالمة ميدان": "Maydan call",
        "مافيا ميدان": "Maydan Mafia",
        "نجهّز ميدان…": "Getting Maydan ready…",
        "جاري تجهيز اللعبة والمحفوظات…": "Preparing the game and your saved progress…",
        "تعذر نقل المحفوظات القديمة": "Could not transfer earlier saves",
        "محفوظاتك القديمة لم تُحذف. أعد المحاولة، وحرّر مساحة إن كانت ممتلئة. المتابعة الآن تفتح اللعبة دون إكمال النقل؛ وقد تتقدم إعداداتك وحفظك الجديد على القديم عند المحاولة لاحقًا.": "Your earlier saves have not been deleted. Try again, and free up storage if it is full. Continuing opens the game before the transfer is complete; new settings and saves may take precedence over earlier ones if you retry later.",
        "إعادة المحاولة": "Try again",
        "المتابعة الآن": "Continue now",
        "تعذر العثور على ملفات اللعبة داخل التطبيق.": "The bundled game files could not be found.",
        "تعذّر فتح App Store. تأكد من الاتصال وحاول مجددًا.": "Could not open the App Store. Check your connection and try again.",
        "تحديث من App Store": "Update in the App Store",
        "إعادة التحقق": "Check again",
        "تحديث ميدان من متجر التطبيقات": "Update Maydan in the App Store",
        "إعادة التحقق من التحديث": "Check for the update again",
        "يفتح صفحة ميدان في متجر التطبيقات": "Opens Maydan in the App Store",
        "يتحقق مجددًا من توفر التحديث المطلوب": "Checks whether the required update is available",
        "تحديث ميدان مطلوب": "Maydan update required",
        "تبقى بياناتك ومحفوظاتك كما هي بعد التحديث.": "Your data and saved progress stay with you after the update.",
        "يتوفر تحديث مطلوب لميدان. حدّث التطبيق للمتابعة.": "A Maydan update is required. Update the app to continue.",
        "بلاغ عن إعلان غير ملائم في ميدان": "Report an inappropriate ad in Maydan",
        "صِف الإعلان وسبب البلاغ دون إدخال معلومات شخصية:": "Describe the ad and why you are reporting it. Do not include personal information:",
        "دعم ميدان": "Maydan support",
        "نقل المحفوظات": "Transferring saved progress",
    ]
}
