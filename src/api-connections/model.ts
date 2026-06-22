import { API_CONNECTION_CONSUMER_SET } from "../config/api-connection-consumers.js";
import type {
  ApiConnectionConfigBinding,
  ApiConnectionConsumer,
  ApiConnectionEntry,
  ApiConnectionKind,
} from "../config/types.api-connections.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  DEFAULT_SECRET_PROVIDER_ALIAS,
  isSecretRef,
  type SecretInput,
} from "../config/types.secrets.js";

export type ApiConnectionRiskSeverity = "blocking" | "warning" | "info";

export type ApiConnectionRiskCode =
  | "missing_secret_ref"
  | "unresolved_secret_ref"
  | "plaintext_secret"
  | "high_risk_plaintext_secret"
  | "missing_consumer_scope"
  | "missing_marketplace_api"
  | "missing_dispatch_api"
  | "missing_model_provider"
  | "oauth_cloud_scope_not_exportable"
  | "non_https_base_url"
  | "unbound_config_path"
  | "duplicate_provider";

export type ApiConnectionRiskItem = {
  entryId: string;
  code: ApiConnectionRiskCode;
  severity: ApiConnectionRiskSeverity;
  message: string;
  consumerScope?: string[];
};

export type ApiConnectionReadModelEntry = Omit<ApiConnectionEntry, "secret"> & {
  secret: {
    mode: "none" | "secret_ref" | "plaintext" | "oauth";
    source?: string;
    provider?: string;
    id?: string;
    status: "missing" | "configured" | "unresolved";
  };
  status: "available" | "blocked" | "disabled" | "unbound";
  riskStatus: "ok" | "warning" | "blocked";
  risks: ApiConnectionRiskItem[];
};

export type ApiConnectionsReadModel = {
  entries: ApiConnectionReadModelEntry[];
  metrics: {
    configured: number;
    available: number;
    risky: number;
    unbound: number;
    blocked: number;
  };
  groups: Record<ApiConnectionKind, ApiConnectionReadModelEntry[]>;
  riskReport: {
    items: ApiConnectionRiskItem[];
    counts: Record<ApiConnectionRiskSeverity, number>;
  };
  billingAttribution: {
    byConsumer: Partial<Record<ApiConnectionConsumer, ApiConnectionBillingConsumerSummary>>;
    roleExecution: ApiConnectionRoleExecutionBillingSummary;
  };
};

export type ApiConnectionBillingConsumerSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCny: number;
  lastUsageRef?: string;
  lastUsageAt?: string;
  providerEntryIds: string[];
};

export type ApiConnectionRoleExecutionBillingSummary = ApiConnectionBillingConsumerSummary & {
  status: "blocked" | "ready" | "pending_sync" | "synced" | "unused";
  ledgerConsumer: "role_execution";
  cloudLedgerSync: {
    status: "not_configured" | "pending" | "synced";
    pendingUsageRefs: string[];
    message: string;
    cloudRef?: string;
    lastError?: string;
    updatedAt?: string;
  };
  requiredEvidenceFields: [
    "accountId",
    "billingAccountId",
    "roleListingId",
    "entitlementId",
    "executionId",
    "apiKey/provider/model",
    "consumer=role_execution",
    "ledgerRef/auditRecordId",
  ];
};

const MODEL_TOKEN_CONSUMERS = [
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
] as const satisfies readonly ApiConnectionConsumer[];

const MODEL_TOKEN_CONSUMER_SET = new Set<ApiConnectionConsumer>(MODEL_TOKEN_CONSUMERS);
const CLOUD_MODEL_CONSUMER_SET = new Set<ApiConnectionConsumer>([
  "buyer_storefront",
  "user_center",
  "developer_center",
]);
const MARKETPLACE_CONNECTION_CONSUMER_SET = new Set<ApiConnectionConsumer>([
  "marketplace",
  "operations_backend",
  "buyer_storefront",
  "user_center",
  "developer_center",
  "role_execution",
]);

