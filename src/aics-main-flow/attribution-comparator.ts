import type {
  AttributionFinding,
  CompanyGoal,
  ObservationPackage,
  ObservationSignal,
} from "./types.js";

export const AICS_ATTRIBUTION_DIMENSIONS = [
  "商城问题",
  "本地服务问题",
  "岗位供给问题",
  "授权问题",
  "能力路由问题",
  "API / 模型 / 工具 / Skill 问题",
  "页面体验问题",
  "调度链路问题",
  "岗位执行质量问题",
  "外部能力未吸收",
  "外部产品压力",
  "风险与数据质量问题",
  "目标设定问题",
] as const;

export type AicsAttributionDimension = (typeof AICS_ATTRIBUTION_DIMENSIONS)[number];

/**
 * 单个归因发现
 */
export type RankedCause = {
  /** 原因排序（1 = 最可能主因） */
  rank: number;
  title: AicsAttributionDimension | "目标与实际差距" | "目标指标无法量化";
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
  const attributionSignals = attributionEligibleSignals(observation.signals);
  const rankedCauses: RankedCause[] = [];
  let rank = 0;

  if (observation.signals.length === 0) {
    return {
      completionStatus: "unknown",
      gapSummary: "当前观察包中没有有效信号，无法评估目标完成情况。",
      rankedCauses: [],
      dataInsufficient: true,
      dataInsufficientReason: "ObservationPackage 信号为空，缺少用于对比的实际数据。",
    };
  }

  if (attributionSignals.length === 0) {
    return {
      completionStatus: "unknown",
      gapSummary: "当前观察包没有可用于正式归因的证据信号。",
      rankedCauses: [],
      dataInsufficient: true,
      dataInsufficientReason: "观察信号缺少 evidenceRefs，或被标记为不可归因/待验证。",
    };
  }

  // 如果没有历史目标，仍然可以基于观察证据生成原因候选；但不能声称完成率差距。
  if (!previousGoal) {
    for (const signal of attributionSignals) {
      const marketplaceCause = classifyMarketplaceCause(signal);
      if (!marketplaceCause) continue;
      rankedCauses.push({
        rank: ++rank,
        title: marketplaceCause.title,
        summary: marketplaceCause.summary,
        confidence: marketplaceCause.confidence,
        impactLevel: marketplaceCause.impactLevel,
        evidenceRefs: [signal.id],
      });
    }
    if (rankedCauses.length === 0) {
      const first = attributionSignals[0];
      rankedCauses.push({
        rank: 1,
        title: "风险与数据质量问题",
        summary: `当前观察证据尚未命中固定归因维度，需要人工复核：${first.summary}`,
        confidence: "low",
        impactLevel: "medium",
        evidenceRefs: [first.id],
      });
    }
    return {
      completionStatus: "unknown",
      gapSummary: `基于 ${attributionSignals.length} 条已确认观察证据生成归因候选；由于尚无已确认目标，本报告只解释问题来源，不计算目标完成率。`,
      rankedCauses: rankedCauses.sort((a, b) => a.rank - b.rank),
      dataInsufficient: false,
    };
  }

  // 简单的信号匹配分析：查找与目标指标相关的信号
  const relevantSignals = findRelevantSignals(attributionSignals, previousGoal.metric);

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
      evidenceRefs: relevantSignals.map((s) => s.id),
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
  const gapSignal = findGapSignal(attributionSignals, previousGoal.metric);
  rankedCauses.push({
    rank,
    title: "目标与实际差距",
    summary: `目标 ${previousGoal.target}，实际约 ${avgActual.toFixed(2)}，${direction} ${gapPct.toFixed(1)}%。${gapSignal?.summary ?? ""}`,
    confidence: gapPct > 30 ? "high" : "medium",
    impactLevel: gapPct > 30 ? "critical" : gapPct > 10 ? "high" : "medium",
    evidenceRefs: relevantSignals.map((s) => s.id),
  });

  // 查找岗位商城生产运营维度的异常信号
  const seenCauseSignalIds = new Set<string>();
  for (const signal of attributionSignals) {
    const marketplaceCause = classifyMarketplaceCause(signal);
    if (marketplaceCause && !seenCauseSignalIds.has(signal.id)) {
      seenCauseSignalIds.add(signal.id);
      rankedCauses.push({
        rank: ++rank,
        title: marketplaceCause.title,
        summary: marketplaceCause.summary,
        confidence: marketplaceCause.confidence,
        impactLevel: marketplaceCause.impactLevel,
        evidenceRefs: [signal.id],
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

function attributionEligibleSignals(signals: ObservationSignal[]): ObservationSignal[] {
  return signals.filter((signal) => {
    const record = signal as ObservationSignal & {
      usableForAttribution?: boolean;
      confidence?: string;
      credibility?: string;
      qualityStatus?: string;
    };
    if (!signal.evidenceRefs.length) return false;
    if (record.usableForAttribution === false) return false;
    if (record.qualityStatus === "rejected" || record.qualityStatus === "needs_review")
      return false;
    if (record.confidence === "low" || record.credibility === "low") return false;
    return true;
  });
}

function classifyMarketplaceCause(
  signal: ObservationSignal,
): Pick<RankedCause, "title" | "summary" | "confidence" | "impactLevel"> | null {
  const text = `${signal.title} ${signal.summary}`.toLowerCase();
  const hasProblem =
    /失败|阻塞|不可用|缺失|无反应|pending|rejected|blocked|unhealthy|timeout|error|异常/.test(text);
  if (/目标|指标|target|metric|过高|过低|不合理|无法量化|口径/.test(text) && hasProblem) {
    return {
      title: "目标设定问题",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "high",
    };
  }
  if (/数据质量|缺证据|无证据|低可信|过期|待验证|样本|口径不一致/.test(text)) {
    return {
      title: "风险与数据质量问题",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "medium",
    };
  }
  if (
    /本地|runtime|openclaw|gateway|sqlite|进程|端口|localhost|127\.0\.0\.1/.test(text) &&
    hasProblem
  ) {
    return {
      title: "本地服务问题",
      summary: signal.summary,
      confidence: "high",
      impactLevel: "high",
    };
  }
  if (/api|secretref|provider|模型|tool|skill|工具|连接|健康/.test(text) && hasProblem) {
    return {
      title: "API / 模型 / 工具 / Skill 问题",
      summary: signal.summary,
      confidence: "high",
      impactLevel: "high",
    };
  }
  if (/授权|entitlement|authorized|scope|actor_context|费用确认|额度/.test(text) && hasProblem) {
    return {
      title: "授权问题",
      summary: signal.summary,
      confidence: "high",
      impactLevel: "critical",
    };
  }
  if (/能力路由|可调用|callable|capability|独特能力/.test(text) && hasProblem) {
    return {
      title: "能力路由问题",
      summary: signal.summary,
      confidence: "high",
      impactLevel: "high",
    };
  }
  if (
    /岗位供给|岗位数量|岗位质量|品类|能力标签|样例|listing|role listing/.test(text) &&
    hasProblem
  ) {
    return {
      title: "岗位供给问题",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "high",
    };
  }
  if (/审核|audit|review|发布|上架|商品|商城/.test(text) && hasProblem) {
    return {
      title: "商城问题",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "high",
    };
  }
  if (/页面|按钮|点击|无法使用|滑动|表单|保存|回显|体验|导航/.test(text) && hasProblem) {
    return {
      title: "页面体验问题",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "medium",
    };
  }
  if (/执行质量|产物|验收|结果质量|输出|审计|账本|readback|roleresult/.test(text) && hasProblem) {
    return {
      title: "岗位执行质量问题",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "high",
    };
  }
  if (/调度|dispatch|taskpackage|roleplanitem|派发|执行队列/.test(text) && hasProblem) {
    return {
      title: "调度链路问题",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "high",
    };
  }
  if (/竞品|竞争|替代品|外部产品|产品压力|价格压力/.test(text)) {
    return {
      title: "外部产品压力",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "medium",
    };
  }
  if (/外部|技术|工具|模型|可吸收|capability_library|新能力/.test(text)) {
    return {
      title: text.includes("风险") ? "风险与数据质量问题" : "外部能力未吸收",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "medium",
    };
  }
  if (hasProblem) {
    return {
      title: "风险与数据质量问题",
      summary: signal.summary,
      confidence: "medium",
      impactLevel: "high",
    };
  }
  return null;
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
