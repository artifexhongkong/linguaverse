/**
 * SherpaOnnx Capacitor plugin — TypeScript API.
 *
 * Provides offline speech-to-text via sherpa-onnx + SenseVoiceSmall.
 * Available only on Android (native plugin). On web, calls will throw
 * — use `isAvailable()` to check before calling.
 */

import { registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle as CapacitorPluginListenerHandle } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";

/** Re-exported so consumers can type their listener handles. */
export type PluginListenerHandle = CapacitorPluginListenerHandle;

export interface RecognitionResult {
  /** Recognized text with punctuation (Cantonese / Mandarin / English). */
  text: string;
  /** "result" for intermediate segments, "final" for the last segment. */
  type: "result" | "final";
}

export interface DownloadProgress {
  phase: "downloading" | "done" | "error";
  file?: string;
  received?: number;
  total?: number;
  percent?: number;
  totalBytes?: number;
  message?: string;
}

export interface InitResult {
  success: boolean;
  message?: string;
}

export interface ModelsState {
  downloaded: boolean;
  totalBytes: number;
}

export interface InitializedState {
  initialized: boolean;
  initializing: boolean;
  modelsDownloaded: boolean;
}

export interface ConnectionTestResult {
  allOk: boolean;
  modelsDir: string;
  modelsDirExists: boolean;
  modelsDirWritable: boolean;
  urls: Array<{
    file: string;
    url: string;
    status: number;
    size?: number;
    ok: boolean;
    error?: string;
  }>;
}

export interface NativeLibTestResult {
  nativeLibLoaded: boolean;
  nativeLibError: string;
  modelsDownloaded: boolean;
  classFound: boolean;
  classError?: string;
  supportedAbis?: string[];
}

export interface SherpaOnnxPlugin {
  /** Diagnostic: test if native library loaded + class is accessible. */
  testNativeLib(): Promise<NativeLibTestResult>;
  /** Diagnostic: test network connectivity to all download URLs. */
  testConnection(): Promise<ConnectionTestResult>;
  /** Download model files (~236MB) from HuggingFace/GitHub to internal storage. */
  downloadModels(): Promise<{ success: boolean; totalBytes?: number }>;
  /** Check if model files exist in internal storage. */
  areModelsDownloaded(): Promise<ModelsState>;
  /** Delete downloaded model files (frees ~236MB). */
  deleteModels(): Promise<{ success: boolean; freedBytes: number }>;
  /** Load model files + create recognizer. Requires models downloaded first. */
  initSpeechRecognizer(): Promise<InitResult>;
  /** Start mic capture at 16kHz → VAD → SenseVoiceSmall → callback. */
  startListening(): Promise<{ success: boolean }>;
  /** Stop mic + flush remaining VAD segments + release audio. */
  stopListening(): Promise<{ success: boolean }>;
  /** Check if the recognizer is loaded and ready. */
  isInitialized(): Promise<InitializedState>;
  /** Free all native resources. */
  release(): Promise<{ success: boolean }>;
  /** Listen for recognized text segments. */
  addListener(
    event: "onRecognitionResult",
    listener: (result: RecognitionResult) => void,
  ): Promise<PluginListenerHandle>;
  /** Listen for model download progress updates. */
  addListener(
    event: "onDownloadProgress",
    listener: (progress: DownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

// registerPlugin returns a proxy. On non-Android platforms, method
// calls will reject — callers should catch and fall back gracefully.
export const SherpaOnnx = registerPlugin<SherpaOnnxPlugin>("SherpaOnnx");

/**
 * Check if the native plugin is available (Android only).
 * On web, returns false.
 *
 * Uses Capacitor.getPlatform() which is set at runtime by the native
 * bridge — NOT a build-time env var. Previous implementation read
 * import.meta.env.VITE_CAPACITOR_PLATFORM which was never set, so
 * the check always fell through to "web" even on Android.
 */
export function isSherpaOnnxAvailable(): boolean {
  try {
    return Capacitor.getPlatform() === "android";
  } catch {
    // If Capacitor isn't initialized yet (shouldn't happen at call time),
    // fall back to checking the global.
    return typeof window !== "undefined"
      && (window as any).capacitor?.platform === "android";
  }
}
