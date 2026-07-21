export interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const LANGUAGES: Language[] = [
  { code: "auto", name: "Auto Detect", nativeName: "自動偵測", flag: "🌐" },
  { code: "zh-TW", name: "Traditional Chinese", nativeName: "繁體中文", flag: "🇹🇼" },
  { code: "zh-CN", name: "Simplified Chinese", nativeName: "簡體中文", flag: "🇨🇳" },
  { code: "en", name: "English", nativeName: "English", flag: "🇺🇸" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇵🇹" },
  { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦" },
  { code: "th", name: "Thai", nativeName: "ไทย", flag: "🇹🇭" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱" },
  { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱" },
];

export function getLanguage(code: string): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export interface ContextMode {
  code: string;
  name: string;
  icon: string;
  desc: string;
}

export const CONTEXT_MODES: ContextMode[] = [
  { code: "general", name: "通用", icon: "💬", desc: "日常通用翻譯" },
  { code: "business", name: "商務", icon: "💼", desc: "正式商業語氣" },
  { code: "legal", name: "法律", icon: "⚖️", desc: "法律文件精準翻譯" },
  { code: "medical", name: "醫療", icon: "⚕️", desc: "醫學術語專業翻譯" },
  { code: "tech", name: "科技", icon: "💻", desc: "技術文件與 IT 術語" },
  { code: "casual", name: "口語", icon: "😎", desc: "輕鬆自然的口語表達" },
];

export function getContextMode(code: string): ContextMode {
  return CONTEXT_MODES.find((c) => c.code === code) ?? CONTEXT_MODES[0];
}
