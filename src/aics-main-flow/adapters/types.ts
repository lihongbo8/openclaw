import type { ObservationSignal } from "../types.js";

/**
 * 数据源可信度级别
 * - high: 已注册、在有效期内的受控来源
 * - medium: 已注册但置信度不确定的来源
 * - low: 未注册、过期或冲突中的来源
 */
export type SourceConfidence = "high" | "medium" | "low";

/**
 * 数据源新鲜度
 */
export type SourceFreshness = "fresh" | "stale" | "expired" | "unknown";

/**
 * 单个证据引用
 */
export type EvidenceRef = {
  id: string;
  sourceId: string;
  sourceType: string;
  label: string;
  confidence: SourceConfidence;
  freshness: SourceFreshness;
  collectedAt: number;
  /** 可选：引用具体的数据记录 ID */
  recordId?: string;
};

/**
 * 适配器采集结果
 */
export type AdapterFetchResult = {
  sourceId: string;
  sourceType: string;
  signals: ObservationSignal[];
  evidenceRefs: EvidenceRef[];
  freshness: SourceFreshness;
  collectedAt: number;
  /** 适配器级别的错误信息，不影响其他适配器 */
  error?: string;
};

/**
 * 观察数据源适配器接口。
 *
 * 每个适配器负责从一种数据源收集事实、趋势和证据引用。
 * 适配器 MUST NOT 输出归因结论、策略建议或执行建议。
 */
export type ObservationAdapter = {
  /** 适配器唯一标识 */
  readonly id: string;
  /** 可读标签 */
  readonly label: string;
  /** 数据源类型 */
  readonly sourceType: string;
  /** 默认可信度 */
  readonly defaultConfidence: SourceConfidence;

  /**
   * 采集观察数据。
   * 返回原始的事实信号和证据引用，不做归因或策略解释。
   */
  fetch(): Promise<AdapterFetchResult>;
};
