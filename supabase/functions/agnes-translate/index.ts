import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/*
 * LinguaVerse AI Translation Engine
 * 
 * Primary: Groq API (LLaMA 3.1 - Free tier: 14,400 req/day)
 * Fallback: OpenRouter (free models)
 * 
 * Environment variables (set in Supabase Dashboard > Edge Functions > Secrets):
 *   GROQ_API_KEY       - Get free key at https://console.groq.com
 *   OPENROUTER_API_KEY - Get free key at https://openrouter.ai (optional fallback)
 */

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") ?? "llama-3.1-8b-instant";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = "meta-llama/llama-3.1-8b-instruct:free";

interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  systemPrompt?: string;
}

function buildSystemPrompt(req: TranslationRequest): string {
  const langDirective = req.sourceLang === "auto"
    ? `Detect the source language and translate the following text to ${req.targetLang}`
    : `Translate the following ${req.sourceLang} text to ${req.targetLang}`;

  if (req.systemPrompt) {
    return `${req.systemPrompt}\n\n${langDirective}. Output ONLY the translated text. Do not add explanations, notes, or commentary.`;
  }
  return `You are an expert multilingual translator with deep knowledge of context, idioms, and cultural nuances. ${langDirective}. Output ONLY the translated text. Do not add explanations, notes, or commentary. Preserve the original tone and register.`;
}

async function callGroq(systemPrompt: string, text: string): Promise<{ text: string; model: string } | null> {
  if (!GROQ_API_KEY) return null;

  try {
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.3,
        max_tokens: 2048,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      console.error(`Groq API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!translatedText) return null;

    return { text: translatedText, model: `LLaMA-3.1-8B (Groq)` };
  } catch (e) {
    console.error(`Groq fetch error: ${e}`);
    return null;
  }
}

async function callOpenRouter(systemPrompt: string, text: string): Promise<{ text: string; model: string } | null> {
  if (!OPENROUTER_API_KEY) return null;

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://linguaverse.app",
        "X-Title": "LinguaVerse",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      console.error(`OpenRouter API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!translatedText) return null;

    return { text: translatedText, model: `LLaMA-3.1-8B (OpenRouter)` };
  } catch (e) {
    console.error(`OpenRouter fetch error: ${e}`);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: TranslationRequest = await req.json();
    const { text, sourceLang, targetLang, systemPrompt } = body;

    if (!text || !targetLang) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: text, targetLang" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fullSystemPrompt = buildSystemPrompt({ text, sourceLang, targetLang, systemPrompt });

    // Try Groq first (primary)
    let result = await callGroq(fullSystemPrompt, text);

    // Fallback to OpenRouter
    if (!result) {
      result = await callOpenRouter(fullSystemPrompt, text);
    }

    if (result) {
      return new Response(
        JSON.stringify({
          text: result.text,
          confidence: 0.95,
          engine: "agnes",
          model: result.model,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // All providers failed
    return new Response(
      JSON.stringify({
        error: "AI translation service unavailable. Please ensure GROQ_API_KEY is set in Supabase Edge Function secrets. Get a free key at https://console.groq.com",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
