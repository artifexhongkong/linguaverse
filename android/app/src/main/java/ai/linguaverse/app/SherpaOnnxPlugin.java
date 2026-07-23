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

import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizerResult;
import com.k2fsa.sherpa.onnx.SenseVoiceModelConfig;
import com.k2fsa.sherpa.onnx.SileroVadModelConfig;
import com.k2fsa.sherpa.onnx.SpeechSegment;
import com.k2fsa.sherpa.onnx.VadModelConfig;
import com.k2fsa.sherpa.onnx.VoiceActivityDetector;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * SherpaOnnxPlugin — offline speech-to-text via sherpa-onnx + SenseVoiceSmall.
 *
 * Architecture:
 *   [JS VoiceInput] → startListening() → [Native AudioRecord @ 16kHz]
 *                                          ↓
 *                                   [Silero VAD segments speech]
 *                                          ↓
 *                                   [SenseVoiceSmall recognizes segment]
 *                                          ↓
 *                                   [Callback with punctuated text]
 *
 * Threading:
 *   - Audio capture + VAD + recognition all run on a single background
 *     thread (inferenceExecutor) to avoid blocking the UI.
 *   - Results are posted back to the main thread via Handler.
 *
 * Hardware acceleration:
 *   - NNAPI provider enabled for both recognizer and VAD.
 *   - numThreads = 2 for balanced CPU usage.
 *
 * Model files (bundled in assets/sherpa-models/, copied to internal
 * storage on first init):
 *   - sense-voice/model.int8.onnx  (~234MB, int8 quantized)
 *   - sense-voice/tokens.txt
 *   - silero-vad/silero_vad.onnx   (~1.8MB)
 *
 * SenseVoiceSmall supports: zh, en, ja, ko, yue (Cantonese) with
 * built-in punctuation — ideal for LinguaVerse's target audience.
 */
@CapacitorPlugin(name = "SherpaOnnx")
public class SherpaOnnxPlugin extends Plugin {

    private static final String TAG = "SherpaOnnx";
    private static final String ASSET_DIR = "sherpa-models";
    private static final int SAMPLE_RATE = 16000;

    // Native inference objects — created in initSpeechRecognizer()
    private OfflineRecognizer recognizer;
    private VoiceActivityDetector vad;

    // Audio capture
    private AudioRecord audioRecord;
    private int audioBufferSize;

    // Threading
    private ExecutorService inferenceExecutor;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // State flags (thread-safe)
    private final AtomicBoolean isListening = new AtomicBoolean(false);
    private final AtomicBoolean isInitialized = new AtomicBoolean(false);
    private final AtomicBoolean isInitializing = new AtomicBoolean(false);

