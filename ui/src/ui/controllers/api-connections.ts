import type { AppViewState } from "../app-view-state.ts";
import { invalidateModelCatalogCache, loadModels } from "./models.ts";

export type ApiConnectionKind = "model" | "tool_skill" | "marketplace" | "dialog" | "custom";
export type ApiConnectionConsumer =
  | "marketplace"
  | "marketplace_dialog"
  | "local_dialog"
  | "dispatch"
  | "main_chat"
  | "operations_backend"
  | "build_session"
  | "buyer_storefront"
  | "user_center"
  | "developer_center"
  | "ai_review"
  | "role_execution"
  | "tool"
  | "skill"
  | "voice"
  | "image"
  | "media_model"
  | "model";

export type ApiConnectionFormSecretRef = {
  source: string;
  provider: string;
  id: string;
};

export type ApiConnectionFormState = {
  templateId: string;
  connectionMode: "direct" | "env" | "oauth" | "local";
  editingId: string | null;
  advancedOpen: boolean;
  name: string;
  kind: ApiConnectionKind;
  provider: string;
  baseUrl: string;
  secretValue: string;
  secretEnvId: string;
  existingSecretRef: ApiConnectionFormSecretRef | null;
  consumers: ApiConnectionConsumer[];
  modelId: string;
  inputTokenPriceCnyPerMillion: string;
  outputTokenPriceCnyPerMillion: string;
  dailyBudgetCny: string;
  bindingPath: string;
  smokeJson: string;
};

export type ApiConnectionsPageState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
  readModel: Record<string, unknown> | null;
  closedLoopReadiness: Record<string, unknown> | null;
  form: ApiConnectionFormState;
};

const MODEL_TOKEN_CONSUMERS: ApiConnectionConsumer[] = [
  "model",
  "local_dialog",
  "operations_backend",
  "build_session",
  "buyer_storefront",
  "user_center",
  "developer_center",
  "ai_review",
  "role_execution",
  "image",
  "media_model",
];

const MODEL_TOKEN_CONSUMER_SET = new Set<ApiConnectionConsumer>(MODEL_TOKEN_CONSUMERS);
const MARKETPLACE_CONNECTION_CONSUMERS = new Set<ApiConnectionConsumer>([
  "marketplace",
  "operations_backend",
  "buyer_storefront",
  "user_center",
  "developer_center",
  "role_execution",
]);
const TOOL_SKILL_CONSUMERS = new Set<ApiConnectionConsumer>(["tool", "skill"]);
const DEFAULT_MODEL_PRICING_CNY_PER_MILLION: Record<string, { input: string; output: string }> = {
  anthropic: { input: "20", output: "100" },
  deepseek: { input: "0.02", output: "0.02" },
  gemini: { input: "8", output: "32" },
  openai: { input: "8", output: "32" },
  "qwen-dashscope": { input: "0.8", output: "2" },
};

export type ApiConnectionTemplate = {
  id: string;
  title: string;
  description: string;
  category:
    | "cloud_marketplace"
    | "local_service"
    | "model_provider"
    | "tool_provider"
    | "skill_provider"
    | "role_usage"
    | "custom_provider";
  kind: ApiConnectionKind;
  provider: string;
  consumers: ApiConnectionConsumer[];
  bindingPath: string;
  baseUrl?: string;
  connectionMode?: ApiConnectionFormState["connectionMode"];
  modelOptions?: string[];
  defaultModel?: string;
  requiresExternalSecret: boolean;
  visibleInApiManagement?: boolean;
};

