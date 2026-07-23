package ai.linguaverse.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Main Capacitor activity with microphone permission handling.
 *
 * Why this exists:
 *   Android WebView will reject getUserMedia() requests from web content
 *   unless the WebChromeClient.onPermissionRequest() callback explicitly
 *   grants RESOURCE_AUDIO_CAPTURE — even when RECORD_AUDIO is already
 *   granted at the OS level. Capacitor's default BridgeActivity does not
 *   override this callback, so voice input fails with errors like:
 *     - "麥克風權限被拒絕"  (NotAllowedError)
 *     - "無法存取麥克風: ..."  (other DOMException variants)
 *
 * Fix:
 *   1. On startup, proactively request RECORD_AUDIO if not yet granted.
 *   2. Install a WebChromeClient that grants RESOURCE_AUDIO_CAPTURE when
 *      the OS-level permission is held. We install it AFTER super.onCreate()
 *      AND re-install it on a delayed handler to make sure we run after
 *      Capacitor's own WebChromeClient setup (Capacitor sets its client
 *      inside bridge.create() which is called from super.onCreate() → load(),
 *      but in some Capacitor 6.x versions the client can be re-applied
 *      lazily on first page load, so we also re-apply on a 500ms delay).
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_AUDIO_PERMISSION = 1001;

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Ensure RECORD_AUDIO is granted at the OS level before the WebView
        //    tries to use it. If not, request it — the user will see the
        //    standard Android permission dialog.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{Manifest.permission.RECORD_AUDIO},
                        REQ_AUDIO_PERMISSION
                );
            }
        }

        // 2. Install the permission-granting WebChromeClient. Do it now AND
        //    again on a 500ms delay to ensure we override Capacitor's client
        //    (which may be set lazily on first page load).
        installPermissionWebChromeClient();
        new Handler(Looper.getMainLooper()).postDelayed(this::installPermissionWebChromeClient, 500);
        new Handler(Looper.getMainLooper()).postDelayed(this::installPermissionWebChromeClient, 2000);
    }

    /**
     * Install a WebChromeClient that grants RESOURCE_AUDIO_CAPTURE when the
     * OS-level RECORD_AUDIO permission is held.
     *
     * This is idempotent — calling it multiple times just re-installs the
     * same client.
     */
    private void installPermissionWebChromeClient() {
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    java.util.List<String> granted = new java.util.ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            if (ContextCompat.checkSelfPermission(
                                    MainActivity.this, Manifest.permission.RECORD_AUDIO)
                                    == PackageManager.PERMISSION_GRANTED) {
                                granted.add(resource);
                            } else {
                                // OS permission not granted yet — request it
                                // and deny this web request. The user can tap
                                // the mic button again after granting.
                                ActivityCompat.requestPermissions(
                                        MainActivity.this,
                                        new String[]{Manifest.permission.RECORD_AUDIO},
                                        REQ_AUDIO_PERMISSION
                                );
                            }
                        }
                    }
                    if (granted.isEmpty()) {
                        request.deny();
                    } else {
                        request.grant(granted.toArray(new String[0]));
                    }
                });
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_AUDIO_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                android.util.Log.i("LinguaVerse", "RECORD_AUDIO permission granted");
            } else {
                android.util.Log.w("LinguaVerse", "RECORD_AUDIO permission denied");
            }
        }
    }
}
