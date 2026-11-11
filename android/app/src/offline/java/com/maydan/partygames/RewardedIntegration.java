package com.maydan.partygames;

import android.app.Activity;
import android.webkit.WebView;
import android.widget.LinearLayout;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Collections;

/** The ordinary proof identifies Android but offers no SDK or ad availability. */
final class RewardedIntegration {
    private final WebView webView;

    RewardedIntegration(Activity activity, WebView webView, LinearLayout root) {
        this.webView = webView;
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "MaydanRewarded",
                Collections.singleton(RewardedRequestPolicy.ORIGIN), (view, message, origin, mainFrame, reply) -> {
                    if (!RewardedRequestPolicy.trustedSource(origin.toString(), mainFrame)) return;
                    String data = message.getData();
                    if (data == null || data.length() > 2048) return;
                    try {
                        JSONObject request = new JSONObject(data);
                        String id = request.optString("id", "");
                        if (!RewardedRequestPolicy.validRequestId(id)) return;
                        JSONObject result = new JSONObject().put("state", "unavailable")
                            .put("presented", false).put("available", false)
                            .put("mode", "off").put("privacyOptionsRequired", false);
                        reply.postMessage(new JSONObject().put("id", id).put("ok", true)
                            .put("result", result).toString());
                    } catch (JSONException error) {
                        // Malformed requests do not gain a native capability.
                    }
                });
        }
    }
    void resume() {}
    void stop() {}
    void destroy() {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(webView, "MaydanRewarded");
        }
    }
}
