import type {
  AttributionFinding,
  CompanyGoal,
  ObservationPackage,
  ObservationSignal,
} from "./types.js";

/**
 * 单个归因发现
 */
export type RankedCause = {
  /** 原因排序（1 = 最可能主因） */
  rank: number;
  title: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  impactLevel: "critical" | "high" | "medium" | "low" | "negligible";
  /** 关联的证据引用 ID */
  evidenceRefs: string[];
};

/**
 * 自动对比输入
 */
export type AttributionCompareInput = {
  /** 当前观察包（来自观察层） */
  observation: ObservationPackage;
  /** 上一周期的公司目标（如果有） */
  previousGoal?: CompanyGoal;
  /** 可选的现有归因报告 ID 引用 */
  attributionReportId?: string;
};

/**
 * 自动对比结果
 */
export type AttributionCompareResult = {
  /** 完成状态 */
  completionStatus: "on_track" | "partial" | "off_track" | "unknown";
  /** 差距描述 */
  gapSummary: string;
  /** 排序后的原因列表 */
  rankedCauses: RankedCause[];
  /** 数据是否不足以做出可靠归因 */
  dataInsufficient: boolean;
  /** 数据不足原因 */
  dataInsufficientReason?: string;
};

/**
 * 从 ObservationSignal 和 CompanyGoal 自动生成归因发现。
 *
 * 关键边界：数据不足时 primary_cause 为空，标记 data-insufficient。
 * 不强行给出主因，不创建 CompanyGoal/PlanningPackage/TaskPackage。
 */
export function compareObservationsToGoal(
  input: AttributionCompareInput,
): AttributionCompareResult {
  const { observation, previousGoal } = input;
  const rankedCauses: RankedCause[] = [];
  let rank = 0;

  // 如果没有历史目标，无法对比
  if (!previousGoal) {
    return {
      completionStatus: "unknown",
      gapSummary: "缺少上一周期公司目标，无法进行归因对比。需要先建立目标基线。",
      rankedCauses: [],
      dataInsufficient: true,
      dataInsufficientReason: "缺少历史 CompanyGoal 记录，无法计算目标和实际结果的差距。",
    };
  }

  // 检查观察数据是否充分
  if (observation.signals.length === 0) {
    return {
      completionStatus: "unknown",
      gapSummary: "当前观察包中没有有效信号，无法评估目标完成情况。",
      rankedCauses: [],
      dataInsufficient: true,
      dataInsufficientReason: "ObservationPackage 信号为空，缺少用于对比的实际数据。",
    };
  }

  // 简单的信号匹配分析：查找与目标指标相关的信号
  const relevantSignals = findRelevantSignals(observation.signals, previousGoal.metric);

  if (relevantSignals.length === 0) {
    return {
      completionStatus: "unknown",
      gapSummary: `当前观察信号未覆盖目标指标 "${previousGoal.metric}"。`,
      rankedCauses: [],
      dataInsufficient: true,
      dataInsufficientReason: `目标指标 "${previousGoal.metric}" 在当前观察数据中无对应信号。`,
    };
  }

  // 分析目标 vs 实际
  const targetValue = parseNumericTarget(previousGoal.target);
  const actualValues = relevantSignals
    .map((s) => extractNumericValue(s.summary))
    .filter((v): v is number => v !== null);

  if (targetValue === null || actualValues.length === 0) {
    rank++;
    rankedCauses.push({
      rank,
      title: "目标指标无法量化",
      summary: `目标 "${previousGoal.metric}" 的目标值 "${previousGoal.target}" 或观察信号中缺少可量化的数值，无法精确计算差距。`,
      confidence: "low",
      impactLevel: "medium",
      evidenceRefs: [observation.id, previousGoal.id],
    });

    return {
      completionStatus: "partial",
      gapSummary: `目标 "${previousGoal.metric}" 由于缺少量化数据无法精确评估。`,
      rankedCauses,
      dataInsufficient: false,
    };
  }

  const avgActual = actualValues.reduce((sum, v) => sum + v, 0) / actualValues.length;
  const gap = targetValue - avgActual;
  const gapPct = targetValue !== 0 ? Math.abs(gap / targetValue) * 100 : 0;

  // 确定完成状态
  let completionStatus: AttributionCompareResult["completionStatus"];
  if (gapPct <= 10) {
    completionStatus = "on_track";
  } else if (gapPct <= 30) {
    completionStatus = "partial";
  } else {
    completionStatus = "off_track";
  }

  const direction = gap > 0 ? "落后" : "超额完成";

  // 自动识别可能的原因
  rank++;
  const gapSignal = findGapSignal(observation.signals, previousGoal.metric);
  rankedCauses.push({
    rank,
    title: "目标与实际差距",
    summary: `目标 ${previousGoal.target}，实际约 ${avgActual.toFixed(2)}，${direction} ${gapPct.toFixed(1)}%。${gapSignal?.summary ?? ""}`,
    confidence: gapPct > 30 ? "high" : "medium",
    impactLevel: gapPct > 30 ? "critical" : gapPct > 10 ? "high" : "medium",
    evidenceRefs: [observation.id, previousGoal.id, ...relevantSignals.map((s) => s.id)],
  });

  // 查找异常信号
  for (const signal of observation.signals) {
    if (
      signal.summary.includes("失败") ||
      signal.summary.includes("阻塞") ||
      signal.summary.includes("不可用") ||
      signal.summary.includes("缺失")
    ) {
      rank++;
      rankedCauses.push({
        rank,
        title: signal.title,
        summary: signal.summary,
        confidence: "medium",
        impactLevel: "high",
        evidenceRefs: signal.evidenceRefs,
      });
    }
  }

  return {
    completionStatus,
    gapSummary:
      `目标 "${previousGoal.metric}" ${previousGoal.target}，` +
      `实际 ${avgActual.toFixed(2)}，${direction} ${gapPct.toFixed(1)}%。` +
      `发现 ${rankedCauses.length} 个可能原因。`,
    rankedCauses: rankedCauses.sort((a, b) => a.rank - b.rank),
    dataInsufficient: false,
  };
}

