import { getContextMode } from "./languages";

/**
 * Agnes translation client.
 *
 * The Android APK (built from this repo via Capacitor) calls the Agnes API
 * directly using credentials baked in at build time via Vite env vars
 * (`VITE_AGNES_*`). The optional Supabase Edge Function path is kept as a
 * fallback for the hosted web build only.
 *
 * Why direct call?
 *   - The previous version always routed through
 *     `${SUPABASE_URL}/functions/v1/agnes-translate`, but when
 *     `VITE_SUPABASE_URL` was not configured the fetch silently failed and
 *     the app fell back to the legacy phrase-map "machine" translator,
 *     producing low-quality output. Calling Agnes directly removes that
 *     single point of failure for the APK.
 */

const AGNES_API_KEY = import.meta.env.VITE_AGNES_API_KEY ?? "";
const AGNES_BASE_URL = (import.meta.env.VITE_AGNES_BASE_URL ?? "https://apihub.agnes-ai.com/v1").replace(/\/$/, "");
const AGNES_MODEL = import.meta.env.VITE_AGNES_MODEL ?? "agnes-2.0-flash";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

const USE_SUPABASE_EDGE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export interface AgnesTranslationResult {
  text: string;
  confidence: number;
  engine: "agnes";
  model: string;
}

function buildSystemPrompt(text: string, sourceLang: string, targetLang: string, context: string, systemPrompt?: string): string {
  const ctx = getContextMode(context);
  const langDirective = sourceLang === "auto"
    ? `請將以下文字翻譯為${targetLang}`
    : `請將以下${sourceLang}文字翻譯為${targetLang}`;

  if (systemPrompt) {
    return `${systemPrompt}\n\n${langDirective}。只輸出譯文，不附加任何解釋。`;
  }
  return `你是專業翻譯專家。${langDirective}。只輸出譯文，不附加任何解釋。語境：${ctx.name}模式。`;
}

/**
 * Call the Agnes Chat Completions API directly.
 * Falls back to the Supabase Edge Function only if those env vars are set,
 * so the hosted web build can still keep the key server-side.
 */
export async function agnesTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: string,
  systemPrompt?: string,
): Promise<AgnesTranslationResult> {
  if (!text || !text.trim()) {
    return { text: "", confidence: 0, engine: "agnes", model: AGNES_MODEL };
  }

  if (USE_SUPABASE_EDGE) {
    return callViaSupabaseEdge(text, sourceLang, targetLang, context, systemPrompt);
  }

  if (!AGNES_API_KEY) {
    throw new Error("翻譯服務暫時無法使用，請稍後再試");
  }

  const fullSystemPrompt = buildSystemPrompt(text, sourceLang, targetLang, context, systemPrompt);

  const response = await fetch(`${AGNES_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AGNES_API_KEY}`,
    },
    body: JSON.stringify({
      model: AGNES_MODEL,
      messages: [
        { role: "system", content: fullSystemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    // Log full error to console for debugging, but throw a neutral message
    // so the underlying service name never surfaces in the UI.
    const errText = await response.text().catch(() => "");
    console.error(`[translate] HTTP ${response.status}: ${errText.slice(0, 200)}`);
    throw new Error("翻譯服務暫時無法使用，請稍後再試");
  }

  const data = await response.json();
  const translatedText = data?.choices?.[0]?.message?.content ?? "";
  if (!translatedText.trim()) {
    throw new Error("翻譯失敗，請稍後再試");
  }

  return {
    text: translatedText.trim(),
    confidence: 0.95,
    engine: "agnes",
    model: AGNES_MODEL,
  };
}

/**
 * Streaming variant: yields translation chunks as soon as Agnes emits them.
 * The UI feels dramatically faster because the user sees text appear in
 * real-time instead of waiting for the whole response.
 *
 * Returns the final concatenated text when the stream completes.
 */
export async function agnesTranslateStream(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: string,
  systemPrompt: string | undefined,
  onChunk: (delta: string, fullSoFar: string) => void,
): Promise<string> {
  if (!text || !text.trim()) return "";

  if (USE_SUPABASE_EDGE) {
    // Edge function doesn't support streaming — fall back to single-shot.
    const result = await callViaSupabaseEdge(text, sourceLang, targetLang, context, systemPrompt);
    onChunk(result.text, result.text);
    return result.text;
  }

  if (!AGNES_API_KEY) {
    throw new Error("翻譯服務暫時無法使用，請稍後再試");
  }

  const fullSystemPrompt = buildSystemPrompt(text, sourceLang, targetLang, context, systemPrompt);

  const response = await fetch(`${AGNES_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AGNES_API_KEY}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: AGNES_MODEL,
      messages: [
        { role: "system", content: fullSystemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      stream: true,
      max_tokens: 1500,
    }),
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    console.error(`[translate/stream] HTTP ${response.status}: ${errText.slice(0, 200)}`);
    throw new Error("翻譯服務暫時無法使用，請稍後再試");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines
      let nlIdx;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          buffer = "";
          break;
        }
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            fullText += delta;
            onChunk(delta, fullText);
          }
        } catch {
          // partial JSON — wait for more bytes
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!fullText.trim()) {
    throw new Error("翻譯失敗，請稍後再試");
  }
  return fullText.trim();
}

async function callViaSupabaseEdge(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: string,
  systemPrompt?: string,
): Promise<AgnesTranslationResult> {
  const ctx = getContextMode(context);
  const langDirective = sourceLang === "auto"
    ? `請將以下文字翻譯為${targetLang}`
    : `請將以下${sourceLang}文字翻譯為${targetLang}`;

  const fullSystemPrompt = systemPrompt
    ? `${systemPrompt}\n\n${langDirective}。只輸出譯文，不附加任何解釋。`
    : `你是專業翻譯專家。${langDirective}。只輸出譯文，不附加任何解釋。語境：${ctx.name}模式。`;

  const response = await fetch(`${SUPABASE_URL}/functions/v1/agnes-translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ text, sourceLang, targetLang, systemPrompt: fullSystemPrompt }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error(`[translate] HTTP ${response.status}: ${errText.slice(0, 200)}`);
    throw new Error("翻譯服務暫時無法使用，請稍後再試");
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error);

  return {
    text: data.text,
    confidence: data.confidence ?? 0.95,
    engine: "agnes",
    model: data.model ?? AGNES_MODEL,
  };
}
