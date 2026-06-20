import type { ApiConnectionConsumer } from "./controllers/api-connections.ts";
import type { SessionsUsageResult } from "./types.ts";

export type ApiMeteringTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCny: number;
};

export type ApiConsumerMeteringRow = ApiMeteringTotals & {
  consumer: string;
};

export type ApiModelMeteringRow = {
  entry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  pricing: Record<string, unknown>;
  metering: Record<string, unknown>;
  totals: ApiMeteringTotals;
};

export type ApiBudgetStatus = "missing_pricing" | "exceeded" | "ok" | "unset";

export type ApiBudgetRow = {
  label: string;
  model: string;
  currentCostCny: number;
  budgetLimitCny: number;
  status: ApiBudgetStatus;
};

export type ApiLedgerSyncRow = {
  entryLabel: string;
  status: string;
  message: string;
  usageRef: string;
  cloudRef: string;
  updatedAt: string;
  pendingUsageRefs: string[];
};

export type ApiMeteringViewModel = {
  entries: Array<Record<string, unknown>>;
  modelRows: ApiModelMeteringRow[];
  modelTotals: ApiMeteringTotals;
  consumerTotals: Array<{ consumer: string; totals: ApiMeteringTotals }>;
  budgetRows: ApiBudgetRow[];
  ledgerSyncRows: ApiLedgerSyncRow[];
  usageDays: number;
  hasModelMetering: boolean;
  meteringForEntry: (entry: Record<string, unknown>) => ApiMeteringTotals;
  consumerMeteringForEntry: (entry: Record<string, unknown>) => ApiConsumerMeteringRow[];
  meteringForEntries: (entries: Array<Record<string, unknown>>) => ApiMeteringTotals;
  meteringForConsumerEntries: (
    entries: Array<Record<string, unknown>>,
    consumer: ApiConnectionConsumer,
  ) => ApiMeteringTotals;
  budgetStatusForEntry: (entry: Record<string, unknown>) => ApiBudgetRow;
};

export const MODEL_TOKEN_CONSUMER_VALUES = new Set<ApiConnectionConsumer>([
  "local_dialog",
  "operations_backend",
  "build_session",
  "buyer_storefront",
  "user_center",
  "developer_center",
  "ai_review",
  "role_execution",
  "media_model",
  "model",
]);

export const MODEL_TOKEN_CONSUMER_LABELS: Record<string, string> = {
  local_dialog: "本地主对话框",
  operations_backend: "经营后台",
  build_session: "BuildSession",
  buyer_storefront: "商城前台",
  user_center: "使用者中心",
  developer_center: "开发者中心",
  ai_review: "AI 辅助审核",
  role_execution: "岗位执行",
  media_model: "图片/视频/语音",
  model: "通用模型池",
};

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function numberFromUnknown(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function emptyApiMeteringTotals(): ApiMeteringTotals {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costCny: 0,
  };
}

export function addApiMeteringTotals(
  left: ApiMeteringTotals,
  right: ApiMeteringTotals,
): ApiMeteringTotals {
  return {
    calls: left.calls + right.calls,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    costCny: left.costCny + right.costCny,
  };
}

