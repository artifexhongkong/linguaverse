/**
 * SherpaOnnx Capacitor plugin — TypeScript API.
 *
 * Provides offline speech-to-text via sherpa-onnx + SenseVoiceSmall.
 * Available only on Android (native plugin). On web, calls will throw
 * — use `isAvailable()` to check before calling.
 */

import { registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle as CapacitorPluginListenerHandle } from "@capacitor/core";

/** Re-exported so consumers can type their listener handles. */
export type PluginListenerHandle = CapacitorPluginListenerHandle;

export interface RecognitionResult {
  /** Recognized text with punctuation (Cantonese / Mandarin / English). */
  text: string;
  /** "result" for intermediate segments, "final" for the last segment. */
  type: "result" | "final";
}

export interface InitResult {
  success: boolean;
  message?: string;
}

export interface InitializedState {
  initialized: boolean;
  initializing: boolean;
}

export interface SherpaOnnxPlugin {
  /** Load model files + create recognizer (async, ~5-30s first time). */
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
}

// registerPlugin returns a proxy. On non-Android platforms, method
// calls will reject — callers should catch and fall back gracefully.
export const SherpaOnnx = registerPlugin<SherpaOnnxPlugin>("SherpaOnnx");

/**
 * Check if the native plugin is available (Android only).
 * On web, returns false.
 */
export function isSherpaOnnxAvailable(): boolean {
  // Capacitor sets platform info at runtime
  const platform =
    (import.meta as any).env?.VITE_CAPACITOR_PLATFORM ??
    (typeof window !== "undefined" && (window as any).capacitor?.platform) ??
    "web";
  return platform === "android";
}
