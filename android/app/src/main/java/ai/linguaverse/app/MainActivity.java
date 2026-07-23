package ai.linguaverse.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Main Capacitor activity.
 *
 * Microphone handling:
 *   Capacitor 6's BridgeWebChromeClient already implements
 *   onPermissionRequest() — when the web content calls getUserMedia(),
 *   Capacitor requests RECORD_AUDIO + MODIFY_AUDIO_SETTINGS via the
 *   ActivityResult API and grants the WebView's AUDIO_CAPTURE resource
 *   on success.
 *
 *   IMPORTANT: do NOT call webView.setWebChromeClient() here — that
 *   would REPLACE Capacitor's BridgeWebChromeClient and break the
 *   permission-grant flow. (This was the root cause of the
 *   "麥克風被其他程式佔用" error in v1.0.4: a custom WebChromeClient
 *   was granting RESOURCE_AUDIO_CAPTURE without first requesting
 *   MODIFY_AUDIO_SETTINGS, so getUserMedia threw NotReadableError.)
 *
 *   All we do here is proactively request RECORD_AUDIO on startup so
 *   the user isn't surprised by a permission dialog on first tap.
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_AUDIO_PERMISSION = 1001;

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Proactively request RECORD_AUDIO if not yet granted. The user
        // will see the standard Android permission dialog. If they grant
        // it here, the WebView's onPermissionRequest (handled by Capacitor)
        // will succeed instantly on first mic tap.
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
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // Let Capacitor's bridge handle its own permission callbacks first
        // (it dispatches to registered plugins, including the
        // BridgeWebChromeClient's permissionLauncher). Then log our
        // audio result for debugging.
        if (requestCode == REQ_AUDIO_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                android.util.Log.i("LinguaVerse", "RECORD_AUDIO permission granted");
            } else {
                android.util.Log.w("LinguaVerse", "RECORD_AUDIO permission denied");
            }
        }
    }
}
