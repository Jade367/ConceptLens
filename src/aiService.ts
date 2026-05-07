import { requestUrl } from "obsidian";
import { buildPrompt, buildSystemInstruction } from "./promptTemplates";
import { AiAction, CapturedSelection, ConceptLensSettings } from "./types";

interface ChatMessage {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

interface ChatCompletionChoice {
  message?: ChatMessage;
  text?: string;
}

interface AiResponseBody {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  choices?: ChatCompletionChoice[];
  content?: Array<{ type?: string; text?: string }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

type ProviderKind = "chat" | "anthropic" | "gemini";

interface ResolvedProvider {
  kind: ProviderKind;
  name: string;
  url: string;
  model: string;
  headers: Record<string, string>;
}

type ConcreteProviderPreset = Exclude<ConceptLensSettings["providerPreset"], "auto" | "custom">;
type AutoDetectedCallback = (preset: ConcreteProviderPreset, keyFingerprint: string) => Promise<void> | void;

interface ProbeSummary {
  providerName: string;
  status: number;
  message: string;
}

const PROBE_PRESETS: ConcreteProviderPreset[] = [
  "kimi-code",
  "kimi",
  "kimi-cn",
  "qwen-intl",
  "qwen",
  "qwen-us",
  "glm",
  "doubao",
  "deepseek",
  "siliconflow",
  "openai",
  "openrouter",
  "anthropic",
  "gemini"
];

const PROBE_TIMEOUT_MS = 8000;

export class AiService {
  private autoDetectionCache = new Map<string, ConcreteProviderPreset>();
  private inFlightRequests = new Map<string, Promise<void>>();

  constructor(
    private getSettings: () => ConceptLensSettings,
    private onAutoDetected?: AutoDetectedCallback
  ) {}

  async run(action: AiAction, selection: CapturedSelection): Promise<string> {
    const settings = this.getSettings();
    if (!settings.apiKey) {
      throw new Error("Please add an AI API key in ConceptLens settings.");
    }

    const provider = await resolveProvider(settings, this.autoDetectionCache, this.onAutoDetected);
    const requestBody = buildRequestBody(provider, settings, action, selection);
    const requestKey = buildRequestKey(provider, action, selection, requestBody);
    if (this.inFlightRequests.has(requestKey)) {
      throw new Error("A matching ConceptLens AI request is still running. Please wait a moment before retrying.");
    }

    const networkPromise = requestUrl({
      url: provider.url,
      method: "POST",
      headers: provider.headers,
      body: JSON.stringify(requestBody),
      throw: false
    });
    this.trackInFlightRequest(requestKey, networkPromise);

    const response = await waitForResponseWithTimeout(
      networkPromise,
      getRequestTimeoutMs(settings),
      provider.name
    );

    const body = this.parseBody(response.json, response.text);
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 401) {
        throw new Error(buildUnauthorizedMessage(provider, settings));
      }

      throw new Error(body.error?.message ?? `${provider.name} request failed with status ${response.status}.`);
    }

    const text = this.extractOutputText(body);
    if (!text) {
      throw new Error("The AI service returned an empty response.");
    }

    return text;
  }

  generateConceptCard(selection: CapturedSelection): Promise<string> {
    return this.run("card", selection);
  }

  private trackInFlightRequest(requestKey: string, networkPromise: Promise<unknown>): void {
    const cleanup = networkPromise
      .catch(() => undefined)
      .then(() => {
        this.inFlightRequests.delete(requestKey);
      });
    this.inFlightRequests.set(requestKey, cleanup);
  }

  private parseBody(json: unknown, text: string): AiResponseBody {
    return parseResponseBody(json, text);
  }

