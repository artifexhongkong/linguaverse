import { getContextMode } from "../lib/languages";
import { agnesTranslate, agnesTranslateStream } from "../lib/agnes-client";
import { assemblePrompt } from "../prompts/prompt-assembler";
import type { PromptAssemblyOptions, DomainCode } from "../prompts/types";

/**
 * Scheduler facade over the translation client.
 *
 * The UI never sees engine/model/confidence/fallback fields — only the
 * translated text and an optional context note for display.
 */
export interface TranslationOutput {
  text: string;
  contextNote?: string;
  detectedLang?: string;
}

export interface SchedulerOptions {
  timeoutMs?: number;
  maxRetries?: number;
  domain?: DomainCode | "custom";
  customPrompt?: PromptAssemblyOptions;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 1;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isRecoverable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    return (
      msg === "TIMEOUT" ||
      msg.includes("fetch") ||
      msg.includes("network")
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
): Promise<TranslationOutput> {
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
    return { text: "" };
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await withTimeout(
        agnesTranslate(trimmed, sourceLang, targetLang, context, assembled.systemPrompt),
        timeoutMs,
      );
      return {
        text: result.text,
        detectedLang: sourceLang === "auto" ? undefined : sourceLang,
        contextNote: `${ctx.name}模式`,
      };
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries && !isRecoverable(error)) throw error;
    }
  }

  throw lastError ?? new Error("翻譯失敗，請稍後再試");
}

/**
 * Streaming variant — yields partial translations as the model emits them.
 * The user sees text appear in real-time, dramatically reducing perceived
 * latency on slower endpoints.
 */
export async function scheduleTranslationStream(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: string,
  onChunk: (delta: string, fullSoFar: string) => void,
  options?: SchedulerOptions,
): Promise<TranslationOutput> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
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
    return { text: "" };
  }

  try {
    const fullText = await withTimeout(
      agnesTranslateStream(
        trimmed, sourceLang, targetLang, context,
        assembled.systemPrompt, onChunk,
      ),
      timeoutMs,
    );
    return {
      text: fullText,
      detectedLang: sourceLang === "auto" ? undefined : sourceLang,
      contextNote: `${ctx.name}模式`,
    };
  } catch (error) {
    // Fall back to non-streaming if streaming fails — single retry
    try {
      const result = await withTimeout(
        agnesTranslate(trimmed, sourceLang, targetLang, context, assembled.systemPrompt),
        timeoutMs,
      );
      onChunk(result.text, result.text);
      return {
        text: result.text,
        detectedLang: sourceLang === "auto" ? undefined : sourceLang,
        contextNote: `${ctx.name}模式`,
      };
    } catch {
      throw error;
    }
  }
}