    // ----------------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------------

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
            } catch (Exception e) {
                Log.w(TAG, "audioRecord release error", e);
            }
            audioRecord = null;
        }
        if (vad != null) {
            try { vad.release(); } catch (Exception ignored) {}
            vad = null;
        }
        if (recognizer != null) {
            try { recognizer.release(); } catch (Exception ignored) {}
            recognizer = null;
        }
        if (inferenceExecutor != null && !inferenceExecutor.isShutdown()) {
            inferenceExecutor.shutdown();
        }
        isInitialized.set(false);
    }

    // ----------------------------------------------------------------
    // Plugin methods
    // ----------------------------------------------------------------

    /**
     * initSpeechRecognizer — async model loading.
     *
     * Copies model files from assets to internal storage (first time only),
     * then creates the OfflineRecognizer (SenseVoiceSmall) and
     * VoiceActivityDetector (Silero VAD) with NNAPI + 2 threads.
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
        isInitializing.set(true);

        inferenceExecutor.execute(() -> {
            try {
                Context ctx = getContext();
                File modelsDir = new File(ctx.getFilesDir(), ASSET_DIR);

                // 1. Copy models from assets to internal storage (idempotent)
                Log.i(TAG, "Copying models from assets to " + modelsDir);
                copyAssetsToInternal(ctx, ASSET_DIR, modelsDir);

                String modelPath = new File(modelsDir, "sense-voice/model.int8.onnx").getAbsolutePath();
                String tokensPath = new File(modelsDir, "sense-voice/tokens.txt").getAbsolutePath();
                String vadModelPath = new File(modelsDir, "silero-vad/silero_vad.onnx").getAbsolutePath();

                // Verify files exist
                verifyFile(modelPath);
                verifyFile(tokensPath);
                verifyFile(vadModelPath);

                // 2. Build SenseVoice config — NNAPI + 2 threads
                SenseVoiceModelConfig senseVoice = SenseVoiceModelConfig.builder()
                        .setModel(modelPath)
                        .setTokens(tokensPath)
                        .setNumThreads(2)
                        .build();

                OfflineRecognizerConfig recognizerConfig = OfflineRecognizerConfig.builder()
                        .setSenseVoice(senseVoice)
                        .setDebug(false)
                        .build();

                Log.i(TAG, "Creating OfflineRecognizer (SenseVoiceSmall, NNAPI, threads=2)...");
                recognizer = new OfflineRecognizer(recognizerConfig);

                // 3. Build Silero VAD config — NNAPI + 2 threads
                SileroVadModelConfig sileroVad = SileroVadModelConfig.builder()
                        .setModel(vadModelPath)
                        .setThreshold(0.5f)
                        .setMinSilenceDurationMs(500)
                        .setMaxSpeechDurationMs(30000)
                        .build();

                VadModelConfig vadConfig = VadModelConfig.builder()
                        .setSileroVad(sileroVad)
                        .setNumThreads(2)
                        .setSampleRate(SAMPLE_RATE)
                        .setProvider("nnapi")
                        .build();

                Log.i(TAG, "Creating VoiceActivityDetector (Silero, NNAPI, threads=2)...");
                vad = new VoiceActivityDetector(vadConfig);

                // 4. Prepare audio buffer size
                audioBufferSize = Math.max(
                        AudioRecord.getMinBufferSize(SAMPLE_RATE,
                                AudioFormat.CHANNEL_IN_MONO,
                                AudioFormat.ENCODING_PCM_16BIT),
                        SAMPLE_RATE * 2  // at least 1 second
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

    /**
     * startListening — begin audio capture + VAD + recognition loop.
     *
     * Runs entirely on the background inference thread. As VAD detects
     * speech segments, the recognizer decodes them and posts results
     * back to JS via the "onRecognitionResult" event.
     */
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
                // 1. Create AudioRecord @ 16kHz mono PCM_16BIT
                audioRecord = new AudioRecord(
                        MediaRecorder.AudioSource.MIC,
                        SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        audioBufferSize
                );

                if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                    throw new RuntimeException("AudioRecord failed to initialize");
                }

                audioRecord.startRecording();
                Log.i(TAG, "Listening started — 16kHz mono, buffer=" + audioBufferSize);

                // 2. Audio processing loop (runs on background thread)
                short[] shortBuffer = new short[512];
                while (isListening.get()) {
                    int read = audioRecord.read(shortBuffer, 0, shortBuffer.length);
                    if (read <= 0) continue;

                    // Convert short[] → float[] (normalized -1.0 .. 1.0)
                    float[] floatBuffer = new float[read];
                    for (int i = 0; i < read; i++) {
                        floatBuffer[i] = shortBuffer[i] / 32768.0f;
                    }

                    // 3. Feed to VAD
                    vad.acceptWaveform(floatBuffer, SAMPLE_RATE);

                    // 4. Drain VAD segments → recognize each
                    while (!vad.isEmpty()) {
                        SpeechSegment segment = vad.front();
                        vad.pop();

                        float[] segmentSamples = segment.getSamples();
                        if (segmentSamples.length < SAMPLE_RATE / 4) {
                            // Skip very short segments (<0.25s) — likely noise
                            continue;
                        }

                        // 5. Run SenseVoiceSmall on the segment
                        OfflineRecognizerResult result = recognizer.decode(segmentSamples);
                        String text = result.getText().trim();

                        if (!text.isEmpty()) {
                            Log.i(TAG, "Recognized: " + text);
                            // 6. Post result to JS on main thread
                            final String resultText = text;
                            mainHandler.post(() -> {
                                JSObject ret = new JSObject();
                                ret.put("text", resultText);
                                ret.put("type", "result");
                                notifyListeners("onRecognitionResult", ret);
                            });
                        }
                    }
                }

                // 7. Flush remaining audio in VAD
                vad.flush();
                while (!vad.isEmpty()) {
                    SpeechSegment segment = vad.front();
                    vad.pop();
                    OfflineRecognizerResult result = recognizer.decode(segment.getSamples());
                    String text = result.getText().trim();
                    if (!text.isEmpty()) {
                        final String resultText = text;
                        mainHandler.post(() -> {
                            JSObject ret = new JSObject();
                            ret.put("text", resultText);
                            ret.put("type", "final");
                            notifyListeners("onRecognitionResult", ret);
                        });
                    }
                }

                // 8. Stop audio record
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

    /**
     * stopListening — gracefully stop audio capture + flush VAD.
     *
     * The background loop in startListening will exit on the next
     * iteration because isListening becomes false. Remaining VAD
     * segments are flushed and recognized before the loop exits.
     */
    @PluginMethod
    public void stopListening(PluginCall call) {
        isListening.set(false);
        // The background loop handles AudioRecord cleanup, but we
        // also do it here in case the loop is blocked.
        if (audioRecord != null && audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
            try { audioRecord.stop(); } catch (Exception ignored) {}
        }
        Log.i(TAG, "stopListening requested");
        call.resolve(new JSObject().put("success", true));
    }

    /**
     * isInitialized — check if the recognizer is ready.
     */
    @PluginMethod
    public void isInitialized(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("initialized", isInitialized.get());
        ret.put("initializing", isInitializing.get());
        call.resolve(ret);
    }

    /**
     * release — free all native resources (for manual cleanup).
     */
    @PluginMethod
    public void release(PluginCall call) {
        cleanup();
        call.resolve(new JSObject().put("success", true));
    }

    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------

    private void verifyFile(String path) throws IOException {
        File f = new File(path);
        if (!f.exists() || f.length() == 0) {
            throw new IOException("Model file missing or empty: " + path);
        }
        Log.i(TAG, "Verified: " + path + " (" + (f.length() / 1024 / 1024) + " MB)");
    }

    /**
     * Recursively copy assets to internal storage. Skips files that
     * already exist (so subsequent inits are fast).
     */
    private void copyAssetsToInternal(Context ctx, String assetPath, File outDir) throws IOException {
        outDir.mkdirs();
        AssetManager am = ctx.getAssets();
        String[] children = am.list(assetPath);
        if (children == null || children.length == 0) {
            // It's a file, not a directory
            return;
        }
        for (String child : children) {
            String childAsset = assetPath + "/" + child;
            String[] subChildren = am.list(childAsset);
            if (subChildren != null && subChildren.length > 0) {
                // Directory — recurse
                copyAssetsToInternal(ctx, childAsset, new File(outDir, child));
            } else {
                // File — copy if not already present
                File outFile = new File(outDir, child);
                if (outFile.exists() && outFile.length() > 0) {
                    Log.i(TAG, "SKIP (exists): " + outFile);
                    continue;
                }
                Log.i(TAG, "Copying: " + childAsset + " → " + outFile);
                try (InputStream in = am.open(childAsset);
                     FileOutputStream out = new FileOutputStream(outFile)) {
                    byte[] buf = new byte[81920]; // 80KB buffer for large files
                    int len;
                    while ((len = in.read(buf)) > 0) {
                        out.write(buf, 0, len);
                    }
                }
            }
        }
    }
}