export const API_CONNECTION_TEMPLATES: ApiConnectionTemplate[] = [
  {
    id: "cloud-marketplace",
    title: "迭界AI云端（本地开发）",
    description:
      "本地开发/测试用的云端模拟连接，读取已授权岗位、申请 execution-token 并上传审计摘要。",
    category: "cloud_marketplace",
    kind: "marketplace",
    provider: "cloud-marketplace",
    consumers: [
      "marketplace",
      "operations_backend",
      "buyer_storefront",
      "user_center",
      "developer_center",
      "role_execution",
    ],
    bindingPath: "plugins.entries.aics.config.cloudAccessToken",
    baseUrl: "http://127.0.0.1:9000",
    connectionMode: "env",
    requiresExternalSecret: true,
    visibleInApiManagement: false,
  },
  {
    id: "dijie-cloud-bridge",
    title: "迭界AI云端",
    description: "正式连接迭界岗位商城：岗位授权、已购岗位、execution-token、审计上传和费用回写。",
    category: "cloud_marketplace",
    kind: "marketplace",
    provider: "dijie-cloud-bridge",
    consumers: [
      "marketplace",
      "operations_backend",
      "buyer_storefront",
      "user_center",
      "developer_center",
      "role_execution",
    ],
    bindingPath: "plugins.entries.aics.config.cloudAccessToken",
    baseUrl: "http://127.0.0.1:9000",
    connectionMode: "env",
    requiresExternalSecret: true,
  },
  {
    id: "openclaw-local",
    title: "迭界AI本地端",
    description: "本地 Gateway、runtime、插件、本地对话框和本地能力路由健康状态。",
    category: "local_service",
    kind: "custom",
    provider: "openclaw-local",
    consumers: ["tool", "skill"],
    bindingPath: "",
    connectionMode: "local",
    requiresExternalSecret: false,
  },
  {
    id: "openai",
    title: "OpenAI",
    description: "模型 Token 计费 Provider，可供本地端、商城对话和岗位执行使用。",
    category: "model_provider",
    kind: "model",
    provider: "openai",
    consumers: MODEL_TOKEN_CONSUMERS,
    bindingPath: "models.providers.openai",
    baseUrl: "https://api.openai.com/v1",
    connectionMode: "env",
    modelOptions: ["gpt-5.5"],
    defaultModel: "gpt-5.5",
    requiresExternalSecret: true,
  },
  {
    id: "anthropic",
    title: "Anthropic",
    description: "Claude 模型 Provider。",
    category: "model_provider",
    kind: "model",
    provider: "anthropic",
    consumers: MODEL_TOKEN_CONSUMERS,
    bindingPath: "models.providers.anthropic",
    baseUrl: "https://api.anthropic.com",
    modelOptions: ["claude-sonnet-4", "claude-haiku"],
    defaultModel: "claude-sonnet-4",
    requiresExternalSecret: true,
  },
  {
    id: "gemini",
    title: "Google Gemini",
    description: "Gemini 模型 Provider。",
    category: "model_provider",
    kind: "model",
    provider: "gemini",
    consumers: MODEL_TOKEN_CONSUMERS,
    bindingPath: "models.providers.gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    modelOptions: ["gemini-2.5-pro", "gemini-2.5-flash"],
    defaultModel: "gemini-2.5-flash",
    requiresExternalSecret: true,
  },
  {
    id: "deepseek",
    title: "DeepSeek",
    description: "DeepSeek V4 模型 Provider。",
    category: "model_provider",
    kind: "model",
    provider: "deepseek",
    consumers: MODEL_TOKEN_CONSUMERS,
    bindingPath: "models.providers.deepseek",
    baseUrl: "https://api.deepseek.com",
    connectionMode: "env",
    modelOptions: ["deepseek-v4-flash", "deepseek-v4-pro"],
    defaultModel: "deepseek-v4-flash",
    requiresExternalSecret: true,
  },
  {
    id: "qwen-dashscope",
    title: "阿里百炼 / 通义千问",
    description: "阿里云百炼 DashScope / Qwen 模型 Provider。",
    category: "model_provider",
    kind: "model",
    provider: "qwen-dashscope",
    consumers: MODEL_TOKEN_CONSUMERS,
    bindingPath: "models.providers.qwen-dashscope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelOptions: ["qwen-plus", "qwen-max"],
    defaultModel: "qwen-plus",
    requiresExternalSecret: true,
  },
  {
    id: "ollama",
    title: "Ollama / 本地模型",
    description: "本地模型服务，通常不需要外部密钥。",
    category: "model_provider",
    kind: "model",
    provider: "ollama",
    consumers: MODEL_TOKEN_CONSUMERS,
    bindingPath: "models.providers.ollama.baseUrl",
    baseUrl: "http://localhost:11434",
    connectionMode: "local",
    modelOptions: ["llama3.1", "qwen2.5", "mistral"],
    defaultModel: "llama3.1",
    requiresExternalSecret: false,
  },
  {
    id: "tool-skill-api",
    title: "工具 / Skill API",
    description: "供给搜索、浏览器、图片、语音、数据等工具和 Skill 依赖。",
    category: "tool_provider",
    kind: "tool_skill",
    provider: "tool-skill",
    consumers: ["tool", "skill"],
    bindingPath: "skills.entries.<skill>.apiKey",
    connectionMode: "env",
    requiresExternalSecret: true,
    visibleInApiManagement: false,
  },
  {
    id: "custom",
    title: "自定义服务",
    description: "手动配置 provider、用途和绑定路径。",
    category: "custom_provider",
    kind: "custom",
    provider: "custom",
    consumers: [],
    bindingPath: "",
    requiresExternalSecret: true,
  },
];

function templateById(id: string | null | undefined): ApiConnectionTemplate {
  return (
    API_CONNECTION_TEMPLATES.find((template) => template.id === id) ?? API_CONNECTION_TEMPLATES[0]!
  );
}

function defaultSecretEnvId(provider: string): string {
  return `${
    provider
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "API"
  }_API_KEY`;
}

function requiresSecretRef(form: Pick<ApiConnectionFormState, "kind" | "consumers">): boolean {
  return (
    form.kind === "marketplace" ||
    form.kind === "tool_skill" ||
    form.consumers.includes("marketplace") ||
    form.consumers.includes("dispatch")
  );
}

function normalizeConsumersForKind(
  kind: ApiConnectionKind,
  consumers: readonly ApiConnectionConsumer[] | undefined,
): ApiConnectionConsumer[] {
  const normalized = Array.from(new Set(consumers ?? []));
  if (kind === "model") {
    return normalized.filter((consumer) => MODEL_TOKEN_CONSUMER_SET.has(consumer));
  }
  if (kind === "marketplace") {
    return normalized.filter((consumer) => MARKETPLACE_CONNECTION_CONSUMERS.has(consumer));
  }
  if (kind === "tool_skill") {
    return normalized.filter((consumer) => TOOL_SKILL_CONSUMERS.has(consumer));
  }
  return normalized;
}

function formFromTemplate(template: ApiConnectionTemplate): ApiConnectionFormState {
  const pricing = DEFAULT_MODEL_PRICING_CNY_PER_MILLION[template.provider] ?? {
    input: "1",
    output: "4",
  };
  return {
    templateId: template.id,
    connectionMode: template.connectionMode ?? (template.requiresExternalSecret ? "env" : "local"),
    editingId: null,
    advancedOpen: template.id === "custom",
    name: template.title,
    kind: template.kind,
    provider: template.provider,
    baseUrl: template.baseUrl ?? "",
    secretValue: "",
    secretEnvId:
      template.id === "cloud-marketplace" || template.id === "dijie-cloud-bridge"
        ? "DIJIE_CLOUD_ACCESS_TOKEN"
        : template.id === "qwen-dashscope"
          ? "DASHSCOPE_API_KEY"
          : template.requiresExternalSecret
            ? defaultSecretEnvId(template.provider)
            : "",
    existingSecretRef: null,
    consumers: [...template.consumers],
    modelId: template.defaultModel ?? template.modelOptions?.[0] ?? "",
    inputTokenPriceCnyPerMillion: template.kind === "model" ? pricing.input : "",
    outputTokenPriceCnyPerMillion: template.kind === "model" ? pricing.output : "",
    dailyBudgetCny: "",
    bindingPath: template.bindingPath,
    smokeJson: "",
  };
}

