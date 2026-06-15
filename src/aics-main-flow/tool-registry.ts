// ======================================================================
// ToolRegistry: 工具库管理
// ======================================================================
//
// 工具能力分组：
//   image.*       — 图片生成/编辑/分析
//   video.*       — 视频生成/剪辑/字幕
//   file.*        — 文件读写/打包
//   web.*         — 搜索/抓取/浏览器
//   workspace.*   — 工作区操作
//   text.*        — 文案/翻译/总结
//   data.*        — 数据分析/处理
//   human.*       — 人工确认
//   audit.*       — 审计
//
// 每个工具都有：capability、input/output schema、risk_level、质量规则

export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

export type ToolCapabilityGroup =
  | "image.generation"
  | "image.editing"
  | "image.inspect"
  | "video.generation"
  | "video.editing"
  | "video.caption"
  | "video.audio"
  | "file.read"
  | "file.write"
  | "file.packaging"
  | "web.search"
  | "web.fetch"
  | "web.browser"
  | "workspace.read"
  | "workspace.write"
  | "workspace.shell"
  | "text.generate"
  | "text.translate"
  | "text.summarize"
  | "data.analyze"
  | "data.export"
  | "human.confirm"
  | "audit.log";

export type ToolRegistration = {
  toolId: string;
  name: string;
  label: string;
  description: string;
  capabilities: ToolCapabilityGroup[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  requiresHumanConfirm: boolean;
  qualityCheckRules: string[];
  /** 执行此工具的处理函数 */
  handler: (input: Record<string, unknown>) => Promise<ToolCallResult>;
  /** 状态：enabled/disabled */
  enabled: boolean;
  /** 来源：core/plugin/external */
  source: "core" | "plugin" | "external";
};

export type ToolCallResult = {
  ok: boolean;
  output?: Record<string, unknown>;
  artifactRefs?: string[];
  error?: string;
  durationMs: number;
  qualityCheckPassed: boolean;
};

// ======================================================================
// ToolRegistry
// ======================================================================

const _tools = new Map<string, ToolRegistration>();

export const ToolRegistry = {
  register(tool: ToolRegistration): void {
    _tools.set(tool.toolId, tool);
  },

  unregister(toolId: string): boolean {
    return _tools.delete(toolId);
  },

  get(toolId: string): ToolRegistration | undefined {
    return _tools.get(toolId);
  },

  /** 按能力查询可用工具 */
  findByCapability(capability: ToolCapabilityGroup): ToolRegistration[] {
    return [..._tools.values()].filter((t) => t.enabled && t.capabilities.includes(capability));
  },

  /** 按多个能力查询 */
  findByCapabilities(capabilities: ToolCapabilityGroup[]): ToolRegistration[] {
    return [..._tools.values()].filter(
      (t) => t.enabled && capabilities.some((c) => t.capabilities.includes(c)),
    );
  },

  /** 按风险等级筛选 */
  findByRisk(maxRisk: ToolRiskLevel): ToolRegistration[] {
    const order: ToolRiskLevel[] = ["low", "medium", "high", "critical"];
    const maxIndex = order.indexOf(maxRisk);
    return [..._tools.values()].filter((t) => t.enabled && order.indexOf(t.riskLevel) <= maxIndex);
  },

  /** 列出所有已注册工具 */
  listAll(): ToolRegistration[] {
    return [..._tools.values()];
  },

  /** 列出所有启用的工具 */
  listEnabled(): ToolRegistration[] {
    return [..._tools.values()].filter((t) => t.enabled);
  },

  /** 统计 */
  summary(): { total: number; enabled: number; byRisk: Record<ToolRiskLevel, number> } {
    const all = [..._tools.values()];
    const enabled = all.filter((t) => t.enabled);
    const byRisk: Record<string, number> = {};
    for (const t of enabled) {
      byRisk[t.riskLevel] = (byRisk[t.riskLevel] ?? 0) + 1;
    }
    return {
      total: all.length,
      enabled: enabled.length,
      byRisk: byRisk as Record<ToolRiskLevel, number>,
    };
  },

  /** 清空（测试用） */
  _clear(): void {
    _tools.clear();
  },
};

// ======================================================================
// ToolCallRequest / ToolExecutionResponse
// ======================================================================

export type ToolCallRequest = {
  requestId: string;
  roleRunRef: string;
  workflowStepRef: string;
  toolCapability: ToolCapabilityGroup;
  candidateToolRefs?: string[];
  input: Record<string, unknown>;
  expectedOutput: string;
  riskLevel: ToolRiskLevel;
  humanConfirmPolicy: "auto" | "required" | "never";
  qualityRequirement: string;
  deadlineMs?: number;
};

export type ToolExecutionResponse = {
  requestId: string;
  selectedToolRef: string;
  artifactRefs: string[];
  structuredOutput: Record<string, unknown>;
  executionSummary: string;
  costSummary: { inputTokens: number; outputTokens: number; costCents: number };
  riskFlags: string[];
  blockedReason?: string;
  needHumanConfirm: boolean;
  humanConfirmRequest?: string;
  qualityCheckSummary: string;
};

// ======================================================================
// ToolExecutionEngine
// ======================================================================

export async function executeToolCall(request: ToolCallRequest): Promise<ToolExecutionResponse> {
  // 1. 按 capability 查找候选工具
  let candidates = ToolRegistry.findByCapability(request.toolCapability);

  // 2. 如果指定了候选工具，优先使用
  if (request.candidateToolRefs?.length) {
    const preferred = candidates.filter(
      (t) =>
        request.candidateToolRefs!.includes(t.toolId) ||
        request.candidateToolRefs!.includes(t.name),
    );
    if (preferred.length > 0) {
      candidates = preferred;
    }
  }

  if (candidates.length === 0) {
    return {
      requestId: request.requestId,
      selectedToolRef: "none",
      artifactRefs: [],
      structuredOutput: {},
      executionSummary: `没有找到匹配 capability "${request.toolCapability}" 的可用工具`,
      costSummary: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      riskFlags: ["no_tool_available"],
      blockedReason: `capability "${request.toolCapability}" 在工具库中不可用`,
      needHumanConfirm: false,
      qualityCheckSummary: "no_tool",
    };
  }

  // 3. 按风险政策过滤
  const allowedByRisk = candidates.filter((t) => {
    if (request.humanConfirmPolicy === "never" && t.riskLevel === "critical") {
      return false;
    }
    return true;
  });

  if (allowedByRisk.length === 0) {
    return {
      requestId: request.requestId,
      selectedToolRef: "blocked_by_risk",
      artifactRefs: [],
      structuredOutput: {},
      executionSummary: `所有候选工具均被风险政策拦截（最高允许 ${request.humanConfirmPolicy}）`,
      costSummary: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      riskFlags: ["all_blocked_by_risk"],
      blockedReason: "risk_policy_block",
      needHumanConfirm: true,
      humanConfirmRequest: `capability "${request.toolCapability}" 需要确认才能使用高风险工具`,
      qualityCheckSummary: "blocked",
    };
  }

  // 4. 选择优先级最高的工具（按注册顺序，或用更复杂的策略）
  const selected = allowedByRisk[0];

  // 5. 检查是否需要人工确认
  const needHumanConfirm =
    request.humanConfirmPolicy === "required" ||
    (selected.requiresHumanConfirm && request.humanConfirmPolicy !== "never");

  if (needHumanConfirm) {
    return {
      requestId: request.requestId,
      selectedToolRef: selected.toolId,
      artifactRefs: [],
      structuredOutput: {},
      executionSummary: `capability "${request.toolCapability}" 需要人工确认`,
      costSummary: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      riskFlags: ["human_confirm_required"],
      needHumanConfirm: true,
      humanConfirmRequest: `请确认使用 "${selected.label}" 执行 "${request.expectedOutput}"`,
      qualityCheckSummary: "human_confirm_pending",
    };
  }

  // 6. 执行工具
  try {
    const deadline = request.deadlineMs
      ? new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("tool_timeout")), request.deadlineMs!),
        )
      : null;

    const executePromise = selected.handler(request.input);
    const result = deadline ? await Promise.race([executePromise, deadline]) : await executePromise;

    const toolResult = result as ToolCallResult;

    return {
      requestId: request.requestId,
      selectedToolRef: selected.toolId,
      artifactRefs: toolResult.artifactRefs ?? [],
      structuredOutput: toolResult.output ?? {},
      executionSummary: toolResult.ok ? "工具执行成功" : `工具执行失败: ${toolResult.error}`,
      costSummary: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      riskFlags: toolResult.ok ? [] : ["tool_execution_error"],
      blockedReason: toolResult.error,
      needHumanConfirm: false,
      qualityCheckSummary: toolResult.qualityCheckPassed ? "passed" : "failed",
    };
  } catch (error) {
    return {
      requestId: request.requestId,
      selectedToolRef: selected.toolId,
      artifactRefs: [],
      structuredOutput: {},
      executionSummary: `工具执行异常: ${error instanceof Error ? error.message : String(error)}`,
      costSummary: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      riskFlags: ["tool_execution_exception"],
      blockedReason: error instanceof Error ? error.message : "Unknown tool error",
      needHumanConfirm: false,
      qualityCheckSummary: "exception",
    };
  }
}

