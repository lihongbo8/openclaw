import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  bindApiConnectionConfigPath,
  materializeApiConnectionToConfig,
  unmaterializeApiConnectionFromConfig,
} from "../../api-connections/materializer.js";
import {
  createApiConnectionsReadModel,
  normalizeApiConnectionEntry,
} from "../../api-connections/model.js";
import { API_CONNECTION_CONSUMER_SET } from "../../config/api-connection-consumers.js";
import {
  readConfigFileSnapshotForWrite,
  validateConfigObjectWithPlugins,
} from "../../config/config.js";
import type {
  ApiConnectionConsumer,
  ApiConnectionEntry,
  ApiConnectionKind,
} from "../../config/types.api-connections.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { isSecretRef, type SecretInput } from "../../config/types.secrets.js";
import { recordModelUsageToApiMetering } from "./aics-api-metering.js";
import { commitGatewayConfigWrite } from "./config-write-flow.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";

const API_CONNECTION_KINDS = new Set<ApiConnectionKind>([
  "model",
  "tool_skill",
  "marketplace",
  "dialog",
  "custom",
]);

const MODEL_PROVIDER_BASE_URL_DEFAULTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com",
  google: "https://generativelanguage.googleapis.com",
  ollama: "http://localhost:11434",
  openai: "https://api.openai.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "qwen-dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
};

const CLOUD_MODEL_CONSUMERS = new Set<ApiConnectionConsumer>([
  "buyer_storefront",
  "user_center",
  "developer_center",
]);

const API_CONNECTIONS_SECRET_PROVIDER = "api-connections";
const API_CONNECTIONS_SECRET_FILE_RELATIVE_PATH = ["secrets", "api-connections.json"];

type CloudVariableSyncStatus = "blocked" | "failed" | "synced";

type CloudVariableSyncResult = {
  status: CloudVariableSyncStatus;
  target: "dijie_ai_cloud";
  variableName: string;
  consumers: ApiConnectionConsumer[];
  updatedAt: string;
  message: string;
  cloudRef?: string;
  httpStatus?: number;
  lastError?: string;
};

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key);
  if (!value) throw new Error(`missing required string param: ${key}`);
  return value;
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function kindParam(params: Record<string, unknown>): ApiConnectionKind {
  const value = stringParam(params, "kind");
  if (!value || !API_CONNECTION_KINDS.has(value as ApiConnectionKind)) {
    throw new Error("missing or invalid API connection kind");
  }
  return value as ApiConnectionKind;
}

function consumersParam(params: Record<string, unknown>): ApiConnectionConsumer[] {
  const value = params.consumers;
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (entry): entry is ApiConnectionConsumer =>
          typeof entry === "string" &&
          API_CONNECTION_CONSUMER_SET.has(entry as ApiConnectionConsumer),
      ),
    ),
  );
}

function consumerParam(params: Record<string, unknown>): ApiConnectionConsumer {
  const value = stringParam(params, "consumer");
  if (!value || !API_CONNECTION_CONSUMER_SET.has(value as ApiConnectionConsumer)) {
    throw new Error("missing or invalid API usage consumer");
  }
  return value as ApiConnectionConsumer;
}

function modelUsageParam(params: Record<string, unknown>): Record<string, unknown> {
  const nested =
    params.modelUsage && typeof params.modelUsage === "object" && !Array.isArray(params.modelUsage)
      ? (params.modelUsage as Record<string, unknown>)
      : {};
  return {
    ...nested,
    ...(params.provider !== undefined ? { provider: params.provider } : {}),
    ...(params.model !== undefined ? { model: params.model } : {}),
    ...(params.inputTokens !== undefined ? { inputTokens: params.inputTokens } : {}),
    ...(params.outputTokens !== undefined ? { outputTokens: params.outputTokens } : {}),
    ...(params.totalTokens !== undefined ? { totalTokens: params.totalTokens } : {}),
    ...(params.costCents !== undefined ? { costCents: params.costCents } : {}),
  };
}

function roleExecutionBillingAttributionParam(params: Record<string, unknown>) {
  const nested =
    params.attribution &&
    typeof params.attribution === "object" &&
    !Array.isArray(params.attribution)
      ? (params.attribution as Record<string, unknown>)
      : {};
  const field = (key: string) => stringParam(nested, key) ?? stringParam(params, key);
  const attribution: Record<string, string> = {};
  for (const key of [
    "accountId",
    "billingAccountId",
    "roleListingId",
    "entitlementId",
    "executionId",
    "packageId",
    "developerRef",
    "ledgerRef",
    "auditRecordId",
  ]) {
    const value = field(key);
    if (value) attribution[key] = value;
  }
  return Object.keys(attribution).length ? attribution : undefined;
}

function validateModelUsageTokens(modelUsage: Record<string, unknown>): void {
  const inputTokens = finiteNumber(modelUsage.inputTokens);
  const outputTokens = finiteNumber(modelUsage.outputTokens);
  const totalTokens = finiteNumber(modelUsage.totalTokens) || inputTokens + outputTokens;
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    throw new Error("model usage must include inputTokens, outputTokens, or totalTokens");
  }
}

function requestedScopeParam(params: Record<string, unknown>): string[] {
  const value = params.requestedScope;
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter(
            (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
          ),
        ),
      )
    : [];
}