function normalizedModelIdForTemplate(
  template: ApiConnectionTemplate,
  modelId: string | null | undefined,
): string {
  const trimmed = String(modelId ?? "").trim();
  const retiredModels = new Set(
    template.id === "openai"
      ? ["gpt-4.1"]
      : template.id === "deepseek"
        ? ["deepseek-chat", "deepseek-reasoner"]
        : [],
  );
  if (trimmed && retiredModels.has(trimmed)) {
    return template.defaultModel ?? template.modelOptions?.[0] ?? "";
  }
  if (trimmed) return trimmed;
  return template.defaultModel ?? template.modelOptions?.[0] ?? "";
}

function availableModelsForTemplate(
  template: ApiConnectionTemplate,
  modelId: string | null | undefined,
): string[] {
  const selected = normalizedModelIdForTemplate(template, modelId);
  return Array.from(new Set([...(template.modelOptions ?? []), selected].filter(Boolean)));
}

function isManualModelIdForTemplate(
  template: ApiConnectionTemplate,
  modelId: string | null | undefined,
): boolean {
  const selected = normalizedModelIdForTemplate(template, modelId);
  return Boolean(
    selected &&
    template.kind === "model" &&
    template.modelOptions?.length &&
    !template.modelOptions.includes(selected),
  );
}

export function createDefaultApiConnectionForm(): ApiConnectionFormState {
  return formFromTemplate(templateById("openai"));
}

export function createDefaultApiConnectionsPageState(): ApiConnectionsPageState {
  return {
    loading: false,
    saving: false,
    error: null,
    message: null,
    readModel: null,
    closedLoopReadiness: null,
    form: createDefaultApiConnectionForm(),
  };
}

function requestUpdate(state: AppViewState): void {
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestHostUpdate?.();
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestUpdate?.();
}

async function refreshChatModelCatalogAfterModelConfigChange(state: AppViewState): Promise<void> {
  if (!state.client || !state.connected) return;
  invalidateModelCatalogCache(state.client);
  state.chatModelsLoading = true;
  requestUpdate(state);
  try {
    state.chatModelCatalog = await loadModels(state.client);
  } finally {
    state.chatModelsLoading = false;
    requestUpdate(state);
  }
}

function defaultConsumersForKind(kind: ApiConnectionKind): ApiConnectionConsumer[] {
  switch (kind) {
    case "model":
      return [...MODEL_TOKEN_CONSUMERS];
    case "tool_skill":
      return ["tool", "skill"];
    case "marketplace":
      return ["marketplace"];
    case "dialog":
      return ["buyer_storefront", "user_center", "developer_center"];
    default:
      return [];
  }
}

function messageForConnectionMode(
  mode: ApiConnectionFormState["connectionMode"],
  template: ApiConnectionTemplate,
): string {
  if (mode === "local") return `已切换为本地服务，「${template.title}」不需要填写 API Key。`;
  if (mode === "oauth")
    return `已切换为 OAuth / 云端授权，「${template.title}」不需要填写 API Key。`;
  if (mode === "env") {
    return template.kind === "marketplace" || template.kind === "tool_skill"
      ? `已切换为本地安全保存，「${template.title}」的真实密钥由本页统一管理，需要时同步到目标端。`
      : `已切换为本地安全保存：粘贴 Key 后配置里只保留 SecretRef，可供本地端和迭界AI云端使用。`;
  }
  return `已切换为本地安全保存：粘贴 API Key 后会自动转换为本机 SecretRef。`;
}

function connectionModeFromSecret(
  entry: Record<string, unknown>,
  secret: Record<string, unknown>,
): ApiConnectionFormState["connectionMode"] {
  const authMode = String(entry.authMode ?? "");
  const secretMode = String(secret.mode ?? "");
  if (authMode === "oauth" || secretMode === "oauth") return "oauth";
  if (authMode === "none" || secretMode === "none") return "local";
  return "env";
}

export function updateApiConnectionFormField(
  state: AppViewState,
  field: keyof ApiConnectionFormState,
  value: string | boolean | ApiConnectionConsumer[] | null,
): void {
  const current = state.apiConnections.form;
  if (field === "templateId") {
    const template = templateById(value as string);
    const nextForm = formFromTemplate(template);
    state.apiConnections = {
      ...state.apiConnections,
      error: null,
      message:
        template.connectionMode === "local"
          ? `已选择「${template.title}」，本地服务不需要填写 API Key。`
          : template.connectionMode === "oauth"
            ? `已选择「${template.title}」，当前使用 OAuth / 云端授权，不需要填写 API Key。`
            : requiresSecretRef(nextForm)
              ? `已选择「${template.title}」，粘贴密钥值后会本地安全保存，并在需要时同步到目标端。`
              : `已选择「${template.title}」，粘贴真实 API Key 后点击连接。`,
      form: { ...nextForm, editingId: current.editingId, existingSecretRef: null },
    };
    requestUpdate(state);
    return;
  }
  if (field === "connectionMode") {
    const connectionMode = value as ApiConnectionFormState["connectionMode"];
    const template = templateById(current.templateId);
    state.apiConnections = {
      ...state.apiConnections,
      error: null,
      message: messageForConnectionMode(connectionMode, template),
      form: {
        ...current,
        connectionMode,
        secretValue:
          connectionMode === "direct" || connectionMode === "env" ? current.secretValue : "",
        secretEnvId:
          connectionMode === "env"
            ? current.secretEnvId || defaultSecretEnvId(current.provider)
            : current.secretEnvId,
        existingSecretRef:
          connectionMode === current.connectionMode &&
          (connectionMode === "env" || connectionMode === "direct")
            ? current.existingSecretRef
            : null,
      },
    };
    requestUpdate(state);
    return;
  }
  if (field === "kind") {
    const kind = value as ApiConnectionKind;
    state.apiConnections = {
      ...state.apiConnections,
      error: null,
      message: null,
      form: { ...current, kind, consumers: defaultConsumersForKind(kind) },
    };
  } else {
    state.apiConnections = {
      ...state.apiConnections,
      error: null,
      message: null,
      form: { ...current, [field]: value },
    };
  }
  requestUpdate(state);
}

