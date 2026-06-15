import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { proposeMemoryFromRoleResult } from "../../aics-main-flow/memory-system.js";
import {
  executeWithRealTools,
  createHttpImageExecutor,
} from "../../aics-main-flow/real-tool-executor.js";
import { createRoleExecutionEngine } from "../../aics-main-flow/role-execution-engine.js";
import type { RoleExecutionStep, RoleResult } from "../../aics-main-flow/role-execution-types.js";
import { RoleInstanceStore } from "../../aics-main-flow/role-instance-store.js";
import { AicsMainFlowStore, runApprovedTask } from "../../aics-main-flow/store.js";
import type {
  AicsMainFlowReadModel,
  DispatchToRoleRequest,
  RolePlanItem,
  TaskPackage,
} from "../../aics-main-flow/types.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayParam(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function respondError(respond: RespondFn, error: unknown): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}

function timestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function progressForStatus(status: string): number {
  switch (status) {
    case "completed":
      return 100;
    case "running":
      return 58;
    case "failed":
      return 72;
    case "blocked":
      return 16;
    case "needs_human_confirm":
      return 42;
    default:
      return 24;
  }
}

function executionBlockedReason(
  task: TaskPackage | null,
  request: DispatchToRoleRequest,
  match: { status?: string } | undefined,
): string | null {
  if (!task) return "missing_task_package";
  if (
    (request.capabilityRequestId || match?.status === "needs_unique_capability") &&
    (task.status === "blocked" || request.status === "blocked" || request.toolSkillReady === false)
  ) {
    return "unique_capability_pending";
  }
  if (!request.roleListingId || !request.entitlementId) {
    return "authorization_required";
  }
  if (request.confirmExecution !== true) {
    return "execution_confirmation_required";
  }
  if (request.costConfirmed !== true) {
    return "cost_not_confirmed";
  }
  if (request.toolSkillReady === false) {
    return "tool_skill_not_ready";
  }
  if (request.apiBindingReady === false) {
    return "api_binding_required";
  }
  return null;
}

function buildExecutionConsoleReadModel(readModel: AicsMainFlowReadModel) {
  const objects = readModel.objects;
  const matches = readModel.capabilities.matches;
  const uniqueRequests = readModel.capabilities.uniqueRequests;
  const blockedReasons = readModel.blockedReasons.filter((reason) => reason.stage === "role");
  const taskById = new Map(objects.taskPackages.map((task) => [task.id, task]));
  const rolePlanById = new Map(objects.rolePlanItems.map((item) => [item.id, item]));
  const planningById = new Map(objects.planningPackages.map((pkg) => [pkg.id, pkg]));
  const goalById = new Map(objects.goals.map((goal) => [goal.id, goal]));
  const resultsByRequestId = new Map<string, (typeof objects.roleResults)[number][]>();
  for (const result of objects.roleResults) {
    const list = resultsByRequestId.get(result.dispatchToRoleRequestId) ?? [];
    list.push(result);
    resultsByRequestId.set(result.dispatchToRoleRequestId, list);
  }

  const executions = objects.dispatchToRoleRequests
    .map((request) => {
      const task = taskById.get(request.taskPackageId) ?? null;
      const rolePlan = task ? (rolePlanById.get(task.rolePlanItemId) ?? null) : null;
      const planning = task ? (planningById.get(task.planningPackageId) ?? null) : null;
      const goal = task ? (goalById.get(task.goalId) ?? null) : null;
      const match = rolePlan
        ? matches.find((item) => item.rolePlanItemId === rolePlan.id)
        : undefined;
      const latestResult =
        (resultsByRequestId.get(request.id) ?? []).sort(
          (a, b) => timestamp(b.createdAt) - timestamp(a.createdAt),
        )[0] ?? null;
      const uniqueRequest = match?.uniqueCapabilityRequestId
        ? (uniqueRequests.find((item) => item.id === match.uniqueCapabilityRequestId) ?? null)
        : null;

      const blockedReason = executionBlockedReason(task, request, match);

      const status =
        latestResult?.outcome === "succeeded"
          ? "completed"
          : latestResult?.outcome === "failed"
            ? "failed"
            : latestResult?.outcome === "blocked" || blockedReason
              ? "blocked"
              : request.status === "running"
                ? "running"
                : "ready";

      return {
        id: request.id,
        dispatchRequestId: request.id,
        taskPackageId: task?.id ?? request.taskPackageId,
        rolePlanItemId: rolePlan?.id ?? request.rolePlanItemId,
        roleListingId: request.roleListingId ?? "",
        roleTitle: request.roleTitle ?? rolePlan?.title ?? "待分配岗位",
        title: task?.title ?? rolePlan?.title ?? "未命名执行任务",
        taskText: task?.taskText ?? rolePlan?.taskIntent ?? "",
        expectedOutput: rolePlan?.expectedOutput ?? "",
        sourceGoalTitle: goal?.title ?? "未关联公司目标",
        planningTitle: planning?.title ?? "未关联规划方案",
        workBlockTitle: rolePlan?.category ?? task?.category ?? "通用品类",
        status,
        progress: progressForStatus(status),
        currentStep: latestResult
          ? latestResult.outcome === "succeeded"
            ? "产物已回写"
            : "等待处理执行结果"
          : blockedReason
            ? "等待解除阻塞"
            : "等待执行",
        authorized: !blockedReason,
        blockedReason,
        capabilitySummary: match?.summary ?? "等待调度层匹配云端授权能力。",
        allowedTools: request.allowedTools ?? match?.allowedTools ?? [],
        allowedSkills: request.allowedSkills ?? match?.allowedSkills ?? [],
        requiredCapabilityRefs:
          task?.requiredCapabilityRefs ?? request.requiredCapabilityRefs ?? [],
        uniqueCapabilityRequest: uniqueRequest,
        canRun: status === "ready" && !blockedReason,
        updatedAt: request.updatedAt,
        createdAt: request.createdAt,
        result: latestResult,
        artifactRefs: latestResult?.artifactRefs ?? [],
      };
    })
    .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));

  const counts = {
    ready: executions.filter((item) => item.status === "ready").length,
    running: executions.filter((item) => item.status === "running").length,
    needsHumanConfirm: executions.filter((item) => item.status === "needs_human_confirm").length,
    blocked: executions.filter((item) => item.status === "blocked").length,
    failed: executions.filter((item) => item.status === "failed").length,
    completed: executions.filter((item) => item.status === "completed").length,
  };

  return {
    summary: {
      total: executions.length,
      ...counts,
      artifactCount: executions.reduce((sum, item) => sum + item.artifactRefs.length, 0),
      blockedReasonCount:
        blockedReasons.length + executions.filter((item) => item.blockedReason).length,
    },
    executions,
    blockedReasons,
    latest: executions[0] ?? null,
    updatedAt: readModel.updatedAt,
  };
}

