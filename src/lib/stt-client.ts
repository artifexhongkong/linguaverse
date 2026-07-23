/**
 * Speech-to-Text client.
 *
 * Records audio from the device microphone via the browser MediaRecorder
 * API, then transcribes it via an OpenAI-compatible Whisper endpoint.
 *
 * Tuned for Cantonese (HK), Taiwanese Mandarin, and code-mixed
 * Chinese-English via a dialect-biasing prompt.
 *
 * NOTE: This client calls the Whisper API directly from the device.
 * The Agnes gateway does NOT expose Whisper — you must configure
 * VITE_STT_API_KEY / VITE_STT_BASE_URL to point at an OpenAI-compatible
 * provider (OpenAI itself, Groq, DeepInfra, etc.).
 */

const STT_API_KEY = import.meta.env.VITE_STT_API_KEY ?? "";
const STT_BASE_URL = (import.meta.env.VITE_STT_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const STT_MODEL = import.meta.env.VITE_STT_MODEL ?? "whisper-1";

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

export function isSTTConfigured(): boolean {
  return Boolean(STT_API_KEY && STT_BASE_URL);
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
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      throw new Error("麥克風權限被拒絕，請在系統設定中允許");
    }
    throw new Error("無法存取麥克風：" + (err as Error).message);
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
 * Transcribe an audio Blob via the Whisper API.
 * The dialect prompt is injected to improve accuracy on Cantonese,
 * Taiwanese Mandarin, and VFX jargon.
 */
export async function transcribe(audio: Blob): Promise<STTResult> {
  if (!isSTTConfigured()) {
    throw new Error("語音識別未配置，請聯繫管理員");
  }

  // Pick a sensible filename based on the blob's mime type so the Whisper
  // API can detect the format correctly.
  const ext = audio.type.includes("webm")
    ? "webm"
    : audio.type.includes("mp4")
    ? "mp4"
    : audio.type.includes("ogg")
    ? "ogg"
    : "wav";
  const filename = `recording.${ext}`;

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
    console.error(`[stt] HTTP ${response.status}: ${errText.slice(0, 200)}`);
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
