import { getContextMode } from "./languages";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface AgnesTranslationResult {
  text: string;
  confidence: number;
  engine: "agnes";
  model: string;
}

export async function agnesTranslate(
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
