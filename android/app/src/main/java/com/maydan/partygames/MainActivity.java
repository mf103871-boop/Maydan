package com.maydan.partygames;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String HOST = WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String ASSET_PATH = "/game/";
    private static final String HOME = "https://" + HOST + ASSET_PATH + "index.html";
    private static final String DOCUMENT_CSP =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; " +
        "connect-src 'self'; frame-src 'none'; worker-src 'none'; " +
        "base-uri 'none'; object-src 'none'; form-action 'none'";

    private WebView webView;
    private RewardedIntegration rewarded;
    private LinearLayout root;
    private TextView banner;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView message = new TextView(this);
            message.setText(NativeLocalization.text(this, R.string.webview_update));
            message.setGravity(Gravity.CENTER);
            setContentView(message);
            applyLightSystemBars();
            return;
        }

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(255, 248, 233));
        setContentView(root);
        applyLightSystemBars();
        applySystemInsets(root);

        banner = new TextView(this);
        banner.setText(NativeLocalization.text(this, R.string.offline_preview));
        banner.setGravity(Gravity.CENTER);
        banner.setTextColor(Color.rgb(58, 37, 69));
        banner.setTextSize(13);
        int spacing = Math.round(8 * getResources().getDisplayMetrics().density);
        banner.setPadding(spacing, spacing, spacing, spacing);
        root.addView(banner);

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        configureWebView();
        rewarded = new RewardedIntegration(this, webView, root);
        refreshLocalization();
        if (state == null || webView.restoreState(state) == null) webView.loadUrl(HOME);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (rewarded != null) rewarded.resume();
    }

    @Override
    protected void onStop() {
        if (rewarded != null) rewarded.stop();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (rewarded != null) rewarded.destroy();
        if (webView != null && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(webView, "MaydanLocale");
        }
        super.onDestroy();
    }

    private void applyLightSystemBars() {
        if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
            int appearance = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(appearance, appearance);
        } else {
            int appearance = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) appearance |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            getWindow().getDecorView().setSystemUiVisibility(
                getWindow().getDecorView().getSystemUiVisibility() | appearance);
        }
    }

    private void applySystemInsets(View root) {
        // With API 35+ edge-to-edge, leave the banner and controls outside system bars.
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets padding = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
                return insets;
            });
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);

        WebViewCompat.addWebMessageListener(webView, "MaydanLocale",
            Collections.singleton("https://" + HOST), (view, message, origin, mainFrame, reply) -> {
                if (view != webView || !mainFrame || !"https".equals(origin.getScheme())
                    || !HOST.equals(origin.getHost()) || origin.getPort() != -1 || origin.getUserInfo() != null
                    || view.getUrl() == null || !isLocalAsset(Uri.parse(view.getUrl()))) return;
                String data = message.getData();
                if (data == null || data.length() > 128) return;
                try {
                    JSONObject request = new JSONObject(data);
                    if (!"setLocale".equals(request.optString("type", ""))) return;
                    if (NativeLocalization.setLocale(this, request.optString("locale", ""))) refreshLocalization();
                } catch (JSONException ignored) {
                    // Invalid messages cannot change the shell's locale.
                }
            });

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler(ASSET_PATH, new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isLocalAsset(request.getUrl()) && request.isForMainFrame()) return false;
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this, NativeLocalization.text(MainActivity.this, R.string.offline_navigation), Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!isLocalAsset(url) || !"GET".equals(request.getMethod())) {
                    return emptyResponse(403, "Forbidden");
                }
                WebResourceResponse response = loader.shouldInterceptRequest(url);
                if (response == null || response.getData() == null) return emptyResponse(404, "Not Found");
                String path = url.getPath();
                if (path.endsWith(".html")) {
                    response.setResponseHeaders(Collections.singletonMap("Content-Security-Policy", DOCUMENT_CSP));
                } else if (path.endsWith(".woff2")) {
                    response.setMimeType("font/woff2");
                } else if (path.endsWith(".opus")) {
                    response.setMimeType("audio/ogg");
                } else if (path.endsWith(".json")) {
                    response.setMimeType("application/json");
                    response.setEncoding("UTF-8");
                }
                return response;
            }
        });
    }

    private void refreshLocalization() {
        root.setLayoutDirection("en".equals(NativeLocalization.locale(this))
            ? View.LAYOUT_DIRECTION_LTR : View.LAYOUT_DIRECTION_RTL);
        banner.setText(NativeLocalization.text(this, R.string.offline_preview));
        if (rewarded != null) rewarded.refreshLocalization();
    }

    private static boolean isLocalAsset(Uri url) {
        String path = url.getPath();
        return "https".equals(url.getScheme()) && HOST.equals(url.getHost())
            && url.getPort() == -1 && url.getUserInfo() == null
            && path != null && path.startsWith(ASSET_PATH);
    }

    private static WebResourceResponse emptyResponse(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (webView != null) webView.saveState(state);
    }

    @Override
    public void onBackPressed() {
        goBack();
    }

    private void goBack() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finish();
    }
}
