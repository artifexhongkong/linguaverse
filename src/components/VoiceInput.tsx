import { useEffect, useRef, useState } from "react";
import {
  isOfflineSTTAvailable,
  startListening as offlineStart,
  stopListening as offlineStop,
  preInitialize as offlinePreInit,
  release as offlineRelease,
} from "../lib/offline-stt";

/**
 * Premium voice-input button — industrial minimalist design.
 *
 * STT backend: sherpa-onnx + SenseVoiceSmall (fully offline, on-device).
 * Falls back to cloud STT (stt-client.ts) if the native plugin isn't
 * available (web build).
 *
 * Visual states:
 *  - **Idle**: fine mic icon, hairline border; hover → soft cyan glow.
 *  - **Recording**: red gradient + breathing pulse + live timer.
 *  - **Transcribing**: blue tint + spinner (only for cloud fallback).
 *
 * Offline mode flow:
 *  1. Tap → startListening() → native AudioRecord @ 16kHz captures audio
 *  2. VAD (Silero) segments speech → SenseVoiceSmall recognizes each
 *  3. Callback fires with punctuated text (zh/en/yue) → appended to input
 *  4. Tap again → stopListening() → flush remaining segments
 *
 * Results arrive in real-time as the user speaks (segment-by-segment).
 */

interface VoiceInputProps {
  onTranscribed: (text: string) => void;
  onToast: (msg: string) => void;
  disabled?: boolean;
  onStateChange?: (state: "idle" | "recording" | "transcribing") => void;
}

const MAX_RECORD_SECONDS = 60;

export function VoiceInput({ onTranscribed, onToast, disabled, onStateChange }: VoiceInputProps) {
  const [state, setStateRaw] = useState<"idle" | "recording" | "transcribing" | "initializing">("idle");
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineAvailable = isOfflineSTTAvailable();

  const setState = (next: "idle" | "recording" | "transcribing" | "initializing") => {
    setStateRaw(next);
    onStateChange?.(next === "initializing" ? "idle" : next);
  };

  // Pre-initialize the offline recognizer on mount (Android only).
  // This avoids the ~10-30s delay on first tap.
  useEffect(() => {
    if (offlineAvailable) {
      void offlinePreInit().catch(() => {});
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      // Don't release the recognizer here — keep it alive for the
      // app's lifetime. It's released on app exit.
    };
  }, [offlineAvailable]);

  const startTimer = () => {
    setSeconds(0);
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_RECORD_SECONDS) {
          void handleStop();
        }
        return s + 1;
      });
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // ---- Offline STT (Android) ----
  const handleOfflineStart = async () => {
    setState("initializing");
    try {
      await offlineStart((text, type) => {
        // Each recognized segment is appended to the input
        if (text) onTranscribed(text);
        if (type === "result") {
          onToast("識別中…");
        }
      });
      setState("recording");
      startTimer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "語音引擎啟動失敗";
      onToast(msg);
      setState("idle");
    }
  };

  const handleOfflineStop = async () => {
    stopTimer();
    setState("transcribing");
    try {
      await offlineStop();
      onToast("已識別語音內容");
    } catch {
      // ignore — results already delivered via callback
    } finally {
      setState("idle");
      setSeconds(0);
    }
  };

  const handleStop = () => {
    if (offlineAvailable) {
      void handleOfflineStop();
    }
  };

  const handleClick = async () => {
    if (disabled) return;

    if (state === "recording") {
      void handleStop();
      return;
    }
    if (state === "transcribing" || state === "initializing") return;

    if (!offlineAvailable) {
      onToast("離線語音辨識僅支援 Android App");
      return;
    }

    void handleOfflineStart();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    stopTimer();
    if (offlineAvailable) {
      void offlineStop().catch(() => {});
    }
    setState("idle");
    setSeconds(0);
    onToast("已取消錄音");
  };

  const timeLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  const MicIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className="voice-input-icon">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0014 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );

  const StopIcon = (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"
      strokeLinecap="round" strokeLinejoin="round" className="voice-input-icon">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );

  const SpinnerIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="voice-input-icon voice-input-spinner">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );

  const icon =
    state === "transcribing" || state === "initializing" ? SpinnerIcon :
    state === "recording" ? StopIcon : MicIcon;

  const ariaLabel =
    state === "recording" ? `停止錄音，已錄製 ${timeLabel}` :
    state === "transcribing" ? "語音識別中" :
    state === "initializing" ? "語音引擎初始化中" :
    "語音輸入";

  return (
    <div className="voice-input-wrap">
      <button
        type="button"
        className={`voice-input-btn state-${state === "initializing" ? "transcribing" : state}`}
        onClick={handleClick}
        disabled={disabled || state === "transcribing" || state === "initializing"}
        aria-pressed={state === "recording"}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="voice-input-pulse" aria-hidden="true" />
        {icon}
        {state === "recording" && (
          <span className="voice-input-timer" aria-live="polite">{timeLabel}</span>
        )}
        {state === "transcribing" && (
          <span className="voice-input-label">識別中</span>
        )}
        {state === "initializing" && (
          <span className="voice-input-label">引擎載入中</span>
        )}
      </button>

      {state === "recording" && (
        <button
          type="button"
          className="voice-input-cancel"
          onClick={handleCancel}
          aria-label="取消錄音"
          title="取消錄音"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
