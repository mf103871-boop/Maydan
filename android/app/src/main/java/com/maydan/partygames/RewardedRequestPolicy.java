package com.maydan.partygames;

import java.net.URI;
import java.net.URISyntaxException;

final class RewardedRequestPolicy {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String AD_UNIT = "ca-app-pub-3940256099942544/5224354917";
    static final long MAX_ATTEMPT_MS = 15 * 60_000 + 60_000;

    static boolean trustedSource(String origin, boolean mainFrame) {
        if (!mainFrame || origin == null) return false;
        try {
            URI uri = new URI(origin);
            return "https".equals(uri.getScheme())
                && "appassets.androidplatform.net".equals(uri.getRawAuthority())
                && (uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))
                && uri.getRawQuery() == null && uri.getRawFragment() == null;
        } catch (URISyntaxException error) {
            return false;
        }
    }

    static boolean validRequestId(String id) {
        return id != null && id.matches("mdn-[a-zA-Z0-9_-]{1,64}");
    }

    static boolean validAttempt(String token, String unit, long expiry, long now) {
        return token != null && token.matches("[a-f0-9]{64}") && AD_UNIT.equals(unit)
            && expiry > now && expiry <= now + MAX_ATTEMPT_MS;
    }
}
