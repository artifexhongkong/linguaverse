export const STYLE_RULES: string[] = [
  "語氣需與原文保持一致：正式文件保持正式語氣，休閒內容保持輕鬆語氣。",
  "句式需符合目標語言的自然語序，不照搬原文句式結構。",
  "標點符號需轉換為目標語言的標準用法。",
  "段落結構保持原文的邏輯分段，不隨意合併或拆分。",
];

export const DEFAULT_STYLE_PROMPT = STYLE_RULES.join("\n");
