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

import com.k2fsa.sherpa.onnx.FeatureConfig;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * SherpaOnnxPlugin — offline speech-to-text via sherpa-onnx + SenseVoiceSmall.
 *
 * API: Kotlin data-class style (NOT builder pattern). Config objects are
 * created via constructor with named parameters emulated via overloads.
 *
 * Architecture:
 *   [JS VoiceInput] → startListening() → [Native AudioRecord @ 16kHz]
 *                                          ↓
 *                                   [Silero VAD segments speech]
 *                                          ↓
 *                                   [OfflineStream + SenseVoiceSmall decode]
 *                                          ↓
 *                                   [Callback with punctuated text]
 *
 * Threading:
 *   - Audio capture + VAD + recognition all run on a single background
 *     thread (inferenceExecutor) to avoid blocking the UI.
 *   - Results are posted back to the main thread via Handler.
 *
 * Hardware acceleration:
 *   - NNAPI provider enabled (set on OfflineModelConfig + VadModelConfig).
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

    // Native inference objects
    private OfflineRecognizer recognizer;
    private Vad vad;

    // Audio capture
    private AudioRecord audioRecord;
    private int audioBufferSize;

    // Threading
    private ExecutorService inferenceExecutor;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // State
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
     * then creates the OfflineRecognizer (SenseVoiceSmall) and Vad (Silero)
     * with NNAPI + 2 threads.
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

                // 1. Copy models from assets to internal storage
                Log.i(TAG, "Copying models from assets to " + modelsDir);
                copyAssetsToInternal(ctx, ASSET_DIR, modelsDir);

                String modelPath = new File(modelsDir, "sense-voice/model.int8.onnx").getAbsolutePath();
                String tokensPath = new File(modelsDir, "sense-voice/tokens.txt").getAbsolutePath();
                String vadModelPath = new File(modelsDir, "silero-vad/silero_vad.onnx").getAbsolutePath();

                verifyFile(modelPath);
                verifyFile(tokensPath);
                verifyFile(vadModelPath);

                // 2. Build SenseVoice config
                //    OfflineSenseVoiceModelConfig(model, language, useInverseTextNormalization)
                OfflineSenseVoiceModelConfig senseVoice = new OfflineSenseVoiceModelConfig(
                        modelPath,   // model
                        "auto",      // language — auto-detect (zh/en/ja/ko/yue)
                        true         // useInverseTextNormalization
                );

                // 3. Build OfflineModelConfig — holds tokens, numThreads, provider
                //    Constructor params (Kotlin data class):
                //      transducer, paraformer, whisper, moonshine, nemo,
                //      senseVoice, tokens, numThreads, debug, provider,
                //      modelType, modelingUnit, lemmaText, hotwordsFile, parakeet
                //    We only set senseVoice, tokens, numThreads, provider, debug.
                //    Others get default empty/null values.
                OfflineModelConfig modelConfig = new OfflineModelConfig(
                        null,         // transducer
                        null,         // paraformer
                        null,         // whisper
                        null,         // moonshine
                        null,         // nemo
                        senseVoice,   // senseVoice
                        tokensPath,   // tokens
                        2,            // numThreads
                        false,        // debug
                        "nnapi",      // provider — Android hardware acceleration
                        null, 0, null, null, null, null, null  // remaining defaults
                );

                // 4. Build OfflineRecognizerConfig
                //    Constructor: (featConfig, modelConfig, ...)
                OfflineRecognizerConfig recognizerConfig = new OfflineRecognizerConfig(
                        new FeatureConfig(),  // featConfig — default sampleRate=16000
                        modelConfig,
                        null, 0, null, 0f, null, null, 0f, 0  // remaining defaults
                );

                Log.i(TAG, "Creating OfflineRecognizer (SenseVoiceSmall, NNAPI, threads=2)...");
                recognizer = new OfflineRecognizer(recognizerConfig);

                // 5. Build Silero VAD config
                //    SileroVadModelConfig(model, threshold, minSilenceDuration,
                //      minSpeechDuration, windowSize, maxSpeechDuration)
                SileroVadModelConfig sileroVad = new SileroVadModelConfig(
                        vadModelPath,    // model
                        0.5f,            // threshold
                        500f,            // minSilenceDuration (ms)
                        100f,            // minSpeechDuration (ms)
                        512,             // windowSize
                        30000f           // maxSpeechDuration (ms)
                );

                // 6. Build VadModelConfig
                //    Constructor: (sileroVad, sampleRate, numThreads, provider, debug)
                VadModelConfig vadConfig = new VadModelConfig(
                        sileroVad,
                        SAMPLE_RATE,     // sampleRate
                        2,               // numThreads
                        "nnapi",         // provider
                        false            // debug
                );

                Log.i(TAG, "Creating Vad (Silero, NNAPI, threads=2)...");
                vad = new Vad(vadConfig);

                // 7. Prepare audio buffer size
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

                // 2. Audio processing loop (background thread)
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
                    while (!vad.empty()) {
                        SpeechSegment segment = vad.front();
                        vad.pop();

                        float[] segmentSamples = segment.getSamples();
                        if (segmentSamples.length < SAMPLE_RATE / 4) {
                            continue; // skip very short segments (<0.25s)
                        }

                        // 5. Create OfflineStream, feed segment, decode
                        OfflineStream stream = recognizer.createStream();
                        stream.acceptWaveform(segmentSamples, SAMPLE_RATE);
                        OfflineRecognizerResult result = recognizer.decode(stream);
                        stream.release();

                        String text = result.getText().trim();
                        if (!text.isEmpty()) {
                            Log.i(TAG, "Recognized: " + text);
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

                // 6. Flush remaining audio in VAD
                vad.flush();
                while (!vad.empty()) {
                    SpeechSegment segment = vad.front();
                    vad.pop();
                    OfflineStream stream = recognizer.createStream();
                    stream.acceptWaveform(segment.getSamples(), SAMPLE_RATE);
                    OfflineRecognizerResult result = recognizer.decode(stream);
                    stream.release();
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

                // 7. Stop audio record
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
     */
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
        call.resolve(ret);
    }

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

    private void copyAssetsToInternal(Context ctx, String assetPath, File outDir) throws IOException {
        outDir.mkdirs();
        AssetManager am = ctx.getAssets();
        String[] children = am.list(assetPath);
        if (children == null || children.length == 0) return;
        for (String child : children) {
            String childAsset = assetPath + "/" + child;
            String[] subChildren = am.list(childAsset);
            if (subChildren != null && subChildren.length > 0) {
                copyAssetsToInternal(ctx, childAsset, new File(outDir, child));
            } else {
                File outFile = new File(outDir, child);
                if (outFile.exists() && outFile.length() > 0) {
                    Log.i(TAG, "SKIP (exists): " + outFile);
                    continue;
                }
                Log.i(TAG, "Copying: " + childAsset + " → " + outFile);
                try (InputStream in = am.open(childAsset);
                     FileOutputStream out = new FileOutputStream(outFile)) {
                    byte[] buf = new byte[81920];
                    int len;
                    while ((len = in.read(buf)) > 0) {
                        out.write(buf, 0, len);
                    }
                }
            }
        }
    }
}
