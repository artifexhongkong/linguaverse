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
 * SherpaOnnxPlugin — offline STT via sherpa-onnx + SenseVoiceSmall.
 *
 * Kotlin data classes have default values for all params, so we use the
 * no-arg constructor + setters (Java sees Kotlin `var` as getX/setX).
 *
 * Key API notes (verified from v1.10.40 Kotlin source):
 *   - OfflineRecognizer(null, config) — first arg is nullable AssetManager
 *   - vad.acceptWaveform(float[]) — NO sampleRate param (uses config's rate)
 *   - recognizer.decode(stream) returns void — call getResult(stream) after
 *   - vad.empty() not isEmpty()
 */
@CapacitorPlugin(name = "SherpaOnnx")
public class SherpaOnnxPlugin extends Plugin {

    private static final String TAG = "SherpaOnnx";
    private static final String ASSET_DIR = "sherpa-models";
    private static final int SAMPLE_RATE = 16000;

    private OfflineRecognizer recognizer;
    private Vad vad;
    private AudioRecord audioRecord;
    private int audioBufferSize;
    private ExecutorService inferenceExecutor;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean isListening = new AtomicBoolean(false);
    private final AtomicBoolean isInitialized = new AtomicBoolean(false);
    private final AtomicBoolean isInitializing = new AtomicBoolean(false);

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
                copyAssetsToInternal(ctx, ASSET_DIR, modelsDir);

                String modelPath = new File(modelsDir, "sense-voice/model.int8.onnx").getAbsolutePath();
                String tokensPath = new File(modelsDir, "sense-voice/tokens.txt").getAbsolutePath();
                String vadModelPath = new File(modelsDir, "silero-vad/silero_vad.onnx").getAbsolutePath();
                verifyFile(modelPath);
                verifyFile(tokensPath);
                verifyFile(vadModelPath);

                // --- Build OfflineRecognizerConfig (no-arg + setters) ---
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
                // featConfig defaults to FeatureConfig() with sampleRate=16000

                Log.i(TAG, "Creating OfflineRecognizer (SenseVoiceSmall, NNAPI, threads=2)...");
                // Constructor: OfflineRecognizer(AssetManager? = null, config)
                // From Java, pass null for the first arg to use file-based loading.
                recognizer = new OfflineRecognizer(null, recognizerConfig);

                // --- Build VadModelConfig (no-arg + setters) ---
                SileroVadModelConfig sileroVad = new SileroVadModelConfig();
                sileroVad.setModel(vadModelPath);
                sileroVad.setThreshold(0.5f);
                sileroVad.setMinSilenceDuration(500f);   // ms
                sileroVad.setMinSpeechDuration(100f);     // ms
                sileroVad.setMaxSpeechDuration(30000f);   // ms (30s cap)

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

                    // short[] → float[] (normalized)
                    float[] floatBuffer = new float[read];
                    for (int i = 0; i < read; i++) {
                        floatBuffer[i] = shortBuffer[i] / 32768.0f;
                    }

                    // VAD accepts float[] (no sampleRate — uses config's rate)
                    vad.acceptWaveform(floatBuffer);

                    // Drain VAD segments → recognize
                    while (!vad.empty()) {
                        SpeechSegment segment = vad.front();
                        vad.pop();

                        float[] samples = segment.getSamples();
                        if (samples.length < SAMPLE_RATE / 4) continue;

                        // Create stream → feed samples → decode → get result
                        OfflineStream stream = recognizer.createStream();
                        stream.acceptWaveform(samples, SAMPLE_RATE);
                        recognizer.decode(stream);  // void — triggers recognition
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

                // Flush remaining VAD audio
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
        call.resolve(ret);
    }

    @PluginMethod
    public void release(PluginCall call) {
        cleanup();
        call.resolve(new JSObject().put("success", true));
    }

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
                Log.i(TAG, "Copying: " + childAsset);
                try (InputStream in = am.open(childAsset);
                     FileOutputStream out = new FileOutputStream(outFile)) {
                    byte[] buf = new byte[81920];
                    int len;
                    while ((len = in.read(buf)) > 0) out.write(buf, 0, len);
                }
            }
        }
    }
}
