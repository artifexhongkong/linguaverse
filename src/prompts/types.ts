export type PromptLayer = "base" | "domain" | "style" | "output";

export type DomainCode =
  | "academic"
  | "legal"
  | "medical"
  | "programming"
  | "game-l10n"
  | "business"
  | "cantonese";

export interface DomainTemplate {
  code: DomainCode;
  name: string;
  icon: string;
  desc: string;
  rules: string[];
  terminology?: Record<string, string>;
}

export interface CustomPrompt {
  id: string;
  name: string;
  domain: DomainCode | "custom";
  base_override: string | null;
  domain_override: string | null;
  style_override: string | null;
  output_override: string | null;
  terminology: Record<string, string> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AssembledPrompt {
  systemPrompt: string;
  terminologyBlock: string;
  fullPrompt: string;
  layers: { base: string; domain: string; style: string; output: string };
}

export interface PromptAssemblyOptions {
  domain?: DomainCode | "custom";
  customBase?: string | null;
  customDomain?: string | null;
  customStyle?: string | null;
  customOutput?: string | null;
  terminology?: Record<string, string> | null;
  sourceLang?: string;
  targetLang?: string;
}
