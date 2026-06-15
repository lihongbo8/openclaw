import type { AppViewState } from "../app-view-state.ts";

export type ApiConnectionKind = "model" | "tool_skill" | "marketplace" | "dialog" | "custom";
export type ApiConnectionConsumer =
  | "marketplace"
  | "dispatch"
  | "main_chat"
  | "tool"
  | "skill"
  | "voice"
  | "image"
  | "model";

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
  consumers: ApiConnectionConsumer[];
  bindingPath: string;
  smokeJson: string;
};

export type ApiConnectionsPageState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
  readModel: Record<string, unknown> | null;
  form: ApiConnectionFormState;
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
  requiresExternalSecret: boolean;
  visibleInApiManagement?: boolean;
};

export const API_CONNECTION_TEMPLATES: ApiConnectionTemplate[] = [
  {
    id: "cloud-marketplace",
    title: "云端商城 API",
    description: "本地开发默认连接云端商城，读取已授权岗位、申请 execution-token 并上传审计摘要。",
    category: "cloud_marketplace",
    kind: "marketplace",
    provider: "cloud-marketplace",
    consumers: ["marketplace", "dispatch"],
    bindingPath: "plugins.entries.aics.config.cloudAccessToken",
    baseUrl: "http://127.0.0.1:9000",
    requiresExternalSecret: true,
  },
  {
    id: "dijie-cloud-bridge",
    title: "迭界岗位商城云端桥",
    description: "正式连接岗位授权、已购岗位、执行 token、审计上传和费用回写。",
    category: "cloud_marketplace",
    kind: "marketplace",
    provider: "dijie-cloud-bridge",
    consumers: ["marketplace", "dispatch"],
    bindingPath: "plugins.entries.aics.config.cloudBaseUrl",
    baseUrl: "https://api.dijie.ai",
    requiresExternalSecret: true,
  },
  {
    id: "openclaw-local",
    title: "本地 OpenClaw 服务",
    description: "本地 Gateway、runtime、插件和本地能力路由健康状态。",
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
    description: "模型、多模态、图片和语音能力的 Provider。",
    category: "model_provider",
    kind: "model",
    provider: "openai",
    consumers: ["model"],
    bindingPath: "models.providers.openai.apiKey",
    baseUrl: "https://api.openai.com/v1",
    requiresExternalSecret: true,
  },
  {
    id: "anthropic",
    title: "Anthropic",
    description: "Claude 模型 Provider。",
    category: "model_provider",
    kind: "model",
    provider: "anthropic",
    consumers: ["model"],
    bindingPath: "models.providers.anthropic.apiKey",
    baseUrl: "https://api.anthropic.com",
    requiresExternalSecret: true,
  },
  {
    id: "gemini",
    title: "Google Gemini",
    description: "Gemini 模型 Provider。",
    category: "model_provider",
    kind: "model",
    provider: "gemini",
    consumers: ["model"],
    bindingPath: "models.providers.gemini.apiKey",
    baseUrl: "https://generativelanguage.googleapis.com",
    requiresExternalSecret: true,
  },
  {
    id: "deepseek",
    title: "DeepSeek",
    description: "DeepSeek Chat / Reasoner 模型 Provider。",
    category: "model_provider",
    kind: "model",
    provider: "deepseek",
    consumers: ["model"],
    bindingPath: "models.providers.deepseek.apiKey",
    baseUrl: "https://api.deepseek.com",
    requiresExternalSecret: true,
  },
  {
    id: "qwen-dashscope",
    title: "阿里百炼 / 通义千问",
    description: "阿里云百炼 DashScope / Qwen 模型 Provider。",
    category: "model_provider",
    kind: "model",
    provider: "qwen-dashscope",
    consumers: ["model"],
    bindingPath: "models.providers.qwen-dashscope.apiKey",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    requiresExternalSecret: true,
  },
  {
    id: "ollama",
    title: "Ollama / 本地模型",
    description: "本地模型服务，通常不需要外部密钥。",
    category: "model_provider",
    kind: "model",
    provider: "ollama",
    consumers: ["model"],
    bindingPath: "models.providers.ollama.baseUrl",
    baseUrl: "http://localhost:11434",
    connectionMode: "local",
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

function formFromTemplate(template: ApiConnectionTemplate): ApiConnectionFormState {
  return {
    templateId: template.id,
    connectionMode: template.connectionMode ?? "direct",
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
    consumers: [...template.consumers],
    bindingPath: template.bindingPath,
    smokeJson: "",
  };
}

export function createDefaultApiConnectionForm(): ApiConnectionFormState {
  return formFromTemplate(API_CONNECTION_TEMPLATES[0]!);
}

export function createDefaultApiConnectionsPageState(): ApiConnectionsPageState {
  return {
    loading: false,
    saving: false,
    error: null,
    message: null,
    readModel: null,
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

function defaultConsumersForKind(kind: ApiConnectionKind): ApiConnectionConsumer[] {
  switch (kind) {
    case "model":
      return ["model"];
    case "tool_skill":
      return ["tool", "skill"];
    case "marketplace":
      return ["marketplace", "dispatch"];
    case "dialog":
      return ["main_chat", "voice", "image"];
    default:
      return [];
  }
}

export function updateApiConnectionFormField(
  state: AppViewState,
  field: keyof ApiConnectionFormState,
  value: string | boolean | ApiConnectionConsumer[] | null,
): void {
  const current = state.apiConnections.form;
  if (field === "templateId") {
    const template = templateById(value as string);
    state.apiConnections = {
      ...state.apiConnections,
      error: null,
      message:
        template.connectionMode === "local"
          ? `已选择「${template.title}」，本地服务不需要填写 API Key。`
          : `已选择「${template.title}」，请粘贴真实 API Key 后点击连接。`,
      form: { ...formFromTemplate(template), editingId: current.editingId },
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
  if (provider === "cloud-marketplace" || consumers.includes("marketplace"))
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
  const bindings = Array.isArray(entry.configBindings)
    ? (entry.configBindings as Array<Record<string, unknown>>)
    : [];
  state.apiConnections = {
    ...state.apiConnections,
    error: null,
    message: "正在编辑已连接服务。",
    form: {
      templateId: templateIdForEntry(entry),
      connectionMode: secret.mode === "none" ? "local" : "env",
      editingId: id,
      advancedOpen: false,
      name: String(entry.name ?? ""),
      kind: String(entry.kind ?? "custom") as ApiConnectionKind,
      provider: String(entry.provider ?? ""),
      baseUrl: String(entry.baseUrl ?? entry.endpoint ?? ""),
      secretValue: "",
      secretEnvId: String(secret.id ?? ""),
      consumers: Array.isArray(entry.consumers) ? (entry.consumers as ApiConnectionConsumer[]) : [],
      bindingPath: String(bindings[0]?.path ?? ""),
      smokeJson: JSON.stringify(
        (entry.metadata as Record<string, unknown> | undefined)?.dijie ?? {},
        null,
        2,
      ),
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
  const parsed = JSON.parse(raw) as unknown;
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
  return {
    name: form.name,
    kind: form.kind,
    provider: form.provider,
    baseUrl: form.baseUrl || undefined,
    secret: form.connectionMode === "direct" ? form.secretValue : undefined,
    secretEnvId: form.connectionMode === "env" ? form.secretEnvId || undefined : undefined,
    authMode:
      form.connectionMode === "local"
        ? "none"
        : form.connectionMode === "direct"
          ? "plaintext"
          : undefined,
    consumers: form.consumers,
    bindingPath: form.bindingPath || undefined,
    metadata: parseDijieSmokeMetadata(form),
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
            source: "env",
            provider: "default",
            id: form.secretEnvId,
            status: "unresolved",
          }
        : { mode: "plaintext", status: "configured" };
  const risks =
    form.connectionMode === "direct"
      ? [
          {
            entryId: id,
            code: "plaintext_secret",
            severity: "warning",
            message: "API Key 已保存为本地明文配置；后续可切换为环境变量。",
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
          : "plaintext",
    consumers: form.consumers,
    requestedScope: [],
    configBindings,
    metadata: parseDijieSmokeMetadata(form),
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

function validateFormForSave(form: ApiConnectionFormState): string | null {
  if (!form.name.trim()) return "请选择服务。";
  if (!form.provider.trim()) return "缺少 Provider ID。";
  if (form.connectionMode === "direct" && !form.secretValue.trim()) {
    return "请粘贴真实 API Key，不能空保存。";
  }
  if (form.connectionMode === "env" && !form.secretEnvId.trim()) {
    return "请填写环境变量名，不能空保存。";
  }
  if (form.smokeJson.trim()) {
    try {
      if (!parseDijieSmokeMetadata(form)) {
        return "Smoke JSON 里没有可识别的 roleListingId、entitlementId、deviceId、workspaceRef 或 localGatewayId。";
      }
    } catch {
      return "Smoke JSON 不是有效 JSON。";
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
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      readModel:
        result.readModel ?? createOptimisticReadModel(state.apiConnections.readModel, form),
      message: form.editingId ? "连接已更新。" : "连接已保存。",
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
      message: "连接记录已删除；已同步到运行时配置的值不会被自动删除。",
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

export function testApiConnectionEntry(state: AppViewState, id: string): void {
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
          : "连接本地检查通过，可供系统使用。";
  state.apiConnections = {
    ...state.apiConnections,
    error: blocking || secret.status === "unresolved" || insecure ? message : null,
    message: blocking || secret.status === "unresolved" || insecure ? null : message,
  };
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
    const result = await state.client.request<{ readModel?: Record<string, unknown> }>(
      "aics.apiConnections.entry.materialize",
      id ? { id } : {},
    );
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      readModel: result.readModel ?? state.apiConnections.readModel,
      message: "API 已同步到运行时配置路径。",
    };
  } catch (err) {
    if (isGatewayServiceRestartError(err)) {
      state.apiConnections = {
        ...state.apiConnections,
        saving: false,
        error: null,
        message: "API 同步已提交，Gateway 正在重启；重连后会自动刷新。",
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

export async function checkClosedLoopReadiness(state: AppViewState): Promise<void> {
  state.apiConnections = { ...state.apiConnections, saving: true, error: null, message: null };
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    const result = await state.client.request<Record<string, unknown>>(
      "aics.closedLoop.readiness.get",
      {},
    );
    const checks = Array.isArray(result.checks)
      ? (result.checks as Array<Record<string, unknown>>)
      : [];
    const blocked = checks.filter((item) => item.status === "blocked");
    const passed = checks.filter((item) => item.status === "pass");
    const summary = blocked.length
      ? `闭环检查阻塞：${String(blocked[0]?.message ?? "存在未通过检查")}`
      : `闭环检查通过：${passed.length} 项检查已通过。`;
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      error: blocked.length ? summary : null,
      message: blocked.length ? null : summary,
    };
  } catch (err) {
    state.apiConnections = {
      ...state.apiConnections,
      saving: false,
      error: err instanceof Error ? err.message : "闭环检查失败",
    };
  }
  requestUpdate(state);
}
