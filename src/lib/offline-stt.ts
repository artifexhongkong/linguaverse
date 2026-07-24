/**
 * Offline speech-to-text client — wraps the SherpaOnnx native plugin.
 *
 * This is the primary STT path on Android. It uses SenseVoiceSmall
 * (supports zh/en/ja/ko/yue with built-in punctuation) running fully
 * on-device via sherpa-onnx with NNAPI hardware acceleration.
 *
 * Lifecycle:
 *   1. ensureInitialized() — called lazily before first recording.
 *      Copies model files from assets to internal storage (first time
 *      only, ~10-30s), then creates the recognizer + VAD.
 *   2. startListening() — starts mic capture at 16kHz. As VAD detects
 *      speech segments, the recognizer outputs text via the
 *      onRecognitionResult callback.
 *   3. stopListening() — stops mic, flushes remaining VAD segments.
 *
 * If the native plugin isn't available (web build), falls back to the
 * cloud-based stt-client.ts so the app still works on web.
 */

import {
  SherpaOnnx,
  isSherpaOnnxAvailable,
  type RecognitionResult,
  type DownloadProgress as DownloadProgressType,
  type PluginListenerHandle,
} from "../plugins/sherpa-onnx";

/** Re-exported so SettingsPage can type its progress handler. */
export type DownloadProgress = DownloadProgressType;

let initPromise: Promise<void> | null = null;
let resultListener: PluginListenerHandle | null = null;
let pendingResultHandler: ((text: string, type: "result" | "final") => void) | null = null;

// ----------------------------------------------------------------
// Model management
// ----------------------------------------------------------------

/**
 * Check if model files have been downloaded to internal storage.
 * Returns { downloaded: false, totalBytes: 0 } on web.
 */
export async function checkModels(): Promise<{ downloaded: boolean; totalBytes: number }> {
  if (!isSherpaOnnxAvailable()) return { downloaded: false, totalBytes: 0 };
  try {
    return await SherpaOnnx.areModelsDownloaded();
  } catch {
    return { downloaded: false, totalBytes: 0 };
  }
}

/**
 * Download model files (~236MB) from HuggingFace/GitHub.
 * Reports progress via the onProgress callback.
 *
 * @param onProgress called with download progress updates
 * @throws if download fails
 */
export async function downloadModels(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  if (!isSherpaOnnxAvailable()) {
    throw new Error("離線語音辨識僅支援 Android App");
  }

  let progressListener: PluginListenerHandle | null = null;
  if (onProgress) {
    progressListener = await SherpaOnnx.addListener("onDownloadProgress", onProgress);
  }

  try {
    await SherpaOnnx.downloadModels();
  } finally {
    if (progressListener) {
      try { await progressListener.remove(); } catch {}
    }
  }
}

/**
 * Delete downloaded model files (frees ~236MB).
 */
export async function deleteModels(): Promise<void> {
  if (!isSherpaOnnxAvailable()) return;
  // Reset init state since models are gone
  initPromise = null;
  try {
    await SherpaOnnx.deleteModels();
  } catch {}
}

// ----------------------------------------------------------------
// Speech recognition
// ----------------------------------------------------------------

/**
 * Initialize the offline recognizer (idempotent — safe to call multiple
 * times). Models must be downloaded first via downloadModels().
 *
 * @throws if the native plugin isn't available (web), models aren't
 *         downloaded, or init fails.
 */
export async function ensureInitialized(): Promise<void> {
  if (!isSherpaOnnxAvailable()) {
    throw new Error("離線語音辨識僅支援 Android App");
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Set up result listener BEFORE init
    if (!resultListener) {
      resultListener = await SherpaOnnx.addListener(
        "onRecognitionResult",
        (result: RecognitionResult) => {
          if (pendingResultHandler && result.text) {
            pendingResultHandler(result.text, result.type);
          }
        },
      );
    }

    const state = await SherpaOnnx.isInitialized();
    if (state.initialized) return;
    if (!state.modelsDownloaded) {
      throw new Error("語音模型尚未下載，請先到設定頁下載");
    }

    const res = await SherpaOnnx.initSpeechRecognizer();
    if (!res.success && res.message !== "already initialized" && res.message !== "initializing") {
      throw new Error("語音引擎初始化失敗");
    }
  })();

  return initPromise;
}

/**
 * Start listening. The callback fires for each recognized speech segment
 * (with punctuation). The callback runs on the main thread.
 *
 * @param onResult called with each recognized text segment
 */
export async function startListening(
  onResult: (text: string, type: "result" | "final") => void,
): Promise<void> {
  await ensureInitialized();
  pendingResultHandler = onResult;
  await SherpaOnnx.startListening();
}

/**
 * Stop listening. Flushes any remaining VAD segments (which may produce
 * one final callback). Clears the result handler.
 */
export async function stopListening(): Promise<void> {
  try {
    await SherpaOnnx.stopListening();
  } finally {
    pendingResultHandler = null;
  }
}

/**
 * Check if offline STT is available on this platform.
 */
export function isOfflineSTTAvailable(): boolean {
  return isSherpaOnnxAvailable();
}

/**
 * Pre-initialize the recognizer (optional — call on app startup to
 * avoid the ~5-10s delay on first mic tap, after models are downloaded).
 */
export async function preInitialize(): Promise<void> {
  if (!isSherpaOnnxAvailable()) return;
  try {
    const state = await SherpaOnnx.isInitialized();
    if (!state.modelsDownloaded) return; // don't try to init without models
    await ensureInitialized();
  } catch (err) {
    console.warn("[offline-stt] pre-init failed (will retry on first use):", err);
  }
}

/**
 * Release all native resources. Call when the app is done with STT
 * (e.g. on page unmount) to avoid memory leaks.
 */
export async function release(): Promise<void> {
  if (!isSherpaOnnxAvailable()) return;
  pendingResultHandler = null;
  if (resultListener) {
    try { await resultListener.remove(); } catch {}
    resultListener = null;
  }
  try {
    await SherpaOnnx.release();
  } catch {}
  initPromise = null;
}
