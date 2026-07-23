/**
 * Speech-to-Text client.
 *
 * Records audio from the device microphone via the browser MediaRecorder
 * API, then transcribes it.
 *
 * Two modes (auto-selected based on env vars):
 *   1. **Backend proxy mode** (preferred): POST the audio Blob to
 *      VITE_STT_BACKEND_URL (e.g. https://api.example.com/api/v1/stt).
 *      The backend holds the Whisper API key — never exposed to the client.
 *   2. **Direct mode** (fallback): call the Whisper API directly from the
 *      device using VITE_STT_API_KEY / VITE_STT_BASE_URL. Useful for the
 *      Android APK build where there is no backend.
 *
 * Tuned for Cantonese (HK), Taiwanese Mandarin, and code-mixed
 * Chinese-English via a dialect-biasing prompt.
 */

// Backend proxy mode — preferred when available (keeps API key server-side)
const STT_BACKEND_URL = (import.meta.env.VITE_STT_BACKEND_URL ?? "").trim();

// Direct mode — falls back to the Agnes gateway + Agnes API key (since Agnes
// exposes an OpenAI-compatible /audio/transcriptions endpoint). This mirrors
// the backend's config.py logic, so the APK can do STT out-of-the-box with
// the same credentials that power translation — no extra secrets required.
//
// IMPORTANT: use explicit `||` fallback (not `??`) because Vite inlines
// unset `import.meta.env.VITE_*` as the empty string `""`, which is NOT
// nullish, so `??` would not fall through. `||` treats `""` as falsy and
// falls through correctly.
const AGNES_API_KEY = import.meta.env.VITE_AGNES_API_KEY || "";
const AGNES_BASE_URL = (import.meta.env.VITE_AGNES_BASE_URL || "").replace(/\/$/, "");
const STT_API_KEY = import.meta.env.VITE_STT_API_KEY || AGNES_API_KEY;
const STT_BASE_URL = (
  import.meta.env.VITE_STT_BASE_URL || AGNES_BASE_URL || "https://api.openai.com/v1"
).replace(/\/$/, "");
const STT_MODEL = import.meta.env.VITE_STT_MODEL || "whisper-1";

// Bias the Whisper decoder toward Cantonese colloquial words (嘅/咗/咁/
// 嘢/點解/唔該/冇/咩), Taiwanese Mandarin phrasing, and VFX/film jargon
// (keying, tracking, roto, composite, render, matchmove, HDRI, rigging,
// particle simulation, color grading, look development).
const DIALECT_PROMPT =
  "這是一段包含粵語口語（如嘅、咗、咁、嘢、點解、唔該、冇、咩）、" +
  "台灣口語（如欸、超、宅、揪、靠北、機車）以及影視 VFX 專業術語" +
  "（如 keying、tracking、roto、composite、render、matchmove、HDRI、" +
  "rigging、particle simulation、color grading、look development）" +
  "的中英夾雜日常對話。";

export interface STTResult {
  text: string;
  model: string;
  duration?: number;
  language?: string;
}

/**
 * Returns true if STT is usable — either via the backend proxy or via
 * direct-mode credentials.
 */
export function isSTTConfigured(): boolean {
  return Boolean(STT_BACKEND_URL) || Boolean(STT_API_KEY && STT_BASE_URL);
}

/**
 * Returns a human-readable label for the active STT mode (used by the UI
 * for tooltip / accessibility).
 */
export function sttMode(): "backend" | "direct" | "none" {
  if (STT_BACKEND_URL) return "backend";
  if (STT_API_KEY && STT_BASE_URL) return "direct";
  return "none";
}

/**
 * Start recording audio from the microphone.
 *
 * Returns a controller with `stop()` that resolves to the recorded Blob.
 * The recording uses webm/opus when supported (Chrome / Android WebView),
 * falling back to whatever the platform supports.
 */
export interface RecordingController {
  stop: () => Promise<Blob>;
  /** Cancel the recording and release the microphone. */
  cancel: () => void;
}

