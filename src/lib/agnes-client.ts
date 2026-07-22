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
    throw new Error("Agnes API key is not configured. Set VITE_AGNES_API_KEY in .env before building.");
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
    const errText = await response.text().catch(() => "");
    throw new Error(`Agnes API error: ${response.status} ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const translatedText = data?.choices?.[0]?.message?.content ?? "";
  if (!translatedText.trim()) {
    throw new Error("Agnes API returned empty translation.");
  }

  return {
    text: translatedText.trim(),
    confidence: 0.95,
    engine: "agnes",
    model: AGNES_MODEL,
  };
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
    throw new Error(`Agnes API error: ${response.status} ${errText}`);
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
