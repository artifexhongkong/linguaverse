export const OUTPUT_FORMAT_RULES: string[] = [
  "僅輸出翻譯結果，不附加任何解釋或說明文字。",
  "文化注釋以方括號 [文化注：...] 格式附在對應段落後。",
  "多義詞替代譯法以圓括號 (替代譯法：...) 格式附在對應詞後。",
  "專有名詞首次出現以圓括號 (原文：...) 格式附上原文對照。",
  "若原文有疑義，在對應段落後以 [原文疑義：...] 格式標注。",
];

export const DEFAULT_OUTPUT_PROMPT = OUTPUT_FORMAT_RULES.join("\n");
