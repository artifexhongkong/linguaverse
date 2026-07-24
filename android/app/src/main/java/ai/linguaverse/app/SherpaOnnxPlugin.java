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
    @PluginMethod
    public void downloadModels(PluginCall call) {
        if (isDownloading.get()) {
            call.reject("download already in progress");
            return;
        }
        isDownloading.set(true);

        inferenceExecutor.execute(() -> {
            try {
                File dir = getModelsDir();
                long totalBytes = 0;

                for (String[] entry : DOWNLOAD_FILES) {
                    String relPath = entry[0];
                    String url = entry[1];
                    File outFile = new File(dir, relPath);
                    outFile.getParentFile().mkdirs();

                    // Skip if already downloaded (idempotent — supports resume)
                    if (outFile.exists() && outFile.length() > 0) {
                        Log.i(TAG, "SKIP (exists): " + outFile);
                        totalBytes += outFile.length();
                        continue;
                    }

                    Log.i(TAG, "Downloading " + url + " → " + outFile);
                    final String currentFile = relPath;
                    totalBytes += downloadFile(url, outFile, (received, total) -> {
                        // Post progress to JS
                        int percent = total > 0 ? (int)(received * 100 / total) : 0;
                        JSObject prog = new JSObject();
                        prog.put("phase", "downloading");
                        prog.put("file", currentFile);
                        prog.put("received", received);
                        prog.put("total", total);
                        prog.put("percent", percent);
                        notifyListeners("onDownloadProgress", prog);
                    });
                }

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
                mainHandler.post(() -> {
                    notifyListeners("onDownloadProgress", err);
                    call.reject("download failed: " + e.getMessage());
                });
            } finally {
                isDownloading.set(false);
            }
        });
    }

    /**
     * Download a single file with progress callback. Supports HTTP redirects
     * (HuggingFace and GitHub use 302 redirects to CDN).
     */
    private long downloadFile(String urlStr, File outFile, ProgressCallback cb) throws IOException {
        HttpURLConnection conn = null;
        InputStream in = null;
        FileOutputStream out = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(60000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "LinguaVerse/1.0");

            int response = conn.getResponseCode();
            if (response != 200) {
                throw new IOException("HTTP " + response + " for " + urlStr);
            }

            long total = conn.getContentLength();
            in = conn.getInputStream();
            out = new FileOutputStream(outFile);

            byte[] buf = new byte[81920];
            long received = 0;
            int lastReportPercent = -1;
            int len;
            while ((len = in.read(buf)) > 0) {
                out.write(buf, 0, len);
                received += len;
                // Report progress at most every 5% to avoid flooding
                int percent = total > 0 ? (int)(received * 100 / total) : 0;
                if (percent != lastReportPercent && percent % 5 == 0) {
                    lastReportPercent = percent;
                    cb.onProgress(received, total);
                }
            }
            out.flush();
            Log.i(TAG, "Downloaded " + outFile.getName() + ": " + (received / 1024 / 1024) + " MB");
            return received;
        } finally {
            if (in != null) try { in.close(); } catch (Exception ignored) {}
            if (out != null) try { out.close(); } catch (Exception ignored) {}
            if (conn != null) conn.disconnect();
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