// ======================================================================
// capabilities/resolve 自动匹配
// ======================================================================

export type CapabilityMatchResult =
  | { status: "ready"; tool: ToolRegistration }
  | { status: "candidate"; tools: ToolRegistration[] }
  | { status: "missing"; capability: ToolCapabilityGroup }
  | { status: "blocked"; capability: ToolCapabilityGroup; reason: string };

export type CapabilityResolveReport = {
  required: string[];
  results: CapabilityMatchResult[];
  summary: {
    ready: number;
    candidate: number;
    missing: number;
    blocked: number;
  };
};

/**
 * 将岗位的 requiredCapabilities 与工具库匹配。
 * 返回每个能力的匹配状态。
 */
export function resolveCapabilities(requiredCapabilities: string[]): CapabilityResolveReport {
  const results: CapabilityMatchResult[] = [];

  for (const cap of requiredCapabilities) {
    const normalized = cap.toLowerCase().replace(/[\s_-]+/g, ".");

    // 尝试在注册表中精确匹配
    const knownCapabilities = [
      ...new Set(ToolRegistry.listEnabled().flatMap((t) => t.capabilities)),
    ];

    const matches = knownCapabilities.filter(
      (kc) => kc === normalized || kc.startsWith(normalized) || normalized.startsWith(kc),
    );

    if (matches.length > 0) {
      const tools = ToolRegistry.findByCapabilities(matches as ToolCapabilityGroup[]);
      if (tools.length === 1) {
        results.push({ status: "ready", tool: tools[0] });
      } else if (tools.length > 0) {
        results.push({ status: "candidate", tools });
      } else {
        results.push({ status: "missing", capability: normalized as ToolCapabilityGroup });
      }
    } else {
      results.push({ status: "missing", capability: normalized as ToolCapabilityGroup });
    }
  }

  return {
    required: requiredCapabilities,
    results,
    summary: {
      ready: results.filter((r) => r.status === "ready").length,
      candidate: results.filter((r) => r.status === "candidate").length,
      missing: results.filter((r) => r.status === "missing").length,
      blocked: results.filter((r) => r.status === "blocked").length,
    },
  };
}
