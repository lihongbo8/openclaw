import { randomUUID } from "node:crypto";
import { createRoleExecutionEngine } from "./role-execution-engine.js";
import type { RoleExecutor, RoleResult } from "./role-execution-types.js";
import {
  RoleInstanceStore,
  type RoleArtifactRecord,
  type RoleExecutionStepRecord,
} from "./role-instance-store.js";
import { AicsMainFlowStore } from "./store.js";

// ======================================================================
// Dispatcher: 调度层服务
// ======================================================================
//
// 职责：
// 1. 从 AicsMainFlowStore 读取最新的 TaskPackage
// 2. 通过 RoleExecutionEngine 准备执行上下文
// 3. 通过抽象执行器执行任务
// 4. 将结果写回 AicsMainFlowStore 和 RoleInstanceStore
// 5. 控制 DispatchRun 状态机
//
// 这是 AICS 唯一可以物化 TaskPackage 并启动岗位执行的层。

export type DispatchRunStatus =
  | "created"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type DispatchConfig = {
  modelRef?: string;
  workspaceRoot?: string;
  /** 最大重试次数 */
  maxReworks?: number;
  /** 单次执行超时（毫秒） */
  timeoutMs?: number;
};

export type DispatchResult = {
  ok: boolean;
  dispatchRunId: string;
  status: DispatchRunStatus;
  roleResult?: RoleResult;
  error?: string;
  reworkCount: number;
  /** 日志条目 */
  logs: string[];
};

/**
 * 从当前主流程状态中取出最新 TaskPackage 并执行。
 *
 * 工作流：
 *   1. readModel() → 获取最新 TaskPackage 和 DispatchToRoleRequest
 *   2. 创建或获取 RoleInstance
 *   3. RoleExecutionEngine.prepare() → RoleExecutionContext
 *   4. executor.execute(context) → 原始输出
 *   5. RoleExecutionEngine 组装 RoleResult
 *   6. 写回 AicsMainFlowStore (runApprovedTask)
 *   7. 写回 RoleInstanceStore (recordRun + artifacts + issues)
 */
// ═══ 结构化日志 ═══

function log(level: "info" | "warn" | "error", event: string, detail?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, event, ...detail };
  if (level === "error") console.error(JSON.stringify(entry));
  else console.warn(JSON.stringify(entry)); // stdout 避免与 stderr 混淆
}

function toMainFlowOutcome(outcome: RoleResult["outcome"]): "succeeded" | "failed" | "blocked" {
  if (outcome === "succeeded" || outcome === "blocked") return outcome;
  return "failed";
}

function toStepRecords(steps: RoleResult["steps"]): RoleExecutionStepRecord[] {
  return steps.map((step) => ({
    stepId: `${step.stepIndex}:${step.stepName}`,
    order: step.stepIndex,
    kind: step.stepName,
    description: step.inputSummary,
    status: step.status,
    toolOutput: step.outputSummary,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    durationMs: step.completedAt ? step.completedAt - step.startedAt : undefined,
  }));
}

function toArtifactRecords(executionId: string, artifactRefs: string[]): RoleArtifactRecord[] {
  const now = Date.now();
  return artifactRefs.map((relPath, index) => ({
    artifactId: `${executionId}:artifact:${index}`,
    runId: executionId,
    relPath,
    kind: "document",
    createdAt: now,
  }));
}

