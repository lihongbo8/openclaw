import type { AicsMainFlowState, ObservationPackage } from "../types.js";
import type { ObservationAdapter, AdapterFetchResult } from "./types.js";

/**
 * 历史基线适配器配置
 */
export type HistoricalAdapterConfig = {
  /** 读取当前主流程状态的函数 */
  readState: () => AicsMainFlowState;
};

/**
 * 从历史 ObservationPackage 读取周期对比数据的适配器。
 *
 * 采集内容：
 * - 上一周期的观察摘要
 * - 信号数量变化趋势
 * - 历史基线引用
 */
export function createHistoricalAdapter(config: HistoricalAdapterConfig): ObservationAdapter {
  const sourceType = "aics_historical_baseline";

  return {
    id: "historical-baseline",
    label: "历史基线对比",
    sourceType,
    defaultConfidence: "medium",

    async fetch(): Promise<AdapterFetchResult> {
      const collectedAt = Date.now();
      const state = config.readState();
      const signals: AdapterFetchResult["signals"] = [];
      const evidenceRefs: AdapterFetchResult["evidenceRefs"] = [];

      const sortedObservations = [...state.observations].sort((a, b) => b.createdAt - a.createdAt);
      const currentObs = sortedObservations[0];
      const previousObs = sortedObservations[1];

      if (previousObs) {
        signals.push({
          id: "previous-observation-baseline",
          title: "上周期观察基线",
          summary: `上周期观察 "${previousObs.title}" 包含 ${previousObs.signals.length} 个信号，创建于 ${new Date(previousObs.createdAt).toISOString()}`,
          evidenceRefs: [previousObs.id],
        });
        evidenceRefs.push({
          id: previousObs.id,
          sourceId: "historical-baseline",
          sourceType,
          label: `ObservationPackage: ${previousObs.title}`,
          confidence: "medium",
          freshness: "stale",
          collectedAt,
          recordId: previousObs.id,
        });
      }

      if (currentObs && previousObs) {
        const signalDiff = currentObs.signals.length - previousObs.signals.length;
        const trend = signalDiff > 0 ? "上升" : signalDiff < 0 ? "下降" : "持平";
        signals.push({
          id: "observation-signal-trend",
          title: "信号数量趋势",
          summary: `相比上周期，信号数量 ${trend}（${previousObs.signals.length} → ${currentObs.signals.length}，变化 ${signalDiff > 0 ? "+" : ""}${signalDiff}）`,
          evidenceRefs: [currentObs.id, previousObs.id],
        });
      } else if (currentObs && !previousObs) {
        signals.push({
          id: "first-observation-note",
          title: "首次观察",
          summary: `这是第一个观察包 "${currentObs.title}"，暂无历史基线`,
          evidenceRefs: [currentObs.id],
        });
      }

      if (!currentObs && !previousObs) {
        return {
          sourceId: "historical-baseline",
          sourceType,
          signals: [],
          evidenceRefs: [],
          freshness: "unknown",
          collectedAt,
          error: "暂无历史观察记录，无法生成基线对比",
        };
      }

      return {
        sourceId: "historical-baseline",
        sourceType,
        signals,
        evidenceRefs,
        freshness: "fresh",
        collectedAt,
      };
    },
  };
}
