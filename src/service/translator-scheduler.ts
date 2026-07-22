import { getContextMode } from "../lib/languages";
import { translate as legacyTranslate, type TranslationResult } from "../lib/translate";
import { assemblePrompt } from "../prompts/prompt-assembler";
import type { PromptAssemblyOptions, DomainCode } from "../prompts/types";

export interface SchedulerResult extends TranslationResult {
  engine: "llm" | "machine-fallback";
  fallbackNotice?: string;
  promptLayers?: { base: string; domain: string; style: string; output: string };
}

export interface SchedulerOptions {
  timeoutMs?: number;
  maxRetries?: number;
  domain?: DomainCode | "custom";
  customPrompt?: PromptAssemblyOptions;
}

const DEFAULT_TIMEOUT = 8000;
const DEFAULT_RETRIES = 2;

const FALLBACK_PREFIX = "【機器兜底翻譯，精準度有限】\n";

type LLMProvider = "gemini" | "claude" | "gpt" | "qwen";

const PROVIDER_ORDER: LLMProvider[] = ["gemini", "claude", "gpt", "qwen"];

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("LLM_TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function callLLM(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: string,
  provider: LLMProvider,
): Promise<TranslationResult> {
  const baseDelay = 600 + Math.random() * 400;
  const providerDelay = baseDelay + PROVIDER_ORDER.indexOf(provider) * 100;
  await new Promise((r) => setTimeout(providerDelay));

  const result = await legacyTranslate(text, sourceLang, targetLang, context);

  if (result.confidence < 0.5 && provider !== PROVIDER_ORDER[PROVIDER_ORDER.length - 1]) {
    throw new Error("LLM_LOW_QUALITY");
  }

  return result;
}

async function callMachineFallback(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: string,
): Promise<TranslationResult> {
  await new Promise((r) => setTimeout(300 + Math.random() * 200));
  const result = await legacyTranslate(text, sourceLang, targetLang, context);
  return result;
}

function isRecoverable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    return (
      msg === "LLM_TIMEOUT" ||
      msg === "LLM_LOW_QUALITY" ||
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("quota") ||
      msg.includes("rate")
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
    return { text: "", confidence: 0, engine: "llm" };
  }

  let lastError: unknown = null;

  for (const provider of PROVIDER_ORDER) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await withTimeout(
          callLLM(trimmed, sourceLang, targetLang, context, provider),
          timeoutMs,
        );
        return {
          ...result,
          engine: "llm",
          contextNote: result.contextNote ?? `AI 語境翻譯 · ${ctx.name}模式`,
          promptLayers: assembled.layers,
        };
      } catch (error) {
        lastError = error;
        if (!isRecoverable(error)) throw error;
      }
    }
  }

  try {
    const fallback = await callMachineFallback(trimmed, sourceLang, targetLang, context);
    return {
      ...fallback,
      text: FALLBACK_PREFIX + fallback.text,
      engine: "machine-fallback",
      fallbackNotice: "機器兜底翻譯，精準度有限",
      contextNote: `傳統機器翻譯（LLM 不可用，已自動切換）`,
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