export async function dispatchAndExecute(
  executor: RoleExecutor,
  config: DispatchConfig = {},
): Promise<DispatchResult> {
  const logs: string[] = [];
  const dispatchRunId = randomUUID();

  const store = new AicsMainFlowStore();
  const readModel = store.readModel();
  const latestTask = readModel.latest.taskPackage;
  const latestRequest = readModel.latest.dispatchToRoleRequest;

  log("info", "dispatch_start", { dispatchRunId });

  if (!latestTask) {
    log("error", "dispatch_no_task", { dispatchRunId });
    return {
      ok: false,
      dispatchRunId,
      status: "blocked",
      error: "没有可调度的 TaskPackage。请先完成规划确认和调度物化。",
      reworkCount: 0,
      logs,
    };
  }

  logs.push(`Dispatcher: 获取到 TaskPackage "${latestTask.title}" (id=${latestTask.id})`);

  // 重试控制
  const maxReworks = config.maxReworks ?? 3;
  let reworkCount = 0;
  let lastError: string | undefined;

  while (reworkCount <= maxReworks) {
    if (reworkCount > 0) {
      logs.push(`Dispatcher: 第 ${reworkCount} 次重试...`);
    }

    try {
      // 1. 获取或创建岗位实例
      const instance = RoleInstanceStore.ensureInstance({
        roleListingId: latestRequest?.roleListingId ?? latestTask.rolePlanItemId,
        roleTitle: latestRequest?.roleTitle ?? latestTask.title,
        workspaceDir: latestRequest?.workspaceDir ?? config.workspaceRoot ?? process.cwd(),
      });
      logs.push(`Dispatcher: 岗位实例 "${instance.roleTitle}" (id=${instance.instanceId})`);

      // 2. 准备执行上下文
      log("info", "dispatch_prepare", { dispatchRunId, taskTitle: latestTask.title });
      const engine = createRoleExecutionEngine();
      const context = engine.prepare(latestTask, {
        modelRef: config.modelRef,
        workspaceRoot: config.workspaceRoot,
        timeoutMs: config.timeoutMs,
      });
      logs.push(`Dispatcher: 执行上下文就绪，工作区=${context.workspaceDir}`);

      // 3. 记录运行开始
      const runRecord = RoleInstanceStore.recordRun({
        instanceId: instance.instanceId,
        taskPackageId: latestTask.id,
        executionId: context.executionId,
        status: "running",
        summary: "岗位执行中",
        startedAt: Date.now(),
      });
      logs.push(`Dispatcher: 运行记录创建 (runId=${runRecord.runId})`);

      // 4. 执行
      const roleResult = await engine.execute(context, executor);

      // 5. 更新运行记录
      RoleInstanceStore.recordRun({
        instanceId: runRecord.instanceId,
        taskPackageId: runRecord.taskPackageId,
        executionId: runRecord.executionId,
        status: roleResult.outcome === "succeeded" ? "completed" : "failed",
        summary: roleResult.summary.slice(0, 500),
        artifactRefs: roleResult.artifactRefs,
        error: roleResult.blockedReason,
        startedAt: roleResult.startedAt,
        completedAt: roleResult.completedAt,
        durationMs: roleResult.durationMs,
      });

      // 6. 记录步骤和产物
      RoleInstanceStore.recordSteps(
        instance.instanceId,
        context.executionId,
        toStepRecords(roleResult.steps),
      );
      RoleInstanceStore.recordArtifacts({
        instanceId: instance.instanceId,
        executionId: context.executionId,
        artifacts: toArtifactRecords(context.executionId, roleResult.artifactRefs),
      });

      // 7. 写回主流程
      store.update((state) => {
        state.roleResults.push({
          id: randomUUID(),
          kind: "RoleResult",
          status: roleResult.outcome === "succeeded" ? "completed" : "failed",
          createdAt: roleResult.startedAt,
          updatedAt: roleResult.completedAt,
          auditRefs: [],
          taskPackageId: latestTask.id,
          dispatchToRoleRequestId: latestRequest?.id ?? "",
          outcome: toMainFlowOutcome(roleResult.outcome),
          summary: roleResult.summary.slice(0, 500),
          artifactRefs: roleResult.artifactRefs,
        });
        return state;
      });

      logs.push(
        `Dispatcher: 执行${roleResult.outcome === "succeeded" ? "成功" : "失败"}，` +
          `${roleResult.steps.length} 步，${roleResult.toolUsage.totalToolCalls} 次工具调用，` +
          `${roleResult.durationMs}ms`,
      );

      return {
        ok: roleResult.outcome === "succeeded",
        dispatchRunId,
        status: roleResult.outcome === "succeeded" ? "completed" : "failed",
        roleResult,
        reworkCount,
        logs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logs.push(`Dispatcher: 执行异常 (第 ${reworkCount + 1} 次): ${lastError}`);

      // 检查是否可重试
      if (reworkCount < maxReworks && isRetryableError(lastError)) {
        reworkCount++;
        continue;
      }

      // 不可重试，记录失败
      RoleInstanceStore.recordRun({
        instanceId: "unknown",
        taskPackageId: latestTask.id,
        executionId: dispatchRunId,
        status: "blocked",
        summary: lastError,
        error: lastError,
        startedAt: Date.now(),
        completedAt: Date.now(),
      });

      return {
        ok: false,
        dispatchRunId,
        status: "blocked",
        error: lastError,
        reworkCount,
        logs,
      };
    }
  }

  // 重试耗尽
  return {
    ok: false,
    dispatchRunId,
    status: "failed",
    error: `重试 ${maxReworks} 次后仍然失败：${lastError}`,
    reworkCount,
    logs,
  };
}

/**
 * 创建用于 AICS main flow Gateway 的调度执行器
 */
export function createMainFlowDispatchExecutor(
  executor: RoleExecutor,
): (config?: DispatchConfig) => Promise<DispatchResult> {
  return (config) => dispatchAndExecute(executor, config);
}

// ======================================================================
// Helpers
// ======================================================================

function isRetryableError(error: string): boolean {
  const transientPatterns = [
    "timeout",
    "timed out",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "network",
    "temporarily unavailable",
    "rate limit",
    "too many requests",
    "503",
    "502",
    "504",
  ];
  return transientPatterns.some((p) => error.toLowerCase().includes(p.toLowerCase()));
}