function entriesFromReadModel(state: AppViewState): Array<Record<string, unknown>> {
  const readModel = state.apiConnections.readModel ?? {};
  const entries = (readModel as { entries?: unknown }).entries;
  if (Array.isArray(entries)) return entries as Array<Record<string, unknown>>;
  const groups = (readModel as { groups?: unknown }).groups;
  if (!groups || typeof groups !== "object") return [];
  return Object.values(groups as Record<string, unknown>).flatMap((group) =>
    Array.isArray(group) ? (group as Array<Record<string, unknown>>) : [],
  );
}

function templateIdForEntry(entry: Record<string, unknown>): string {
  const provider = typeof entry.provider === "string" ? entry.provider : "";
  const kind = typeof entry.kind === "string" ? entry.kind : "";
  const consumers = Array.isArray(entry.consumers) ? entry.consumers : [];
  if (provider === "dijie-cloud-bridge") return "dijie-cloud-bridge";
  if (provider === "cloud-marketplace" || (kind !== "model" && consumers.includes("marketplace")))
    return "cloud-marketplace";
  if (provider === "openclaw-local") return "openclaw-local";
  if (provider === "openai") return "openai";
  if (provider === "anthropic") return "anthropic";
  if (provider === "gemini" || provider === "google") return "gemini";
  if (provider === "deepseek") return "deepseek";
  if (provider === "qwen-dashscope" || provider === "dashscope" || provider === "qwen")
    return "qwen-dashscope";
  if (provider === "ollama") return "ollama";
  if (provider.includes("image")) return "image-generation";
  if (provider.includes("video")) return "video-generation";
  if (kind === "model")
    return API_CONNECTION_TEMPLATES.some((template) => template.provider === provider)
      ? provider
      : "custom";
  return "custom";
}

export function editApiConnectionEntry(state: AppViewState, id: string): void {
  const entry = entriesFromReadModel(state).find((candidate) => String(candidate.id ?? "") === id);
  if (!entry) {
    state.apiConnections = { ...state.apiConnections, error: "没有找到要编辑的连接。" };
    requestUpdate(state);
    return;
  }
  const secret = (entry.secret ?? {}) as Record<string, unknown>;
  const existingSecretRef =
    secret.mode === "secret_ref" &&
    typeof secret.source === "string" &&
    typeof secret.provider === "string" &&
    typeof secret.id === "string"
      ? { source: secret.source, provider: secret.provider, id: secret.id }
      : null;
  const bindings = Array.isArray(entry.configBindings)
    ? (entry.configBindings as Array<Record<string, unknown>>)
    : [];
  const dijieMetadata = (entry.metadata as Record<string, unknown> | undefined)?.dijie;
  const smokeJson =
    dijieMetadata && typeof dijieMetadata === "object" && !Array.isArray(dijieMetadata)
      ? JSON.stringify(dijieMetadata, null, 2)
      : "";
  state.apiConnections = {
    ...state.apiConnections,
    error: null,
    message: "正在编辑已连接服务。",
    form: {
      templateId: templateIdForEntry(entry),
      connectionMode: connectionModeFromSecret(entry, secret),
      editingId: id,
      advancedOpen: false,
      name: String(entry.name ?? ""),
      kind: String(entry.kind ?? "custom") as ApiConnectionKind,
      provider: String(entry.provider ?? ""),
      baseUrl: String(entry.baseUrl ?? entry.endpoint ?? ""),
      secretValue: "",
      secretEnvId: String(secret.id ?? ""),
      existingSecretRef,
      consumers: normalizeConsumersForKind(
        String(entry.kind ?? "custom") as ApiConnectionKind,
        Array.isArray(entry.consumers) ? (entry.consumers as ApiConnectionConsumer[]) : [],
      ),
      modelId: normalizedModelIdForTemplate(
        templateById(templateIdForEntry(entry)),
        String((entry.metadata as Record<string, unknown> | undefined)?.defaultModel ?? ""),
      ),
      inputTokenPriceCnyPerMillion: String(
        (
          (entry.metadata as Record<string, unknown> | undefined)?.pricing as
            | Record<string, unknown>
            | undefined
        )?.inputCnyPerMillion ?? "0",
      ),
      outputTokenPriceCnyPerMillion: String(
        (
          (entry.metadata as Record<string, unknown> | undefined)?.pricing as
            | Record<string, unknown>
            | undefined
        )?.outputCnyPerMillion ?? "0",
      ),
      dailyBudgetCny: String(
        (
          (entry.metadata as Record<string, unknown> | undefined)?.budget as
            | Record<string, unknown>
            | undefined
        )?.dailyCny ?? "",
      ),
      bindingPath: String(bindings[0]?.path ?? ""),
      smokeJson,
    },
  };
  requestUpdate(state);
}

export function resetApiConnectionForm(state: AppViewState): void {
  state.apiConnections = {
    ...state.apiConnections,
    error: null,
    message: null,
    form: createDefaultApiConnectionForm(),
  };
  requestUpdate(state);
}

const DIJIE_SMOKE_METADATA_KEYS = [
  "roleListingId",
  "entitlementId",
  "deviceId",
  "workspaceRef",
  "localGatewayId",
] as const;

const DIJIE_SMOKE_NESTED_KEYS = [
  "metadata",
  "dijie",
  "result",
  "data",
  "closedLoop",
  "closedLoopReadiness",
  "readiness",
  "bridge",
  "authorization",
  "entitlement",
  "role",
  "listing",
  "executionToken",
  "execution",
] as const;

function collectDijieSmokeCandidates(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectDijieSmokeCandidates(item));
  }
  const record = value as Record<string, unknown>;
  return [
    record,
    ...DIJIE_SMOKE_NESTED_KEYS.flatMap((key) => collectDijieSmokeCandidates(record[key])),
  ];
}

function parseDijieSmokeMetadata(
  form: ApiConnectionFormState,
): Record<string, unknown> | undefined {
  const raw = form.smokeJson.trim();
  if (!raw) return undefined;
  if (form.kind !== "marketplace") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (
    (Array.isArray(parsed) && parsed.length === 0) ||
    (parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0)
  ) {
    return undefined;
  }
  const dijie: Record<string, string> = {};
  for (const candidate of collectDijieSmokeCandidates(parsed)) {
    for (const key of DIJIE_SMOKE_METADATA_KEYS) {
      if (dijie[key]) continue;
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        dijie[key] = value.trim();
      }
    }
  }
  return Object.keys(dijie).length ? { dijie } : undefined;
}