function normalizeConsumersForKind(
  kind: ApiConnectionKind,
  consumers: readonly ApiConnectionConsumer[] | undefined,
): ApiConnectionConsumer[] {
  const normalized = normalizeList(consumers);
  if (kind === "model") {
    return normalized.filter((consumer) => MODEL_TOKEN_CONSUMER_SET.has(consumer));
  }
  if (kind === "marketplace") {
    return normalized.filter((consumer) => MARKETPLACE_CONNECTION_CONSUMER_SET.has(consumer));
  }
  if (kind === "tool_skill") {
    return normalized.filter((consumer) => consumer === "tool" || consumer === "skill");
  }
  return normalized;
}

export function normalizeApiConnectionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function defaultSecretRefForProvider(provider: string): SecretInput {
  const id =
    provider
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "API";
  return {
    source: "env",
    provider: DEFAULT_SECRET_PROVIDER_ALIAS,
    id: `${id}_API_KEY`,
  };
}

function normalizeList<T extends string>(items: readonly T[] | undefined): T[] {
  return Array.from(new Set((items ?? []).map((item) => item.trim()).filter(Boolean) as T[]));
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

export function normalizeApiConnectionEntry(
  input: Partial<ApiConnectionEntry> & Pick<ApiConnectionEntry, "name" | "kind" | "provider">,
  previous?: ApiConnectionEntry,
): ApiConnectionEntry {
  const now = new Date().toISOString();
  const provider = input.provider.trim();
  const id = normalizeApiConnectionId(input.id ?? previous?.id ?? `${input.kind}-${provider}`);
  const requestedAuthMode = input.authMode ?? previous?.authMode;
  const secret =
    requestedAuthMode === "none" || requestedAuthMode === "oauth"
      ? undefined
      : (input.secret ?? previous?.secret ?? defaultSecretRefForProvider(provider));
  const authMode =
    requestedAuthMode ??
    (typeof secret === "string" ? "plaintext" : secret ? "secret_ref" : "none");

  return {
    ...previous,
    ...input,
    id,
    name: input.name.trim(),
    kind: input.kind,
    provider,
    authMode,
    secret,
    consumers: normalizeList(input.consumers ?? previous?.consumers),
    requestedScope: normalizeList(input.requestedScope ?? previous?.requestedScope),
    configBindings: dedupeBindings(input.configBindings ?? previous?.configBindings),
    enabled: input.enabled ?? previous?.enabled ?? true,
    createdAt: previous?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
}

export function dedupeBindings(
  bindings: readonly ApiConnectionConfigBinding[] | undefined,
): ApiConnectionConfigBinding[] {
  const seen = new Set<string>();
  const next: ApiConnectionConfigBinding[] = [];
  for (const binding of bindings ?? []) {
    const path = binding.path.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    next.push({ ...binding, path });
  }
  return next;
}

function secretSummary(
  secret: SecretInput | undefined,
  env: NodeJS.ProcessEnv,
  authMode?: ApiConnectionEntry["authMode"],
  config?: Pick<OpenClawConfig, "secrets">,
) {
  if (authMode === "oauth") {
    return { mode: "oauth" as const, status: "configured" as const };
  }
  if (!secret) {
    return { mode: "none" as const, status: "missing" as const };
  }
  if (typeof secret === "string") {
    return {
      mode: "plaintext" as const,
      status: secret.trim() ? ("configured" as const) : ("missing" as const),
    };
  }
  if (isSecretRef(secret)) {
    const unresolved =
      (secret.source === "env" && !env[secret.id]) ||
      (secret.source === "file" && !config?.secrets?.providers?.[secret.provider]);
    return {
      mode: "secret_ref" as const,
      source: secret.source,
      provider: secret.provider,
      id: secret.id,
      status: unresolved ? ("unresolved" as const) : ("configured" as const),
    };
  }
  return { mode: "none" as const, status: "missing" as const };
}

function risk(
  entry: ApiConnectionEntry,
  env: NodeJS.ProcessEnv,
  duplicates: Set<string>,
  config?: Pick<OpenClawConfig, "secrets">,
): ApiConnectionRiskItem[] {
  const risks: ApiConnectionRiskItem[] = [];
  const secret = secretSummary(entry.secret, env, entry.authMode, config);
  const consumers = normalizeConsumersForKind(entry.kind, entry.consumers);
  const consumerScope = consumers;
  const authRequiresSecret =
    (entry.authMode ?? "secret_ref") !== "none" && (entry.authMode ?? "secret_ref") !== "oauth";
  const marketplaceOrDispatch =
    entry.kind === "marketplace" || entry.kind === "tool_skill" || consumers.includes("dispatch");

  if (authRequiresSecret && secret.mode === "none") {
    risks.push({
      entryId: entry.id,
      code: "missing_secret_ref",
      severity: "blocking",
      message:
        entry.kind === "model"
          ? "缺少 API Key，不能供给模型 Token 使用场景。"
          : "缺少 SecretRef，不能供给运行时消费者。",
      consumerScope,
    });
  }
  if (authRequiresSecret && secret.status === "unresolved") {
    risks.push({
      entryId: entry.id,
      code: "unresolved_secret_ref",
      severity: "blocking",
      message: `SecretRef ${secret.source}:${secret.provider}:${secret.id} 当前无法解析。`,
      consumerScope,
    });
  }
  if (secret.mode === "plaintext" && (marketplaceOrDispatch || entry.kind !== "model")) {
    risks.push({
      entryId: entry.id,
      code: marketplaceOrDispatch ? "high_risk_plaintext_secret" : "plaintext_secret",
      severity: marketplaceOrDispatch ? "blocking" : "warning",
      message: marketplaceOrDispatch
        ? "迭界AI云端、调度能力或工具服务 Token 请改用本地安全保存，由本页统一管理并同步到目标端。"
        : "API Key 已保存为本地 SecretRef。",
      consumerScope,
    });
  }
  const cloudConsumers = consumers.filter((consumer) => CLOUD_MODEL_CONSUMER_SET.has(consumer));
  if (entry.kind === "model" && entry.authMode === "oauth" && cloudConsumers.length > 0) {
    risks.push({
      entryId: entry.id,
      code: "oauth_cloud_scope_not_exportable",
      severity: "warning",
      message:
        "OAuth 模型授权只能在本地端使用；云端商城/使用者中心/开发者中心需要迭界AI云端自己的 OAuth 或服务授权。",
      consumerScope: cloudConsumers,
    });
  }
  if (consumers.length === 0) {
    risks.push({
      entryId: entry.id,
      code: "missing_consumer_scope",
      severity: "blocking",
      message: "API 没有明确供给对象或 scope。",
      consumerScope,
    });
  }
  if ((entry.baseUrl ?? entry.endpoint ?? "").trim().startsWith("http://")) {
    risks.push({
      entryId: entry.id,
      code: "non_https_base_url",
      severity: "warning",
      message: "baseUrl 不是 HTTPS。",
      consumerScope,
    });
  }
  if ((entry.configBindings ?? []).length === 0) {
    risks.push({
      entryId: entry.id,
      code: "unbound_config_path",
      severity: "warning",
      message: "API 还没有绑定到 OpenClaw 运行时配置路径。",
      consumerScope,
    });
  }
  if (duplicates.has(`${entry.kind}:${entry.provider.toLowerCase()}`)) {
    risks.push({
      entryId: entry.id,
      code: "duplicate_provider",
      severity: "warning",
      message: "同一类型下存在重复 provider。",
      consumerScope,
    });
  }
  return risks;
}

function globalRisk(entries: ApiConnectionEntry[]): ApiConnectionRiskItem[] {
  const risks: ApiConnectionRiskItem[] = [];
  const hasMarketplace = entries.some(
    (entry) =>
      entry.enabled !== false &&
      entry.kind === "marketplace" &&
      normalizeConsumersForKind(entry.kind, entry.consumers).includes("marketplace"),
  );
  const modelProviderScopes = new Set(
    entries
      .filter((entry) => entry.enabled !== false && entry.kind === "model")
      .flatMap((entry) => normalizeConsumersForKind(entry.kind, entry.consumers)),
  );
  const missingModelScopes = MODEL_TOKEN_CONSUMERS.filter(
    (consumer) => !modelProviderScopes.has(consumer),
  );
  if (!hasMarketplace) {
    risks.push({
      entryId: "__marketplace__",
      code: "missing_marketplace_api",
      severity: "blocking",
      message:
        "迭界AI云端未配置，授权读取、已购岗位、execution-token、审计上传和 ledger 回写会被阻塞。",
      consumerScope: ["marketplace"],
    });
  }
  if (missingModelScopes.length === MODEL_TOKEN_CONSUMERS.length) {
    risks.push({
      entryId: "__model_token__",
      code: "missing_model_provider",
      severity: "blocking",
      message:
        "模型 Provider 未配置，本地主对话、经营后台、BuildSession、云端商城对话和岗位执行无法消耗模型 Token。",
      consumerScope: [...MODEL_TOKEN_CONSUMERS],
    });
  } else if (missingModelScopes.length > 0) {
    risks.push({
      entryId: "__model_token_scope__",
      code: "missing_model_provider",
      severity: "warning",
      message: `部分模型 Token 场景未绑定 Provider：${missingModelScopes.join(", ")}。`,
      consumerScope: missingModelScopes,
    });
  }
  return risks;
}

function emptyConsumerBilling(
  providerEntryIds: string[] = [],
): ApiConnectionBillingConsumerSummary {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costCny: 0,
    providerEntryIds,
  };
}

function addConsumerBilling(
  current: ApiConnectionBillingConsumerSummary | undefined,
  entryId: string,
  source: Record<string, unknown>,
): ApiConnectionBillingConsumerSummary {
  const providerEntryIds = new Set([...(current?.providerEntryIds ?? []), entryId]);
  const lastUsageAt = stringField(source, "lastUsageAt") ?? current?.lastUsageAt;
  const lastUsageRef = stringField(source, "lastUsageRef") ?? current?.lastUsageRef;
  return {
    calls: (current?.calls ?? 0) + finiteNumber(source.calls),
    inputTokens: (current?.inputTokens ?? 0) + finiteNumber(source.inputTokens),
    outputTokens: (current?.outputTokens ?? 0) + finiteNumber(source.outputTokens),
    totalTokens: (current?.totalTokens ?? 0) + finiteNumber(source.totalTokens),
    costCny: (current?.costCny ?? 0) + finiteNumber(source.costCny ?? source.cost),
    ...(lastUsageRef ? { lastUsageRef } : {}),
    ...(lastUsageAt ? { lastUsageAt } : {}),
    providerEntryIds: Array.from(providerEntryIds).sort(),
  };
}

function cloudLedgerSyncSummary(entries: ApiConnectionEntry[]) {
  const syncRecords = entries
    .map((entry) => readRecord(readRecord(readRecord(entry.metadata).metering).cloudLedgerSync))
    .filter((record) => Object.keys(record).length > 0);
  const pendingUsageRefs = Array.from(
    new Set(syncRecords.flatMap((record) => stringArray(record.pendingUsageRefs))),
  ).slice(-200);
  const latest = syncRecords.at(-1);
  const latestRecord = latest ?? {};
  const latestStatus = stringField(latestRecord, "status");
  if (latestStatus === "synced" && pendingUsageRefs.length === 0) {
    return {
      status: "synced" as const,
      pendingUsageRefs,
      message: stringField(latestRecord, "message") ?? "岗位执行费用已同步到云端账本。",
      ...(stringField(latestRecord, "cloudRef")
        ? { cloudRef: stringField(latestRecord, "cloudRef") }
        : {}),
      ...(stringField(latestRecord, "updatedAt")
        ? { updatedAt: stringField(latestRecord, "updatedAt") }
        : {}),
    };
  }
  if (syncRecords.length > 0 || pendingUsageRefs.length > 0) {
    return {
      status: "pending" as const,
      pendingUsageRefs,
      message:
        stringField(latestRecord, "message") ??
        "岗位执行费用已在本地记录，等待同步到迭界AI云端账本。",
      ...(stringField(latestRecord, "lastError")
        ? { lastError: stringField(latestRecord, "lastError") }
        : {}),
      ...(stringField(latestRecord, "updatedAt")
        ? { updatedAt: stringField(latestRecord, "updatedAt") }
        : {}),
    };
  }
  return {
    status: "not_configured" as const,
    pendingUsageRefs,
    message: "尚未产生岗位执行费用，或云端账本同步尚未配置。",
  };
}

function createBillingAttributionSummary(
  entries: ApiConnectionEntry[],
): ApiConnectionsReadModel["billingAttribution"] {
  const byConsumer: Partial<Record<ApiConnectionConsumer, ApiConnectionBillingConsumerSummary>> =
    {};
  const modelEntries = entries.filter((entry) => entry.enabled !== false && entry.kind === "model");
  for (const entry of modelEntries) {
    const byConsumerRecord = readRecord(readRecord(readRecord(entry.metadata).metering).byConsumer);
    for (const [consumer, value] of Object.entries(byConsumerRecord)) {
      if (!API_CONNECTION_CONSUMER_SET.has(consumer as ApiConnectionConsumer)) continue;
      byConsumer[consumer as ApiConnectionConsumer] = addConsumerBilling(
        byConsumer[consumer as ApiConnectionConsumer],
        entry.id,
        readRecord(value),
      );
    }
  }

  const roleExecution =
    byConsumer.role_execution ??
    emptyConsumerBilling(
      modelEntries
        .filter((entry) =>
          normalizeConsumersForKind(entry.kind, entry.consumers).includes("role_execution"),
        )
        .map((entry) => entry.id),
    );
  const hasRoleProvider = roleExecution.providerEntryIds.length > 0;
  const cloudLedgerSync = cloudLedgerSyncSummary(modelEntries);
  const status: ApiConnectionRoleExecutionBillingSummary["status"] = !hasRoleProvider
    ? "blocked"
    : roleExecution.calls === 0
      ? "unused"
      : cloudLedgerSync.status === "synced"
        ? "synced"
        : cloudLedgerSync.status === "pending"
          ? "pending_sync"
          : "ready";

  return {
    byConsumer,
    roleExecution: {
      ...roleExecution,
      status,
      ledgerConsumer: "role_execution",
      cloudLedgerSync,
      requiredEvidenceFields: [
        "accountId",
        "billingAccountId",
        "roleListingId",
        "entitlementId",
        "executionId",
        "apiKey/provider/model",
        "consumer=role_execution",
        "ledgerRef/auditRecordId",
      ],
    },
  };
}

export function createApiConnectionsReadModel(
  config: Pick<OpenClawConfig, "apiConnections" | "secrets">,
  env: NodeJS.ProcessEnv = process.env,
): ApiConnectionsReadModel {
  const entries = Object.values(config.apiConnections?.entries ?? {});
  const providerCounts = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.provider.toLowerCase()}`;
    providerCounts.set(key, (providerCounts.get(key) ?? 0) + 1);
  }
  const duplicates = new Set(
    [...providerCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
  );

  const readEntries = entries
    .map((entry): ApiConnectionReadModelEntry => {
      const risks = risk(entry, env, duplicates, config);
      const blocked = risks.some((item) => item.severity === "blocking");
      const warning = risks.some((item) => item.severity === "warning");
      const bound = (entry.configBindings ?? []).length > 0;
      return {
        ...entry,
        secret: secretSummary(entry.secret, env, entry.authMode, config),
        consumers: normalizeConsumersForKind(entry.kind, entry.consumers),
        requestedScope: normalizeList(entry.requestedScope),
        configBindings: dedupeBindings(entry.configBindings),
        status:
          entry.enabled === false
            ? "disabled"
            : blocked
              ? "blocked"
              : bound
                ? "available"
                : "unbound",
        riskStatus: blocked ? "blocked" : warning ? "warning" : "ok",
        risks,
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const riskItems = [...readEntries.flatMap((entry) => entry.risks), ...globalRisk(entries)];
  const groups: ApiConnectionsReadModel["groups"] = {
    model: [],
    tool_skill: [],
    marketplace: [],
    dialog: [],
    custom: [],
  };
  for (const entry of readEntries) {
    groups[entry.kind].push(entry);
  }
  return {
    entries: readEntries,
    metrics: {
      configured: readEntries.length,
      available: readEntries.filter((entry) => entry.status === "available").length,
      risky: readEntries.filter((entry) => entry.riskStatus !== "ok").length,
      unbound: readEntries.filter((entry) => entry.status === "unbound").length,
      blocked: readEntries.filter((entry) => entry.status === "blocked").length,
    },
    groups,
    riskReport: {
      items: riskItems,
      counts: {
        blocking: riskItems.filter((item) => item.severity === "blocking").length,
        warning: riskItems.filter((item) => item.severity === "warning").length,
        info: riskItems.filter((item) => item.severity === "info").length,
      },
    },
    billingAttribution: createBillingAttributionSummary(entries),
  };
}