/**
 * 从信号中查找与目标指标相关的信号
 */
function findRelevantSignals(signals: ObservationSignal[], metric: string): ObservationSignal[] {
  const lowerMetric = metric.toLowerCase();
  return signals.filter((s) => {
    const text = `${s.title} ${s.summary}`.toLowerCase();
    return (
      text.includes(lowerMetric) ||
      lowerMetric.split(/\s+/).some((word) => word.length > 2 && text.includes(word))
    );
  });
}

/**
 * 尝试从目标字符串中解析数值
 */
function parseNumericTarget(target: string): number | null {
  const match = target.match(/([\d,.]+)\s*%?\s*$/);
  if (match) {
    return parseFloat(match[1].replace(/,/g, ""));
  }
  const num = parseFloat(target);
  return isNaN(num) ? null : num;
}

/**
 * 尝试从信号摘要中提取数值
 */
function extractNumericValue(summary: string): number | null {
  const matches = summary.match(/(\d+)\s*(?:个|项|次|条)/);
  if (matches) {
    return parseFloat(matches[1]);
  }
  return null;
}

/**
 * 查找与目标差距最相关的信号
 */
function findGapSignal(signals: ObservationSignal[], metric: string): ObservationSignal | null {
  const lowerMetric = metric.toLowerCase();
  return (
    signals.find((s) => {
      const text = `${s.title} ${s.summary}`.toLowerCase();
      return (
        (text.includes("差距") || text.includes("不足") || text.includes("滞后")) &&
        text.includes(lowerMetric)
      );
    }) ?? null
  );
}

/**
 * 将对比结果转换为 AttributionReport 输入
 */
export function toAttributionInput(
  result: AttributionCompareResult,
  observationPackageId: string,
): {
  title: string;
  summary: string;
  findings: AttributionFinding[];
} {
  return {
    title: `归因报告 ${new Date().toISOString().slice(0, 10)} ${observationPackageId}`,
    summary: result.gapSummary,
    findings: result.rankedCauses.map((cause) => ({
      id: `finding-${cause.rank}`,
      title: cause.title,
      summary: cause.summary,
      confidence: cause.confidence,
      observationSignalIds: cause.evidenceRefs,
    })),
  };
}
