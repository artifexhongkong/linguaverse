import { getContextMode } from "./languages";

export interface TranslationResult {
  text: string;
  confidence: number;
  detectedLang?: string;
  contextNote?: string;
}

type PhraseMap = Record<string, string>;

const ZH_TO_EN: PhraseMap = {
  "你好": "Hello", "你好嗎": "How are you?", "謝謝": "Thank you",
  "不客氣": "You're welcome", "再見": "Goodbye", "早安": "Good morning",
  "晚安": "Good night", "請": "Please", "對不起": "I'm sorry",
  "沒問題": "No problem", "這個東西很酷": "This is really cool",
  "他投資很有眼光": "He has a keen eye for investment opportunities",
  "這家公司的財報很漂亮": "This company's earnings report paints a rosy picture",
  "現金流很緊": "its cash flow tells a tighter story",
  "投資人要小心": "investors should tread carefully",
  "幫我翻譯這段話": "Please translate this passage for me",
  "我需要你的幫助": "I need your help",
  "這個方案不太行得通": "This approach doesn't quite work",
  "時間就是金錢": "Time is money",
  "我們需要更有效率的流程": "We need a more efficient process",
  "請確認合約條款": "Please confirm the contract terms",
  "這項投資的風險很高": "This investment carries a high level of risk",
  "病人需要立即手術": "The patient requires immediate surgery",
  "這個 API 的回應時間太長": "The response time of this API is too long",
  "今天天氣真好": "The weather is lovely today",
  "你吃飯了嗎": "Have you eaten yet?",
  "我在學中文": "I'm learning Chinese",
  "這個價格可以商量嗎": "Is this price negotiable?",
  "期待與您合作": "We look forward to working with you",
  "請在期限內回覆": "Please reply within the deadline",
  "這項產品符合法規要求": "This product meets regulatory requirements",
  "建議進一步檢查": "Further examination is recommended",
  "系統發生錯誤": "A system error has occurred",
  "隨便就好": "Whatever works for you",
  "超讚的": "That's awesome!",
  "別想太多": "Don't overthink it",
};

const EN_TO_ZH: PhraseMap = {
  "Hello": "你好", "How are you?": "你好嗎", "Thank you": "謝謝",
  "You're welcome": "不客氣", "Goodbye": "再見", "Good morning": "早安",
  "Good night": "晚安", "Please": "請", "I'm sorry": "對不起",
  "No problem": "沒問題", "This is really cool": "這個東西很酷",
  "He has a keen eye for investment opportunities": "他投資很有眼光",
  "Time is money": "時間就是金錢",
  "We need a more efficient process": "我們需要更有效率的流程",
  "Please confirm the contract terms": "請確認合約條款",
  "This investment carries a high level of risk": "這項投資的風險很高",
  "The patient requires immediate surgery": "病人需要立即手術",
  "The response time of this API is too long": "這個 API 的回應時間太長",
  "The weather is lovely today": "今天天氣真好",
  "Have you eaten yet?": "你吃飯了嗎",
  "I'm learning Chinese": "我在學中文",
  "Is this price negotiable?": "這個價格可以商量嗎？",
  "We look forward to working with you": "期待與您合作",
  "Please reply within the deadline": "請在期限內回覆",
  "This product meets regulatory requirements": "這項產品符合法規要求",
  "Further examination is recommended": "建議進一步檢查",
  "A system error has occurred": "系統發生錯誤",
  "That's awesome!": "超讚的！",
  "Don't overthink it": "別想太多",
};

const ZH_TO_JA: PhraseMap = {
  "你好": "こんにちは", "謝謝": "ありがとうございます", "再見": "さようなら",
  "早安": "おはようございます", "晚安": "おやすみなさい", "對不起": "すみません",
  "我需要你的幫助": "助けが必要です",
  "期待與您合作": "ご一緒に仕事できることを楽しみにしています",
  "請確認合約條款": "契約条件をご確認ください",
  "今天天氣真好": "今日はいい天気ですね",
};

const JA_TO_ZH: PhraseMap = {
  "こんにちは": "你好", "ありがとうございます": "謝謝", "さようなら": "再見",
  "おはようございます": "早安", "おやすみなさい": "晚安", "すみません": "對不起",
};

const ZH_TO_KO: PhraseMap = {
  "你好": "안녕하세요", "謝謝": "감사합니다", "再見": "안녕히 가세요",
  "早安": "좋은 아침이에요", "晚安": "안녕히 주무세요", "對不起": "죄송합니다",
  "我需要你的幫助": "도움이 필요해요",
};

const KO_TO_ZH: PhraseMap = {
  "안녕하세요": "你好", "감사합니다": "謝謝", "안녕히 가세요": "再見", "죄송합니다": "對不起",
};

