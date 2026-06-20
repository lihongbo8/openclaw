import { promises as fs } from "node:fs";
import { applyModelUsageToApiConnectionMetering } from "../../api-connections/metering.js";
import {
  readConfigFileSnapshotForWrite,
  validateConfigObjectWithPlugins,
} from "../../config/config.js";
import type {
  ApiConnectionConsumer,
  ApiConnectionEntry,
} from "../../config/types.api-connections.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { isSecretRef } from "../../config/types.secrets.js";
import { commitGatewayConfigWrite } from "./config-write-flow.js";
import type { GatewayRequestContext } from "./types.js";

type CloudLedgerSyncStatus = "blocked" | "pending" | "synced";

type CloudLedgerSyncResult = {
  status: CloudLedgerSyncStatus;
  target: "dijie_ai_cloud";
  usageRef: string;
  updatedAt: string;
  message: string;
  httpStatus?: number;
  cloudRef?: string;
  lastError?: string;
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function trimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
  const direct = trimString(value);
  if (direct) return direct;
  if (!isSecretRef(value)) return undefined;
  if (value.source === "env") return process.env[value.id]?.trim() || undefined;
  if (value.source !== "file") return undefined;
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

async function resolveDijieCloudLedgerConfig(config: OpenClawConfig): Promise<{
  cloudBaseUrl?: string;
  cloudAccessToken?: string;
  ledgerPath: string;
}> {
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
    const cloudBaseUrl = trimString(entry.baseUrl ?? entry.endpoint);
    const cloudAccessToken = await resolveSecretValueFromConfig(entry.secret, config);
    if (cloudBaseUrl && cloudAccessToken) {
      return {
        cloudBaseUrl,
        cloudAccessToken,
        ledgerPath: "/dijie/ledger/entries",
      };
    }
  }
  const pluginConfig = readRecord(config.plugins?.entries?.aics?.config);
  return {
    cloudBaseUrl: trimString(pluginConfig.cloudBaseUrl),
    cloudAccessToken: await resolveSecretValueFromConfig(pluginConfig.cloudAccessToken, config),
    ledgerPath: trimString(pluginConfig.cloudLedgerEntriesPath) ?? "/dijie/ledger/entries",
  };
}

function consumerSurface(consumer: ApiConnectionConsumer): string {
  switch (consumer) {
    case "buyer_storefront":
      return "buyer_storefront";
    case "user_center":
      return "user_center";
    case "developer_center":
      return "developer_center";
    case "ai_review":
      return "admin_review";
    case "role_execution":
    case "operations_backend":
    case "build_session":
    case "local_dialog":
    case "model":
    case "media_model":
    default:
      return "openclaw_local";
  }
}

function consumerMode(consumer: ApiConnectionConsumer): string {
  if (consumer === "developer_center") return "developer";
  if (consumer === "ai_review") return "review";
  return "user";
}

function consumerLedgerSource(consumer: ApiConnectionConsumer): string {
  if (consumer === "role_execution") return "role_usage";
  if (
    consumer === "local_dialog" ||
    consumer === "buyer_storefront" ||
    consumer === "user_center"
  ) {
    return "dialog_usage";
  }
  return "main_system_usage";
}

function modelIdFromUsageOrEntry(
  modelUsage: Record<string, unknown>,
  entry: ApiConnectionEntry | undefined,
): string | null {
  const direct = trimString(modelUsage.model ?? modelUsage.modelId);
  if (direct) return direct;
  const metadata = readRecord(entry?.metadata);
  const defaultModel = trimString(metadata.defaultModel);
  if (defaultModel) return defaultModel;
  const availableModels = metadata.availableModels;
  if (Array.isArray(availableModels)) {
    return (
      availableModels.find(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      ) ?? null
    );
  }
  return null;
}

function buildCloudLedgerBody(params: {
  config: OpenClawConfig;
  entryId: string;
  consumer: ApiConnectionConsumer;
  executionId: string;
  modelUsage: Record<string, unknown>;
  costCny: number;
}): Record<string, unknown> {
  const entry = params.config.apiConnections?.entries?.[params.entryId];
  const inputTokens = finiteNumber(params.modelUsage.inputTokens);
  const outputTokens = finiteNumber(params.modelUsage.outputTokens);
  const totalTokens = finiteNumber(params.modelUsage.totalTokens) || inputTokens + outputTokens;
  const costCents = Math.max(0, Math.round(params.costCny * 100));
  return {
    accountId: "openclaw_local",
    billingAccountId: "dijie_ai_local",
    source: consumerLedgerSource(params.consumer),
    usageKind: "model_tokens",
    surface: consumerSurface(params.consumer),
    mode: consumerMode(params.consumer),
    subject: {
      consumer: params.consumer,
      apiConnectionEntryId: params.entryId,
      usageRef: params.executionId,
    },
    meters: [
      { name: "input_tokens", quantity: inputTokens, unit: "token" },
      { name: "output_tokens", quantity: outputTokens, unit: "token" },
      { name: "total_tokens", quantity: totalTokens, unit: "token" },
    ],
    currency: "CNY",
    grossAmountCents: costCents,
    platformReceivableCents: costCents,
    developerReceivableCents: 0,
    modelProvider: trimString(params.modelUsage.provider) ?? entry?.provider ?? null,
    modelId: modelIdFromUsageOrEntry(params.modelUsage, entry),
    modelPricingKnown: costCents > 0,
    modelPricingSource: "api_management",
    providerCostCents: costCents,
    providerCostCurrency: "CNY",
    executionId: params.executionId,
    occurredAt: trimString(params.modelUsage.occurredAt) ?? new Date().toISOString(),
  };
}