function secretParam(params: Record<string, unknown>): SecretInput | undefined {
  const value = params.secret;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      (record.source === "env" || record.source === "file" || record.source === "exec") &&
      typeof record.provider === "string" &&
      typeof record.id === "string"
    ) {
      return { source: record.source, provider: record.provider, id: record.id };
    }
  }
  const envId = stringParam(params, "secretEnvId");
  if (envId) {
    return { source: "env", provider: "default", id: envId };
  }
  return undefined;
}

function bindingsParam(params: Record<string, unknown>) {
  const bindingPath = stringParam(params, "bindingPath") ?? stringParam(params, "configPath");
  const raw = params.configBindings;
  const bindings = Array.isArray(raw)
    ? raw.flatMap((entry) => {
        if (typeof entry === "string" && entry.trim())
          return [{ path: entry.trim(), owner: "apiConnections" as const }];
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const path = stringParam(entry as Record<string, unknown>, "path");
          return path ? [{ path, owner: "apiConnections" as const }] : [];
        }
        return [];
      })
    : [];
  return bindingPath
    ? [...bindings, { path: bindingPath, owner: "apiConnections" as const }]
    : bindings;
}

function metadataParam(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = params.metadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function managedSecretValueParam(params: Record<string, unknown>): string | undefined {
  const value = stringParam(params, "managedSecretValue");
  return value;
}

function secretFilePathForConfig(configPath: string): string {
  return path.join(path.dirname(configPath), ...API_CONNECTIONS_SECRET_FILE_RELATIVE_PATH);
}

function jsonPointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function managedSecretRefForEntry(entryId: string): SecretInput {
  return {
    source: "file",
    provider: API_CONNECTIONS_SECRET_PROVIDER,
    id: `/entries/${jsonPointerSegment(entryId)}/secret`,
  };
}

async function readManagedSecretsFile(secretPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(secretPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeManagedApiConnectionSecret(params: {
  configPath: string;
  entryId: string;
  secretValue: string;
}): Promise<string> {
  const secretPath = secretFilePathForConfig(params.configPath);
  const secretDir = path.dirname(secretPath);
  await fs.mkdir(secretDir, { recursive: true, mode: 0o700 });
  await fs.chmod(secretDir, 0o700).catch(() => {});
  const current = await readManagedSecretsFile(secretPath);
  const entries =
    current.entries && typeof current.entries === "object" && !Array.isArray(current.entries)
      ? { ...(current.entries as Record<string, unknown>) }
      : {};
  entries[params.entryId] = {
    ...(entries[params.entryId] && typeof entries[params.entryId] === "object"
      ? (entries[params.entryId] as Record<string, unknown>)
      : {}),
    secret: params.secretValue,
    updatedAt: new Date().toISOString(),
  };
  const next = { ...current, version: 1, entries };
  await fs.writeFile(secretPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(secretPath, 0o600).catch(() => {});
  return secretPath;
}

async function deleteManagedApiConnectionSecret(params: {
  configPath: string;
  entryId: string;
}): Promise<boolean> {
  const secretPath = secretFilePathForConfig(params.configPath);
  const current = await readManagedSecretsFile(secretPath);
  const entries =
    current.entries && typeof current.entries === "object" && !Array.isArray(current.entries)
      ? { ...(current.entries as Record<string, unknown>) }
      : {};
  if (!Object.prototype.hasOwnProperty.call(entries, params.entryId)) return false;
  delete entries[params.entryId];
  const next = { ...current, version: 1, entries };
  await fs.writeFile(secretPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(secretPath, 0o600).catch(() => {});
  return true;
}

function ensureManagedSecretProvider(config: OpenClawConfig, configPath: string): OpenClawConfig {
  const secretPath = secretFilePathForConfig(configPath);
  return {
    ...config,
    secrets: {
      ...(config.secrets ?? {}),
      providers: {
        ...(config.secrets?.providers ?? {}),
        [API_CONNECTIONS_SECRET_PROVIDER]: {
          source: "file",
          path: secretPath,
          mode: "json",
        },
      },
    },
  };
}

async function applyManagedSecretValue(params: {
  configPath: string;
  config: OpenClawConfig;
  entry: ApiConnectionEntry;
  managedSecretValue?: string;
}): Promise<{ config: OpenClawConfig; entry: ApiConnectionEntry; changedPaths: string[] }> {
  if (!params.managedSecretValue) {
    return { config: params.config, entry: params.entry, changedPaths: [] };
  }
  const secretPath = await writeManagedApiConnectionSecret({
    configPath: params.configPath,
    entryId: params.entry.id,
    secretValue: params.managedSecretValue,
  });
  const nextConfig = ensureManagedSecretProvider(params.config, params.configPath);
  return {
    config: nextConfig,
    entry: {
      ...params.entry,
      authMode: "secret_ref",
      secret: managedSecretRefForEntry(params.entry.id),
      metadata: {
        ...(params.entry.metadata ?? {}),
        managedSecret: {
          provider: API_CONNECTIONS_SECRET_PROVIDER,
          path: secretPath,
          updatedAt: new Date().toISOString(),
        },
      },
    },
    changedPaths: [
      `apiConnections.entries.${params.entry.id}.secret`,
      `secrets.providers.${API_CONNECTIONS_SECRET_PROVIDER}`,
    ],
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimUnknownString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveSecretValue(value: unknown): string | undefined {
  const direct = trimUnknownString(value);
  if (direct) return direct;
  if (isSecretRef(value) && value.source === "env") {
    return process.env[value.id]?.trim() || undefined;
  }
  return undefined;
}

function readJsonPointerValue(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  const parts = pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cursor = root;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

async function resolveSecretValueFromConfig(
  value: unknown,
  config: OpenClawConfig,
): Promise<string | undefined> {
  const direct = resolveSecretValue(value);
  if (direct) return direct;
  if (!isSecretRef(value) || value.source !== "file") return undefined;
  const provider = config.secrets?.providers?.[value.provider];
  if (!provider || provider.source !== "file") return undefined;
  try {
    const raw = await fs.readFile(provider.path, "utf8");
    const payload =
      provider.mode === "singleValue" ? raw.replace(/\r?\n$/, "") : (JSON.parse(raw) as unknown);
    const resolved =
      provider.mode === "singleValue" ? payload : readJsonPointerValue(payload, value.id);
    return typeof resolved === "string" && resolved.trim() ? resolved.trim() : undefined;
  } catch {
    return undefined;
  }
}

function defaultCloudVariableName(entry: ApiConnectionEntry): string {
  return `${entry.provider
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}_API_KEY`;
}

function cloudModelConsumers(entry: ApiConnectionEntry): ApiConnectionConsumer[] {
  return (entry.consumers ?? []).filter((consumer) => CLOUD_MODEL_CONSUMERS.has(consumer));
}

function apiConnectionMetadata(entry: ApiConnectionEntry | undefined): Record<string, unknown> {
  return recordValue(entry?.metadata);
}

export async function resolveAicsCloudConnectionFromApiConnections(
  config: OpenClawConfig,
): Promise<{ cloudBaseUrl?: string; cloudAccessToken?: string }> {
  const entries = Object.values(config.apiConnections?.entries ?? {})
    .filter(
      (entry) =>
        entry.enabled !== false &&
        entry.kind === "marketplace" &&
        (entry.provider === "dijie-cloud-bridge" || entry.provider === "cloud-marketplace"),
    )
    .sort((left, right) => {
      if (left.provider === right.provider) return 0;
      return left.provider === "dijie-cloud-bridge" ? -1 : 1;
    });
  for (const entry of entries) {
    const cloudBaseUrl = trimUnknownString(entry.baseUrl ?? entry.endpoint);
    const cloudAccessToken = await resolveSecretValueFromConfig(entry.secret, config);
    if (cloudBaseUrl && cloudAccessToken) {
      return { cloudBaseUrl, cloudAccessToken };
    }
  }
  return {};
}

async function resolveAicsCloudSyncConfig(config: OpenClawConfig): Promise<{
  cloudBaseUrl?: string;
  cloudApiVariablesSyncBearer?: string;
  syncPath: string;
}> {
  const pluginConfig = recordValue(config.plugins?.entries?.aics?.config);
  const apiConnectionConfig = await resolveAicsCloudConnectionFromApiConnections(config);
  return {
    cloudBaseUrl: apiConnectionConfig.cloudBaseUrl ?? trimUnknownString(pluginConfig.cloudBaseUrl),
    cloudApiVariablesSyncBearer:
      (await resolveSecretValueFromConfig(pluginConfig.cloudApiVariablesSyncBearer, config)) ??
      process.env.DIJIE_INTERNAL_BRIDGE_BEARER?.trim(),
    syncPath:
      trimUnknownString(pluginConfig.cloudApiVariablesSyncPath) ?? "/dijie/api-variables/sync",
  };
}

function buildCloudVariableSyncResult(params: {
  entry: ApiConnectionEntry;
  status: CloudVariableSyncStatus;
  message: string;
  httpStatus?: number;
  lastError?: string;
  cloudRef?: string;
}): CloudVariableSyncResult {
  const metadata = apiConnectionMetadata(params.entry);
  const variableName =
    trimUnknownString(metadata.cloudVariableName) ?? defaultCloudVariableName(params.entry);
  return {
    status: params.status,
    target: "dijie_ai_cloud",
    variableName,
    consumers: cloudModelConsumers(params.entry),
    updatedAt: new Date().toISOString(),
    message: params.message,
    ...(params.httpStatus !== undefined ? { httpStatus: params.httpStatus } : {}),
    ...(params.lastError ? { lastError: params.lastError } : {}),
    ...(params.cloudRef ? { cloudRef: params.cloudRef } : {}),
  };
}

function errorMessageForCloudVariableSync(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "迭界AI云端变量同步超时：请检查云端地址、网络和迭界AI云端服务是否可访问。";
  }
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? recordValue(error.cause) : {};
  const code = String(cause.code ?? recordValue(error).code ?? "");
  if (/ENOTFOUND|EAI_AGAIN/i.test(code) || /fetch failed/i.test(message)) {
    return "迭界AI云端不可达：请检查云端地址、DNS/网络和迭界AI云端服务 Token 后再同步。";
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR|ENETUNREACH|EHOSTUNREACH/i.test(code)) {
    return "迭界AI云端连接失败：请检查网络、云端服务状态和 Base URL 后再同步。";
  }
  return "迭界AI云端变量同步失败：请检查云端服务 Token、Base URL 和服务端日志。";
}

function errorDetailForCloudVariableSync(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? recordValue(error.cause) : {};
  const code = trimUnknownString(cause.code ?? recordValue(error).code);
  return code ? `${message} (${code})` : message;
}

function withCloudVariableSyncMetadata(
  entry: ApiConnectionEntry,
  sync: CloudVariableSyncResult,
): ApiConnectionEntry {
  return {
    ...entry,
    metadata: {
      ...(entry.metadata ?? {}),
      cloudVariableName: sync.variableName,
      cloudVariableSync: sync,
    },
    updatedAt: new Date().toISOString(),
  };
}

async function syncModelApiConnectionToDijieCloud(params: {
  config: OpenClawConfig;
  entry: ApiConnectionEntry;
}): Promise<{ ok: boolean; sync: CloudVariableSyncResult }> {
  const { config, entry } = params;
  if (entry.kind !== "model") {
    const sync = buildCloudVariableSyncResult({
      entry,
      status: "blocked",
      message: "只有模型 Provider 需要同步到迭界AI云端变量池。",
    });
    return { ok: false, sync };
  }
  const cloudConsumers = cloudModelConsumers(entry);
  if (cloudConsumers.length === 0) {
    const sync = buildCloudVariableSyncResult({
      entry,
      status: "blocked",
      message: "这个模型 Provider 只供给本地场景，不需要同步到迭界AI云端。",
    });
    return { ok: false, sync };
  }
  if (entry.authMode === "oauth") {
    const sync = buildCloudVariableSyncResult({
      entry,
      status: "blocked",
      message:
        "OAuth 模型授权不能导出 API Key；云端如需使用这个 Provider，请在迭界AI云端完成 OAuth/服务授权。",
    });
    return { ok: false, sync };
  }
  const { cloudBaseUrl, cloudApiVariablesSyncBearer, syncPath } =
    await resolveAicsCloudSyncConfig(config);
  if (!cloudBaseUrl) {
    const sync = buildCloudVariableSyncResult({
      entry,
      status: "blocked",
      message: "待同步：请先接入迭界AI云端 Base URL，再同步云端模型变量。",
    });
    return { ok: false, sync };
  }
  if (!cloudApiVariablesSyncBearer) {
    const sync = buildCloudVariableSyncResult({
      entry,
      status: "blocked",
      message:
        "待同步：请先配置迭界AI内部桥接 Bearer（DIJIE_INTERNAL_BRIDGE_BEARER / cloudApiVariablesSyncBearer）。账号访问 Token 不能用于云端变量同步。",
    });
    return { ok: false, sync };
  }
  const secretValue = await resolveSecretValueFromConfig(entry.secret, config);
  if (!secretValue) {
    const sync = buildCloudVariableSyncResult({
      entry,
      status: "blocked",
      message: "待同步：这个模型 Provider 没有可用 API Key，不能写入迭界AI云端变量。",
    });
    return { ok: false, sync };
  }
  const metadata = apiConnectionMetadata(entry);
  const variableName =
    trimUnknownString(metadata.cloudVariableName) ?? defaultCloudVariableName(entry);
  const entryWithVariableName = {
    ...entry,
    metadata: { ...metadata, cloudVariableName: variableName },
  };
  const url = new URL(syncPath, cloudBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cloudApiVariablesSyncBearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: entry.provider,
        kind: "model",
        variableName,
        value: secretValue,
        baseUrl: entry.baseUrl ?? entry.endpoint,
        model: trimUnknownString(metadata.defaultModel),
        pricing: recordValue(metadata.pricing),
        budget: recordValue(metadata.budget),
        consumers: cloudConsumers,
        source: "openclaw_api_management",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as unknown;
      const payloadRecord = recordValue(payload);
      const error = trimUnknownString(payloadRecord.error) ?? response.statusText;
      const message =
        response.status === 401
          ? "迭界AI云端变量同步失败：内部桥接 Bearer 与云端 DIJIE_INTERNAL_BRIDGE_BEARER 不一致。请不要使用账号访问 Token 同步云端变量。"
          : `迭界AI云端变量同步失败：${response.status} ${error || "HTTP error"}。`;
      const sync = buildCloudVariableSyncResult({
        entry: entryWithVariableName,
        status: "failed",
        httpStatus: response.status,
        message,
        ...(error ? { lastError: error } : {}),
      });
      return { ok: false, sync };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    const cloudRef =
      trimUnknownString(recordValue(payload).cloudRef) ??
      trimUnknownString(recordValue(payload).variableRef);
    const sync = buildCloudVariableSyncResult({
      entry: entryWithVariableName,
      status: "synced",
      cloudRef,
      message:
        "已同步到迭界AI云端变量池；云端商城/使用者中心/开发者中心可按授权使用这个模型 Provider。",
    });
    return { ok: true, sync };
  } catch (err) {
    const sync = buildCloudVariableSyncResult({
      entry: entryWithVariableName,
      status: "failed",
      message: errorMessageForCloudVariableSync(err),
      lastError: errorDetailForCloudVariableSync(err),
    });
    return { ok: false, sync };
  } finally {
    clearTimeout(timeout);
  }
}

function ensureApiConnections(config: OpenClawConfig): OpenClawConfig {
  return {
    ...config,
    apiConnections: {
      entries: { ...(config.apiConnections?.entries ?? {}) },
    },
  };
}

function validateNextConfig(config: OpenClawConfig): OpenClawConfig {
  const validated = validateConfigObjectWithPlugins(normalizeModelProviderEmptyBaseUrls(config));
  if (!validated.ok) {
    const message = validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(message || "invalid config");
  }
  return validated.config;
}

function normalizeModelProviderEmptyBaseUrls(config: OpenClawConfig): OpenClawConfig {
  const providers = config.models?.providers;
  if (!providers) return config;
  let nextConfig = config;
  let nextProviders = providers;
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    if (!providerConfig) continue;
    const defaultBaseUrl = MODEL_PROVIDER_BASE_URL_DEFAULTS[providerId.toLowerCase()];
    const needsBaseUrl =
      providerConfig.baseUrl === "" ||
      (providerConfig.baseUrl === undefined && Boolean(defaultBaseUrl));
    const needsModels = !Array.isArray(providerConfig.models);
    if (!needsBaseUrl && !needsModels) continue;
    if (nextConfig === config) {
      nextProviders = { ...providers };
      nextConfig = {
        ...config,
        models: {
          ...config.models,
          providers: nextProviders,
        },
      };
    }
    nextProviders[providerId] = {
      ...providerConfig,
      ...(needsBaseUrl && defaultBaseUrl ? { baseUrl: defaultBaseUrl } : {}),
      ...(needsModels ? { models: [] } : {}),
    } as typeof providerConfig;
  }
  return nextConfig;
}

async function writeConfig(
  opts: GatewayRequestHandlerOptions,
  mutate: (
    config: OpenClawConfig,
    snapshot: ConfigWriteSnapshotLike,
  ) =>
    | { config: OpenClawConfig; changedPaths?: string[] }
    | Promise<{ config: OpenClawConfig; changedPaths?: string[] }>,
  options: { allowConfigSizeDrop?: boolean } = {},
) {
  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  const mutated = await mutate(snapshot.config, snapshot);
  const nextConfig = validateNextConfig(mutated.config);
  if ((mutated.changedPaths ?? []).length === 0 && isDeepStrictEqual(snapshot.config, nextConfig)) {
    const readModel = createApiConnectionsReadModel(snapshot.config);
    opts.respond(true, {
      ok: true,
      changedPaths: [],
      readModel,
    });
    return;
  }
  const writeResult = await commitGatewayConfigWrite({
    snapshot,
    writeOptions: {
      ...writeOptions,
      allowConfigSizeDrop: options.allowConfigSizeDrop === true || writeOptions.allowConfigSizeDrop,
    },
    nextConfig,
    context: opts.context,
    disconnectSharedAuthClients: false,
  });
  const readModel = createApiConnectionsReadModel(writeResult.config);
  opts.respond(true, {
    ok: true,
    changedPaths: mutated.changedPaths ?? [],
    readModel,
  });
}

type ConfigWriteSnapshotLike = {
  path: string;
};

function createEntryFromParams(params: Record<string, unknown>): ApiConnectionEntry {
  const authMode = stringParam(params, "authMode");
  const entry = normalizeApiConnectionEntry({
    id: stringParam(params, "id"),
    name: requireString(params, "name"),
    kind: kindParam(params),
    provider: requireString(params, "provider"),
    baseUrl: stringParam(params, "baseUrl"),
    endpoint: stringParam(params, "endpoint"),
    authMode:
      authMode === "plaintext" ||
      authMode === "none" ||
      authMode === "oauth" ||
      authMode === "secret_ref"
        ? authMode
        : undefined,
    secret: secretParam(params),
    consumers: consumersParam(params),
    requestedScope: requestedScopeParam(params),
    configBindings: bindingsParam(params),
    metadata: metadataParam(params),
  });
  assertNoProtectedPlaintextSecret(entry);
  return entry;
}

function isProtectedApiConnection(entry: ApiConnectionEntry): boolean {
  const consumers = entry.consumers ?? [];
  return (
    entry.kind === "marketplace" ||
    entry.kind === "tool_skill" ||
    consumers.includes("marketplace") ||
    consumers.includes("dispatch")
  );
}

function assertNoProtectedPlaintextSecret(entry: ApiConnectionEntry): void {
  if (isProtectedApiConnection(entry) && typeof entry.secret === "string") {
    throw new Error("商城/调度能力不能保存明文密钥，必须使用 SecretRef。");
  }
}

type ApiConnectionTestResult = {
  status: "passed" | "failed" | "needs_review";
  message: string;
  updateModelValidation?: boolean;
  metadataPatch?: Record<string, unknown>;
};

function testApiConnectionReadModelEntry(entry: Record<string, unknown>): ApiConnectionTestResult {
  const risks = Array.isArray(entry.risks) ? (entry.risks as Array<Record<string, unknown>>) : [];
  const blocking = risks.find((risk) => risk.severity === "blocking");
  const secret = (entry.secret ?? {}) as Record<string, unknown>;
  const bindings = Array.isArray(entry.configBindings) ? entry.configBindings : [];
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
  if (blocking) {
    return {
      status: "failed",
      message: `连接检查未通过：${blocking.message ?? blocking.code ?? "存在阻塞项"}`,
    };
  }
  if (secret.status === "unresolved") {
    return { status: "failed", message: "连接检查未通过：SecretRef 当前无法解析。" };
  }
  if (insecure) {
    return { status: "failed", message: "连接检查未通过：Base URL 不是 HTTPS。" };
  }
  if (bindings.length === 0) {
    return { status: "needs_review", message: "连接可保存，但还没有同步绑定路径。" };
  }
  if (manualModelNeedsTest) {
    return {
      status: "needs_review",
      message: "手动模型 ID 已做后端配置检查并标记为手动确认；这不代表已经发起外部模型调用。",
      updateModelValidation: true,
    };
  }
  return { status: "passed", message: "连接后端检查通过，可供系统使用。" };
}

async function resolveApiConnectionSecretForTest(
  entry: ApiConnectionEntry,
  config: OpenClawConfig,
): Promise<{
  status: "available" | "missing" | "unsupported";
  value?: string;
  message?: string;
}> {
  if (entry.authMode === "none" || entry.authMode === "oauth") {
    return { status: "missing", message: "该连接方式不需要 API Key，跳过外部模型目录测试。" };
  }
  if (typeof entry.secret === "string" && entry.secret.trim()) {
    return { status: "available", value: entry.secret.trim() };
  }
  if (!entry.secret) {
    return { status: "missing", message: "缺少 API Key 或 SecretRef，不能做外部模型目录测试。" };
  }
  if (isSecretRef(entry.secret)) {
    const value = await resolveSecretValueFromConfig(entry.secret, config);
    return value
      ? { status: "available", value }
      : {
          status: "missing",
          message: `SecretRef ${entry.secret.source}:${entry.secret.provider}:${entry.secret.id} 当前无法解析，不能做外部模型目录测试。`,
        };
  }
  return { status: "missing", message: "API Key 配置不可识别。" };
}

function providerModelsUrl(entry: ApiConnectionEntry): string | undefined {
  const provider = entry.provider.toLowerCase();
  const rawBase =
    (entry.baseUrl ?? entry.endpoint)?.trim() ||
    (provider === "openai"
      ? "https://api.openai.com/v1"
      : provider === "deepseek"
        ? "https://api.deepseek.com"
        : provider === "qwen-dashscope" || provider === "dashscope" || provider === "qwen"
          ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
          : provider === "anthropic"
            ? "https://api.anthropic.com"
            : provider === "gemini" || provider === "google"
              ? "https://generativelanguage.googleapis.com"
              : "");
  if (!rawBase) return undefined;
  const base = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;
  if (provider === "anthropic") return `${base}/v1/models`;
  if (provider === "gemini" || provider === "google") return `${base}/v1beta/models`;
  return `${base}/models`;
}

function modelDirectoryRequestInit(
  entry: ApiConnectionEntry,
  secret: string,
): RequestInit | undefined {
  const provider = entry.provider.toLowerCase();
  if (provider === "gemini" || provider === "google") {
    return { method: "GET" };
  }
  if (provider === "anthropic") {
    return {
      method: "GET",
      headers: {
        "x-api-key": secret,
        "anthropic-version": "2023-06-01",
      },
    };
  }
  return {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  };
}

function appendGeminiApiKey(url: string, secret: string): string {
  const next = new URL(url);
  next.searchParams.set("key", secret);
  return next.toString();
}

function extractModelIdsFromDirectory(provider: string, payload: unknown): string[] {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  const ids = data.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    const raw =
      typeof candidate.id === "string"
        ? candidate.id
        : typeof candidate.name === "string"
          ? candidate.name
          : "";
    const id = provider === "gemini" ? raw.replace(/^models\//, "") : raw;
    return id.trim() ? [id.trim()] : [];
  });
  return Array.from(new Set(ids)).slice(0, 50);
}

async function fetchModelDirectory(
  entry: ApiConnectionEntry,
  config: OpenClawConfig,
): Promise<ApiConnectionTestResult> {
  const url = providerModelsUrl(entry);
  if (!url) {
    return {
      status: "needs_review",
      message: "这个模型 Provider 没有可识别的模型目录接口，已完成本地配置检查。",
    };
  }
  const secret = await resolveApiConnectionSecretForTest(entry, config);
  if (secret.status !== "available" || !secret.value) {
    return {
      status: "failed",
      message: secret.message ?? "缺少可用 API Key，不能做外部模型目录测试。",
    };
  }
  const provider = entry.provider.toLowerCase();
  const requestUrl =
    provider === "gemini" || provider === "google" ? appendGeminiApiKey(url, secret.value) : url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(requestUrl, {
      ...modelDirectoryRequestInit(entry, secret.value),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: "failed",
        message: `外部模型目录测试失败：${response.status} ${response.statusText || "HTTP error"}。`,
      };
    }
    const payload = (await response.json()) as unknown;
    const observedModels = extractModelIdsFromDirectory(provider, payload);
    const now = new Date().toISOString();
    const sample = observedModels.slice(0, 5);
    const metadata =
      entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
        ? (entry.metadata as Record<string, unknown>)
        : {};
    const modelValidation =
      metadata.modelValidation &&
      typeof metadata.modelValidation === "object" &&
      !Array.isArray(metadata.modelValidation)
        ? (metadata.modelValidation as Record<string, unknown>)
        : {};
    const currentDefaultModel =
      typeof metadata.defaultModel === "string" ? metadata.defaultModel.trim() : "";
    const shouldPromoteDefaultModel =
      observedModels.length > 0 &&
      modelValidation.source !== "manual_model_id" &&
      (!currentDefaultModel || !observedModels.includes(currentDefaultModel));
    const promotedDefaultModel = shouldPromoteDefaultModel ? observedModels[0] : undefined;
    return {
      status: "passed",
      message: observedModels.length
        ? `外部模型目录测试通过：读取到 ${observedModels.length} 个模型，示例 ${sample.join(" / ")}。${promotedDefaultModel ? `默认模型已切到 ${promotedDefaultModel}。` : ""}未发起模型生成，不产生 Token。`
        : "外部模型目录测试通过，但返回中没有可识别的模型 ID；未发起模型生成，不产生 Token。",
      metadataPatch: {
        ...(promotedDefaultModel ? { defaultModel: promotedDefaultModel } : {}),
        modelValidation: {
          status: "provider_verified",
          source: "provider_models_endpoint",
          verifiedAt: now,
          observedModelCount: observedModels.length,
          observedModels: sample,
          note: "已通过只读模型目录接口验证；未发起模型生成，不产生 Token。",
        },
        ...(observedModels.length ? { availableModels: observedModels } : {}),
      },
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "外部模型目录测试超时。"
        : `外部模型目录测试失败：${err instanceof Error ? err.message : String(err)}`;
    return { status: "failed", message };
  } finally {
    clearTimeout(timeout);
  }
}

async function testApiConnectionEntry(
  entry: Record<string, unknown>,
  rawEntry?: ApiConnectionEntry,
  config?: OpenClawConfig,
): Promise<ApiConnectionTestResult> {
  const local = testApiConnectionReadModelEntry(entry);
  if (local.status === "failed") return local;
  if (
    rawEntry?.kind === "model" &&
    config &&
    rawEntry.authMode !== "oauth" &&
    rawEntry.authMode !== "none"
  ) {
    const external = await fetchModelDirectory(rawEntry, config);
    return external.status === "passed" ? { ...external, updateModelValidation: true } : external;
  }
  return local;
}

export const aicsApiConnectionsHandlers: GatewayRequestHandlers = {
  "aics.apiConnections.readModel.get": async ({ context, respond }) => {
    respond(true, createApiConnectionsReadModel(context.getRuntimeConfig()));
  },

  "aics.apiConnections.riskReport.get": async ({ context, respond }) => {
    respond(true, createApiConnectionsReadModel(context.getRuntimeConfig()).riskReport);
  },

  "aics.apiConnections.entry.test": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
      const readModel = createApiConnectionsReadModel(snapshot.config);
      const entry = readModel.entries.find((candidate) => candidate.id === id);
      if (!entry) throw new Error(`API connection not found: ${id}`);
      const rawEntry = snapshot.config.apiConnections?.entries?.[id];
      const connectionTest = await testApiConnectionEntry(
        entry as unknown as Record<string, unknown>,
        rawEntry,
        snapshot.config,
      );
      let nextReadModel = readModel;
      if (connectionTest.updateModelValidation && rawEntry) {
        const previousMetadata = rawEntry.metadata ?? {};
        const metadataPatch = connectionTest.metadataPatch ?? {};
        const nextConfig = validateNextConfig({
          ...snapshot.config,
          apiConnections: {
            entries: {
              ...(snapshot.config.apiConnections?.entries ?? {}),
              [id]: {
                ...rawEntry,
                metadata: {
                  ...previousMetadata,
                  ...metadataPatch,
                  modelValidation: {
                    ...((previousMetadata.modelValidation ?? {}) as Record<string, unknown>),
                    ...((metadataPatch.modelValidation ?? {}) as Record<string, unknown>),
                    ...(metadataPatch.modelValidation
                      ? {}
                      : {
                          status: "manual_confirmed",
                          confirmedAt: new Date().toISOString(),
                          note: "已完成后端配置检查；真实可调用性仍以外部模型请求结果为准。",
                        }),
                  },
                },
              },
            },
          },
        });
        const writeResult = await commitGatewayConfigWrite({
          snapshot,
          writeOptions,
          nextConfig,
          context: opts.context,
          disconnectSharedAuthClients: false,
          afterWrite: { mode: "none", reason: "api connection test metadata only" },
        });
        nextReadModel = createApiConnectionsReadModel(writeResult.config);
      }
      opts.respond(true, {
        ok: connectionTest.status !== "failed",
        connectionTest,
        readModel: nextReadModel,
      });
      return;
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : "test failed"),
      );
    }
  },

  "aics.apiConnections.modelUsage.record": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const consumer = consumerParam(params);
      const modelUsage = modelUsageParam(params);
      validateModelUsageTokens(modelUsage);
      const usageRef =
        stringParam(params, "usageRef") ??
        stringParam(params, "executionId") ??
        `api_usage:${consumer}:${Date.now()}`;
      const apiMetering = await recordModelUsageToApiMetering({
        context: opts.context,
        consumer,
        executionId: usageRef,
        modelUsage,
        attribution: roleExecutionBillingAttributionParam(params),
      });
      if (!apiMetering) {
        throw new Error("no enabled model API connection matches this consumer/provider");
      }
      const readModel = createApiConnectionsReadModel(opts.context.getRuntimeConfig());
      opts.respond(true, {
        ok: true,
        apiMetering: {
          entryId: apiMetering.entryId,
          costCny: apiMetering.costCny,
          consumer,
          usageRef,
          cloudLedgerSync: apiMetering.cloudLedgerSync,
        },
        readModel,
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "record model usage failed",
        ),
      );
    }
  },

  "aics.apiConnections.entry.create": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const entry = createEntryFromParams(params);
      const managedSecretValue = managedSecretValueParam(params);
      await writeConfig(opts, async (config, snapshot) => {
        const next = ensureApiConnections(config);
        const managed = await applyManagedSecretValue({
          configPath: snapshot.path,
          config: next,
          entry,
          managedSecretValue,
        });
        const nextWithConnections = ensureApiConnections(managed.config);
        nextWithConnections.apiConnections!.entries![managed.entry.id] = managed.entry;
        return {
          config: nextWithConnections,
          changedPaths: [`apiConnections.entries.${managed.entry.id}`, ...managed.changedPaths],
        };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "invalid API connection",
        ),
      );
    }
  },

  "aics.apiConnections.entry.update": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      const managedSecretValue = managedSecretValueParam(params);
      await writeConfig(opts, async (config, snapshot) => {
        const next = ensureApiConnections(config);
        const previous = next.apiConnections!.entries![id];
        if (!previous) throw new Error(`API connection not found: ${id}`);
        const authMode = stringParam(params, "authMode");
        const patch: Partial<ApiConnectionEntry> &
          Pick<ApiConnectionEntry, "name" | "kind" | "provider"> = {
          ...previous,
          ...(stringParam(params, "name") ? { name: stringParam(params, "name")! } : {}),
          kind: (stringParam(params, "kind") as ApiConnectionKind) ?? previous.kind,
          provider: stringParam(params, "provider") ?? previous.provider,
          ...(stringParam(params, "baseUrl") ? { baseUrl: stringParam(params, "baseUrl") } : {}),
          ...(stringParam(params, "endpoint") ? { endpoint: stringParam(params, "endpoint") } : {}),
          ...(authMode === "plaintext" ||
          authMode === "none" ||
          authMode === "oauth" ||
          authMode === "secret_ref"
            ? { authMode }
            : {}),
          ...(params.secret !== undefined || params.secretEnvId !== undefined
            ? { secret: secretParam(params) }
            : {}),
          ...(params.consumers !== undefined ? { consumers: consumersParam(params) } : {}),
          ...(params.requestedScope !== undefined
            ? { requestedScope: requestedScopeParam(params) }
            : {}),
          ...(params.configBindings !== undefined ||
          params.bindingPath !== undefined ||
          params.configPath !== undefined
            ? { configBindings: bindingsParam(params) }
            : {}),
          ...(params.metadata !== undefined ? { metadata: metadataParam(params) } : {}),
        };
        const entry = normalizeApiConnectionEntry(patch, previous);
        assertNoProtectedPlaintextSecret(entry);
        const managed = await applyManagedSecretValue({
          configPath: snapshot.path,
          config: next,
          entry,
          managedSecretValue,
        });
        const nextWithConnections = ensureApiConnections(managed.config);
        nextWithConnections.apiConnections!.entries![id] = managed.entry;
        return {
          config: nextWithConnections,
          changedPaths: [`apiConnections.entries.${id}`, ...managed.changedPaths],
        };
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "update failed",
        ),
      );
    }
  },

  "aics.apiConnections.entry.delete": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      await writeConfig(
        opts,
        async (config, snapshot) => {
          const next = ensureApiConnections(config);
          const previous = next.apiConnections!.entries![id];
          let nextConfig = next;
          let cleanupChangedPaths: string[] = [];
          if (previous) {
            try {
              const unmaterialized = unmaterializeApiConnectionFromConfig(next, previous);
              const cleanupCandidate = ensureApiConnections(unmaterialized.config);
              delete cleanupCandidate.apiConnections!.entries![id];
              validateNextConfig(cleanupCandidate);
              nextConfig = cleanupCandidate;
              cleanupChangedPaths = unmaterialized.changedPaths;
            } catch {
              nextConfig = ensureApiConnections(next);
              cleanupChangedPaths = [];
            }
          }
          const removedManagedSecret =
            previous?.secret &&
            isSecretRef(previous.secret) &&
            previous.secret.source === "file" &&
            previous.secret.provider === API_CONNECTIONS_SECRET_PROVIDER
              ? await deleteManagedApiConnectionSecret({
                  configPath: snapshot.path,
                  entryId: id,
                })
              : false;
          delete nextConfig.apiConnections!.entries![id];
          return {
            config: nextConfig,
            changedPaths: [
              ...cleanupChangedPaths,
              `apiConnections.entries.${id}`,
              ...(removedManagedSecret
                ? [`secrets.providers.${API_CONNECTIONS_SECRET_PROVIDER}.entries.${id}`]
                : []),
            ],
          };
        },
        { allowConfigSizeDrop: true },
      );
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "delete failed",
        ),
      );
    }
  },

  "aics.apiConnections.entry.bindConfigPath": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      const path = requireString(params, "path");
      await writeConfig(opts, (config) => ({
        config: bindApiConnectionConfigPath(config, id, path),
        changedPaths: [`apiConnections.entries.${id}.configBindings`, path],
      }));
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : "bind failed"),
      );
    }
  },

  "aics.apiConnections.entry.materialize": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = stringParam(params, "id");
      await writeConfig(opts, (config) => materializeApiConnectionToConfig(config, id));
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "materialize failed",
        ),
      );
    }
  },

  "aics.apiConnections.entry.syncCloudVariables": async (opts) => {
    try {
      const params = paramsRecord(opts.req.params);
      const id = requireString(params, "id");
      const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
      const entry = snapshot.config.apiConnections?.entries?.[id];
      if (!entry) throw new Error(`API connection not found: ${id}`);
      const syncResult = await syncModelApiConnectionToDijieCloud({
        config: snapshot.config,
        entry,
      });
      const nextEntry = withCloudVariableSyncMetadata(entry, syncResult.sync);
      const nextConfig = validateNextConfig({
        ...snapshot.config,
        apiConnections: {
          entries: {
            ...(snapshot.config.apiConnections?.entries ?? {}),
            [id]: nextEntry,
          },
        },
      });
      const writeResult = await commitGatewayConfigWrite({
        snapshot,
        writeOptions,
        nextConfig,
        context: opts.context,
        disconnectSharedAuthClients: false,
        afterWrite: { mode: "none", reason: "api connection cloud variable sync metadata" },
      });
      opts.respond(true, {
        ok: syncResult.ok,
        cloudVariableSync: syncResult.sync,
        readModel: createApiConnectionsReadModel(writeResult.config),
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "sync cloud variables failed",
        ),
      );
    }
  },
};
