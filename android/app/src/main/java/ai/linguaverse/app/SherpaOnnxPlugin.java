package ai.linguaverse.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.k2fsa.sherpa.onnx.OfflineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizerResult;
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig;
import com.k2fsa.sherpa.onnx.OfflineStream;
import com.k2fsa.sherpa.onnx.SileroVadModelConfig;
import com.k2fsa.sherpa.onnx.SpeechSegment;
import com.k2fsa.sherpa.onnx.Vad;
import com.k2fsa.sherpa.onnx.VadModelConfig;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * SherpaOnnxPlugin — offline STT via sherpa-onnx + SenseVoiceSmall.
 *
 * Model files are NOT bundled in the APK (keeps APK ~3MB instead of 266MB).
 * Users download them on-demand via the Settings page → downloadModels().
 *
 * Model files (stored in app's internal files dir /sherpa-models/):
 *   - sense-voice/model.int8.onnx  (~234MB)
 *   - sense-voice/tokens.txt       (~300KB)
 *   - silero-vad/silero_vad.onnx   (~1.8MB)
 *
 * Download sources:
 *   - SenseVoiceSmall: HuggingFace csukuangfj/sherpa-onnx-sense-voice-...
 *   - Silero VAD: GitHub k2-fsa/sherpa-onnx releases
 */
@CapacitorPlugin(name = "SherpaOnnx")
public class SherpaOnnxPlugin extends Plugin {

    private static final String TAG = "SherpaOnnx";
    private static final String MODEL_DIR = "sherpa-models";
    private static final int SAMPLE_RATE = 16000;

    // Download sources — multiple mirrors for reliability.
    //
    // Primary: GitHub Releases (our own repo — most reliable, supports
    //          Range/resume, no rate limits for public repos).
    // Mirror 1: cors.isteed.cc — a GitHub CORS proxy that works in
    //          mainland China to bypass GFW throttling on github.com.
    //          (ghproxy.com is DEAD as of 2026 — redirects to ghfast.top
    //          homepage instead of the actual file.)
    // Mirror 2: HuggingFace (original source — works everywhere except
    //          mainland China where HF is often blocked).
    //
    // The download logic tries each mirror in order until one succeeds.
    // After download, file size is verified against EXPECTED_SIZES to
    // prevent "instant download" of error HTML pages being treated as
    // successful model downloads.
    private static final String GITHUB_RELEASES_BASE =
            "https://github.com/artifexhongkong/linguaverse/releases/download/sherpa-models-v1";
    private static final String CORS_BASE =
            "https://cors.isteed.cc/github.com/artifexhongkong/linguaverse/releases/download/sherpa-models-v1";
    private static final String HUGGINGFACE_BASE =
            "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main";

    // Expected file sizes (in bytes) — used to verify downloads.
    // If a downloaded file doesn't match, it's likely an error HTML page
    // (e.g. a dead mirror returning a redirect page) and we retry.
    private static final long EXPECTED_MODEL_SIZE  = 239233841L; // model.int8.onnx (~228 MB)
    private static final long EXPECTED_TOKENS_SIZE =    315894L; // tokens.txt (~309 KB)
    private static final long EXPECTED_VAD_SIZE    =    643854L; // silero_vad.onnx (~629 KB)

    // Files to download (relative path under MODEL_DIR → primary download URL)
    private static final String[][] DOWNLOAD_FILES = {
            {"sense-voice/model.int8.onnx", GITHUB_RELEASES_BASE + "/model.int8.onnx"},
            {"sense-voice/tokens.txt",      GITHUB_RELEASES_BASE + "/tokens.txt"},
            {"silero-vad/silero_vad.onnx",  GITHUB_RELEASES_BASE + "/silero_vad.onnx"},
    };

    // Expected sizes indexed by file (matches DOWNLOAD_FILES order)
    private static final long[] EXPECTED_SIZES = {
            EXPECTED_MODEL_SIZE, EXPECTED_TOKENS_SIZE, EXPECTED_VAD_SIZE,
    };

    // Mirror URLs for each file (used if primary GitHub URL fails).
    // Order: GitHub → cors.isteed.cc (China mirror) → HuggingFace (fallback).
    private static final String[][] MIRROR_URLS = {
            {   // model.int8.onnx
                    GITHUB_RELEASES_BASE + "/model.int8.onnx",
                    CORS_BASE + "/model.int8.onnx",
                    HUGGINGFACE_BASE + "/model.int8.onnx",
            },
            {   // tokens.txt
                    GITHUB_RELEASES_BASE + "/tokens.txt",
                    CORS_BASE + "/tokens.txt",
                    HUGGINGFACE_BASE + "/tokens.txt",
            },
            {   // silero_vad.onnx
                    GITHUB_RELEASES_BASE + "/silero_vad.onnx",
                    CORS_BASE + "/silero_vad.onnx",
                    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
            },
    };

    private OfflineRecognizer recognizer;
    private Vad vad;
    private AudioRecord audioRecord;
    private int audioBufferSize;
    private ExecutorService inferenceExecutor;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean isListening = new AtomicBoolean(false);
    private final AtomicBoolean isInitialized = new AtomicBoolean(false);
    private final AtomicBoolean isInitializing = new AtomicBoolean(false);
    private final AtomicBoolean isDownloading = new AtomicBoolean(false);

    @Override
    public void load() {
        super.load();
        inferenceExecutor = Executors.newSingleThreadExecutor();
    }

    @Override
    protected void handleOnDestroy() {
        cleanup();
        super.handleOnDestroy();
    }

    private void cleanup() {
        isListening.set(false);
        if (audioRecord != null) {
            try {
                if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    audioRecord.stop();
                }
                audioRecord.release();
            } catch (Exception e) { Log.w(TAG, "audioRecord release", e); }
            audioRecord = null;
        }
        if (vad != null) { try { vad.release(); } catch (Exception ignored) {} vad = null; }
        if (recognizer != null) { try { recognizer.release(); } catch (Exception ignored) {} recognizer = null; }
        if (inferenceExecutor != null && !inferenceExecutor.isShutdown()) inferenceExecutor.shutdown();
        isInitialized.set(false);
    }

    // ----------------------------------------------------------------
    // Model management
    // ----------------------------------------------------------------

    private File getModelsDir() {
        return new File(getContext().getFilesDir(), MODEL_DIR);
    }

    /**
     * Verify a model file exists and matches the expected size.
     * Throws IOException with a clear message if the file is missing
     * or wrong size — this prevents sherpa-onnx from crashing with a
     * native segfault when given a corrupt model file.
     */
    private void verifyModelFile(String path, long expectedSize, String displayName) throws IOException {
        File f = new File(path);
        if (!f.exists()) {
            throw new IOException("模型檔案不存在: " + displayName + " — 請重新下載");
        }
        long actual = f.length();
        long tolerance = expectedSize / 100; // 1% tolerance
        if (Math.abs(actual - expectedSize) > tolerance) {
            // Delete the corrupt file so the next download attempt
            // starts fresh instead of trying to resume.
            f.delete();
            throw new IOException("模型檔案損壞: " + displayName
                    + " 大小 " + actual + " ≠ 預期 " + expectedSize
                    + " — 已刪除，請重新下載");
        }
        Log.i(TAG, "Verified " + displayName + ": " + (actual / 1024 / 1024) + " MB ✅");
    }

    /**
     * Check if all required model files exist in internal storage AND
     * match their expected sizes. This prevents "instant download" bugs
     * where a dead mirror returns an HTML error page that gets saved as
     * the model file (e.g. 1.8KB HTML page instead of 228MB ONNX model).
     */
    private boolean areModelsDownloaded() {
        File dir = getModelsDir();
        for (int i = 0; i < DOWNLOAD_FILES.length; i++) {
            File f = new File(dir, DOWNLOAD_FILES[i][0]);
            if (!f.exists() || f.length() == 0) return false;
            // Verify size matches expected (within 1% tolerance for any
            // minor server-side re-encoding differences)
            long expected = EXPECTED_SIZES[i];
            long actual = f.length();
            long tolerance = expected / 100; // 1%
            if (Math.abs(actual - expected) > tolerance) {
                Log.w(TAG, "Model file size mismatch: " + f.getName()
                        + " expected=" + expected + " actual=" + actual);
                return false;
            }
        }
        return true;
    }

    /**
     * downloadModels — download model files from HuggingFace/GitHub to
     * internal storage. Reports progress via "onDownloadProgress" event.
     *
     * Progress events:
     *   { phase: "downloading", file: "...", received: N, total: M, percent: P }
     *   { phase: "done", totalBytes: N }
     *   { phase: "error", message: "..." }
     */
    /**
     * testConnection — diagnostic method that pings all download URLs
     * and returns the HTTP status for each. Useful for diagnosing
     * network issues without downloading 234MB.
     *
     * Uses GET with Range: bytes=0-0 (1 byte) instead of HEAD because:
     *   - HuggingFace returns 307 for HEAD on tokens.txt but 200 for GET
     *   - Some CDNs don't support HEAD
     *   - GET + Range gives us the real Content-Length via Content-Range
     *
     * Accepts 200, 206, 301, 302, 303, 307, 308 as "ok" — all are either
     * success or redirect responses that downloadFile() handles.
     */
    @PluginMethod
    public void testConnection(PluginCall call) {
        inferenceExecutor.execute(() -> {
            JSObject result = new JSObject();
            org.json.JSONArray urls = new org.json.JSONArray();
            boolean allOk = true;

            for (int fileIdx = 0; fileIdx < DOWNLOAD_FILES.length; fileIdx++) {
                String relPath = DOWNLOAD_FILES[fileIdx][0];
                // Test the PRIMARY (first) mirror URL
                String urlStr = MIRROR_URLS[fileIdx][0];
                JSObject item = new JSObject();
                item.put("file", relPath);
                item.put("url", urlStr);
                item.put("mirrorCount", MIRROR_URLS[fileIdx].length);
                try {
                    URL url = new URL(urlStr);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(15000);
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("User-Agent", "LinguaVerse/1.1");
                    conn.setRequestProperty("Range", "bytes=0-0");
                    int code = conn.getResponseCode();
                    String contentRange = conn.getHeaderField("Content-Range");
                    long size = -1;
                    if (contentRange != null && contentRange.contains("/")) {
                        try {
                            size = Long.parseLong(contentRange.substring(contentRange.lastIndexOf("/") + 1));
                        } catch (NumberFormatException ignored) {}
                    }
                    if (size < 0) {
                        size = conn.getContentLength();
                    }
                    item.put("status", code);
                    item.put("size", size);
                    boolean ok = code == 200 || code == 206
                            || code == 301 || code == 302 || code == 303
                            || code == 307 || code == 308;
                    item.put("ok", ok);
                    if (!ok) allOk = false;
                    try {
                        InputStream is = conn.getInputStream();
                        if (is != null) is.close();
                    } catch (Exception ignored) {}
                    conn.disconnect();
                    Log.i(TAG, "testConnection: " + relPath + " → HTTP " + code + " (size=" + size + ")");
                } catch (Exception e) {
                    item.put("status", -1);
                    item.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
                    item.put("ok", false);
                    allOk = false;
                    Log.e(TAG, "testConnection failed for " + relPath, e);
                }
                urls.put(item);
            }

            result.put("urls", urls);
            result.put("allOk", allOk);
            result.put("modelsDir", getModelsDir().getAbsolutePath());
            result.put("modelsDirExists", getModelsDir().exists());
            result.put("modelsDirWritable", getModelsDir().canWrite() || getModelsDir().getParentFile().canWrite());

            mainHandler.post(() -> {
                call.resolve(result);
            });
        });
    }

    /**
     * downloadModels — download model files from HuggingFace/GitHub to
     * internal storage. Reports progress via "onDownloadProgress" event.
     *
     * Progress events:
     *   { phase: "downloading", file: "...", received: N, total: M, percent: P }
     *   { phase: "done", totalBytes: N }
     *   { phase: "error", message: "..." }
     */
    @PluginMethod
    public void downloadModels(PluginCall call) {
        if (isDownloading.get()) {
            call.reject("download already in progress");
            return;
        }
        isDownloading.set(true);

        // Save the call so we can resolve/reject it from the background thread.
        // Capacitor's PluginCall is safe to call from any thread.
        inferenceExecutor.execute(() -> {
            try {
                File dir = getModelsDir();
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IOException("無法建立模型目錄: " + dir.getAbsolutePath());
                }
                long totalBytes = 0;

                for (int fileIdx = 0; fileIdx < DOWNLOAD_FILES.length; fileIdx++) {
                    String relPath = DOWNLOAD_FILES[fileIdx][0];
                    File outFile = new File(dir, relPath);
                    outFile.getParentFile().mkdirs();
                    long expectedSize = EXPECTED_SIZES[fileIdx];

                    Log.i(TAG, "Downloading " + relPath + " (expected " + expectedSize + " bytes) → " + outFile);
                    final String currentFile = relPath;

                    // Try each mirror URL until one succeeds AND produces
                    // a file of the correct size.
                    String[] mirrors = MIRROR_URLS[fileIdx];
                    boolean downloaded = false;
                    Exception lastErr = null;

                    for (int mirrorIdx = 0; mirrorIdx < mirrors.length; mirrorIdx++) {
                        String mirrorUrl = mirrors[mirrorIdx];
                        Log.i(TAG, "  Trying mirror " + (mirrorIdx + 1) + "/" + mirrors.length
                                + ": " + mirrorUrl.substring(0, Math.min(80, mirrorUrl.length())));

                        // If a previous mirror left a corrupt/wrong-size file,
                        // delete it before retrying (otherwise resume logic
                        // would try to resume from the wrong offset).
                        if (outFile.exists() && outFile.length() != expectedSize && outFile.length() < expectedSize / 2) {
                            Log.w(TAG, "  Deleting corrupt partial file (" + outFile.length() + " bytes)");
                            outFile.delete();
                        }

                        try {
                            long bytes = downloadFile(mirrorUrl, outFile, (received, total) -> {
                                int percent = total > 0 ? (int)(received * 100 / total) : 0;
                                final int finalPercent = percent;
                                final long finalReceived = received;
                                final long finalTotal = total;
                                mainHandler.post(() -> {
                                    JSObject prog = new JSObject();
                                    prog.put("phase", "downloading");
                                    prog.put("file", currentFile);
                                    prog.put("received", finalReceived);
                                    prog.put("total", finalTotal);
                                    prog.put("percent", finalPercent);
                                    notifyListeners("onDownloadProgress", prog);
                                });
                            });

                            // Verify file size — a dead mirror might return
                            // HTTP 200 with an HTML error page (e.g. 1.8KB)
                            // instead of the actual 228MB model file.
                            if (outFile.length() != expectedSize) {
                                Log.w(TAG, "  ✗ Mirror " + (mirrorIdx + 1) + " produced wrong size: "
                                        + outFile.length() + " (expected " + expectedSize + ")");
                                outFile.delete(); // remove corrupt file
                                throw new IOException("檔案大小不正確: " + outFile.length()
                                        + " ≠ " + expectedSize);
                            }

                            totalBytes += bytes;
                            downloaded = true;
                            Log.i(TAG, "  ✓ Mirror " + (mirrorIdx + 1) + " succeeded: " + bytes + " bytes (verified)");
                            break; // success, move to next file
                        } catch (Exception e) {
                            lastErr = e;
                            Log.w(TAG, "  ✗ Mirror " + (mirrorIdx + 1) + " failed: " + e.getMessage());
                            // Continue to next mirror
                        }
                    }

                    if (!downloaded) {
                        throw new IOException("所有下載源都失敗: " + relPath
                                + " — 最後錯誤: " + (lastErr != null ? lastErr.getMessage() : "unknown"));
                    }
                }

                Log.i(TAG, "All downloads complete, total=" + totalBytes);
                JSObject done = new JSObject();
                done.put("phase", "done");
                done.put("totalBytes", totalBytes);
                final long finalTotalBytes = totalBytes;
                mainHandler.post(() -> {
                    notifyListeners("onDownloadProgress", done);
                    call.resolve(new JSObject().put("success", true).put("totalBytes", finalTotalBytes));
                });
            } catch (Exception e) {
                Log.e(TAG, "download failed", e);
                JSObject err = new JSObject();
                err.put("phase", "error");
                err.put("message", e.getMessage());
                final String errMsg = e.getClass().getSimpleName() + ": " + e.getMessage();
                mainHandler.post(() -> {
                    notifyListeners("onDownloadProgress", err);
                    call.reject("下載失敗: " + errMsg);
                });
            } finally {
                isDownloading.set(false);
            }
        });
    }

    /**
     * Download a single file with progress callback + resume support.
     *
     * Handles:
     *   - HTTP 302 redirects (HuggingFace/GitHub → CDN)
     *   - Resume via Range header (if partial file exists)
     *   - Long timeouts (10 min read — large files on slow networks)
     *   - Retry on transient failures (up to 3 attempts)
     *
     * IMPORTANT: If the file already exists and is complete, the server
     * returns 416 Range Not Satisfiable — we treat this as success and
     * return the existing file size. This is NOT an error.
     */
    private long downloadFile(String urlStr, File outFile, ProgressCallback cb) throws IOException {
        // Disable HTTP keep-alive for large downloads — Android's connection
        // pool sometimes returns stale connections after a large transfer,
        // causing the next request to fail with SocketException.
        System.setProperty("http.keepAlive", "false");

        long existingBytes = outFile.exists() ? outFile.length() : 0;

        // Try up to 2 times per mirror (1 retry for transient network issues).
        // The caller (downloadModels) handles mirror rotation, so we don't
        // need many retries here — 2 is enough for transient failures.
        Exception lastError = null;
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                long downloaded = downloadFileOnce(urlStr, outFile, cb, existingBytes);
                return downloaded;
            } catch (Exception e) {
                lastError = e;
                Log.w(TAG, "Download attempt " + attempt + " failed for " + outFile.getName()
                        + " from " + urlStr.substring(0, Math.min(60, urlStr.length()))
                        + ": " + e.getClass().getSimpleName() + ": " + e.getMessage());
                // Update existingBytes for resume on next attempt
                existingBytes = outFile.exists() ? outFile.length() : 0;
                if (attempt < 2) {
                    try { Thread.sleep(2000L); } catch (InterruptedException ignored) {}
                }
            }
        }
        throw new IOException("下載失敗: " + lastError.getClass().getSimpleName()
                + " — " + lastError.getMessage(), lastError);
    }

    private long downloadFileOnce(String urlStr, File outFile, ProgressCallback cb, long resumeFrom) throws IOException {
        String currentUrl = urlStr;
        int redirectCount = 0;
        HttpURLConnection conn = null;
        InputStream in = null;
        FileOutputStream out = null;

        try {
            // Follow up to 5 redirects manually (HttpURLConnection's auto-redirect
            // sometimes fails for HTTPS → HTTPS cross-domain redirects on HuggingFace)
            while (redirectCount < 5) {
                URL url = new URL(currentUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(60000);   // 60s to establish connection
                conn.setReadTimeout(600000);     // 10 min between read chunks
                conn.setInstanceFollowRedirects(false);
                conn.setUseCaches(false);
                conn.setRequestProperty("User-Agent", "LinguaVerse/1.1");
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("Connection", "close");

                // Resume support — if we have a partial file, request the rest
                if (resumeFrom > 0) {
                    conn.setRequestProperty("Range", "bytes=" + resumeFrom + "-");
                    Log.i(TAG, "Resuming " + outFile.getName() + " from byte " + resumeFrom);
                }

                int response = conn.getResponseCode();
                Log.i(TAG, "HTTP " + response + " for " + outFile.getName()
                        + " (redirect=" + redirectCount + ", resumeFrom=" + resumeFrom + ")");

                // Handle redirects (301, 302, 303, 307, 308)
                if (response == 301 || response == 302 || response == 303 || response == 307 || response == 308) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null || location.isEmpty()) {
                        throw new IOException("Redirect " + response + " without Location header");
                    }
                    Log.i(TAG, "  → Redirect to: " + location.substring(0, Math.min(100, location.length())));
                    currentUrl = location;
                    redirectCount++;
                    continue;
                }

                if (response == 416) {
                    // Range Not Satisfiable — file already fully downloaded.
                    // This is SUCCESS, not an error.
                    Log.i(TAG, "  → 416 Range Not Satisfiable — " + outFile.getName() + " already complete ("
                            + outFile.length() + " bytes)");
                    // Report 100% progress before returning
                    cb.onProgress(outFile.length(), outFile.length());
                    return outFile.length();
                }

                if (response != 200 && response != 206) {
                    String body = "";
                    try {
                        InputStream errStream = conn.getErrorStream();
                        if (errStream != null) {
                            byte[] errBuf = new byte[2048];
                            int errLen = errStream.read(errBuf);
                            if (errLen > 0) body = new String(errBuf, 0, errLen);
                            errStream.close();
                        }
                    } catch (Exception ignored) {}
                    throw new IOException("HTTP " + response + " — " + body);
                }

                // 200 = full download (server ignored Range or fresh start)
                // 206 = partial content (resume successful)
                boolean isResume = (response == 206 && resumeFrom > 0);
                long contentLen = conn.getContentLength();
                long total;
                if (isResume) {
                    // Content-Length is the remaining bytes, not the total
                    total = resumeFrom + contentLen;
                } else {
                    // Fresh download — truncate existing file
                    resumeFrom = 0;
                    total = contentLen;
                }
                Log.i(TAG, "  Content-Length=" + contentLen + ", total=" + total + ", isResume=" + isResume);

                in = conn.getInputStream();
                out = new FileOutputStream(outFile, isResume);

                byte[] buf = new byte[131072]; // 128KB buffer
                long received = resumeFrom;
                long lastReportTime = 0;
                int len;
                while ((len = in.read(buf)) > 0) {
                    out.write(buf, 0, len);
                    received += len;
                    // Report progress every 500ms
                    long now = System.currentTimeMillis();
                    if (now - lastReportTime > 500 || (total > 0 && received >= total)) {
                        lastReportTime = now;
                        cb.onProgress(received, total);
                    }
                }
                out.flush();
                Log.i(TAG, "  Downloaded " + outFile.getName() + ": " + received + " bytes (file size: " + outFile.length() + ")");

                // Verify file size if we know the expected total
                if (total > 0 && outFile.length() != total) {
                    Log.w(TAG, "  WARNING: file size mismatch! Expected " + total + " but got " + outFile.length());
                    // Don't throw — some servers report wrong Content-Length.
                    // The file may still be usable.
                }
                return received;
            }
            throw new IOException("Too many redirects (>5)");
        } finally {
            // Close in reverse order. Catch ALL exceptions — a failure in
            // close() should not mask the actual download result.
            if (in != null) { try { in.close(); } catch (Exception e) { Log.w(TAG, "in.close() failed", e); } }
            if (out != null) { try { out.close(); } catch (Exception e) { Log.w(TAG, "out.close() failed", e); } }
            if (conn != null) { try { conn.disconnect(); } catch (Exception e) { Log.w(TAG, "conn.disconnect() failed", e); } }
        }
    }

    private interface ProgressCallback {
        void onProgress(long received, long total);
    }

    /**
     * areModelsDownloaded — check if models exist (for Settings UI).
     */
    @PluginMethod
    public void areModelsDownloaded(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("downloaded", areModelsDownloaded());
        File dir = getModelsDir();
        long size = 0;
        if (dir.exists()) {
            for (String[] entry : DOWNLOAD_FILES) {
                File f = new File(dir, entry[0]);
                if (f.exists()) size += f.length();
            }
        }
        ret.put("totalBytes", size);
        call.resolve(ret);
    }

    /**
     * deleteModels — remove downloaded models (for Settings "clear" button).
     */
    @PluginMethod
    public void deleteModels(PluginCall call) {
        // Release recognizer first if initialized
        if (recognizer != null) { try { recognizer.release(); } catch (Exception ignored) {} recognizer = null; }
        if (vad != null) { try { vad.release(); } catch (Exception ignored) {} vad = null; }
        isInitialized.set(false);

        File dir = getModelsDir();
        long freed = 0;
        if (dir.exists()) {
            for (String[] entry : DOWNLOAD_FILES) {
                File f = new File(dir, entry[0]);
                if (f.exists()) { freed += f.length(); f.delete(); }
            }
        }
        Log.i(TAG, "Deleted models, freed " + (freed / 1024 / 1024) + " MB");
        call.resolve(new JSObject().put("success", true).put("freedBytes", freed));
    }

    // ----------------------------------------------------------------
    // Speech recognition
    // ----------------------------------------------------------------

    /**
     * initSpeechRecognizer — async model loading.
     * Models must be downloaded first via downloadModels().
     *
     * Verifies file sizes before loading to prevent sherpa-onnx from
     * crashing on corrupt/incomplete model files (e.g. an HTML error
     * page that was saved as model.int8.onnx by a dead mirror).
     */
    @PluginMethod
    public void initSpeechRecognizer(PluginCall call) {
        if (isInitialized.get()) {
            call.resolve(new JSObject().put("success", true).put("message", "already initialized"));
            return;
        }
        if (isInitializing.get()) {
            call.resolve(new JSObject().put("success", true).put("message", "initializing"));
            return;
        }

        if (!areModelsDownloaded()) {
            call.reject("模型未下載或檔案不完整，請重新下載");
            return;
        }

        isInitializing.set(true);
        inferenceExecutor.execute(() -> {
            try {
                File dir = getModelsDir();
                String modelPath = new File(dir, "sense-voice/model.int8.onnx").getAbsolutePath();
                String tokensPath = new File(dir, "sense-voice/tokens.txt").getAbsolutePath();
                String vadModelPath = new File(dir, "silero-vad/silero_vad.onnx").getAbsolutePath();

                // Double-check file sizes before loading (areModelsDownloaded
                // already checks, but this catches any race condition where
                // the file was deleted between the check and here).
                verifyModelFile(modelPath, EXPECTED_MODEL_SIZE, "model.int8.onnx");
                verifyModelFile(tokensPath, EXPECTED_TOKENS_SIZE, "tokens.txt");
                verifyModelFile(vadModelPath, EXPECTED_VAD_SIZE, "silero_vad.onnx");

                // OfflineSenseVoiceModelConfig
                OfflineSenseVoiceModelConfig senseVoice = new OfflineSenseVoiceModelConfig();
                senseVoice.setModel(modelPath);
                senseVoice.setLanguage("auto");
                senseVoice.setUseInverseTextNormalization(true);

                OfflineModelConfig modelConfig = new OfflineModelConfig();
                modelConfig.setSenseVoice(senseVoice);
                modelConfig.setTokens(tokensPath);
                modelConfig.setNumThreads(2);
                // Use "cpu" instead of "nnapi" — NNAPI can crash on some
                // devices with unsupported ops. CPU is universally safe.
                modelConfig.setProvider("cpu");
                modelConfig.setDebug(false);

                OfflineRecognizerConfig recognizerConfig = new OfflineRecognizerConfig();
                recognizerConfig.setModelConfig(modelConfig);

                Log.i(TAG, "Creating OfflineRecognizer (SenseVoiceSmall, CPU, threads=2)...");
                recognizer = new OfflineRecognizer(null, recognizerConfig);

                // SileroVadModelConfig
                SileroVadModelConfig sileroVad = new SileroVadModelConfig();
                sileroVad.setModel(vadModelPath);
                sileroVad.setThreshold(0.5f);
                sileroVad.setMinSilenceDuration(500f);
                sileroVad.setMinSpeechDuration(100f);
                sileroVad.setMaxSpeechDuration(30000f);

                VadModelConfig vadConfig = new VadModelConfig();
                vadConfig.setSileroVadModelConfig(sileroVad);
                vadConfig.setSampleRate(SAMPLE_RATE);
                vadConfig.setNumThreads(2);
                vadConfig.setProvider("cpu");
                vadConfig.setDebug(false);

                Log.i(TAG, "Creating Vad (Silero, CPU, threads=2)...");
                vad = new Vad(null, vadConfig);

                audioBufferSize = Math.max(
                        AudioRecord.getMinBufferSize(SAMPLE_RATE,
                                AudioFormat.CHANNEL_IN_MONO,
                                AudioFormat.ENCODING_PCM_16BIT),
                        SAMPLE_RATE * 2
                );

                isInitialized.set(true);
                isInitializing.set(false);
                Log.i(TAG, "sherpa-onnx initialized successfully");
                mainHandler.post(() -> call.resolve(new JSObject().put("success", true)));

            } catch (Exception e) {
                isInitializing.set(false);
                Log.e(TAG, "init failed", e);
                mainHandler.post(() -> call.reject("init failed: " + e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (!isInitialized.get()) {
            call.reject("not initialized — call initSpeechRecognizer first");
            return;
        }
        if (isListening.get()) {
            call.resolve(new JSObject().put("success", true).put("message", "already listening"));
            return;
        }
        isListening.set(true);

        inferenceExecutor.execute(() -> {
            try {
                audioRecord = new AudioRecord(
                        MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                        audioBufferSize);
                if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                    throw new RuntimeException("AudioRecord init failed");
                }
                audioRecord.startRecording();
                Log.i(TAG, "Listening started — 16kHz mono");

                short[] shortBuffer = new short[512];
                while (isListening.get()) {
                    int read = audioRecord.read(shortBuffer, 0, shortBuffer.length);
                    if (read <= 0) continue;

                    float[] floatBuffer = new float[read];
                    for (int i = 0; i < read; i++) {
                        floatBuffer[i] = shortBuffer[i] / 32768.0f;
                    }

                    vad.acceptWaveform(floatBuffer);

                    while (!vad.empty()) {
                        SpeechSegment segment = vad.front();
                        vad.pop();
                        float[] samples = segment.getSamples();
                        if (samples.length < SAMPLE_RATE / 4) continue;

                        OfflineStream stream = recognizer.createStream();
                        stream.acceptWaveform(samples, SAMPLE_RATE);
                        recognizer.decode(stream);
                        OfflineRecognizerResult result = recognizer.getResult(stream);
                        stream.release();

                        String text = result.getText().trim();
                        if (!text.isEmpty()) {
                            Log.i(TAG, "Recognized: " + text);
                            final String t = text;
                            mainHandler.post(() -> {
                                JSObject ret = new JSObject();
                                ret.put("text", t);
                                ret.put("type", "result");
                                notifyListeners("onRecognitionResult", ret);
                            });
                        }
                    }
                }

                vad.flush();
                while (!vad.empty()) {
                    SpeechSegment segment = vad.front();
                    vad.pop();
                    OfflineStream stream = recognizer.createStream();
                    stream.acceptWaveform(segment.getSamples(), SAMPLE_RATE);
                    recognizer.decode(stream);
                    OfflineRecognizerResult result = recognizer.getResult(stream);
                    stream.release();
                    String text = result.getText().trim();
                    if (!text.isEmpty()) {
                        final String t = text;
                        mainHandler.post(() -> {
                            JSObject ret = new JSObject();
                            ret.put("text", t);
                            ret.put("type", "final");
                            notifyListeners("onRecognitionResult", ret);
                        });
                    }
                }

                if (audioRecord != null) {
                    audioRecord.stop();
                    audioRecord.release();
                    audioRecord = null;
                }
                Log.i(TAG, "Listening stopped");
                mainHandler.post(() -> call.resolve(new JSObject().put("success", true)));

            } catch (Exception e) {
                isListening.set(false);
                Log.e(TAG, "listening error", e);
                if (audioRecord != null) {
                    try { audioRecord.release(); } catch (Exception ignored) {}
                    audioRecord = null;
                }
                mainHandler.post(() -> call.reject("listening failed: " + e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        isListening.set(false);
        if (audioRecord != null && audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
            try { audioRecord.stop(); } catch (Exception ignored) {}
        }
        Log.i(TAG, "stopListening requested");
        call.resolve(new JSObject().put("success", true));
    }

    @PluginMethod
    public void isInitialized(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("initialized", isInitialized.get());
        ret.put("initializing", isInitializing.get());
        ret.put("modelsDownloaded", areModelsDownloaded());
        call.resolve(ret);
    }

    @PluginMethod
    public void release(PluginCall call) {
        cleanup();
        call.resolve(new JSObject().put("success", true));
    }
}
