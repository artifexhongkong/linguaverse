import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const AGNES_API_KEY = "sk-Gi9O49HmwmY8IodPXxQ3e0mxJdp0GSnUxsddLe1dgHbVCUUs";
const AGNES_BASE_URL = "https://api.agnes.ai/v1";
const AGNES_MODEL = "Agnes-2.0-Flash";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { text, sourceLang, targetLang, systemPrompt } = await req.json();

    if (!text || !targetLang) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: text, targetLang" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const langDirective = sourceLang === "auto"
      ? `請將以下文字翻譯為${targetLang}`
      : `請將以下${sourceLang}文字翻譯為${targetLang}`;

    const fullSystemPrompt = systemPrompt
      ? `${systemPrompt}\n\n${langDirective}。只輸出譯文，不附加任何解釋。`
      : `你是專業翻譯專家。${langDirective}。只輸出譯文，不附加任何解釋。`;

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
      const errText = await response.text();
      return new Response(
        JSON.stringify({ error: `Agnes API error: ${response.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content ?? "";

    return new Response(
      JSON.stringify({
        text: translatedText,
        confidence: 0.95,
        engine: "agnes",
        model: AGNES_MODEL,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
