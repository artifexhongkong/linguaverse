import { getContextMode } from "../lib/languages";
import { translate as legacyTranslate, type TranslationResult } from "../lib/translate";
import { agnesTranslate } from "../lib/agnes-client";
import { assemblePrompt } from "../prompts/prompt-assembler";
import type { PromptAssemblyOptions, DomainCode } from "../prompts/types";

export interface SchedulerResult extends TranslationResult {
  engine: "agnes" | "machine-fallback";
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

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RETRIES = 1;

const FALLBACK_PREFIX = "【機器兜底翻譯，精準度有限】\n";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("AGNES_TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isRecoverable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    return (
      msg === "AGNES_TIMEOUT" ||
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("quota") ||
      msg.includes("rate") ||
      msg.includes("Agnes API error")
    );
  }
  return true;
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

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
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
        contextNote: `Agnes-2.0-Flash · ${ctx.name}模式`,
        promptLayers: assembled.layers,
      };
    } catch (error) {
      if (attempt === maxRetries && !isRecoverable(error)) throw error;
    }
  }

  try {
    const fallback = await legacyTranslate(trimmed, sourceLang, targetLang, context);
    return {
      ...fallback,
      text: FALLBACK_PREFIX + fallback.text,
      engine: "machine-fallback",
      fallbackNotice: "機器兜底翻譯，精準度有限",
      contextNote: `傳統機器翻譯（Agnes API 不可用，已自動切換）`,
    };
  } catch {
    return {
      text: FALLBACK_PREFIX + trimmed,
      confidence: 0.3,
      engine: "machine-fallback",
      fallbackNotice: "機器兜底翻譯，精準度有限",
      contextNote: `所有翻譯通道均失敗，請稍後再試`,
    };
  }
}
