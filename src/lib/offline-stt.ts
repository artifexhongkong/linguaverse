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
  type PluginListenerHandle,
} from "../plugins/sherpa-onnx";

let initPromise: Promise<void> | null = null;
let resultListener: PluginListenerHandle | null = null;
let pendingResultHandler: ((text: string, type: "result" | "final") => void) | null = null;

/**
 * Initialize the offline recognizer (idempotent — safe to call multiple
 * times). Returns immediately if already initialized.
 *
 * @throws if the native plugin isn't available (web) or init fails.
 */
export async function ensureInitialized(): Promise<void> {
  if (!isSherpaOnnxAvailable()) {
    throw new Error("離線語音辨識僅支援 Android");
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Set up result listener BEFORE init, so we don't miss early results
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

    // Init is async — model files are copied + recognizer created
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
 * avoid the ~10-30s delay on first mic tap).
 */
export async function preInitialize(): Promise<void> {
  if (!isSherpaOnnxAvailable()) return;
  try {
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
