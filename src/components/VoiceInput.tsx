import { useEffect, useRef, useState } from "react";
import {
  startRecording,
  transcribe,
  isSTTConfigured,
  type RecordingController,
} from "../lib/stt-client";

/**
 * Premium voice-input button — industrial minimalist design.
 *
 * Visual states:
 *  - **Idle**: a fine mic icon, hairline border; on hover, a soft cyan
 *    glow appears around the border (微光).
 *  - **Recording**: red gradient fill + smooth breathing-pulse animation
 *    + a live timer (00:SS) so the user knows it's working.
 *  - **Transcribing**: blue tint + spinning ring (whisper-1 round-trip).
 *
 * Behavior:
 *  - Tap to start recording; tap again to stop and send the Blob to the
 *    STT endpoint (backend proxy or direct Whisper).
 *  - The transcribed text is appended (with a space) to whatever is
 *    already in the input box, so users can chain multiple recordings.
 *  - A small × button appears while recording so the user can cancel
 *    without sending.
 *
 * Accessibility:
 *  - `aria-pressed` reflects the recording state.
 *  - `aria-label` updates per state.
 *  - Keyboard: Enter / Space toggles as usual for a <button>.
 */

interface VoiceInputProps {
  /** Called when transcription succeeds. Receives the recognised text. */
  onTranscribed: (text: string) => void;
  /** Called for user-facing messages (errors, status). */
  onToast: (msg: string) => void;
  /** Disable the button (e.g. while a translation is in flight). */
  disabled?: boolean;
  /** Optional — notified when the button enters / leaves the recording state. */
  onStateChange?: (state: "idle" | "recording" | "transcribing") => void;
}

const MAX_RECORD_SECONDS = 60; // safety cap

export function VoiceInput({ onTranscribed, onToast, disabled, onStateChange }: VoiceInputProps) {
  const [state, setStateRaw] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<RecordingController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Wrap setState so we can notify the parent of state changes
  const setState = (next: "idle" | "recording" | "transcribing") => {
    setStateRaw(next);
    onStateChange?.(next);
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recRef.current) recRef.current.cancel();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startTimer = () => {
    setSeconds(0);
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_RECORD_SECONDS) {
          // Auto-stop at the cap
          void stopAndTranscribe();
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

  const stopAndTranscribe = async () => {
    stopTimer();
    if (!recRef.current) {
      setState("idle");
      return;
    }

    setState("transcribing");
    try {
      const blob = await recRef.current.stop();
      recRef.current = null;

      if (blob.size === 0) {
        onToast("錄音失敗");
        setState("idle");
        return;
      }

      const result = await transcribe(blob);
      if (result.text) {
        onTranscribed(result.text);
        onToast("已識別語音內容");
      } else {
        onToast("未能識別任何語音內容");
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : "語音識別失敗");
    } finally {
      setState("idle");
      setSeconds(0);
    }
  };

  const handleClick = async () => {
    if (disabled) return;

    // If recording → stop and transcribe
    if (state === "recording") {
      void stopAndTranscribe();
      return;
    }

    // If transcribing → ignore (let it finish)
    if (state === "transcribing") return;

    // Otherwise start recording
    if (!isSTTConfigured()) {
      onToast("語音識別未配置，請聯繫管理員設定 STT API");
      return;
    }

    try {
      recRef.current = await startRecording();
      setState("recording");
      startTimer();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "無法啟動麥克風");
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    stopTimer();
    if (recRef.current) {
      recRef.current.cancel();
      recRef.current = null;
    }
    setState("idle");
    setSeconds(0);
    onToast("已取消錄音");
  };

  // Format seconds as M:SS
  const timeLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  // SVG icon — fine stroke, minimal
  const MicIcon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="voice-input-icon"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0014 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );

  const StopIcon = (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="voice-input-icon"
    >
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );

  const SpinnerIcon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="voice-input-icon voice-input-spinner"
    >
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );

  const icon =
    state === "transcribing" ? SpinnerIcon :
    state === "recording" ? StopIcon :
    MicIcon;

  const ariaLabel =
    state === "recording" ? `停止錄音，已錄製 ${timeLabel}` :
    state === "transcribing" ? "語音識別中" :
    "語音輸入";

  return (
    <div className="voice-input-wrap">
      <button
        type="button"
        className={`voice-input-btn state-${state}`}
        onClick={handleClick}
        disabled={disabled || state === "transcribing"}
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
      </button>

      {state === "recording" && (
        <button
          type="button"
          className="voice-input-cancel"
          onClick={handleCancel}
          aria-label="取消錄音"
          title="取消錄音"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
