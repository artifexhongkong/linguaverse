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

    // Download URLs — public mirrors, no auth required.
    private static final String SENSE_VOICE_BASE =
            "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main";
    private static final String VAD_URL =
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";

    // Files to download (relative path under MODEL_DIR → download URL)
    private static final String[][] DOWNLOAD_FILES = {
            {"sense-voice/model.int8.onnx", SENSE_VOICE_BASE + "/model.int8.onnx"},
            {"sense-voice/tokens.txt",      SENSE_VOICE_BASE + "/tokens.txt"},
            {"silero-vad/silero_vad.onnx",  VAD_URL},
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
     * Check if all required model files exist in internal storage.
     */
    private boolean areModelsDownloaded() {
        File dir = getModelsDir();
        for (String[] entry : DOWNLOAD_FILES) {
            File f = new File(dir, entry[0]);
            if (!f.exists() || f.length() == 0) return false;
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
     */
    @PluginMethod
    public void testConnection(PluginCall call) {
        inferenceExecutor.execute(() -> {
            JSObject result = new JSObject();
            org.json.JSONArray urls = new org.json.JSONArray();
            boolean allOk = true;

            for (String[] entry : DOWNLOAD_FILES) {
                String relPath = entry[0];
                String urlStr = entry[1];
                JSObject item = new JSObject();
                item.put("file", relPath);
                item.put("url", urlStr);
                try {
                    URL url = new URL(urlStr);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(15000);
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod("HEAD");
                    conn.setRequestProperty("User-Agent", "LinguaVerse/1.1");
                    int code = conn.getResponseCode();
                    long size = conn.getContentLength();
                    item.put("status", code);
                    item.put("size", size);
                    item.put("ok", code == 200 || code == 301 || code == 302);
                    if (code != 200 && code != 301 && code != 302) allOk = false;
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

            final boolean finalAllOk = allOk;
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

                for (String[] entry : DOWNLOAD_FILES) {
                    String relPath = entry[0];
                    String url = entry[1];
                    File outFile = new File(dir, relPath);
                    outFile.getParentFile().mkdirs();

                    Log.i(TAG, "Downloading " + url + " → " + outFile);
                    final String currentFile = relPath;
                    totalBytes += downloadFile(url, outFile, (received, total) -> {
                        // Post progress to JS on the MAIN thread
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

        Exception lastError = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                long downloaded = downloadFileOnce(urlStr, outFile, cb, existingBytes);
                return downloaded;
            } catch (Exception e) {
                lastError = e;
                Log.w(TAG, "Download attempt " + attempt + " failed for " + outFile.getName()
                        + ": " + e.getClass().getSimpleName() + ": " + e.getMessage());
                // Update existingBytes for resume on next attempt
                existingBytes = outFile.exists() ? outFile.length() : 0;
                if (attempt < 3) {
                    try { Thread.sleep(2000L * attempt); } catch (InterruptedException ignored) {}
                }
            }
        }
        throw new IOException("下載失敗（重試 3 次）: " + lastError.getClass().getSimpleName()
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
            call.reject("models not downloaded — call downloadModels() first");
            return;
        }

        isInitializing.set(true);
        inferenceExecutor.execute(() -> {
            try {
                File dir = getModelsDir();
                String modelPath = new File(dir, "sense-voice/model.int8.onnx").getAbsolutePath();
                String tokensPath = new File(dir, "sense-voice/tokens.txt").getAbsolutePath();
                String vadModelPath = new File(dir, "silero-vad/silero_vad.onnx").getAbsolutePath();

                // OfflineSenseVoiceModelConfig
                OfflineSenseVoiceModelConfig senseVoice = new OfflineSenseVoiceModelConfig();
                senseVoice.setModel(modelPath);
                senseVoice.setLanguage("auto");
                senseVoice.setUseInverseTextNormalization(true);

                OfflineModelConfig modelConfig = new OfflineModelConfig();
                modelConfig.setSenseVoice(senseVoice);
                modelConfig.setTokens(tokensPath);
                modelConfig.setNumThreads(2);
                modelConfig.setProvider("nnapi");
                modelConfig.setDebug(false);

                OfflineRecognizerConfig recognizerConfig = new OfflineRecognizerConfig();
                recognizerConfig.setModelConfig(modelConfig);

                Log.i(TAG, "Creating OfflineRecognizer (SenseVoiceSmall, NNAPI, threads=2)...");
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
                vadConfig.setProvider("nnapi");
                vadConfig.setDebug(false);

                Log.i(TAG, "Creating Vad (Silero, NNAPI, threads=2)...");
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
