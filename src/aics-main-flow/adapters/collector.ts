import type { ObservationSignal, ObservationPackage } from "../types.js";
import type { ObservationAdapter, AdapterFetchResult, SourceConfidence } from "./types.js";

/**
 * 适配器采集汇总结果
 */
export type CollectorResult = {
  /** 所有适配器的原始结果 */
  adapterResults: AdapterFetchResult[];
  /** 合并去重后的信号列表 */
  mergedSignals: ObservationSignal[];
  /** 合并后的证据引用列表 */
  mergedEvidenceRefs: AdapterFetchResult["evidenceRefs"];
  /** 汇总新鲜度 */
  overallFreshness: AdapterFetchResult["freshness"];
  /** 失败的适配器信息 */
  failures: Array<{ adapterId: string; error: string }>;
  /** 总体可信度 */
  overallConfidence: SourceConfidence;
};

/**
 * 从已注册的适配器批量采集观察数据。
 *
 * 适配器之间完全独立，一个失败不影响其他。
 * 采集结果中只包含事实和证据，不包含归因结论或策略建议。
 */
export async function collectObservations(
  adapters: ObservationAdapter[],
): Promise<CollectorResult> {
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.fetch()));

  const adapterResults: AdapterFetchResult[] = [];
  const failures: CollectorResult["failures"] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      adapterResults.push(result.value);
    } else {
      failures.push({
        adapterId: adapters[i].id,
        error: result.reason instanceof Error ? result.reason.message : "Unknown error",
      });
    }
  }

  // 合并信号（简单去重 id）
  const seenSignalIds = new Set<string>();
  const mergedSignals: ObservationSignal[] = [];
  for (const r of adapterResults) {
    for (const signal of r.signals) {
      if (!seenSignalIds.has(signal.id)) {
        seenSignalIds.add(signal.id);
        mergedSignals.push(signal);
      }
    }
  }

  // 合并证据引用
  const seenEvIds = new Set<string>();
  const mergedEvidenceRefs: AdapterFetchResult["evidenceRefs"] = [];
  for (const r of adapterResults) {
    for (const ev of r.evidenceRefs) {
      if (!seenEvIds.has(ev.id)) {
        seenEvIds.add(ev.id);
        mergedEvidenceRefs.push(ev);
      }
    }
  }

  // 计算整体新鲜度
  const hasFresh = adapterResults.some((r) => r.freshness === "fresh");
  const hasStale = adapterResults.some((r) => r.freshness === "stale");
  const allExpired =
    adapterResults.length > 0 &&
    adapterResults.every((r) => ["expired", "unknown"].includes(r.freshness));
  const overallFreshness = allExpired
    ? "expired"
    : hasFresh
      ? "fresh"
      : hasStale
        ? "stale"
        : "unknown";

  // 计算总体可信度
  const highCount = adapterResults.filter(
    (r) => adapters.find((a) => a.id === r.sourceId)?.defaultConfidence === "high",
  ).length;
  const lowCount = adapterResults.filter(
    (r) => adapters.find((a) => a.id === r.sourceId)?.defaultConfidence === "low",
  ).length;
  const overallConfidence: SourceConfidence =
    highCount >= adapterResults.length - failures.length - lowCount
      ? "high"
      : lowCount > 0
        ? "low"
        : "medium";

  return {
    adapterResults,
    mergedSignals,
    mergedEvidenceRefs,
    overallFreshness,
    failures,
    overallConfidence,
  };
}

/**
 * 将 CollectorResult 转换为 ObservationPackage 输入。
 * 注意：此函数只生成事实描述摘要，不生成归因结论。
 */
export function toObservationPackageInput(
  result: CollectorResult,
  title?: string,
): {
  title: string;
  summary: string;
  signals: ObservationSignal[];
} {
  const totalAdapters = result.adapterResults.length + result.failures.length;
  const successCount = result.adapterResults.length;

  const lines: string[] = [
    `${successCount}/${totalAdapters} 个数据源成功采集。`,
    `数据新鲜度: ${result.overallFreshness}。`,
    `可信度: ${result.overallConfidence}。`,
    "",
  ];

  if (result.failures.length > 0) {
    lines.push("以下数据源采集失败：");
    for (const f of result.failures) {
      lines.push(`- ${f.adapterId}: ${f.error}`);
    }
    lines.push("");
  }

  lines.push("采集信号摘要：");
  for (const signal of result.mergedSignals) {
    lines.push(`- ${signal.title}: ${signal.summary}`);
  }

  return {
    title: title ?? `自动观察 ${new Date().toISOString().slice(0, 10)}`,
    summary: lines.join("\n"),
    signals: result.mergedSignals,
  };
}
