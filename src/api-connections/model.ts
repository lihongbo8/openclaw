import type {
  ApiConnectionConfigBinding,
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
    mode: "none" | "secret_ref" | "plaintext";
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
};

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

export function normalizeApiConnectionEntry(
  input: Partial<ApiConnectionEntry> & Pick<ApiConnectionEntry, "name" | "kind" | "provider">,
  previous?: ApiConnectionEntry,
): ApiConnectionEntry {
  const now = new Date().toISOString();
  const provider = input.provider.trim();
  const id = normalizeApiConnectionId(input.id ?? previous?.id ?? `${input.kind}-${provider}`);
  const secret =
    input.authMode === "none"
      ? undefined
      : (input.secret ?? previous?.secret ?? defaultSecretRefForProvider(provider));
  const authMode =
    input.authMode ??
    previous?.authMode ??
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

function secretSummary(secret: SecretInput | undefined, env: NodeJS.ProcessEnv) {
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
    const unresolved = secret.source === "env" && !env[secret.id];
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
): ApiConnectionRiskItem[] {
  const risks: ApiConnectionRiskItem[] = [];
  const secret = secretSummary(entry.secret, env);
  const consumers = normalizeList(entry.consumers);
  const consumerScope = consumers;
  const authRequiresSecret =
    (entry.authMode ?? "secret_ref") !== "none" && (entry.authMode ?? "secret_ref") !== "oauth";
  const marketplaceOrDispatch = consumers.includes("marketplace") || consumers.includes("dispatch");

  if (authRequiresSecret && secret.mode === "none") {
    risks.push({
      entryId: entry.id,
      code: "missing_secret_ref",
      severity: "blocking",
      message: "缺少 SecretRef，不能供给运行时消费者。",
      consumerScope,
    });
  }
  if (secret.status === "unresolved") {
    risks.push({
      entryId: entry.id,
      code: "unresolved_secret_ref",
      severity: "blocking",
      message: `SecretRef ${secret.source}:${secret.provider}:${secret.id} 当前无法解析。`,
      consumerScope,
    });
  }
  if (secret.mode === "plaintext") {
    risks.push({
      entryId: entry.id,
      code: marketplaceOrDispatch ? "high_risk_plaintext_secret" : "plaintext_secret",
      severity: marketplaceOrDispatch ? "blocking" : "warning",
      message: marketplaceOrDispatch
        ? "商城/调度能力绑定了明文密钥，必须改为 SecretRef。"
        : "API 使用本地明文密钥，建议迁移为 SecretRef。",
      consumerScope,
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
    (entry) => entry.enabled !== false && entry.consumers?.includes("marketplace"),
  );
  const hasDispatch = entries.some(
    (entry) => entry.enabled !== false && entry.consumers?.includes("dispatch"),
  );
  if (!hasMarketplace) {
    risks.push({
      entryId: "__marketplace__",
      code: "missing_marketplace_api",
      severity: "blocking",
      message: "商城供给 API 未配置，商城审核/授权消费者会被阻塞。",
      consumerScope: ["marketplace"],
    });
  }
  if (!hasDispatch) {
    risks.push({
      entryId: "__dispatch__",
      code: "missing_dispatch_api",
      severity: "blocking",
      message: "调度供给 API 未配置，任务调度/岗位执行消费者会被阻塞。",
      consumerScope: ["dispatch"],
    });
  }
  return risks;
}

export function createApiConnectionsReadModel(
  config: Pick<OpenClawConfig, "apiConnections">,
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
      const risks = risk(entry, env, duplicates);
      const blocked = risks.some((item) => item.severity === "blocking");
      const warning = risks.some((item) => item.severity === "warning");
      const bound = (entry.configBindings ?? []).length > 0;
      return {
        ...entry,
        secret: secretSummary(entry.secret, env),
        consumers: normalizeList(entry.consumers),
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
  };
}