function selectTaskPackage(
  readModel: AicsMainFlowReadModel,
  params: Record<string, unknown>,
): {
  taskPackage: TaskPackage;
  request: DispatchToRoleRequest | null;
  rolePlanItem: RolePlanItem | null;
} {
  const requestedTaskPackageId = stringParam(params, "taskPackageId");
  const requestedDispatchId = stringParam(params, "dispatchToRoleRequestId");
  const request = requestedDispatchId
    ? (readModel.objects.dispatchToRoleRequests.find((item) => item.id === requestedDispatchId) ??
      null)
    : readModel.latest.dispatchToRoleRequest;
  const taskPackage = requestedTaskPackageId
    ? readModel.objects.taskPackages.find((item) => item.id === requestedTaskPackageId)
    : request
      ? readModel.objects.taskPackages.find((item) => item.id === request.taskPackageId)
      : readModel.latest.taskPackage;
  if (!taskPackage) {
    throw new Error("No TaskPackage available. Run the pipeline first.");
  }
  const rolePlanItem =
    readModel.objects.rolePlanItems.find((item) => item.id === taskPackage.rolePlanItemId) ?? null;
  return { taskPackage, request, rolePlanItem };
}

function toStoreOutcome(outcome: RoleResult["outcome"]): "succeeded" | "failed" | "blocked" {
  if (outcome === "succeeded" || outcome === "blocked") return outcome;
  return "failed";
}

function toStoredSteps(steps: RoleExecutionStep[]) {
  return steps.map((step) => ({
    stepId: `${step.stepIndex}:${step.stepName}`,
    order: step.stepIndex,
    kind: step.stepName,
    description: step.inputSummary,
    status: step.status,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    durationMs: step.completedAt ? step.completedAt - step.startedAt : undefined,
    toolOutput: step.outputSummary,
  }));
}