export async function startRecording(): Promise<RecordingController> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("此裝置不支援麥克風錄音");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    if (err instanceof DOMException) {
      // Provide actionable messages for the most common failure modes.
      // In Android WebView, the error name is the most reliable signal
      // (the .message is often empty or generic like "Permission denied").
      switch (err.name) {
        case "NotAllowedError":
          throw new Error("麥克風權限被拒絕，請到系統設定允許後重試");
        case "NotFoundError":
        case "OverconstrainedError":
          throw new Error("找不到麥克風裝置，請確認麥克風已連接");
        case "NotReadableError":
        case "AbortError":
          // NotReadableError usually means another app is holding the mic,
          // or the WebView permission grant was lost. Suggest restarting.
          throw new Error("麥克風被其他程式佔用，請關閉後重試或重啟 App");
        case "SecurityError":
          throw new Error("麥克風需在安全連線下使用，請更新 App");
      }
    }
    // Fallback — include the error name so we can diagnose future cases.
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[stt] getUserMedia failed:", detail);
    throw new Error("無法啟動麥克風，請重啟 App 後再試");
  }

  // Pick the best supported mime type — Android WebView usually supports
  // webm/opus; iOS Safari supports mp4. Default to whatever the platform
  // offers if neither is available.
  const mimeCandidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  let mimeType: string | undefined;
  for (const m of mimeCandidates) {
    if (MediaRecorder.isTypeSupported(m)) {
      mimeType = m;
      break;
    }
  }

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });

  const stopped = new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => resolve());
  });

  recorder.start();

  let cancelled = false;

  return {
    async stop(): Promise<Blob> {
      if (recorder.state !== "recording") return new Blob();
      recorder.stop();
      await stopped;
      // Release the microphone
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled) return new Blob();
      const type = mimeType ?? "audio/webm";
      return new Blob(chunks, { type });
    },
    cancel(): void {
      cancelled = true;
      if (recorder.state === "recording") recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/**
 * Transcribe an audio Blob.
 *
 * If VITE_STT_BACKEND_URL is set, POSTs the Blob as multipart/form-data
 * to the backend `/api/v1/stt` endpoint — the backend holds the Whisper
 * API key, so nothing sensitive is exposed to the client.
 *
 * Otherwise, calls the Whisper API directly (VITE_STT_API_KEY /
 * VITE_STT_BASE_URL). Useful for the APK build where there is no backend.
 *
 * The dialect prompt is injected in both paths to improve accuracy on
 * Cantonese, Taiwanese Mandarin, and VFX jargon.
 */
export async function transcribe(audio: Blob): Promise<STTResult> {
  if (!isSTTConfigured()) {
    throw new Error("語音識別未配置，請聯繫管理員");
  }

  // Pick a sensible filename based on the blob's mime type so the upstream
  // API can detect the format correctly.
  const ext = audio.type.includes("webm")
    ? "webm"
    : audio.type.includes("mp4")
    ? "mp4"
    : audio.type.includes("ogg")
    ? "ogg"
    : "wav";
  const filename = `recording.${ext}`;

  // ----- Path A: Backend proxy mode (preferred) -----
  // Backend already injects the dialect prompt + language hint, so the
  // client only needs to send the audio file.
  if (STT_BACKEND_URL) {
    const form = new FormData();
    form.append("file", audio, filename);

    let resp: Response;
    try {
      resp = await fetch(STT_BACKEND_URL, {
        method: "POST",
        body: form,
        // Do NOT set Content-Type — the browser will set the multipart
        // boundary for us.
      });
    } catch (err) {
      console.error("[stt/backend] network error:", err);
      throw new Error("無法連接語音識別服務，請檢查網路");
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[stt/backend] HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      if (resp.status === 401 || resp.status === 403) {
        throw new Error("語音識別服務認證失敗");
      }
      if (resp.status === 413) {
        throw new Error("錄音檔案過大，請縮短錄音時間");
      }
      if (resp.status === 429) {
        throw new Error("語音識別請求過於頻繁，請稍後再試");
      }
      throw new Error("語音識別失敗，請稍後再試");
    }

    const data = await resp.json();
    const text = (data.text ?? "").trim();
    if (!text) {
      throw new Error("未能識別任何語音內容，請再試一次");
    }

    return {
      text,
      model: data.model ?? "whisper-1",
      duration: data.duration,
      language: data.language,
    };
  }

  // ----- Path B: Direct mode (fallback for APK) -----
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", STT_MODEL);
  form.append("prompt", DIALECT_PROMPT);
  form.append("response_format", "verbose_json");
  // Hint the language to zh — Whisper will still detect within the zh
  // family, but this skips the auto-detect step and improves accuracy
  // for short clips where auto-detect is unreliable.
  form.append("language", "zh");

  const response = await fetch(`${STT_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STT_API_KEY}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error(`[stt/direct] HTTP ${response.status}: ${errText.slice(0, 200)}`);
    if (response.status === 401 || response.status === 403) {
      throw new Error("語音識別服務認證失敗");
    }
    if (response.status === 429) {
      throw new Error("語音識別請求過於頻繁，請稍後再試");
    }
    throw new Error("語音識別失敗，請稍後再試");
  }

  const data = await response.json();
  const text = (data.text ?? "").trim();
  if (!text) {
    throw new Error("未能識別任何語音內容，請再試一次");
  }

  return {
    text,
    model: data.model ?? STT_MODEL,
    duration: data.duration,
    language: data.language,
  };
}
