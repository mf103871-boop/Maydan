package com.maydan.partygames;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.util.AtomicFile;
import android.webkit.WebResourceResponse;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.BitSet;
import java.util.Arrays;

final class InstalledPackVerifier {
    static final String PATH = "/game/__installed_pack__/";
    private final AssetManager assets;
    private final Context context;
    private AtomicFile receiptFile;
    private byte[] receiptKey;
    private boolean trustedReceipt;
    private JSONObject inventory;
    // Bound to this AssetManager. Package replacement creates a fresh reader.
    private final BitSet verifiedGroups = new BitSet();

    InstalledPackVerifier(Context context) {
        this.context = context.getApplicationContext();
        this.assets = this.context.getAssets();
    }

    private void readReceipt(byte[] manifest) {
        try {
            String pkg = context.getPackageName();
            PackageInfo install = context.getPackageManager().getPackageInfo(pkg, 0);
            String fingerprint = hex(MessageDigest.getInstance("SHA-256").digest(manifest));
            String identity = "v1\n" + pkg + "\n" + context.getApplicationInfo().sourceDir + "\n"
                + install.firstInstallTime + "\n" + install.lastUpdateTime + "\n" + fingerprint;
            receiptKey = identity.getBytes(StandardCharsets.UTF_8);
            receiptFile = new AtomicFile(new File(context.getNoBackupFilesDir(), "maydan-pack-verification"));
            trustedReceipt = Arrays.equals(receiptKey, receiptFile.readFully());
        } catch (IOException | PackageManager.NameNotFoundException | NoSuchAlgorithmException | SecurityException ignored) {
            // A new install, unreadable receipt or storage problem always triggers a complete scan.
        }
    }

    private void rememberVerifiedInstall() {
        trustedReceipt = true;
        if (receiptFile == null || receiptKey == null) return;
        FileOutputStream output = null;
        try {
            output = receiptFile.startWrite();
            output.write(receiptKey);
            receiptFile.finishWrite(output);
        } catch (IOException | SecurityException ignored) {
            if (output != null) receiptFile.failWrite(output);
        }
    }

    // Called only by shouldInterceptRequest, on WebView's background thread.
    // The request chooses a batch number; paths come from the packaged inventory.
    synchronized WebResourceResponse response(String suffix) {
        try {
            if (!suffix.matches("[0-9]{1,6}")) throw new IOException("Invalid batch");
            int batch = Integer.parseInt(suffix);
            if (inventory == null) {
                try (InputStream input = assets.open("native-game-pack.json")) {
                    ByteArrayOutputStream contents = new ByteArrayOutputStream();
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) contents.write(buffer, 0, count);
                    byte[] raw = contents.toByteArray();
                    JSONObject manifest = new JSONObject(new String(raw, StandardCharsets.UTF_8));
                    if (manifest.getInt("schema") != 1) throw new IOException("Unknown inventory");
                    JSONArray groups = manifest.getJSONArray("groups");
                    long bytes = 0;
                    int files = 0;
                    for (int group = 0; group < groups.length(); group++) {
                        JSONArray members = groups.getJSONArray(group);
                        if (members.length() == 0) throw new IOException("Empty batch");
                        files += members.length();
                        for (int i = 0; i < members.length(); i++) bytes += members.getJSONObject(i).getLong("bytes");
                    }
                    if (files <= 0 || bytes <= 0 || files != manifest.getInt("totalFiles")
                        || bytes != manifest.getLong("totalBytes")) throw new IOException("Invalid totals");
                    readReceipt(raw);
                    inventory = manifest;
                }
            }
            JSONArray groups = inventory.getJSONArray("groups");
            if (batch == 0 && trustedReceipt) {
                long bytes = inventory.getLong("totalBytes");
                int files = inventory.getInt("totalFiles");
                JSONObject receipt = new JSONObject().put("batch", 0).put("batches", 1).put("bytes", bytes)
                    .put("files", files).put("totalBytes", bytes).put("totalFiles", files).put("receipt", 1);
                return json(200, "OK", receipt.toString());
            }
            JSONArray group = groups.getJSONArray(batch);
            if (group.length() == 0) throw new IOException("Empty batch");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[65536];
            long bytes = 0;
            for (int index = 0; index < group.length(); index++) {
                JSONObject file = group.getJSONObject(index);
                long size = 0;
                try (InputStream input = assets.open(file.getString("file"), AssetManager.ACCESS_STREAMING)) {
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        digest.update(buffer, 0, count);
                        size += count;
                    }
                }
                if (size != file.getLong("bytes") || !hex(digest.digest()).equals(file.getString("sha256"))) {
                    throw new IOException("Installed asset differs");
                }
                bytes += size;
            }
            JSONObject result = new JSONObject().put("batch", batch).put("batches", groups.length())
                .put("bytes", bytes).put("files", group.length())
                .put("totalBytes", inventory.getLong("totalBytes")).put("totalFiles", inventory.getInt("totalFiles"));
            verifiedGroups.set(batch);
            if (!trustedReceipt && verifiedGroups.cardinality() == groups.length()) rememberVerifiedInstall();
            return json(200, "OK", result.toString());
        } catch (IOException | JSONException | NoSuchAlgorithmException | NumberFormatException error) {
            return json(422, "Unprocessable Content", "{}");
        }
    }

    private static String hex(byte[] value) {
        StringBuilder output = new StringBuilder(value.length * 2);
        for (byte b : value) {
            output.append(Character.forDigit((b >> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
        }
        return output.toString();
    }

    private static WebResourceResponse json(int status, String reason, String value) {
        return new WebResourceResponse("application/json", "UTF-8", status, reason,
            Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)));
    }
}
