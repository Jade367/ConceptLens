import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ConceptLensPlugin from "./main";
import { AiProviderPreset, DEFAULT_SETTINGS, OutputLanguage } from "./types";

const LANGUAGE_LABELS: Record<OutputLanguage, string> = {
  bilingual: "Chinese + English",
  zh: "Chinese",
  en: "English",
  ko: "Korean / 한국어",
  ja: "Japanese / 日本語",
  ar: "Arabic / العربية"
};

const PROVIDER_LABELS: Record<AiProviderPreset, string> = {
  auto: "Auto-detect",
  openai: "OpenAI",
  kimi: "Kimi Platform / Moonshot",
  "kimi-cn": "Kimi Platform / Moonshot China",
  "kimi-code": "Kimi Code",
  qwen: "Qwen / DashScope China",
  "qwen-intl": "Qwen / DashScope International",
  "qwen-us": "Qwen / DashScope US",
  glm: "GLM / Zhipu",
  doubao: "Doubao / Volcengine",
  deepseek: "DeepSeek",
  siliconflow: "SiliconFlow",
  openrouter: "OpenRouter",
  anthropic: "Claude / Anthropic",
  gemini: "Gemini",
  custom: "Custom endpoint"
};

const PROVIDER_ENDPOINTS: Partial<Record<AiProviderPreset, string>> = {
  openai: "https://api.openai.com/v1/chat/completions",
  kimi: "https://api.moonshot.ai/v1/chat/completions",
  "kimi-cn": "https://api.moonshot.cn/v1/chat/completions",
  "kimi-code": "https://api.kimi.com/coding/v1/chat/completions",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  "qwen-intl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  "qwen-us": "https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions",
  glm: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  doubao: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  siliconflow: "https://api.siliconflow.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
};