export function meteringFromRecord(
  metering: Record<string, unknown>,
  pricing: Record<string, unknown>,
): ApiMeteringTotals {
  const inputTokens = numberFromUnknown(metering.inputTokens ?? metering.promptTokens);
  const outputTokens = numberFromUnknown(metering.outputTokens ?? metering.completionTokens);
  const totalTokens = numberFromUnknown(
    metering.totalTokens ?? metering.tokens ?? inputTokens + outputTokens,
  );
  const recordedCost = numberFromUnknown(metering.costCny ?? metering.cost ?? metering.amountCny);
  const inputPrice = numberFromUnknown(pricing.inputCnyPerMillion);
  const outputPrice = numberFromUnknown(pricing.outputCnyPerMillion);
  const calculatedCost =
    inputPrice > 0 || outputPrice > 0
      ? (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice
      : 0;
  return {
    calls: numberFromUnknown(metering.calls ?? metering.callCount),
    inputTokens,
    outputTokens,
    totalTokens,
    costCny: recordedCost > 0 ? recordedCost : calculatedCost,
  };
}

export function usageDaysFromResult(usageResult: SessionsUsageResult | null | undefined): number {
  const usageStartMs = Date.parse(String(usageResult?.startDate ?? ""));
  const usageEndMs = Date.parse(String(usageResult?.endDate ?? ""));
  return Number.isFinite(usageStartMs) && Number.isFinite(usageEndMs)
    ? Math.max(1, Math.floor((usageEndMs - usageStartMs) / 86_400_000) + 1)
    : 1;
}

function hasMetering(totals: ApiMeteringTotals): boolean {
  return (
    totals.calls > 0 ||
    totals.inputTokens > 0 ||
    totals.outputTokens > 0 ||
    totals.totalTokens > 0 ||
    totals.costCny > 0
  );
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function getEntriesFromReadModel(readModel: unknown): Array<Record<string, unknown>> {
  const model = recordFromUnknown(readModel);
  if (Array.isArray(model.entries)) {
    return model.entries.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );
  }
  return Object.values(recordFromUnknown(model.groups)).flatMap((group) =>
    Array.isArray(group)
      ? group.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
      : [],
  );
}

function modelSetForApiConnectionEntry(entry: Record<string, unknown>): Set<string> {
  const metadata = recordFromUnknown(entry.metadata);
  const defaultModel = String(metadata.defaultModel ?? "")
    .trim()
    .toLowerCase();
  const availableModels = Array.isArray(metadata.availableModels)
    ? metadata.availableModels
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .map((value) => value.trim().toLowerCase())
    : [];
  return new Set([defaultModel, ...availableModels].filter(Boolean));
}

function matchesApiConnectionModelUsage(
  usage: Record<string, unknown>,
  provider: string,
  modelSet: Set<string>,
): boolean {
  const usageProvider = String(usage.provider ?? "")
    .trim()
    .toLowerCase();
  const usageModel = String(usage.model ?? "")
    .trim()
    .toLowerCase();
  return usageProvider === provider && (modelSet.size === 0 || modelSet.has(usageModel));
}

export function resolveSessionUsageConsumer(
  session: Record<string, unknown>,
): ApiConnectionConsumer {
  const origin = recordFromUnknown(session.origin);
  const searchable = [
    session.key,
    session.label,
    session.channel,
    session.chatType,
    origin.label,
    origin.provider,
    origin.surface,
    origin.chatType,
    origin.from,
    origin.to,
  ]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ")
    .toLowerCase();
  if (/developer|dev-center|developer_center|开发者/u.test(searchable)) return "developer_center";
  if (/user-center|user_center|用户中心|使用者/u.test(searchable)) return "user_center";
  if (
    /buyer|storefront|marketplace-dialog|marketplace_dialog|shop|商城前台|买家/u.test(searchable)
  ) {
    return "buyer_storefront";
  }
  if (/build-session|build_session|buildsession|岗位创造/u.test(searchable)) return "build_session";
  if (/review|audit|ai-review|ai_review|审核/u.test(searchable)) return "ai_review";
  if (/role-execution|role_execution|岗位执行|execution/u.test(searchable)) return "role_execution";
  if (/operations|operation|aics|main-flow|经营|调度|规划|归因/u.test(searchable)) {
    return "operations_backend";
  }
  return "local_dialog";
}

function sessionUsageMeteringForEntry(
  entry: Record<string, unknown>,
  usageResult: SessionsUsageResult | null | undefined,
): ApiMeteringTotals {
  if (entry.kind !== "model") return emptyApiMeteringTotals();
  const provider = String(entry.provider ?? "")
    .trim()
    .toLowerCase();
  if (!provider) return emptyApiMeteringTotals();
  const metadata = recordFromUnknown(entry.metadata);
  const pricing = recordFromUnknown(metadata.pricing);
  const modelSet = modelSetForApiConnectionEntry(entry);
  const usageByModel = Array.isArray(usageResult?.aggregates?.byModel)
    ? (usageResult.aggregates.byModel as Array<Record<string, unknown>>)
    : [];
  return usageByModel.reduce<ApiMeteringTotals>((totals, usage) => {
    if (!matchesApiConnectionModelUsage(usage, provider, modelSet)) return totals;
    const usageTotals = recordFromUnknown(usage.totals);
    const metering = meteringFromRecord(
      {
        calls: numberFromUnknown(usage.count),
        inputTokens: usageTotals.input,
        outputTokens: usageTotals.output,
        totalTokens: usageTotals.totalTokens,
      },
      pricing,
    );
    return addApiMeteringTotals(totals, metering);
  }, emptyApiMeteringTotals());
}

function sessionUsageMeteringByConsumerForEntry(
  entry: Record<string, unknown>,
  usageResult: SessionsUsageResult | null | undefined,
): ApiConsumerMeteringRow[] {
  if (entry.kind !== "model") return [];
  const provider = String(entry.provider ?? "")
    .trim()
    .toLowerCase();
  if (!provider) return [];
  const metadata = recordFromUnknown(entry.metadata);
  const pricing = recordFromUnknown(metadata.pricing);
  const modelSet = modelSetForApiConnectionEntry(entry);
  const sessions = Array.isArray(usageResult?.sessions)
    ? (usageResult.sessions as Array<Record<string, unknown>>)
    : [];
  const byConsumer = new Map<string, ApiMeteringTotals>();
  for (const session of sessions) {
    const usage = recordFromUnknown(session.usage);
    const modelUsage = Array.isArray(usage.modelUsage)
      ? (usage.modelUsage as Array<Record<string, unknown>>)
      : [];
    for (const item of modelUsage) {
      if (!matchesApiConnectionModelUsage(item, provider, modelSet)) continue;
      const usageTotals = recordFromUnknown(item.totals);
      const metering = meteringFromRecord(
        {
          calls: numberFromUnknown(item.count),
          inputTokens: usageTotals.input,
          outputTokens: usageTotals.output,
          totalTokens: usageTotals.totalTokens,
        },
        pricing,
      );
      const consumer = resolveSessionUsageConsumer(session);
      byConsumer.set(
        consumer,
        addApiMeteringTotals(byConsumer.get(consumer) ?? emptyApiMeteringTotals(), metering),
      );
    }
  }
  return Array.from(byConsumer.entries()).map(([consumer, totals]) => ({ consumer, ...totals }));
}

export function createApiMeteringViewModel(params: {
  readModel?: unknown;
  entries?: Array<Record<string, unknown>>;
  usageResult?: SessionsUsageResult | null;
  includeSessionUsage?: boolean;
}): ApiMeteringViewModel {
  const entries = params.entries ?? getEntriesFromReadModel(params.readModel);
  const usageResult = params.includeSessionUsage === false ? null : params.usageResult;
  const usageDays = usageDaysFromResult(params.usageResult);

  const meteringForEntry = (entry: Record<string, unknown>): ApiMeteringTotals => {
    const metadata = recordFromUnknown(entry.metadata);
    const metering = recordFromUnknown(metadata.metering ?? metadata.usage);
    const pricing = recordFromUnknown(metadata.pricing);
    return addApiMeteringTotals(
      meteringFromRecord(metering, pricing),
      sessionUsageMeteringForEntry(entry, usageResult),
    );
  };

  const consumerMeteringForEntry = (entry: Record<string, unknown>): ApiConsumerMeteringRow[] => {
    const metadata = recordFromUnknown(entry.metadata);
    const metering = recordFromUnknown(metadata.metering ?? metadata.usage);
    const pricing = recordFromUnknown(metadata.pricing);
    const byConsumer = recordFromUnknown(metering.byConsumer);
    const rows = Object.entries(byConsumer).map(([consumer, value]) => ({
      consumer,
      ...meteringFromRecord(recordFromUnknown(value), pricing),
    }));
    const sessionRows = sessionUsageMeteringByConsumerForEntry(entry, usageResult);
    const sessionRowsToMerge = sessionRows.length
      ? sessionRows
      : (() => {
          const sessionMetering = sessionUsageMeteringForEntry(entry, usageResult);
          return hasMetering(sessionMetering)
            ? [{ consumer: "local_dialog", ...sessionMetering }]
            : [];
        })();
    for (const sessionMetering of sessionRowsToMerge) {
      const existingIndex = rows.findIndex((item) => item.consumer === sessionMetering.consumer);
      if (existingIndex >= 0) {
        const existing = rows[existingIndex]!;
        rows[existingIndex] = {
          consumer: sessionMetering.consumer,
          ...addApiMeteringTotals(existing, sessionMetering),
        };
      } else {
        rows.push(sessionMetering);
      }
    }
    return rows
      .filter(hasMetering)
      .sort((left, right) => right.costCny - left.costCny || right.totalTokens - left.totalTokens);
  };

  const meteringForEntries = (targetEntries: Array<Record<string, unknown>>): ApiMeteringTotals =>
    targetEntries.reduce<ApiMeteringTotals>(
      (totals, entry) => addApiMeteringTotals(totals, meteringForEntry(entry)),
      emptyApiMeteringTotals(),
    );

  const meteringForConsumerEntries = (
    targetEntries: Array<Record<string, unknown>>,
    consumer: ApiConnectionConsumer,
  ): ApiMeteringTotals =>
    targetEntries.reduce<ApiMeteringTotals>((totals, entry) => {
      if (consumer === "model") {
        return addApiMeteringTotals(totals, meteringForEntry(entry));
      }
      const consumerMetering = consumerMeteringForEntry(entry).find(
        (item) => item.consumer === consumer,
      );
      return consumerMetering ? addApiMeteringTotals(totals, consumerMetering) : totals;
    }, emptyApiMeteringTotals());

  const budgetStatusForEntry = (entry: Record<string, unknown>): ApiBudgetRow => {
    const metadata = recordFromUnknown(entry.metadata);
    const pricing = recordFromUnknown(metadata.pricing);
    const totals = meteringForEntry(entry);
    const budget = recordFromUnknown(metadata.budget);
    const dailyBudgetCny = numberFromUnknown(budget.dailyCny);
    const budgetLimitCny = dailyBudgetCny > 0 ? dailyBudgetCny * usageDays : 0;
    const lacksPricing =
      entry.kind === "model" &&
      totals.totalTokens > 0 &&
      (numberFromUnknown(pricing.inputCnyPerMillion) <= 0 ||
        numberFromUnknown(pricing.outputCnyPerMillion) <= 0);
    const exceeded = budgetLimitCny > 0 && totals.costCny > budgetLimitCny;
    return {
      label: String(entry.name ?? entry.provider ?? "模型 Provider"),
      model: String(metadata.defaultModel ?? "未选择模型"),
      currentCostCny: totals.costCny,
      budgetLimitCny,
      status: lacksPricing
        ? "missing_pricing"
        : exceeded
          ? "exceeded"
          : budgetLimitCny > 0
            ? "ok"
            : "unset",
    };
  };

  const modelRows = entries
    .filter((entry) => entry.kind === "model")
    .map((entry) => {
      const metadata = recordFromUnknown(entry.metadata);
      const pricing = recordFromUnknown(metadata.pricing);
      const metering = recordFromUnknown(metadata.metering ?? metadata.usage);
      return {
        entry,
        metadata,
        pricing,
        metering,
        totals: meteringForEntry(entry),
      };
    })
    .filter((row) => hasMetering(row.totals));
  const modelTotals = modelRows.reduce(
    (totals, row) => addApiMeteringTotals(totals, row.totals),
    emptyApiMeteringTotals(),
  );
  const consumerTotals = Array.from(
    modelRows
      .flatMap((row) =>
        consumerMeteringForEntry(row.entry).map((item) => ({
          consumer: item.consumer,
          totals: item,
        })),
      )
      .reduce((map, item) => {
        map.set(
          item.consumer,
          addApiMeteringTotals(map.get(item.consumer) ?? emptyApiMeteringTotals(), item.totals),
        );
        return map;
      }, new Map<string, ApiMeteringTotals>()),
  )
    .map(([consumer, totals]) => ({ consumer, totals }))
    .filter((item) => hasMetering(item.totals))
    .sort((left, right) => right.totals.costCny - left.totals.costCny);
  const budgetRows = modelRows.map((row) => budgetStatusForEntry(row.entry));
  const ledgerSyncRows = modelRows
    .map((row) => {
      const sync = recordFromUnknown(row.metering.cloudLedgerSync);
      const status = stringFromUnknown(sync.status);
      if (!status) return null;
      return {
        entryLabel: String(row.entry.name ?? row.entry.provider ?? row.entry.id ?? "模型 Provider"),
        status,
        message: stringFromUnknown(sync.message),
        usageRef: stringFromUnknown(sync.usageRef),
        cloudRef: stringFromUnknown(sync.cloudRef),
        updatedAt: stringFromUnknown(sync.updatedAt),
        pendingUsageRefs: stringArrayFromUnknown(sync.pendingUsageRefs),
      } satisfies ApiLedgerSyncRow;
    })
    .filter((row): row is ApiLedgerSyncRow => Boolean(row));

  return {
    entries,
    modelRows,
    modelTotals,
    consumerTotals,
    budgetRows,
    ledgerSyncRows,
    usageDays,
    hasModelMetering: modelTotals.totalTokens > 0 || modelTotals.costCny > 0,
    meteringForEntry,
    consumerMeteringForEntry,
    meteringForEntries,
    meteringForConsumerEntries,
    budgetStatusForEntry,
  };
}