function requestParamsFromForm(form: ApiConnectionFormState): Record<string, unknown> {
  const template = templateById(form.templateId);
  const defaultModel = normalizedModelIdForTemplate(template, form.modelId);
  const inputPrice = Number(form.inputTokenPriceCnyPerMillion);
  const outputPrice = Number(form.outputTokenPriceCnyPerMillion);
  const hasModelPricing =
    Number.isFinite(inputPrice) &&
    inputPrice > 0 &&
    Number.isFinite(outputPrice) &&
    outputPrice > 0;
  const dailyBudget = Number(form.dailyBudgetCny);
  const modelMetadata =
    form.kind === "model"
      ? {
          defaultModel: defaultModel || undefined,
          availableModels: availableModelsForTemplate(template, form.modelId),
          modelValidation: {
            status: isManualModelIdForTemplate(template, form.modelId)
              ? "needs_test"
              : "recommended",
            source: isManualModelIdForTemplate(template, form.modelId)
              ? "manual_model_id"
              : "template_model",
            note: isManualModelIdForTemplate(template, form.modelId)
              ? "手动模型 ID 已保存；需要用真实账号测试连接后才能确认可调用。"
              : "模板推荐模型。",
          },
          pricing: hasModelPricing
            ? {
                currency: "CNY",
                unit: "1M_tokens",
                inputCnyPerMillion: inputPrice,
                outputCnyPerMillion: outputPrice,
              }
            : undefined,
          budget:
            form.dailyBudgetCny.trim() && Number.isFinite(dailyBudget) && dailyBudget > 0
              ? { currency: "CNY", period: "day", dailyCny: dailyBudget }
              : undefined,
          metering: {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costCny: 0,
            byConsumer: {},
          },
        }
      : {};
  const shouldReuseExistingSecret = Boolean(
    form.existingSecretRef &&
    !form.secretValue.trim() &&
    (form.connectionMode === "direct" || form.connectionMode === "env"),
  );
  return {
    name: form.name,
    kind: form.kind,
    provider: form.provider,
    baseUrl: form.baseUrl || undefined,
    secret: shouldReuseExistingSecret ? (form.existingSecretRef ?? undefined) : undefined,
    secretEnvId:
      form.connectionMode === "env" && !shouldReuseExistingSecret
        ? form.secretEnvId || undefined
        : undefined,
    managedSecretValue:
      (form.connectionMode === "direct" || form.connectionMode === "env") && form.secretValue.trim()
        ? form.secretValue.trim()
        : undefined,
    authMode:
      form.connectionMode === "local"
        ? "none"
        : form.connectionMode === "direct"
          ? "secret_ref"
          : form.connectionMode === "oauth"
            ? "oauth"
            : form.connectionMode === "env"
              ? "secret_ref"
              : undefined,
    consumers: normalizeConsumersForKind(form.kind, form.consumers),
    bindingPath: form.bindingPath || undefined,
    metadata: { ...modelMetadata, ...(parseDijieSmokeMetadata(form) ?? {}) },
  };
}