async function uploadModelUsageToDijieCloudLedger(params: {
  config: OpenClawConfig;
  entryId: string;
  consumer: ApiConnectionConsumer;
  executionId: string;
  modelUsage: Record<string, unknown>;
  costCny: number;
}): Promise<CloudLedgerSyncResult> {
  const { cloudBaseUrl, cloudAccessToken, ledgerPath } = await resolveDijieCloudLedgerConfig(
    params.config,
  );
  if (!cloudBaseUrl || !cloudAccessToken) {
    return {
      status: "pending",
      target: "dijie_ai_cloud",
      usageRef: params.executionId,
      updatedAt: new Date().toISOString(),
      message: "待同步：迭界AI云端服务 Token 或 Base URL 未配置。",
    };
  }
  const url = new URL(ledgerPath, cloudBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cloudAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildCloudLedgerBody(params)),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || body?.ok === false) {
      return {
        status: "pending",
        target: "dijie_ai_cloud",
        usageRef: params.executionId,
        updatedAt: new Date().toISOString(),
        message: "待同步：迭界AI云端账本写入失败。",
        httpStatus: response.status,
        lastError: trimString(body?.error) ?? response.statusText,
      };
    }
    return {
      status: "synced",
      target: "dijie_ai_cloud",
      usageRef: params.executionId,
      updatedAt: new Date().toISOString(),
      message: "已同步到迭界AI云端账本。",
      httpStatus: response.status,
      cloudRef: trimString(body?.cloudRef) ?? trimString(readRecord(body?.ledgerEntry).id),
    };
  } catch (error) {
    return {
      status: "pending",
      target: "dijie_ai_cloud",
      usageRef: params.executionId,
      updatedAt: new Date().toISOString(),
      message: "待同步：迭界AI云端账本暂不可达。",
      lastError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function withCloudLedgerSyncMetadata(
  config: OpenClawConfig,
  entryId: string,
  sync: CloudLedgerSyncResult,
): OpenClawConfig {
  const entries = config.apiConnections?.entries ?? {};
  const entry = entries[entryId];
  if (!entry) return config;
  const metadata = readRecord(entry.metadata);
  const metering = readRecord(metadata.metering);
  const previousSync = readRecord(metering.cloudLedgerSync);
  const pendingUsageRefs = new Set(
    Array.isArray(previousSync.pendingUsageRefs)
      ? previousSync.pendingUsageRefs.filter((value): value is string => typeof value === "string")
      : [],
  );
  if (sync.status === "synced") {
    pendingUsageRefs.delete(sync.usageRef);
  } else {
    pendingUsageRefs.add(sync.usageRef);
  }
  return {
    ...config,
    apiConnections: {
      entries: {
        ...entries,
        [entryId]: {
          ...entry,
          metadata: {
            ...metadata,
            metering: {
              ...metering,
              cloudLedgerSync: {
                ...previousSync,
                ...sync,
                pendingUsageRefs: Array.from(pendingUsageRefs).slice(-200),
              },
            },
          },
          updatedAt: new Date().toISOString(),
        },
      },
    },
  };
}

async function persistCloudLedgerSync(params: {
  context: GatewayRequestContext;
  entryId: string;
  sync: CloudLedgerSyncResult;
}): Promise<void> {
  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  const nextConfig = withCloudLedgerSyncMetadata(snapshot.config, params.entryId, params.sync);
  const validated = validateConfigObjectWithPlugins(nextConfig);
  if (!validated.ok) return;
  const writeResult = await commitGatewayConfigWrite({
    snapshot,
    writeOptions,
    nextConfig: validated.config,
    context: params.context,
    disconnectSharedAuthClients: false,
  });
  writeResult.queueFollowUp();
}

export async function recordModelUsageToApiMetering(params: {
  context: GatewayRequestContext;
  consumer: ApiConnectionConsumer;
  executionId: string;
  modelUsage?: Record<string, unknown>;
}): Promise<{ entryId: string; costCny: number; cloudLedgerSync?: CloudLedgerSyncResult } | null> {
  const modelUsage = readRecord(params.modelUsage);
  const inputTokens = finiteNumber(modelUsage.inputTokens);
  const outputTokens = finiteNumber(modelUsage.outputTokens);
  const totalTokens = finiteNumber(modelUsage.totalTokens) || inputTokens + outputTokens;
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) return null;

  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  const applied = applyModelUsageToApiConnectionMetering(snapshot.config, {
    consumer: params.consumer,
    executionId: params.executionId,
    modelUsage,
  });
  if (!applied) return null;
  const validated = validateConfigObjectWithPlugins(applied.config);
  if (!validated.ok) {
    throw new Error(
      validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ") ||
        "invalid config",
    );
  }
  const writeResult = await commitGatewayConfigWrite({
    snapshot,
    writeOptions,
    nextConfig: validated.config,
    context: params.context,
    disconnectSharedAuthClients: false,
  });
  writeResult.queueFollowUp();
  if (applied.deduped) return { entryId: applied.entryId, costCny: applied.costCny };
  const cloudLedgerSync = await uploadModelUsageToDijieCloudLedger({
    config: applied.config,
    entryId: applied.entryId,
    consumer: params.consumer,
    executionId: params.executionId,
    modelUsage,
    costCny: applied.costCny,
  });
  await persistCloudLedgerSync({
    context: params.context,
    entryId: applied.entryId,
    sync: cloudLedgerSync,
  });
  return { entryId: applied.entryId, costCny: applied.costCny, cloudLedgerSync };
}