export class ConceptLensSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ConceptLensPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("conceptlens-settings");

    containerEl.createEl("h2", { text: "ConceptLens" });

    new Setting(containerEl)
      .setName("Floating toolbar")
      .setDesc("Show actions automatically when text is selected.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.floatingToolbarEnabled)
          .onChange(async (value) => {
            this.plugin.settings.floatingToolbarEnabled = value;
            await this.plugin.saveSettings();
            if (!value) {
              this.plugin.hideToolbar();
            }
          });
      });

    new Setting(containerEl)
      .setName("AI API key")
      .setDesc("Paste your key. Auto-detect uses safe key prefixes by default; active provider probing is opt-in below.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            const nextKey = value.trim();
            if (nextKey !== this.plugin.settings.apiKey) {
              this.plugin.settings.autoDetectedProvider = "";
              this.plugin.settings.autoDetectedKeyFingerprint = "";
            }
            this.plugin.settings.apiKey = nextKey;
            await this.plugin.saveSettings();
          });
      });

    const advancedEl = containerEl.createEl("details", { cls: "conceptlens-advanced-settings" });
    advancedEl.createEl("summary", { text: "Advanced / custom AI settings" });

    new Setting(advancedEl)
      .setName("Provider preset")
      .setDesc("Auto uses safe key-prefix detection. Generic sk- keys usually need a manual provider preset.")
      .addDropdown((dropdown) => {
        Object.entries(PROVIDER_LABELS).forEach(([value, label]) => {
          dropdown.addOption(value, label);
        });
        dropdown
          .setValue(this.plugin.settings.providerPreset)
          .onChange(async (value) => {
            this.plugin.settings.providerPreset = value as AiProviderPreset;
            this.plugin.settings.useCustomEndpoint = value === "custom";
            if (value !== "auto") {
              this.plugin.settings.autoDetectedProvider = "";
              this.plugin.settings.autoDetectedKeyFingerprint = "";
            }
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(advancedEl)
      .setName("Active provider probing")
      .setDesc("Off by default for privacy. If enabled, Auto may send tiny probe requests with this API key to supported providers until one accepts it.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.activeProviderDetectionEnabled)
          .onChange(async (value) => {
            this.plugin.settings.activeProviderDetectionEnabled = value;
            if (!value) {
              this.plugin.settings.autoDetectedProvider = "";
              this.plugin.settings.autoDetectedKeyFingerprint = "";
            }
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(advancedEl)
      .setName("Model override")
      .setDesc("Optional. Leave blank to use the provider preset default model. A faster model here can reduce waiting time.")
      .addText((text) => {
        text
          .setPlaceholder("Leave blank for preset default")
          .setValue(this.plugin.settings.modelOverride)
          .onChange(async (value) => {
            this.plugin.settings.modelOverride = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(advancedEl)
      .setName("Request timeout")
      .setDesc("Maximum time to wait for one AI response. Default: 35 seconds.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "10";
        text.inputEl.max = "120";
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.apiTimeoutSeconds))
          .setValue(String(this.plugin.settings.apiTimeoutSeconds))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.apiTimeoutSeconds = Number.isFinite(parsed)
              ? Math.min(120, Math.max(10, parsed))
              : DEFAULT_SETTINGS.apiTimeoutSeconds;
            await this.plugin.saveSettings();
          });
      });

    new Setting(advancedEl)
      .setName(this.plugin.settings.providerPreset === "custom" ? "Custom base URL" : "Resolved endpoint")
      .setDesc(
        this.plugin.settings.providerPreset === "custom"
          ? "Accepts either a base URL or a full /chat/completions URL."
          : this.plugin.settings.providerPreset === "auto" && this.plugin.settings.autoDetectedProvider
            ? `Auto-detected provider: ${PROVIDER_LABELS[this.plugin.settings.autoDetectedProvider]}.`
            : this.plugin.settings.providerPreset === "auto"
              ? "Auto will show the resolved endpoint after a safe prefix match or an explicit active probe."
              : "Read-only preview of the endpoint used by the selected provider preset."
      )
      .addText((text) => {
        const resolvedPreset =
          this.plugin.settings.providerPreset === "auto" && this.plugin.settings.autoDetectedProvider
            ? this.plugin.settings.autoDetectedProvider
            : this.plugin.settings.providerPreset;
        const endpoint = PROVIDER_ENDPOINTS[resolvedPreset] ?? "Will auto-detect on first AI request";
        text
          .setPlaceholder(DEFAULT_SETTINGS.apiBaseUrl)
          .setValue(this.plugin.settings.providerPreset === "custom" ? this.plugin.settings.apiBaseUrl : endpoint)
          .setDisabled(this.plugin.settings.providerPreset !== "custom")
          .onChange(async (value) => {
            this.plugin.settings.apiBaseUrl = value.trim() || DEFAULT_SETTINGS.apiBaseUrl;
            await this.plugin.saveSettings();
          });
      });

    new Setting(advancedEl)
      .setName("Reset AI defaults")
      .setDesc("Use the built-in OpenAI-compatible defaults again.")
      .addButton((button) => {
        button
          .setButtonText("Reset")
          .onClick(async () => {
            this.plugin.settings.model = DEFAULT_SETTINGS.model;
            this.plugin.settings.modelOverride = DEFAULT_SETTINGS.modelOverride;
            this.plugin.settings.apiBaseUrl = DEFAULT_SETTINGS.apiBaseUrl;
            this.plugin.settings.providerPreset = DEFAULT_SETTINGS.providerPreset;
            this.plugin.settings.autoDetectedProvider = DEFAULT_SETTINGS.autoDetectedProvider;
            this.plugin.settings.autoDetectedKeyFingerprint = DEFAULT_SETTINGS.autoDetectedKeyFingerprint;
            this.plugin.settings.activeProviderDetectionEnabled = DEFAULT_SETTINGS.activeProviderDetectionEnabled;
            this.plugin.settings.useCustomEndpoint = DEFAULT_SETTINGS.useCustomEndpoint;
            this.plugin.settings.apiTimeoutSeconds = DEFAULT_SETTINGS.apiTimeoutSeconds;
            await this.plugin.saveSettings();
            new Notice("AI defaults restored.");
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Concept folder")
      .setDesc("Folder inside your vault where concept notes are created.")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.conceptFolder)
          .setValue(this.plugin.settings.conceptFolder)
          .onChange(async (value) => {
            this.plugin.settings.conceptFolder = value.trim() || DEFAULT_SETTINGS.conceptFolder;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Output language")
      .setDesc("Default language for AI responses and concept cards.")
      .addDropdown((dropdown) => {
        Object.entries(LANGUAGE_LABELS).forEach(([value, label]) => {
          dropdown.addOption(value, label);
        });
        dropdown
          .setValue(this.plugin.settings.outputLanguage)
          .onChange(async (value) => {
            this.plugin.settings.outputLanguage = value as OutputLanguage;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Reset settings")
      .setDesc("Restore ConceptLens defaults. Your concept notes are not changed.")
      .addButton((button) => {
        button
          .setButtonText("Reset")
          .onClick(async () => {
            this.plugin.settings = { ...DEFAULT_SETTINGS };
            await this.plugin.saveSettings();
            new Notice("ConceptLens settings reset.");
            this.display();
          });
      });
  }
}
