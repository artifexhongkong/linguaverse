import { getContextMode } from "./languages";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface AgnesTranslationResult {
  text: string;
  confidence: number;
  engine: "agnes";
  model: string;
}

/** Check if Supabase is configured */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    SUPABASE_URL !== "https://YOUR_PROJECT_ID.supabase.co"
  );
}

/**
 * Call AI Translation via Supabase Edge Function
 * Backend uses Groq API (LLaMA 3.1) for high-quality contextual translation
 */
export async function agnesTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: string,
  systemPrompt?: string,
): Promise<AgnesTranslationResult> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase 未配置。請在 .env 中設置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。"
    );
  }

  const ctx = getContextMode(context);

  const langDirective =
    sourceLang === "auto"
      ? `請將以下文字翻譯為${targetLang}`
      : `請將以下${sourceLang}文字翻譯為${targetLang}`;

  const fullSystemPrompt = systemPrompt
    ? `${systemPrompt}\n\n${langDirective}。只輸出譯文，不附加任何解釋。語境：${ctx.name}模式。`
    : `你是專業翻譯專家。${langDirective}。只輸出譯文，不附加任何解釋。語境：${ctx.name}模式。`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/agnes-translate`,
      {
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
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      let errorMsg = `AI 翻譯服務錯誤 (${response.status})`;
      
      if (response.status === 503) {
        errorMsg = "AI 翻譯服務不可用，請檢查後端 API Key 配置";
      } else if (response.status === 401 || response.status === 403) {
        errorMsg = "Supabase 認證失敗，請檢查 VITE_SUPABASE_ANON_KEY";
      }
      
      throw new Error(`${errorMsg}${errText ? ": " + errText.slice(0, 200) : ""}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    if (!data.text || data.text.trim() === "") {
      throw new Error("AI 返回空翻譯結果，請重試");
    }

    return {
      text: data.text,
      confidence: data.confidence ?? 0.95,
      engine: "agnes",
      model: data.model ?? "LLaMA-3.1",
    };
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("AI 翻譯請求超時，請檢查網絡連接後重試");
    }
    
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error("無法連接到翻譯服務，請檢查網絡連接");
    }
    
    throw error;
  }
}