function normalizedEntryId(form: ApiConnectionFormState): string {
  return `${form.kind}-${form.provider}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function entriesFromReadModelValue(
  readModel: Record<string, unknown> | null,
): Array<Record<string, unknown>> {
  const entries = (readModel ?? {}).entries;
  if (Array.isArray(entries)) return entries as Array<Record<string, unknown>>;
  const groups = (readModel ?? {}).groups;
  if (!groups || typeof groups !== "object") return [];
  return Object.values(groups as Record<string, unknown>).flatMap((group) =>
    Array.isArray(group) ? (group as Array<Record<string, unknown>>) : [],
  );
}

function readModelFromEntries(
  current: Record<string, unknown> | null,
  entries: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const groups: Record<ApiConnectionKind, Record<string, unknown>[]> = {
    model: [],
    tool_skill: [],
    marketplace: [],
    dialog: [],
    custom: [],
  };
  for (const item of entries) {
    const kind = String(item.kind ?? "custom") as ApiConnectionKind;
    (groups[kind] ?? groups.custom).push(item);
  }
  const riskItems = entries.flatMap((item) =>
    Array.isArray(item.risks) ? (item.risks as Array<Record<string, unknown>>) : [],
  );
  return {
    ...(current ?? {}),
    entries,
    groups,
    metrics: {
      configured: entries.length,
      available: entries.filter((item) => item.status === "available").length,
      risky: entries.filter((item) => item.riskStatus !== "ok").length,
      unbound: entries.filter((item) => item.status === "unbound").length,
      blocked: entries.filter((item) => item.status === "blocked").length,
    },
    riskReport: {
      items: riskItems,
      counts: {
        blocking: riskItems.filter((item) => item.severity === "blocking").length,
        warning: riskItems.filter((item) => item.severity === "warning").length,
        info: riskItems.filter((item) => item.severity === "info").length,
      },
    },
  };
}

function createOptimisticReadModel(
  current: Record<string, unknown> | null,
  form: ApiConnectionFormState,
): Record<string, unknown> {
  const previousEntries = entriesFromReadModelValue(current).filter(
    (entry) => String(entry.id ?? "") !== (form.editingId ?? normalizedEntryId(form)),
  );
  const id = form.editingId ?? normalizedEntryId(form);
  const configBindings = form.bindingPath
    ? [{ path: form.bindingPath, owner: "apiConnections" }]
    : [];
  const secret =
    form.connectionMode === "local"
      ? { mode: "none", status: "missing" }
      : form.connectionMode === "env"
        ? {
            mode: "secret_ref",
            source: form.secretValue.trim() ? "file" : (form.existingSecretRef?.source ?? "env"),
            provider: form.secretValue.trim()
              ? "api-connections"
              : (form.existingSecretRef?.provider ?? "default"),
            id: form.secretValue.trim()
              ? `/entries/${id}/secret`
              : (form.existingSecretRef?.id ?? form.secretEnvId),
            status: form.secretValue.trim() || form.existingSecretRef ? "configured" : "unresolved",
          }
        : form.connectionMode === "oauth"
          ? { mode: "oauth", status: "configured" }
          : {
              mode: "secret_ref",
              source: "file",
              provider: "api-connections",
              id: `/entries/${id}/secret`,
              status: "configured",
            };
  const risks =
    form.connectionMode === "direct" && form.kind !== "model"
      ? [
          {
            entryId: id,
            code: "plaintext_secret",
            severity: "warning",
            message: "API Key 已保存为本地 SecretRef。",
          },
        ]
      : [];
  const entry = {
    id,
    name: form.name,
    kind: form.kind,
    provider: form.provider,
    baseUrl: form.baseUrl,
    authMode:
      form.connectionMode === "local"
        ? "none"
        : form.connectionMode === "env"
          ? "secret_ref"
          : form.connectionMode === "oauth"
            ? "oauth"
            : "secret_ref",
    consumers: form.consumers,
    requestedScope: [],
    configBindings,
    metadata: (requestParamsFromForm(form).metadata ?? {}) as Record<string, unknown>,
    enabled: true,
    secret,
    status: configBindings.length ? "available" : "unbound",
    riskStatus: risks.length ? "warning" : "ok",
    risks,
  };
  return readModelFromEntries(current, [...previousEntries, entry]);
}

function createOptimisticReadModelAfterDelete(
  current: Record<string, unknown> | null,
  id: string,
): Record<string, unknown> | null {
  if (!current) return current;
  const entries = entriesFromReadModelValue(current).filter(
    (entry) => String(entry.id ?? "") !== id,
  );
  return readModelFromEntries(current, entries);
}

function updateApiConnectionReadModelEntry(
  current: Record<string, unknown> | null,
  id: string,
  update: (entry: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> | null {
  if (!current) return current;
  const entries = entriesFromReadModelValue(current);
  let changed = false;
  const nextEntries = entries.map((entry) => {
    if (String(entry.id ?? "") !== id) return entry;
    changed = true;
    return update(entry);
  });
  return changed ? readModelFromEntries(current, nextEntries) : current;
}

function validateFormForSave(form: ApiConnectionFormState): string | null {
  if (!form.name.trim()) return "请选择服务。";
  if (!form.provider.trim()) return "缺少 Provider ID。";
  if (requiresSecretRef(form) && form.connectionMode === "direct") {
    return "迭界AI云端、调度能力和工具服务 Token 请使用本地安全保存，由本页统一管理并同步到目标端。";
  }
  if (form.connectionMode === "direct" && !form.secretValue.trim()) {
    if (!form.existingSecretRef) return "请粘贴真实 API Key，不能空保存。";
  }
  if (
    form.connectionMode === "env" &&
    !form.secretEnvId.trim() &&
    !form.secretValue.trim() &&
    !form.existingSecretRef
  ) {
    return "请粘贴密钥值由本地安全保存，或填写已有环境变量名。";
  }
  if (form.kind === "model" && form.connectionMode !== "local" && form.connectionMode !== "oauth") {
    const inputPrice = Number(form.inputTokenPriceCnyPerMillion);
    const outputPrice = Number(form.outputTokenPriceCnyPerMillion);
    const dailyBudget = Number(form.dailyBudgetCny);
    if (
      !Number.isFinite(inputPrice) ||
      inputPrice <= 0 ||
      !Number.isFinite(outputPrice) ||
      outputPrice <= 0
    ) {
      return "请填写输入和输出 Token 单价（元 / 百万），否则只能记录 Token，不能产生费用。";
    }
    if (form.dailyBudgetCny.trim() && (!Number.isFinite(dailyBudget) || dailyBudget <= 0)) {
      return "日预算必须是大于 0 的数字；不需要预算时可以留空。";
    }
  }
  return null;
}

function isGatewayServiceRestartError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /gateway closed\s*\(1012\)|service restart/iu.test(message);
}

export async function refreshApiConnectionsReadModel(state: AppViewState): Promise<void> {
  state.apiConnections = { ...state.apiConnections, loading: true, error: null };
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    const readModel = await state.client.request<Record<string, unknown>>(
      "aics.apiConnections.readModel.get",
      {},
    );
    state.apiConnections = { ...state.apiConnections, loading: false, readModel, error: null };
  } catch (err) {
    state.apiConnections = {
      ...state.apiConnections,
      loading: false,
      error: err instanceof Error ? err.message : "API 连接读取失败",
    };
  }
  requestUpdate(state);
}

export async function createApiConnectionEntry(state: AppViewState): Promise<void> {
  const form = state.apiConnections.form;
  const validationError = validateFormForSave(form);
  if (validationError) {
    state.apiConnections = { ...state.apiConnections, error: validationError, message: null };
    requestUpdate(state);
    return;
  }
  state.apiConnections = { ...state.apiConnections, saving: true, error: null, message: null };
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    const method = form.editingId
      ? "aics.apiConnections.entry.update"
      : "aics.apiConnections.entry.create";
    const result = await state.client.request<{ readModel?: Record<string, unknown> }>(
      method,
      form.editingId
        ? { id: form.editingId, ...requestParamsFromForm(form) }
        : requestParamsFromForm(form),
    );
    const savedEntryId = form.editingId ?? normalizedEntryId(form);
    let readModel =
      result.readModel ?? createOptimisticReadModel(state.apiConnections.readModel, form);
    let message = form.editingId ? "连接已更新。" : "连接已保存。";
    const shouldMaterializeAfterSave =
      form.kind === "model" ||
      form.templateId === "dijie-cloud-bridge" ||
      form.templateId === "cloud-marketplace";
    if (shouldMaterializeAfterSave) {
      const materialized = await state.client.request<{ readModel?: Record<string, unknown> }>(
        "aics.apiConnections.entry.materialize",
        { id: savedEntryId },
      );
      readModel = materialized.readModel ?? readModel;
      message =
        form.kind === "model"
          ? `${message} 已同步到本地模型池。`
          : `${message} 已应用到迭界AI云端连接。`;
      if (form.kind === "model") {
        await refreshChatModelCatalogAfterModelConfigChange(state);
      }
    }
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      readModel,
      message,
      form: createDefaultApiConnectionForm(),
    };
  } catch (err) {
    if (isGatewayServiceRestartError(err)) {
      state.apiConnections = {
        ...state.apiConnections,
        saving: false,
        error: null,
        readModel: createOptimisticReadModel(state.apiConnections.readModel, form),
        message: form.editingId
          ? "连接已提交，Gateway 正在重启；重连后会自动刷新。"
          : "连接已保存，Gateway 正在重启；重连后会自动刷新。",
        form: createDefaultApiConnectionForm(),
      };
      requestUpdate(state);
      return;
    }
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      error: err instanceof Error ? err.message : "API 保存失败",
    };
  }
  requestUpdate(state);
}

export async function deleteApiConnectionEntry(state: AppViewState, id: string): Promise<void> {
  state.apiConnections = { ...state.apiConnections, saving: true, error: null, message: null };
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    const result = await state.client.request<{ readModel?: Record<string, unknown> }>(
      "aics.apiConnections.entry.delete",
      { id },
    );
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      readModel:
        result.readModel ??
        createOptimisticReadModelAfterDelete(state.apiConnections.readModel, id),
      message: "连接记录已删除；由 API 管理应用到本地端的绑定和本机受控密钥已同步清理。",
      form:
        state.apiConnections.form.editingId === id
          ? createDefaultApiConnectionForm()
          : state.apiConnections.form,
    };
  } catch (err) {
    if (isGatewayServiceRestartError(err)) {
      state.apiConnections = {
        ...state.apiConnections,
        saving: false,
        error: null,
        readModel: createOptimisticReadModelAfterDelete(state.apiConnections.readModel, id),
        message: "连接删除已提交，Gateway 正在重启；重连后会自动刷新。",
        form:
          state.apiConnections.form.editingId === id
            ? createDefaultApiConnectionForm()
            : state.apiConnections.form,
      };
      requestUpdate(state);
      return;
    }
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      error: err instanceof Error ? err.message : "连接删除失败",
    };
  }
  requestUpdate(state);
}

type ApiConnectionTestResponse = {
  ok?: boolean;
  connectionTest?: {
    status?: "passed" | "failed" | "needs_review";
    message?: string;
  };
  readModel?: Record<string, unknown>;
};

function applyLocalApiConnectionTest(state: AppViewState, id: string): void {
  const entry = entriesFromReadModel(state).find((candidate) => String(candidate.id ?? "") === id);
  if (!entry) {
    state.apiConnections = { ...state.apiConnections, error: "没有找到要测试的连接。" };
    requestUpdate(state);
    return;
  }
  const secret = (entry.secret ?? {}) as Record<string, unknown>;
  const bindings = Array.isArray(entry.configBindings) ? entry.configBindings : [];
  const risks = Array.isArray(entry.risks) ? (entry.risks as Array<Record<string, unknown>>) : [];
  const blocking = risks.find((risk) => risk.severity === "blocking");
  const baseUrl = String(entry.baseUrl ?? entry.endpoint ?? "");
  const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
  const modelValidation = (metadata.modelValidation ?? {}) as Record<string, unknown>;
  const manualModelNeedsTest =
    entry.kind === "model" &&
    modelValidation.source === "manual_model_id" &&
    modelValidation.status !== "manual_confirmed";
  const insecure =
    baseUrl.startsWith("http://") &&
    !baseUrl.includes("localhost") &&
    !baseUrl.includes("127.0.0.1");
  const message = blocking
    ? `连接检查未通过：${blocking.message ?? blocking.code ?? "存在阻塞项"}`
    : secret.status === "unresolved"
      ? "连接检查未通过：SecretRef 当前无法解析。"
      : insecure
        ? "连接检查未通过：Base URL 不是 HTTPS。"
        : bindings.length === 0
          ? "连接可保存，但还没有同步绑定路径。"
          : manualModelNeedsTest
            ? "手动模型 ID 已做本地配置检查并标记为手动确认；这不代表已经发起外部模型调用。"
            : "连接本地检查通过，可供系统使用。";
  state.apiConnections = {
    ...state.apiConnections,
    error: blocking || secret.status === "unresolved" || insecure ? message : null,
    message: blocking || secret.status === "unresolved" || insecure ? null : message,
    readModel:
      !blocking && secret.status !== "unresolved" && !insecure && manualModelNeedsTest
        ? updateApiConnectionReadModelEntry(state.apiConnections.readModel, id, (item) => ({
            ...item,
            metadata: {
              ...((item.metadata ?? {}) as Record<string, unknown>),
              modelValidation: {
                ...(((item.metadata as Record<string, unknown> | undefined)?.modelValidation ??
                  {}) as Record<string, unknown>),
                status: "manual_confirmed",
                confirmedAt: new Date().toISOString(),
                note: "已完成本地配置检查；真实可调用性仍以外部模型请求结果为准。",
              },
            },
          }))
        : state.apiConnections.readModel,
  };
  requestUpdate(state);
}

export async function testApiConnectionEntry(state: AppViewState, id: string): Promise<void> {
  if (!state.client) {
    applyLocalApiConnectionTest(state, id);
    return;
  }
  state.apiConnections = { ...state.apiConnections, saving: true, error: null, message: null };
  requestUpdate(state);
  try {
    const result = await state.client.request<ApiConnectionTestResponse>(
      "aics.apiConnections.entry.test",
      { id },
    );
    const status = result.connectionTest?.status;
    const message =
      result.connectionTest?.message ??
      (status === "failed" ? "连接测试未通过。" : "连接后端检查通过。");
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      readModel: result.readModel ?? state.apiConnections.readModel,
      error: status === "failed" || result.ok === false ? message : null,
      message: status === "failed" || result.ok === false ? null : message,
    };
  } catch (err) {
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      error: err instanceof Error ? err.message : "连接测试失败",
    };
  }
  requestUpdate(state);
}

export async function materializeApiConnectionEntry(
  state: AppViewState,
  id?: string,
): Promise<void> {
  state.apiConnections = { ...state.apiConnections, saving: true, error: null, message: null };
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    const materializedEntry = id
      ? entriesFromReadModel(state).find((entry) => String(entry.id ?? "") === id)
      : undefined;
    const shouldRefreshModelCatalog = !id || String(materializedEntry?.kind ?? "") === "model";
    const result = await state.client.request<{ readModel?: Record<string, unknown> }>(
      "aics.apiConnections.entry.materialize",
      id ? { id } : {},
    );
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      readModel: result.readModel ?? state.apiConnections.readModel,
      message: "API 已同步到本地端；如果页面短暂显示本机连接，等待几秒会自动恢复。",
    };
    if (shouldRefreshModelCatalog) {
      await refreshChatModelCatalogAfterModelConfigChange(state);
    }
  } catch (err) {
    if (isGatewayServiceRestartError(err)) {
      state.apiConnections = {
        ...state.apiConnections,
        saving: false,
        error: null,
        message: "API 同步已提交，本地端正在重连；页面会在几秒后自动刷新。",
      };
      requestUpdate(state);
      return;
    }
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      error: err instanceof Error ? err.message : "API 同步失败",
    };
  }
  requestUpdate(state);
}

type ApiConnectionCloudVariableSyncResponse = {
  ok?: boolean;
  cloudVariableSync?: {
    status?: "blocked" | "failed" | "synced";
    message?: string;
  };
  readModel?: Record<string, unknown>;
};

export async function syncApiConnectionCloudVariables(
  state: AppViewState,
  id: string,
): Promise<void> {
  state.apiConnections = { ...state.apiConnections, saving: true, error: null, message: null };
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    const result = await state.client.request<ApiConnectionCloudVariableSyncResponse>(
      "aics.apiConnections.entry.syncCloudVariables",
      { id },
    );
    const status = result.cloudVariableSync?.status;
    const message = result.cloudVariableSync?.message ?? "云端变量同步状态已更新。";
    const cloudSyncIncomplete = result.ok === false || status === "blocked" || status === "failed";
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      readModel: result.readModel ?? state.apiConnections.readModel,
      error: null,
      message: cloudSyncIncomplete
        ? `云端变量同步未完成：${message}。本地版岗位创建和岗位执行不受影响；需要云端 SaaS/使用者中心时再处理云端桥接。`
        : message,
    };
  } catch (err) {
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      error: err instanceof Error ? err.message : "云端变量同步失败",
    };
  }
  requestUpdate(state);
}

export async function checkClosedLoopReadiness(state: AppViewState): Promise<void> {
  state.apiConnections = {
    ...state.apiConnections,
    saving: true,
    error: null,
    message: null,
    closedLoopReadiness: null,
  };
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    const result = await state.client.request<Record<string, unknown>>(
      "aics.closedLoop.readiness.get",
      { mode: "local" },
    );
    const checks = Array.isArray(result.checks)
      ? (result.checks as Array<Record<string, unknown>>)
      : [];
    const nextActions = Array.isArray(result.nextActions)
      ? (result.nextActions as Array<Record<string, unknown>>)
      : [];
    const blocked = checks.filter((item) => item.status === "blocked");
    const passed = checks.filter((item) => item.status === "pass");
    const firstNextAction = nextActions[0];
    const firstNextActionText =
      typeof firstNextAction?.action === "string" && firstNextAction.action.trim()
        ? firstNextAction.action.trim()
        : typeof firstNextAction?.message === "string" && firstNextAction.message.trim()
          ? firstNextAction.message.trim()
          : "";
    const context =
      result.context && typeof result.context === "object" && !Array.isArray(result.context)
        ? (result.context as Record<string, unknown>)
        : {};
    const artifactRefs = Array.isArray(context.artifactRefs)
      ? context.artifactRefs.filter(
          (item): item is string => typeof item === "string" && Boolean(item.trim()),
        )
      : [];
    const businessArtifactRefs = artifactRefs.filter(
      (item) => !item.startsWith("audit:") && !item.startsWith("ledger:"),
    );
    const modelUsage =
      context.modelUsage &&
      typeof context.modelUsage === "object" &&
      !Array.isArray(context.modelUsage)
        ? (context.modelUsage as Record<string, unknown>)
        : null;
    const hasModelUsage =
      Boolean(modelUsage) &&
      (typeof modelUsage?.totalTokens === "number" ||
        typeof modelUsage?.inputTokens === "number" ||
        typeof modelUsage?.outputTokens === "number" ||
        typeof modelUsage?.costCents === "number");
    const hasNoModelUsageReason =
      typeof context.modelUsageNotApplicableReason === "string" &&
      Boolean(context.modelUsageNotApplicableReason.trim());
    const hasModelEvidence = hasModelUsage || hasNoModelUsageReason;
    const completedWithEvidence =
      result.mode === "local" &&
      result.status === "ready" &&
      nextActions.length === 0 &&
      typeof context.executionId === "string" &&
      Boolean(context.executionId.trim()) &&
      typeof context.auditRecordId === "string" &&
      Boolean(context.auditRecordId.trim()) &&
      typeof context.ledgerRef === "string" &&
      Boolean(context.ledgerRef.trim()) &&
      businessArtifactRefs.length > 0 &&
      hasModelEvidence;
    const summary = blocked.length
      ? `闭环检查阻塞：${String(blocked[0]?.message ?? "存在未通过检查")}`
      : nextActions.length
        ? `闭环检查可继续：${passed.length} 项检查已通过。下一步：${firstNextActionText || "按明细完成下一步。"}`
        : completedWithEvidence
          ? `闭环检查已完成：执行结果、审计记录、账本记录、业务产物，以及模型费用证据或未调用模型说明均已读回。`
          : `闭环检查通过：${passed.length} 项检查已通过。`;
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      error: blocked.length ? summary : null,
      message: blocked.length ? null : summary,
      closedLoopReadiness: result,
    };
  } catch (err) {
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      error: err instanceof Error ? err.message : "闭环检查失败",
      closedLoopReadiness: null,
    };
  }
  requestUpdate(state);
}
