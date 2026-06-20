import type { AdapterFetchResult, ObservationAdapter } from "./adapters/types.js";
import type { ObservationToolStep, RawToolEvidence } from "./generic-observation-engine.js";

export type ObservationAdapterCollectorConfig = {
  adapter: ObservationAdapter;
  toolPlanId: string;
};

function resultSummary(result: AdapterFetchResult): string {
  if (result.error && result.signals.length === 0) {
    return `${result.sourceId} 采集失败：${result.error}`;
  }
  if (result.signals.length === 0) {
    return `${result.sourceId} 没有返回可用观察事实。`;
  }
  return result.signals
    .slice(0, 3)
    .map((signal) => `${signal.title}：${signal.summary}`)
    .join("；");
}

export function createObservationAdapterCollector(config: ObservationAdapterCollectorConfig) {
  return async (step: ObservationToolStep): Promise<RawToolEvidence> => {
    const result = await config.adapter.fetch();
    const evidenceRef = result.evidenceRefs[0];
    const success = result.signals.length > 0 && !result.error;
    return {
      id: `raw:${step.id}:${config.adapter.id}:${result.collectedAt}`,
      toolPlanId: config.toolPlanId,
      toolStepId: step.id,
      toolType: step.toolType,
      toolName: step.toolName ?? config.adapter.label,
      rawOutputRef:
        evidenceRef?.recordId ??
        evidenceRef?.id ??
        `${config.adapter.sourceType}:${config.adapter.id}:${result.collectedAt}`,
      rawSummary: resultSummary(result),
      collectedAt: new Date(result.collectedAt).toISOString(),
      success,
      ...(success ? {} : { error: result.error ?? "no_observation_signals" }),
    };
  };
}
