export type ConceptLensAction = "overview" | "explain" | "translate" | "expand" | "save";

export type AiAction = Exclude<ConceptLensAction, "save"> | "card";

export type OutputLanguage = "bilingual" | "zh" | "en" | "ko" | "ja" | "ar";

export type AiProviderPreset =
  | "auto"
  | "openai"
  | "kimi"
  | "kimi-cn"
  | "kimi-code"
  | "qwen"
  | "qwen-intl"
  | "qwen-us"
  | "glm"
  | "doubao"
  | "deepseek"
  | "siliconflow"
  | "openrouter"
  | "anthropic"
  | "gemini"
  | "custom";

export interface ConceptLensSettings {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  modelOverride: string;
  providerPreset: AiProviderPreset;
  autoDetectedProvider: AiProviderPreset | "";
  autoDetectedKeyFingerprint: string;
  activeProviderDetectionEnabled: boolean;
  useCustomEndpoint: boolean;
  apiTimeoutSeconds: number;
  conceptFolder: string;
  outputLanguage: OutputLanguage;
  floatingToolbarEnabled: boolean;
}

export interface SelectionRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface CapturedSelection {
  text: string;
  context: string;
  rect: SelectionRect;
  source: "editor" | "reading";
  sourceElement?: Element;
  sourcePath?: string;
  sourceName?: string;
}

export const DEFAULT_SETTINGS: ConceptLensSettings = {
  apiKey: "",
  apiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  modelOverride: "",
  providerPreset: "auto",
  autoDetectedProvider: "",
  autoDetectedKeyFingerprint: "",
  activeProviderDetectionEnabled: false,
  useCustomEndpoint: false,
  apiTimeoutSeconds: 35,
  conceptFolder: "Concepts",
  outputLanguage: "bilingual",
  floatingToolbarEnabled: true
};
