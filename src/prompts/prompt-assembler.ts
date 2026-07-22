import { DEFAULT_BASE_PROMPT } from "./base-rules";
import { getDomainTemplate } from "./domain-templates";
import { DEFAULT_STYLE_PROMPT } from "./style-rules";
import { DEFAULT_OUTPUT_PROMPT } from "./output-format";
import type { PromptAssemblyOptions, AssembledPrompt } from "./types";

function buildTerminologyBlock(terminology: Record<string, string> | null | undefined): string {
  if (!terminology || Object.keys(terminology).length === 0) return "";
  const entries = Object.entries(terminology)
    .map(([k, v]) => `  • ${k} → ${v}`)
    .join("\n");
  return `【術語對照表】\n以下術語在全文中必須保持一致翻譯：\n${entries}`;
}

export function assemblePrompt(options: PromptAssemblyOptions = {}): AssembledPrompt {
  const {
    domain = "custom",
    customBase = null,
    customDomain = null,
    customStyle = null,
    customOutput = null,
    terminology = null,
    sourceLang = "auto",
    targetLang = "en",
  } = options;

  const baseLayer = customBase ?? DEFAULT_BASE_PROMPT;

  let domainLayer = "";
  if (customDomain) {
    domainLayer = customDomain;
  } else if (domain !== "custom") {
    const template = getDomainTemplate(domain);
    if (template) {
      const rulesText = template.rules.map((r) => `  • ${r}`).join("\n");
      domainLayer = `【領域約束：${template.name}】\n${rulesText}`;
      const mergedTerm = { ...template.terminology, ...(terminology ?? {}) };
      const termBlock = buildTerminologyBlock(mergedTerm);
      const styleLayer = customStyle ?? DEFAULT_STYLE_PROMPT;
      const outputLayer = customOutput ?? DEFAULT_OUTPUT_PROMPT;
      const langDirective = `請將以下文字從${sourceLang === "auto" ? "自動偵測語言" : sourceLang}翻譯為${targetLang}。`;

      const fullPrompt = [
        "【系統指令】",
        baseLayer,
        "",
        domainLayer,
        "",
        termBlock ? termBlock + "\n" : "",
        "【語言風格】",
        styleLayer,
        "",
        "【輸出格式】",
        outputLayer,
        "",
        langDirective,
      ].join("\n");

      return {
        systemPrompt: [baseLayer, domainLayer, styleLayer, outputLayer].join("\n\n"),
        terminologyBlock: termBlock,
        fullPrompt,
        layers: { base: baseLayer, domain: domainLayer, style: styleLayer, output: outputLayer },
      };
    }
  }

  const styleLayer = customStyle ?? DEFAULT_STYLE_PROMPT;
  const outputLayer = customOutput ?? DEFAULT_OUTPUT_PROMPT;
  const termBlock = buildTerminologyBlock(terminology);
  const langDirective = `請將以下文字從${sourceLang === "auto" ? "自動偵測語言" : sourceLang}翻譯為${targetLang}。`;

  const fullPrompt = [
    "【系統指令】",
    baseLayer,
    "",
    domainLayer ? domainLayer + "\n" : "",
    termBlock ? termBlock + "\n" : "",
    "【語言風格】",
    styleLayer,
    "",
    "【輸出格式】",
    outputLayer,
    "",
    langDirective,
  ].join("\n");

  return {
    systemPrompt: [baseLayer, domainLayer, styleLayer, outputLayer].filter(Boolean).join("\n\n"),
    terminologyBlock: termBlock,
    fullPrompt,
    layers: { base: baseLayer, domain: domainLayer, style: styleLayer, output: outputLayer },
  };
}
