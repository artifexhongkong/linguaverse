import { getContextMode } from "../lib/languages";
import { agnesTranslate } from "../lib/agnes-client";
import { assemblePrompt } from "../prompts/prompt-assembler";
import type { PromptAssemblyOptions, DomainCode } from "../prompts/types";

export interface TranslationResult {
  text: string;
  confidence: number;
  detectedLang?: string;
  contextNote?: string;
}

export interface SchedulerResult extends TranslationResult {
  engine: "agnes" | "ai-fallback";
  fallbackNotice?: string;
  promptLayers?: { base: string; domain: string; style: string; output: string };
  model?: string;
}

export interface SchedulerOptions {
  timeoutMs?: number;
  maxRetries?: number;
  domain?: DomainCode | "custom";
  customPrompt?: PromptAssemblyOptions;
}

const DEFAULT_TIMEOUT = 20000;
const DEFAULT_RETRIES = 2;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("AI_TRANSLATE_TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scheduleTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: string,
  options?: SchedulerOptions,
): Promise<SchedulerResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxRetries = options?.maxRetries ?? DEFAULT_RETRIES;
  const ctx = getContextMode(context);

  const domain = options?.domain ?? "custom";
  const assembled = assemblePrompt({
    domain,
    ...options?.customPrompt,
    sourceLang,
    targetLang,
  });

  const trimmed = text.trim();
  if (!trimmed) {
    return { text: "", confidence: 0, engine: "agnes" };
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 重試之間加入遞增延遲
      if (attempt > 0) {
        await delay(1000 * attempt);
      }

      const result = await withTimeout(
        agnesTranslate(trimmed, sourceLang, targetLang, context, assembled.systemPrompt),
        timeoutMs,
      );

      return {
        text: result.text,
        confidence: result.confidence,
        engine: "agnes",
        model: result.model,
        detectedLang: sourceLang === "auto" ? undefined : sourceLang,
        contextNote: `AI 語境翻譯 · ${ctx.name}模式`,
        promptLayers: assembled.layers,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`AI translation attempt ${attempt + 1} failed:`, lastError.message);
    }
  }

  // 所有重試都失敗 — 不再 fallback 到硬編碼映射表
  // 直接拋出有意義的錯誤信息
  throw new Error(
    `AI 翻譯服務暫時不可用（已重試 ${maxRetries + 1} 次）。` +
    `請確認 Supabase Edge Function 已部署且 GROQ_API_KEY 已設置。` +
    `錯誤詳情：${lastError?.message ?? "unknown"}`
  );
}
