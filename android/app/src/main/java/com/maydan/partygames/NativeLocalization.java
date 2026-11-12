package com.maydan.partygames;

import android.content.Context;
import android.content.res.Configuration;
import java.util.Locale;

/** Resolve shell labels without recreating an activity that may hold an active game. */
final class NativeLocalization {
    private static final String PREFERENCES = "maydan-ui";
    private static final String KEY = "locale";

    private NativeLocalization() {}

    static String locale(Context context) {
        String saved = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(KEY, null);
        if ("ar".equals(saved) || "en".equals(saved)) return saved;
        String device = context.getResources().getConfiguration().getLocales().get(0).getLanguage();
        return "en".equals(device) ? "en" : "ar";
    }

    static boolean setLocale(Context context, String value) {
        if (!"ar".equals(value) && !"en".equals(value)) return false;
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(KEY, value).apply();
        return true;
    }

    static String text(Context context, int resource) {
        Configuration configuration = new Configuration(context.getResources().getConfiguration());
        configuration.setLocale(Locale.forLanguageTag(locale(context)));
        return context.createConfigurationContext(configuration).getString(resource);
    }
}