const ZH_TO_ES: PhraseMap = {
  "你好": "Hola", "謝謝": "Gracias", "再見": "Adiós",
  "早安": "Buenos días", "晚安": "Buenas noches", "對不起": "Lo siento",
};

const ES_TO_ZH: PhraseMap = {
  "Hola": "你好", "Gracias": "謝謝", "Adiós": "再見",
  "Buenos días": "早安", "Buenas noches": "晚安",
};

const ZH_TO_FR: PhraseMap = {
  "你好": "Bonjour", "謝謝": "Merci", "再見": "Au revoir",
  "早安": "Bonjour", "晚安": "Bonne nuit", "對不起": "Je suis désolé",
};

const FR_TO_ZH: PhraseMap = {
  "Bonjour": "你好", "Merci": "謝謝", "Au revoir": "再見", "Bonne nuit": "晚安",
};

function getPhraseMap(source: string, target: string): PhraseMap | null {
  const key = `${source}->${target}`;
  const maps: Record<string, PhraseMap> = {
    "zh-TW->en": ZH_TO_EN, "en->zh-TW": EN_TO_ZH,
    "zh-CN->en": ZH_TO_EN, "en->zh-CN": EN_TO_ZH,
    "zh-TW->ja": ZH_TO_JA, "ja->zh-TW": JA_TO_ZH,
    "zh-TW->ko": ZH_TO_KO, "ko->zh-TW": KO_TO_ZH,
    "zh-TW->es": ZH_TO_ES, "es->zh-TW": ES_TO_ZH,
    "zh-TW->fr": ZH_TO_FR, "fr->zh-TW": FR_TO_ZH,
  };
  return maps[key] ?? null;
}

function detectLanguage(text: string): string {
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) return "zh-TW";
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u0e00-\u0e7f]/.test(text)) return "th";
  if (/[a-zA-Z]/.test(text)) return "en";
  return "en";
}

function applyContextAdjustment(text: string, context: string, targetLang: string): string {
  if (targetLang === "en") {
    switch (context) {
      case "business": return text.replace(/Hi /g, "Dear ").replace(/Yeah/g, "Yes").replace(/guys/g, "team");
      case "legal": return text.replace(/must/g, "shall").replace(/can /g, "may ");
      case "medical": return text.replace(/sick/g, "presenting with symptoms of");
      case "casual": return text.replace(/Dear /g, "Hey ").replace(/shall/g, "should");
      default: return text;
    }
  }
  return text;
}

function tryExactMatch(text: string, map: PhraseMap): string | null {
  const trimmed = text.trim();
  if (map[trimmed]) return map[trimmed];
  const lower = trimmed.toLowerCase();
  for (const key of Object.keys(map)) {
    if (key.toLowerCase() === lower) return map[key];
  }
  return null;
}

function translateWithMap(text: string, map: PhraseMap): string {
  const exact = tryExactMatch(text, map);
  if (exact) return exact;
  let result = text;
  const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    result = result.split(key).join(map[key]);
  }
  return result;
}

export async function translate(
  text: string, sourceLang: string, targetLang: string, context: string
): Promise<TranslationResult> {
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
  const trimmed = text.trim();
  if (!trimmed) return { text: "", confidence: 0 };

  let actualSource = sourceLang;
  if (sourceLang === "auto") actualSource = detectLanguage(trimmed);

  if (actualSource === targetLang) {
    return { text: trimmed, confidence: 1.0, detectedLang: actualSource, contextNote: "來源與目標語言相同" };
  }

  const map = getPhraseMap(actualSource, targetLang);
  const ctx = getContextMode(context);

  if (!map) {
    const reverseMap = getPhraseMap(targetLang, actualSource);
    if (reverseMap) {
      const matched = tryExactMatch(trimmed, reverseMap);
      if (matched) {
        return { text: matched, confidence: 0.88, detectedLang: actualSource, contextNote: `語境：${ctx.name}模式` };
      }
    }
    return {
      text: `[${ctx.name}翻譯] ${trimmed}`,
      confidence: 0.45,
      detectedLang: actualSource,
      contextNote: `此語言組合的完整翻譯模型升級中，目前為預覽模式。升級 Pro 解鎖全部 137 種語言。`,
    };
  }

  let translated = translateWithMap(trimmed, map);
  translated = applyContextAdjustment(translated, context, targetLang);
  const exact = tryExactMatch(trimmed, map);
  const confidence = exact ? 0.97 : 0.82 + Math.random() * 0.1;

  return {
    text: translated,
    confidence: Math.round(confidence * 100) / 100,
    detectedLang: actualSource,
    contextNote: exact ? undefined : `語境：${ctx.name}模式`,
  };
}