  private extractOutputText(body: AiResponseBody): string {
    if (typeof body.output_text === "string") {
      return body.output_text.trim();
    }

    const chatContent = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text;
    if (typeof chatContent === "string") {
      return chatContent.trim();
    }
    if (Array.isArray(chatContent)) {
      return chatContent
        .map((part) => part.text)
        .filter((part): part is string => Boolean(part))
        .join("\n")
        .trim();
    }

    const anthropicContent = body.content
      ?.map((part) => part.text)
      .filter((part): part is string => Boolean(part))
      .join("\n")
      .trim();
    if (anthropicContent) {
      return anthropicContent;
    }

    const geminiContent = body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter((part): part is string => Boolean(part))
      .join("\n")
      .trim();
    if (geminiContent) {
      return geminiContent;
    }

    const chunks: string[] = [];
    body.output?.forEach((item) => {
      item.content?.forEach((part) => {
        if (typeof part.text === "string") {
          chunks.push(part.text);
        }
      });
    });

    return chunks.join("\n").trim();
  }
}

async function waitForResponseWithTimeout(
  networkPromise: Promise<Awaited<ReturnType<typeof requestUrl>>>,
  timeoutMs: number,
  providerName: string
): Promise<Awaited<ReturnType<typeof requestUrl>>> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      networkPromise,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          reject(
            new Error(
              `${providerName} request timed out after ${Math.round(timeoutMs / 1000)} seconds. The original request may still be running, so wait a moment before retrying, shorten the selection, or choose a faster model in ConceptLens settings.`
            )
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }
}

function parseResponseBody(json: unknown, text: string): AiResponseBody {
  if (json && typeof json === "object") {
    return json as AiResponseBody;
  }

  try {
    return JSON.parse(text) as AiResponseBody;
  } catch {
    return {};
  }
}

function getErrorMessage(body: AiResponseBody, fallback: string): string {
  return body.error?.message ?? fallback.trim();
}

