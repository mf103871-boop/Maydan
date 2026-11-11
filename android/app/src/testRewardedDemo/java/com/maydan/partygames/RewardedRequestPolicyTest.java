package com.maydan.partygames;

import static org.junit.Assert.*;
import org.junit.Test;

public final class RewardedRequestPolicyTest {
    @Test
    public void onlyExactMainFrameOriginCanRequestAds() {
        assertTrue(RewardedRequestPolicy.trustedSource("https://appassets.androidplatform.net", true));
        for (String origin : new String[] {
            "http://appassets.androidplatform.net", "https://appassets.androidplatform.net.evil.test",
            "https://evil.test@appassets.androidplatform.net", "https://appassets.androidplatform.net:443",
            "https://appassets.androidplatform.net/game/index.html", "null", "data:text/html,hello"
        }) assertFalse(origin, RewardedRequestPolicy.trustedSource(origin, true));
        assertFalse(RewardedRequestPolicy.trustedSource(RewardedRequestPolicy.ORIGIN, false));
    }

    @Test
    public void attemptRequiresOpaqueTokenTestUnitAndBoundedFreshExpiry() {
        long now = 1_800_000_000_000L;
        String token = "a".repeat(64);
        assertTrue(RewardedRequestPolicy.validAttempt(token, RewardedRequestPolicy.AD_UNIT, now + 60_000, now));
        assertFalse(RewardedRequestPolicy.validAttempt("player@example.test", RewardedRequestPolicy.AD_UNIT, now + 60_000, now));
        assertFalse(RewardedRequestPolicy.validAttempt(token, "ca-app-pub-0000000000000000/0000000000", now + 60_000, now));
        assertFalse(RewardedRequestPolicy.validAttempt(token, RewardedRequestPolicy.AD_UNIT, now, now));
        assertFalse(RewardedRequestPolicy.validAttempt(token, RewardedRequestPolicy.AD_UNIT, now + 60 * 60_000, now));
    }

    @Test
    public void requestIdentifiersAreBounded() {
        assertTrue(RewardedRequestPolicy.validRequestId("mdn-test_1"));
        for (String id : new String[] {"", "x", "mdn-", "mdn-" + "x".repeat(65), "mdn-<script>"}) {
            assertFalse(id, RewardedRequestPolicy.validRequestId(id));
        }
    }
}
