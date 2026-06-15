import type { TaskPackage } from "./types.js";

// ======================================================================
// Role Package 解析结果
// ======================================================================

/** 岗位包清单 */
export type RolePackageManifest = {
  roleId: string;
  title: string;
  description: string;
  version: string;
  /** requiredCapabilities: 岗位需要的能力声明 */
  requiredCapabilities: string[];
  /** 工作流列表 */
  workflows: string[];
  /** 技能列表 */
  skills: string[];
  /** 知识库文件列表 */
  knowledgeFiles: string[];
  /** 模板文件列表 */
  templateFiles: string[];
  /** SOP 文件列表 */
  sopFiles: string[];
};

/** 从文件系统加载的岗位包内容 */
export type LoadedRolePackage = {
  manifest: RolePackageManifest;
  listing: string;
  sopContent: string;
  skillsContent: string;
  knowledgeContent: string;
  templatesContent: string;
  validationRules: string;
  packageDir: string;
};

// ======================================================================
// 执行上下文
// ======================================================================

/** 岗位执行运行时上下文 */
export type RoleExecutionContext = {
  /** 唯一执行 ID */
  executionId: string;
  /** 来源 TaskPackage */
  taskPackage: TaskPackage;
  /** 加载完成的岗位包 */
  rolePackage: LoadedRolePackage;
  /** 工作区目录（产物输出位置） */
  workspaceDir: string;
  /** 模型标识 */
  modelRef: string;
  /** 可用工具声明 */
  availableTools: string[];
  /** 超时（毫秒） */
  timeoutMs: number;
  /** 最大输出字符数 */
  maxOutputChars: number;
};

// ======================================================================
// 执行步骤记录
// ======================================================================

export type RoleExecutionStep = {
  stepIndex: number;
  stepName: string;
  status: "running" | "completed" | "failed" | "skipped";
  startedAt: number;
  completedAt?: number;
  inputSummary: string;
  outputSummary?: string;
  toolCalls: RoleToolCallRecord[];
  error?: string;
};

export type RoleToolCallRecord = {
  toolName: string;
  toolCallId: string;
  inputSummary: string;
  outputSummary?: string;
  durationMs: number;
  status: "ok" | "error" | "timeout";
  error?: string;
};

// ======================================================================
// 执行结果
// ======================================================================

export type RoleExecutionOutcome = "succeeded" | "failed" | "blocked" | "timed_out";

export type RoleResult = {
  executionId: string;
  taskPackageId: string;
  roleListingId?: string;
  roleTitle?: string;
  outcome: RoleExecutionOutcome;
  summary: string;
  /** 产物引用列表（文件路径或 URL） */
  artifactRefs: string[];
  /** 执行步骤记录 */
  steps: RoleExecutionStep[];
  /** 模型用量摘要 */
  modelUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCents: number;
  };
  /** 工具用量摘要 */
  toolUsage: {
    totalToolCalls: number;
    successfulCalls: number;
    failedCalls: number;
  };
  blockedReason?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
};

// ======================================================================
// 执行器接口
// ======================================================================

/**
 * 抽象执行器接口。负责实际调用 AI 模型执行任务。
 *
 * 实现可以是：
 * - OpenClaw embedded agent (native)
 * - 外部子进程
 * - API 调用
 */
export type RoleExecutor = {
  execute(context: RoleExecutionContext): Promise<{
    output: string;
    steps: RoleExecutionStep[];
    modelUsage: RoleResult["modelUsage"];
    toolUsage: RoleResult["toolUsage"];
    outcome: RoleExecutionOutcome;
    error?: string;
  }>;
};

// ═══ 调度层→岗位层协议 ═══

export type RoleExecutionResponse = {
  executionId: string;
  status: "accepted" | "rejected" | "requires_human_confirm";
  reason?: string;
  acceptedAt?: number;
};

export type RoleRun = {
  runId: string;
  instanceId: string;
  taskPackageId: string;
  executionId: string;
  status: "running" | "completed" | "failed" | "blocked" | "cancelled";
  steps: RoleExecutionStep[];
  summary: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  reworkCount: number;
};

export type Checkpoint = {
  checkpointId: string;
  runId: string;
  stepId: string;
  label: string;
  state: Record<string, unknown>;
  createdAt: number;
};

// ═══ 岗位层→工具层协议 ═══

export type ToolCallRequest = {
  callId: string;
  capabilityRef: string;
  toolName?: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  riskLevel: "safe" | "caution" | "high_risk";
  requiresHumanConfirm: boolean;
};

export type ToolExecutionResponse = {
  callId: string;
  ok: boolean;
  toolName: string;
  output: unknown;
  artifacts: ToolArtifact[];
  durationMs: number;
  modelUsage?: { model: string; inputTokens: number; outputTokens: number };
  error?: string;
};

export type ToolArtifact = {
  artifactId: string;
  kind: "image" | "video" | "document" | "archive";
  relPath: string;
  mimeType: string;
  sizeBytes: number;
};