function getRequestTimeoutMs(settings: ConceptLensSettings): number {
  const seconds = Number.isFinite(settings.apiTimeoutSeconds) ? settings.apiTimeoutSeconds : 35;
  return clamp(seconds, 10, 120) * 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function resolveProvider(
  settings: ConceptLensSettings,
  autoDetectionCache: Map<string, ConcreteProviderPreset>,
  onAutoDetected?: AutoDetectedCallback
): Promise<ResolvedProvider> {
  const apiKey = settings.apiKey.trim();
  if (settings.providerPreset && settings.providerPreset !== "auto") {
    return resolveProviderPreset(settings.providerPreset, apiKey, settings);
  }

  if (settings.useCustomEndpoint) {
    return chatProvider(
      "Custom AI provider",
      normalizeChatCompletionsUrl(settings.apiBaseUrl),
      resolveModel(settings, "gpt-4.1-mini", true),
      apiKey
    );
  }

  const keyFingerprint = fingerprintApiKey(apiKey);
  const savedPreset = getSavedAutoDetectedPreset(settings, keyFingerprint, apiKey);
  const cachedPreset = autoDetectionCache.get(keyFingerprint) ?? savedPreset;
  if (cachedPreset) {
    autoDetectionCache.set(keyFingerprint, cachedPreset);
    if (savedPreset && settings.autoDetectedKeyFingerprint !== keyFingerprint) {
      await onAutoDetected?.(savedPreset, keyFingerprint);
    }
    return resolveProviderPreset(cachedPreset, apiKey, settings);
  }

  const prefixPreset = getPrefixDetectedPreset(apiKey);
  if (prefixPreset) {
    autoDetectionCache.set(keyFingerprint, prefixPreset);
    await onAutoDetected?.(prefixPreset, keyFingerprint);
    return resolveProviderPreset(prefixPreset, apiKey, settings);
  }

  if (!settings.activeProviderDetectionEnabled) {
    throw new Error(buildSafeAutoDetectFailureMessage());
  }

  const detection = await activelyDetectProvider(apiKey, settings);
  if (detection.preset) {
    autoDetectionCache.set(keyFingerprint, detection.preset);
    await onAutoDetected?.(detection.preset, keyFingerprint);
    return resolveProviderPreset(detection.preset, apiKey, settings);
  }

  throw new Error(buildAutoDetectFailureMessage(detection.probes));
}

async function activelyDetectProvider(
  apiKey: string,
  settings: ConceptLensSettings
): Promise<{ preset: ConcreteProviderPreset | null; probes: ProbeSummary[] }> {
  const probes: ProbeSummary[] = [];
  const probeSettings: ConceptLensSettings = {
    ...settings,
    modelOverride: ""
  };

  for (const preset of PROBE_PRESETS) {
    const result = await probeProviderPreset(preset, apiKey, probeSettings);
    probes.push(result.summary);

    if (result.authenticated) {
      return { preset: result.preset, probes };
    }
  }

  return { preset: null, probes };
}

async function probeProviderPreset(
  preset: ConcreteProviderPreset,
  apiKey: string,
  settings: ConceptLensSettings
): Promise<{ preset: ConcreteProviderPreset; authenticated: boolean; summary: ProbeSummary }> {
  const probeProvider = resolveProviderPreset(preset, apiKey, settings);
  try {
    const response = await waitForResponseWithTimeout(
      requestUrl({
          url: probeProvider.url,
          method: "POST",
          headers: probeProvider.headers,
          body: JSON.stringify(buildProbeRequestBody(probeProvider)),
          throw: false
        }),
      PROBE_TIMEOUT_MS,
      probeProvider.name
    );
    const body = parseResponseBody(response.json, response.text);
    const message = getErrorMessage(body, response.text);
    return {
      preset,
      authenticated: isAuthenticatedProbeResponse(response.status, message),
      summary: {
        providerName: probeProvider.name,
        status: response.status,
        message
      }
    };
  } catch (error) {
    return {
      preset,
      authenticated: false,
      summary: {
        providerName: probeProvider.name,
        status: 0,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function buildProbeRequestBody(provider: ResolvedProvider): unknown {
  if (provider.kind === "anthropic") {
    return {
      model: provider.model,
      max_tokens: 1,
      messages: [
        {
          role: "user",
          content: "ping"
        }
      ]
    };
  }

  if (provider.kind === "gemini") {
    return {
      contents: [
        {
          role: "user",
          parts: [{ text: "ping" }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 1
      }
    };
  }

  return {
    model: provider.model,
    messages: [
      {
        role: "user",
        content: "ping"
      }
    ],
    max_tokens: 1,
    stream: false
  };
}

function isAuthenticatedProbeResponse(status: number, message: string): boolean {
  if (status >= 200 && status < 300) {
    return true;
  }

  if (status === 402 || status === 429) {
    return true;
  }

  return false;
}

function getPrefixDetectedPreset(apiKey: string): ConcreteProviderPreset | null {
  if (/^sk-(proj|svcacct)-/.test(apiKey)) {
    return "openai";
  }

  if (apiKey.startsWith("sk-or-")) {
    return "openrouter";
  }

  if (apiKey.startsWith("sk-ant-")) {
    return "anthropic";
  }

  if (apiKey.startsWith("AIza")) {
    return "gemini";
  }

  return null;
}

function toConcreteProviderPreset(value: ConceptLensSettings["autoDetectedProvider"]): ConcreteProviderPreset | null {
  if (value && value !== "auto" && value !== "custom") {
    return value;
  }
  return null;
}

function getSavedAutoDetectedPreset(
  settings: ConceptLensSettings,
  keyFingerprint: string,
  apiKey: string
): ConcreteProviderPreset | null {
  const preset = toConcreteProviderPreset(settings.autoDetectedProvider);
  if (!preset) {
    return null;
  }

  if (settings.autoDetectedKeyFingerprint === keyFingerprint) {
    return preset;
  }

  if (isLegacyFingerprintMatch(settings.autoDetectedKeyFingerprint, apiKey)) {
    return preset;
  }

  return null;
}

function isLegacyFingerprintMatch(fingerprint: string, apiKey: string): boolean {
  const match = fingerprint.match(/^(\d+):[^:]*:[^:]*$/);
  return match ? Number(match[1]) === apiKey.trim().length : false;
}

function fingerprintApiKey(apiKey: string): string {
  const key = apiKey.trim();
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${key.length}:${(hash >>> 0).toString(36)}`;
}

function buildSafeAutoDetectFailureMessage(): string {
  return [
    "Auto-detect could not safely identify this API key from its prefix.",
    "For privacy, the plugin no longer sends one key to many providers by default.",
    "Choose the provider preset manually in advanced AI settings, or enable active provider probing there if you explicitly want the plugin to test supported providers."
  ].join(" ");
}

function buildAutoDetectFailureMessage(probes: ProbeSummary[]): string {
  const details = probes
    .map((probe) => {
      const message = probe.message ? ` ${probe.message.slice(0, 120)}` : "";
      return `${probe.providerName}: ${probe.status || "network"}${message}`;
    })
    .join("; ");

  return [
    "Auto-detect could not identify this API key.",
    "The plugin tried the supported providers with a tiny probe request. Choose a provider preset manually, or use custom endpoint if this key belongs to another compatible service.",
    details ? `Probe results: ${details}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function resolveProviderPreset(
  preset: NonNullable<ConceptLensSettings["providerPreset"]>,
  apiKey: string,
  settings: ConceptLensSettings
): ResolvedProvider {
  switch (preset) {
    case "openai":
      return chatProvider("OpenAI", "https://api.openai.com/v1/chat/completions", resolveModel(settings, "gpt-4.1-mini"), apiKey);
    case "kimi":
      return chatProvider("Kimi", "https://api.moonshot.ai/v1/chat/completions", resolveModel(settings, "kimi-k2.6"), apiKey);
    case "kimi-cn":
      return chatProvider("Kimi China", "https://api.moonshot.cn/v1/chat/completions", resolveModel(settings, "kimi-k2.6"), apiKey);
    case "kimi-code":
      return chatProvider("Kimi Code", "https://api.kimi.com/coding/v1/chat/completions", resolveModel(settings, "kimi-for-coding"), apiKey);
    case "qwen":
      return chatProvider("Qwen China", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", resolveModel(settings, "qwen-plus"), apiKey);
    case "qwen-intl":
      return chatProvider("Qwen International", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", resolveModel(settings, "qwen-plus"), apiKey);
    case "qwen-us":
      return chatProvider("Qwen US", "https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions", resolveModel(settings, "qwen-plus"), apiKey);
    case "glm":
      return chatProvider("GLM", "https://open.bigmodel.cn/api/paas/v4/chat/completions", resolveModel(settings, "glm-5"), apiKey);
    case "doubao":
      return chatProvider("Doubao", "https://ark.cn-beijing.volces.com/api/v3/chat/completions", resolveModel(settings, "doubao-seed-1-6-251015"), apiKey);
    case "deepseek":
      return chatProvider("DeepSeek", "https://api.deepseek.com/chat/completions", resolveModel(settings, "deepseek-v4-flash"), apiKey);
    case "siliconflow":
      return chatProvider("SiliconFlow", "https://api.siliconflow.com/v1/chat/completions", resolveModel(settings, "Qwen/Qwen3-235B-A22B-Instruct-2507"), apiKey);
    case "openrouter":
      return chatProvider("OpenRouter", "https://openrouter.ai/api/v1/chat/completions", resolveModel(settings, "openai/gpt-4.1-mini"), apiKey);
    case "anthropic":
      return {
        kind: "anthropic",
        name: "Anthropic",
        url: "https://api.anthropic.com/v1/messages",
        model: resolveModel(settings, "claude-sonnet-4-20250514"),
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        }
      };
    case "gemini":
      return {
        kind: "gemini",
        name: "Gemini",
        url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        model: resolveModel(settings, "gemini-2.5-flash"),
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json"
        }
      };
    case "custom":
      return chatProvider(
        "Custom AI provider",
        normalizeChatCompletionsUrl(settings.apiBaseUrl),
        resolveModel(settings, "gpt-4.1-mini", true),
        apiKey
      );
    case "auto":
    default:
      return chatProvider("OpenAI", "https://api.openai.com/v1/chat/completions", "gpt-4.1-mini", apiKey);
  }
}

function buildRequestKey(
  provider: ResolvedProvider,
  action: AiAction,
  selection: CapturedSelection,
  requestBody: unknown
): string {
  return [
    provider.name,
    provider.url,
    provider.model,
    action,
    selection.sourcePath ?? "",
    selection.text,
    selection.context,
    JSON.stringify(requestBody)
  ].join("\u0001");
}

function buildRequestBody(
  provider: ResolvedProvider,
  settings: ConceptLensSettings,
  action: AiAction,
  selection: CapturedSelection
): unknown {
  const system = buildSystemInstruction(settings.outputLanguage);
  const prompt = buildPrompt(action, selection, settings.outputLanguage);
  const maxOutputTokens = getMaxOutputTokens(action);

  if (provider.kind === "anthropic") {
    return {
      model: provider.model,
      max_tokens: maxOutputTokens,
      system,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    };
  }

  if (provider.kind === "gemini") {
    return {
      systemInstruction: {
        parts: [{ text: system }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens
      }
    };
  }

  return {
    model: provider.model,
    messages: [
      {
        role: "system",
        content: system
      },
      {
        role: "user",
        content: prompt
      }
    ],
    max_tokens: maxOutputTokens
  };
}

function getMaxOutputTokens(action: AiAction): number {
  switch (action) {
    case "overview":
      return 850;
    case "translate":
      return 180;
    case "explain":
      return 260;
    case "expand":
      return 700;
    case "card":
      return 1200;
    default:
      return 750;
  }
}

function bearerHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function chatProvider(name: string, url: string, model: string, apiKey: string): ResolvedProvider {
  return {
    kind: "chat",
    name,
    url,
    model,
    headers: bearerHeaders(apiKey)
  };
}

function buildUnauthorizedMessage(provider: ResolvedProvider, settings: ConceptLensSettings): string {
  if (provider.name === "OpenAI" || provider.name === "Custom AI provider") {
    return [
      `${provider.name} rejected this API key (401).`,
      "The key may be invalid, expired, copied incorrectly, or it may belong to another provider.",
      settings.useCustomEndpoint
        ? "Check the Endpoint URL and Model in Advanced AI settings."
        : "If this is a Qwen, GLM, Doubao, DeepSeek, SiliconFlow, or another generic sk- key, choose that Provider preset in Advanced AI settings."
    ].join(" ");
  }

  if (provider.name === "Kimi" || provider.name === "Kimi China") {
    return [
      "Kimi Platform rejected this API key (401).",
      "If this key was created in Kimi Code Console, choose Provider preset: Kimi Code.",
      "If it was created in Kimi Platform, check that the key is copied correctly and the account has API balance/quota."
    ].join(" ");
  }

  return `${provider.name} rejected this API key (401). Please check that the key belongs to ${provider.name}.`;
}

function resolveModel(settings: ConceptLensSettings, defaultModel: string, allowLegacyModel = false): string {
  const override = settings.modelOverride?.trim();
  if (override) {
    return override;
  }

  const legacyModel = settings.model?.trim();
  if (allowLegacyModel && legacyModel) {
    return legacyModel;
  }

  return defaultModel;
}

function normalizeChatCompletionsUrl(baseUrl: string): string {
  const normalized = (baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/g, "");
  if (!normalized) {
    return "https://api.openai.com/v1/chat/completions";
  }
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}