export const aicsExecutionHandlers: GatewayRequestHandlers = {
  "aics.executionConsole.readModel.get": ({ respond }) => {
    try {
      const readModel = new AicsMainFlowStore().readModel();
      respond(true, buildExecutionConsoleReadModel(readModel));
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.execution.result.record": ({ params, respond }) => {
    try {
      const record =
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const store = new AicsMainFlowStore();
      const readModel = store.readModel();
      const { taskPackage, request } = selectTaskPackage(readModel, record);
      const preflight = store.executionPreflight({
        taskPackageId: taskPackage.id,
        ...(request?.id ? { dispatchToRoleRequestId: request.id } : {}),
      });
      if (!preflight.canRun) {
        respond(true, {
          ok: false,
          status: "blocked",
          taskPackageId: taskPackage.id,
          dispatchToRoleRequestId: request?.id ?? null,
          blockedReasons: preflight.blockedReasons,
        });
        return;
      }
      const executionId = stringParam(record, "executionId") ?? `cloud_${Date.now()}`;
      const status = stringParam(record, "status");
      const ok = record.ok === true || status === "completed" || status === "succeeded";
      const outcome: RoleResult["outcome"] = ok
        ? "succeeded"
        : status === "blocked"
          ? "blocked"
          : "failed";
      const entitlementId = request?.entitlementId;
      const summary =
        stringParam(record, "summary") ??
        stringParam(record, "message") ??
        (ok ? "云端岗位执行已完成并回写审计。" : "云端岗位执行未成功完成。");
      const auditRecordId = stringParam(record, "auditRecordId") ?? stringParam(record, "auditId");
      const auditRef = auditRecordId
        ? `audit:${auditRecordId}`
        : (stringParam(record, "auditRef") ?? `audit:${executionId}`);
      const ledgerEntryId = stringParam(record, "ledgerEntryId");
      const ledgerRef =
        stringParam(record, "ledgerRef") ??
        (ledgerEntryId
          ? `ledger:${ledgerEntryId}`
          : entitlementId
            ? `ledger:role_execution:${entitlementId}:${executionId}`
            : `ledger:role_execution:${executionId}`);
      const memoryCandidateRef =
        stringParam(record, "memoryCandidateRef") ?? `memory_candidate:${executionId}`;
      const artifactRefs = [...stringArrayParam(record, "artifactRefs"), auditRef];

      store.update((state) =>
        runApprovedTask(
          state,
          {
            taskPackageId: taskPackage.id,
            ...(request?.id ? { dispatchToRoleRequestId: request.id } : {}),
            ledgerRef,
            memoryCandidateRef,
            result: {
              id: executionId,
              outcome,
              summary: summary.slice(0, 500),
              artifactRefs,
            },
          },
          Date.now(),
        ),
      );
      respond(true, { ok: true, executionId, outcome, auditRef, ledgerRef, memoryCandidateRef });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.execution.run": ({ params, respond }) => {
    try {
      const store = new AicsMainFlowStore();
      const readModel = store.readModel();
      const { taskPackage, request, rolePlanItem } = selectTaskPackage(readModel, params);
      const preflight = store.executionPreflight({
        taskPackageId: taskPackage.id,
        ...(request?.id ? { dispatchToRoleRequestId: request.id } : {}),
      });
      if (!preflight.canRun) {
        respond(true, {
          ok: false,
          status: "blocked",
          taskPackageId: taskPackage.id,
          dispatchToRoleRequestId: request?.id ?? null,
          blockedReasons: preflight.blockedReasons,
        });
        return;
      }
      const workspaceRoot = stringParam(params, "workspaceRoot");
      const modelRef = stringParam(params, "modelRef") ?? "deepseek-custom/deepseek-chat";
      const startedAt = Date.now();

      store.update((state) =>
        runApprovedTask(
          state,
          {
            taskPackageId: taskPackage.id,
            ...(request?.id ? { dispatchToRoleRequestId: request.id } : {}),
          },
          startedAt,
        ),
      );

      const apiKey = process.env.DEEPSEEK_API_KEY;
      const toolExecutor = createHttpImageExecutor(apiKey);

      // Prepare execution context
      const engine = createRoleExecutionEngine();
      const context = engine.prepare(taskPackage, {
        workspaceRoot,
        modelRef,
        availableTools: toolExecutor.capabilities,
        timeoutMs: 300_000,
      });

      // Execute with real tools
      executeWithRealTools(context, toolExecutor, apiKey)
        .then(async (executorResult) => {
          const outcome = toStoreOutcome(executorResult.outcome as RoleResult["outcome"]);
          const effectiveRoleListingId =
            request?.roleListingId ?? rolePlanItem?.roleCapabilityRef ?? taskPackage.rolePlanItemId;
          const effectiveEntitlementId = request?.entitlementId;
          // Build RoleResult
          const roleResult: RoleResult = {
            executionId: context.executionId,
            taskPackageId: context.taskPackage.id,
            roleListingId: effectiveRoleListingId,
            roleTitle: request?.roleTitle ?? context.rolePackage.manifest.title,
            outcome,
            summary: String(executorResult.output ?? "").slice(0, 2000),
            artifactRefs: [],
            steps: Array.isArray(executorResult.steps)
              ? (executorResult.steps as RoleExecutionStep[])
              : [],
            modelUsage: {
              inputTokens:
                (executorResult.modelUsage as RoleResult["modelUsage"] | undefined)?.inputTokens ??
                0,
              outputTokens:
                (executorResult.modelUsage as RoleResult["modelUsage"] | undefined)?.outputTokens ??
                0,
              totalTokens:
                (executorResult.modelUsage as RoleResult["modelUsage"] | undefined)?.totalTokens ??
                0,
              costCents:
                (executorResult.modelUsage as RoleResult["modelUsage"] | undefined)?.costCents ?? 0,
            },
            toolUsage: {
              totalToolCalls:
                (executorResult.toolUsage as RoleResult["toolUsage"] | undefined)?.totalToolCalls ??
                0,
              successfulCalls:
                (executorResult.toolUsage as RoleResult["toolUsage"] | undefined)
                  ?.successfulCalls ?? 0,
              failedCalls:
                (executorResult.toolUsage as RoleResult["toolUsage"] | undefined)?.failedCalls ?? 0,
            },
            blockedReason: executorResult.error,
            startedAt,
            completedAt: Date.now(),
            durationMs: Date.now() - startedAt,
          };
          // 记录到本地运行库
          const instance = RoleInstanceStore.ensureInstance({
            roleListingId: effectiveRoleListingId,
            roleTitle: request?.roleTitle ?? context.rolePackage.manifest.title,
            workspaceDir: context.workspaceDir,
          });

          RoleInstanceStore.recordRun({
            instanceId: instance.instanceId,
            taskPackageId: taskPackage.id,
            executionId: context.executionId,
            status: roleResult.outcome === "succeeded" ? "completed" : "failed",
            summary: roleResult.summary.slice(0, 500),
            artifactRefs: roleResult.artifactRefs,
            error: roleResult.blockedReason,
            startedAt: roleResult.startedAt,
            completedAt: roleResult.completedAt,
            durationMs: roleResult.durationMs,
          });

          RoleInstanceStore.recordSteps(
            instance.instanceId,
            context.executionId,
            toStoredSteps(roleResult.steps),
          );
          RoleInstanceStore.recordArtifacts({
            instanceId: instance.instanceId,
            executionId: context.executionId,
            artifacts: roleResult.artifactRefs.map((relPath, index) => ({
              artifactId: `${context.executionId}:artifact:${index}`,
              runId: context.executionId,
              relPath,
              kind: "document",
              createdAt: Date.now(),
            })),
          });

          // 生成记忆候选
          const memoryCandidates = proposeMemoryFromRoleResult({
            roleTitle: context.rolePackage.manifest.title,
            roleListingId: effectiveRoleListingId,
            outcome: roleResult.outcome,
            summary: roleResult.summary,
            steps: roleResult.steps.map((step) => ({
              kind: step.toolCalls.length ? "tool_call" : step.stepName,
              description: step.outputSummary ?? step.inputSummary,
              status: step.status,
            })),
          });

          // 写回主流程
          const memoryCandidateRef = memoryCandidates[0]?.candidateId
            ? `memory_candidate:${memoryCandidates[0].candidateId}`
            : `memory_candidate:${context.executionId}`;
          const ledgerRef = effectiveEntitlementId
            ? `ledger:role_execution:${effectiveEntitlementId}:${context.executionId}`
            : `ledger:role_execution:${context.executionId}`;
          const auditRef = `audit:${context.executionId}`;
          store.update((state) =>
            runApprovedTask(state, {
              taskPackageId: taskPackage.id,
              ...(request?.id ? { dispatchToRoleRequestId: request.id } : {}),
              ledgerRef,
              memoryCandidateRef,
              result: {
                id: context.executionId,
                outcome,
                summary: roleResult.summary.slice(0, 500),
                artifactRefs: [...roleResult.artifactRefs, auditRef],
              },
            }),
          );

          respond(true, {
            ok: roleResult.outcome === "succeeded",
            executionId: context.executionId,
            roleResult,
            memoryCandidates: memoryCandidates.length,
            instance: { instanceId: instance.instanceId, title: instance.roleTitle },
          });
        })
        .catch((err: Error) => {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, `Execution failed: ${err.message}`),
          );
        });
    } catch (error) {
      respondError(respond, error);
    }
  },
};
