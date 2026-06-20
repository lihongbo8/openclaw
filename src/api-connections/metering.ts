import type { ApiConnectionConsumer, ApiConnectionEntry } from "../config/types.api-connections.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

export type ApiModelUsageMeteringResult = {
  config: OpenClawConfig;
  entryId: string;
  costCny: number;
  deduped?: boolean;
};

export type ApiModelRefSelection = {
  entryId: string;
  provider: string;
  model: string;
  modelRef: string;
};

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function calculateModelUsageCostCny(params: {
  modelUsage: Record<string, unknown>;
  pricing: Record<string, unknown>;
}): number {
  const costCents = finiteNumber(params.modelUsage.costCents);
  if (costCents > 0) return costCents / 100;
  const inputTokens = finiteNumber(params.modelUsage.inputTokens);
  const outputTokens = finiteNumber(params.modelUsage.outputTokens);
  const inputPrice = finiteNumber(params.pricing.inputCnyPerMillion);
  const outputPrice = finiteNumber(params.pricing.outputCnyPerMillion);
  return (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice;
}

function addUsageTotals(
  target: Record<string, unknown>,
  usage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCny: number;
  },
): Record<string, unknown> {
  return {
    ...target,
    calls: finiteNumber(target.calls) + usage.calls,
    inputTokens: finiteNumber(target.inputTokens) + usage.inputTokens,
    outputTokens: finiteNumber(target.outputTokens) + usage.outputTokens,
    totalTokens: finiteNumber(target.totalTokens) + usage.totalTokens,
    costCny: finiteNumber(target.costCny ?? target.cost ?? target.amountCny) + usage.costCny,
  };
}

function readRecordedUsageRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function appendRecordedUsageRef(previous: unknown, usageRef: string): string[] {
  return [...readRecordedUsageRefs(previous).filter((item) => item !== usageRef), usageRef].slice(
    -200,
  );
}

export function selectModelApiConnectionEntry(
  entries: Record<string, ApiConnectionEntry>,
  consumer: ApiConnectionConsumer,
  provider?: string,
): ApiConnectionEntry | null {
  const all = Object.values(entries).filter(
    (entry) => entry.enabled !== false && entry.kind === "model",
  );
  const providerMatches = provider
    ? all.filter((entry) => entry.provider.toLowerCase() === provider.toLowerCase())
    : [];
  const candidates = providerMatches.length ? providerMatches : all;
  return (
    candidates.find((entry) => entry.consumers?.includes(consumer)) ??
    candidates.find((entry) => entry.consumers?.includes("model")) ??
    candidates[0] ??
    null
  );
}

function firstString(items: unknown): string | undefined {
  if (!Array.isArray(items)) return undefined;
  for (const item of items) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const id = (item as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim()) return id.trim();
    }
  }
  return undefined;
}

function modelFromProviderConfig(config: OpenClawConfig, provider: string): string | undefined {
  const providers = (config.models?.providers ?? {}) as Record<string, unknown>;
  const providerConfig = providers[provider];
  if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
    return undefined;
  }
  return firstString((providerConfig as Record<string, unknown>).models);
}

export function resolveApiModelRefForConsumer(
  config: OpenClawConfig,
  params: {
    consumer: ApiConnectionConsumer;
    provider?: string;
  },
): ApiModelRefSelection | null {
  const entries = config.apiConnections?.entries ?? {};
  const entry = selectModelApiConnectionEntry(entries, params.consumer, params.provider);
  if (!entry) return null;
  const metadata = readRecord(entry.metadata);
  const model =
    (typeof metadata.defaultModel === "string" && metadata.defaultModel.trim()) ||
    firstString(metadata.availableModels) ||
    modelFromProviderConfig(config, entry.provider);
  if (!model) return null;
  return {
    entryId: entry.id,
    provider: entry.provider,
    model,
    modelRef: `${entry.provider}/${model}`,
  };
}

export function resolveApiModelRefCandidatesForConsumer(
  config: OpenClawConfig,
  params: {
    consumer: ApiConnectionConsumer;
    provider?: string;
  },
): ApiModelRefSelection[] {
  const entries = config.apiConnections?.entries ?? {};
  const all = Object.values(entries).filter(
    (entry) => entry.enabled !== false && entry.kind === "model",
  );
  const providerMatches = params.provider
    ? all.filter((entry) => entry.provider.toLowerCase() === params.provider?.toLowerCase())
    : [];
  const candidates = providerMatches.length ? providerMatches : all;
  const ordered = [
    ...candidates.filter((entry) => entry.consumers?.includes(params.consumer)),
    ...candidates.filter((entry) => entry.consumers?.includes("model")),
    ...candidates,
  ];
  const seen = new Set<string>();
  const selections: ApiModelRefSelection[] = [];
  for (const entry of ordered) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const metadata = readRecord(entry.metadata);
    const model =
      (typeof metadata.defaultModel === "string" && metadata.defaultModel.trim()) ||
      firstString(metadata.availableModels) ||
      modelFromProviderConfig(config, entry.provider);
    if (!model) continue;
    selections.push({
      entryId: entry.id,
      provider: entry.provider,
      model,
      modelRef: `${entry.provider}/${model}`,
    });
  }
  return selections;
}

export function applyModelUsageToApiConnectionMetering(
  config: OpenClawConfig,
  params: {
    consumer: ApiConnectionConsumer;
    executionId: string;
    modelUsage?: Record<string, unknown>;
  },
): ApiModelUsageMeteringResult | null {
  const modelUsage = readRecord(params.modelUsage);
  const inputTokens = finiteNumber(modelUsage.inputTokens);
  const outputTokens = finiteNumber(modelUsage.outputTokens);
  const totalTokens = finiteNumber(modelUsage.totalTokens) || inputTokens + outputTokens;
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) return null;

  const previousEntries = config.apiConnections?.entries ?? {};
  const entry = selectModelApiConnectionEntry(
    previousEntries,
    params.consumer,
    typeof modelUsage.provider === "string" ? modelUsage.provider : undefined,
  );
  if (!entry) return null;

  const metadata = readRecord(entry.metadata);
  const pricing = readRecord(metadata.pricing);
  const metering = readRecord(metadata.metering);
  if (
    metering.lastUsageRef === params.executionId ||
    readRecordedUsageRefs(metering.recordedUsageRefs).includes(params.executionId)
  ) {
    return {
      config,
      entryId: entry.id,
      costCny: 0,
      deduped: true,
    };
  }
  const costCny = calculateModelUsageCostCny({ modelUsage, pricing });
  const usage = {
    calls: 1,
    inputTokens,
    outputTokens,
    totalTokens,
    costCny,
  };
  const byConsumer = readRecord(metering.byConsumer);
  const consumerMetering = readRecord(byConsumer[params.consumer]);
  const now = new Date().toISOString();
  const nextEntry: ApiConnectionEntry = {
    ...entry,
    metadata: {
      ...metadata,
      metering: {
        ...addUsageTotals(metering, usage),
        recordedUsageRefs: appendRecordedUsageRef(metering.recordedUsageRefs, params.executionId),
        byConsumer: {
          ...byConsumer,
          [params.consumer]: {
            ...addUsageTotals(consumerMetering, usage),
            lastUsageRef: params.executionId,
            lastUsageAt: now,
          },
        },
        lastUsageRef: params.executionId,
        lastUsageAt: now,
      },
    },
  };

  return {
    config: {
      ...config,
      apiConnections: {
        entries: {
          ...previousEntries,
          [entry.id]: nextEntry,
        },
      },
    },
    entryId: entry.id,
    costCny,
  };
}
