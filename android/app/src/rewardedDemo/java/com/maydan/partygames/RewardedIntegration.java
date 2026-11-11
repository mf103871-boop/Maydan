package com.maydan.partygames;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.view.View;

import androidx.annotation.NonNull;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.RequestConfiguration;
import com.google.ads.mediation.admob.AdMobAdapter;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.Objects;

/** Optional SDK transport only. Ticket authority remains in the game server. */
final class RewardedIntegration {
    private final Activity activity;
    private final WebView webView;
    private final ConsentInformation consent;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Button privacy;
    private final Set<String> requestIds = new LinkedHashSet<>();
    private final Set<String> shownTokens = new HashSet<>();
    private JavaScriptReplyProxy activeReply;
    private String activeId;
    private boolean resumed;
    private boolean destroyed;
    private boolean initialized;
    private boolean initializing;
    private boolean consentBusy = true;
    private boolean showing;
    private boolean earned;
    private long generation;
    private Runnable loadTimeout;

    RewardedIntegration(Activity activity, WebView webView, LinearLayout root) {
        this.activity = activity;
        this.webView = webView;
        consent = UserMessagingPlatform.getConsentInformation(activity);
        privacy = new Button(activity);
        privacy.setText(R.string.ad_privacy_options);
        privacy.setVisibility(View.GONE);
        privacy.setOnClickListener(view -> showPrivacy(null, null));
        root.addView(privacy);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "MaydanRewarded",
                Collections.singleton(RewardedRequestPolicy.ORIGIN), (view, message, origin, mainFrame, reply) -> {
                    if (!RewardedRequestPolicy.trustedSource(origin.toString(), mainFrame)) return;
                    handle(message.getData(), reply);
                });
        }
        consent.requestConsentInfoUpdate(activity, new ConsentRequestParameters.Builder().build(),
            () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity, error -> consentReady()),
            error -> consentReady());
    }

    private void consentReady() {
        if (destroyed) return;
        consentBusy = false;
        updatePrivacy();
        if (consent.canRequestAds() && !initialized && !initializing) {
            initializing = true;
            MobileAds.setRequestConfiguration(MobileAds.getRequestConfiguration().toBuilder()
                .setMaxAdContentRating(RequestConfiguration.MAX_AD_CONTENT_RATING_G)
                .setPublisherPrivacyPersonalizationState(
                    RequestConfiguration.PublisherPrivacyPersonalizationState.DISABLED)
                .build());
            MobileAds.initialize(activity, status -> {
                // This SDK requires initialize before its first-party ID setter.
                // Keep ad loading closed if the privacy choice cannot persist.
                handler.post(() -> {
                    if (destroyed) return;
                    initialized = MobileAds.putPublisherFirstPartyIdEnabled(false);
                    initializing = false;
                });
            });
        }
    }

    private void updatePrivacy() {
        privacy.setVisibility(consent.getPrivacyOptionsRequirementStatus()
            == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED ? View.VISIBLE : View.GONE);
    }

    private void handle(String message, JavaScriptReplyProxy reply) {
        if (destroyed || message == null || message.length() > 2048) return;
        String id = null;
        try {
            JSONObject request = new JSONObject(message);
            if (!(request.opt("id") instanceof String)) return;
            id = request.getString("id");
            if (!RewardedRequestPolicy.validRequestId(id)) return;
            if (!requestIds.add(id)) {
                reply(reply, id, result("busy", false));
                return;
            }
            if (requestIds.size() > 128) requestIds.remove(requestIds.iterator().next());
            String type = request.optString("type", "");
            if ("rewardedStatus".equals(type)) {
                JSONObject status = result(initialized ? "ready" : "initializing", false);
                status.put("mode", "android-demo");
                status.put("canRequestAds", consent.canRequestAds());
                status.put("initialized", initialized);
                status.put("available", initialized && consent.canRequestAds());
                status.put("privacyOptionsRequired", consent.getPrivacyOptionsRequirementStatus()
                    == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED);
                reply(reply, id, status);
            } else if ("rewardedShow".equals(type)) {
                show(request, reply, id);
            } else if ("rewardedPrivacyOptions".equals(type)) {
                showPrivacy(reply, id);
            } else if ("rewardedCancel".equals(type)) {
                if (!showing && activeId != null && activeId.equals(request.optString("targetId", ""))) {
                    finish("blocked", false);
                }
                reply(reply, id, result(showing ? "busy" : "blocked", showing));
            } else {
                reply(reply, id, result("unavailable", false));
            }
        } catch (JSONException error) {
            if (id != null) reply(reply, id, result("unavailable", false));
        }
    }

    private boolean readySurface() {
        return resumed && !destroyed && !activity.isFinishing() && !activity.isDestroyed()
            && RewardedRequestPolicy.trustedSource(
                webView.getUrl() == null ? "" : android.net.Uri.parse(webView.getUrl()).getScheme()
                    + "://" + android.net.Uri.parse(webView.getUrl()).getAuthority(), true);
    }

    private void show(JSONObject request, JavaScriptReplyProxy reply, String id) throws JSONException {
        String token = request.optString("customData", "");
        long expiry = request.optLong("expiresAt", 0);
        String unit = request.optString("adUnit", "");
        if (!RewardedRequestPolicy.validAttempt(token, unit, expiry, System.currentTimeMillis())
            || shownTokens.contains(token) || shownTokens.size() >= 128) {
            reply(reply, id, result("unavailable", false));
            return;
        }
        if (!readySurface() || activeId != null || consentBusy) {
            reply(reply, id, result("blocked", false));
            return;
        }
        if (!consent.canRequestAds() || !initialized) {
            reply(reply, id, result("privacy-required", false));
            return;
        }

        activeId = id;
        activeReply = reply;
        earned = false;
        String ownerUrl = webView.getUrl();
        long owner = ++generation;
        loadTimeout = () -> {
            if (owner == generation && !showing) finish("unavailable", false);
        };
        handler.postDelayed(loadTimeout, 35_000);
        Bundle extras = new Bundle();
        extras.putInt("npa", 1);
        AdRequest adRequest = new AdRequest.Builder()
            .addNetworkExtrasBundle(AdMobAdapter.class, extras).build();
        RewardedAd.load(activity, RewardedRequestPolicy.AD_UNIT, adRequest,
            new RewardedAdLoadCallback() {
                @Override
                public void onAdFailedToLoad(@NonNull LoadAdError error) {
                    if (owner == generation) finish("unavailable", false);
                }

                @Override
                public void onAdLoaded(@NonNull RewardedAd ad) {
                    if (owner != generation) return;
                    if (!readySurface() || !Objects.equals(ownerUrl, webView.getUrl())
                        || System.currentTimeMillis() >= expiry) {
                        finish("blocked", false);
                        return;
                    }
                    handler.removeCallbacks(loadTimeout);
                    shownTokens.add(token);
                    ad.setServerSideVerificationOptions(new ServerSideVerificationOptions.Builder()
                        .setCustomData(token).build());
                    ad.setFullScreenContentCallback(new FullScreenContentCallback() {
                        @Override
                        public void onAdShowedFullScreenContent() {
                            if (owner == generation) showing = true;
                        }

                        @Override
                        public void onAdDismissedFullScreenContent() {
                            if (owner == generation) finish(earned ? "pending" : "skipped", true);
                        }

                        @Override
                        public void onAdFailedToShowFullScreenContent(@NonNull AdError error) {
                            if (owner == generation) finish("unavailable", false);
                        }
                    });
                    showing = true;
                    ad.show(activity, reward -> {
                        // A client callback is a reason to poll the server only.
                        if (owner == generation) earned = true;
                    });
                }
            });
    }

    private void showPrivacy(JavaScriptReplyProxy reply, String id) {
        if (!readySurface() || consentBusy || activeId != null) {
            if (reply != null) reply(reply, id, result("blocked", false));
            return;
        }
        consentBusy = true;
        UserMessagingPlatform.showPrivacyOptionsForm(activity, error -> {
            if (destroyed) return;
            consentReady();
            if (reply != null) reply(reply, id, result(error == null ? "shown" : "unavailable", false));
        });
    }

    private static JSONObject result(String state, boolean presented) {
        JSONObject value = new JSONObject();
        try {
            value.put("state", state);
            value.put("presented", presented);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return value;
    }

    private void reply(JavaScriptReplyProxy proxy, String id, JSONObject result) {
        if (destroyed) return;
        try {
            proxy.postMessage(new JSONObject().put("id", id).put("ok", true)
                .put("result", result).toString());
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private void finish(String state, boolean presented) {
        if (loadTimeout != null) handler.removeCallbacks(loadTimeout);
        JavaScriptReplyProxy reply = activeReply;
        String id = activeId;
        activeReply = null;
        activeId = null;
        showing = false;
        generation++;
        if (reply != null) reply(reply, id, result(state, presented));
    }

    void resume() {
        resumed = true;
    }

    void stop() {
        resumed = false;
        if (activeId != null && !showing) finish("blocked", false);
    }

    void destroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        generation++;
        activeReply = null;
        activeId = null;
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(webView, "MaydanRewarded");
        }
    }
}
