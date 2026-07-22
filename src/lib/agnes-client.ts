import { getContextMode } from "./languages";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const AGNES_API_KEY = import.meta.env.VITE_AGNES_API_KEY;
const AGNES_BASE_URL = import.meta.env.VITE_AGNES_BASE_URL ?? "https://api.agnes.ai/v1";
const AGNES_MODEL = import.meta.env.VITE_AGNES_MODEL ?? "Agnes-2.0-Flash";

export interface AgnesTranslationResult {
  text: string;
  confidence: number;
  engine: "agnes";
  model: string;
}

/** Check if Supabase is configured */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL !== "https://YOUR_PROJECT_ID.supabase.co");
}

/** Check if direct Agnes API key is available */
export function isDirectApiAvailable(): boolean {
  return Boolean(AGNES_API_KEY && AGNES_API_KEY !== "your-supabase-anon-key-here");
}

/** Call Agnes API directly (bypasses Supabase Edge Function) */
async function agnesDirectTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  systemPrompt?: string,
): Promise<AgnesTranslationResult> {
  const ctx = getContextMode("general");
  const langDirective = sourceLang === "auto"
    ? `請將以下文字翻譯為${targetLang}`
    : `請將以下${sourceLang}文字翻譯為${targetLang}`;

  const fullSystemPrompt = systemPrompt
    ? `${systemPrompt}\n\n${langDirective}。只輸出譯文，不附加任何解釋。語境：${ctx.name}模式。`
    : `你是專業翻譯專家。${langDirective}。只輸出譯文，不附加任何解釋。語境：${ctx.name}模式。`;

  const response = await fetch(`${AGNES_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AGNES_API_KEY}`,
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
    throw new Error(`Agnes API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const translatedText = data.choices?.[0]?.message?.content ?? "";

  return {
    text: translatedText,
    confidence: 0.95,
    engine: "agnes",
    model: AGNES_MODEL,
  };
}

/** Call via Supabase Edge Function */
export async function agnesTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: string,
  systemPrompt?: string,
): Promise<AgnesTranslationResult> {
  // If Supabase is not configured, try direct API call
  if (!isSupabaseConfigured() && isDirectApiAvailable()) {
    console.log("[AgnesClient] Supabase not configured, using direct API call");
    return await agnesDirectTranslate(text, sourceLang, targetLang, systemPrompt);
  }

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
    body: JSON.stringify({
      text,
      sourceLang,
      targetLang,
      systemPrompt: fullSystemPrompt,
    }),
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
    model: data.model ?? "Agnes-2.0-Flash",
  };
}
