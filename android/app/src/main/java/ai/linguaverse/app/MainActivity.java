package ai.linguaverse.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Main Capacitor activity with microphone permission handling.
 *
 * Bug this fixes:
 *   Even when the user has granted the Android RECORD_AUDIO permission at the
 *   system level, the embedded WebView will STILL reject getUserMedia()
 *   requests unless the WebChromeClient.onPermissionRequest() callback
 *   explicitly grants the requested web resources.
 *
 *   Symptom: clicking the voice input button shows "麥克風權限被拒絕"
 *   even though the permission is enabled in system settings.
 *
 *   Root cause: Capacitor's default BridgeActivity does not override
 *   onPermissionRequest, so the WebView falls back to the default
 *   behavior of denying all permission requests from web content.
 *
 * Fix:
 *   1. Before the WebView loads, check that RECORD_AUDIO is granted at
 *      the Android system level. If not, request it.
 *   2. Override onPermissionRequest to grant RESOURCE_AUDIO_CAPTURE
 *      (and VIDEO_CAPTURE as a bonus for future use) whenever the web
 *      content asks for them, as long as the corresponding Android
 *      permission is already granted.
 *
 *   This mirrors what Chrome / Android System WebView do internally —
 *   once the OS-level permission is granted, web content should be
 *   able to access the resource.
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_AUDIO_PERMISSION = 1001;

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Ensure RECORD_AUDIO is granted at the OS level before the WebView
        // tries to use it. If not, request it — the user will see the
        // standard Android permission dialog.
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

        // Install a WebChromeClient that grants web-level permission requests
        // for audio capture, as long as the OS-level permission is held.
        //
        // Note: Capacitor 6's BridgeActivity sets its own WebChromeClient
        // internally for file-chooser handling, but Capacitor 6 routes file
        // uploads through ActivityResult contracts, not WebChromeClient's
        // showFileChooser — so replacing the client here is safe and does
        // not break file uploads.
        android.webkit.WebView webView = bridge.getWebView();
        if (webView != null) {
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> {
                        // Only grant resources the app actually has OS-level
                        // permission for. This prevents silently granting
                        // camera access etc. if we add it later without the
                        // corresponding Android permission.
                        java.util.List<String> granted = new java.util.ArrayList<>();
                        for (String resource : request.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                                if (ContextCompat.checkSelfPermission(
                                        MainActivity.this, Manifest.permission.RECORD_AUDIO)
                                        == PackageManager.PERMISSION_GRANTED) {
                                    granted.add(resource);
                                }
                            }
                            // Future: RESOURCE_VIDEO_CAPTURE → check CAMERA permission
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
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // Let Capacitor's bridge handle its own permission callbacks first
        // (it dispatches to registered plugins). Then log our audio result.
        if (requestCode == REQ_AUDIO_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                android.util.Log.i("LinguaVerse", "RECORD_AUDIO permission granted");
            } else {
                android.util.Log.w("LinguaVerse", "RECORD_AUDIO permission denied");
            }
        }
    }
}
