import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  getLocalRoleExecutionAudit,
  getLocalRoleExecutionAuditByExecutionId,
  getLocalRoleEntitlement,
  getLocalRoleLedgerEntry,
  getLocalRoleLedgerEntryByExecutionId,
  getLocalRoleListing,
  recordLocalRoleExecutionReadback,
} from "../../aics-main-flow/local-role-marketplace.js";
import { createRoleExecutionEngine } from "../../aics-main-flow/role-execution-engine.js";
import type { RoleExecutionStep, RoleResult } from "../../aics-main-flow/role-execution-types.js";
import { RoleInstanceStore } from "../../aics-main-flow/role-instance-store.js";
import { createRoleProductExecutionExecutor } from "../../aics-main-flow/role-product-execution-workflow.js";
import {
  AicsMainFlowStore,
  recordRoleResultEvidenceReadback,
  runApprovedTask,
} from "../../aics-main-flow/store.js";
import type {
  AicsMainFlowReadModel,
  DispatchToRoleRequest,
  RoleResultExecutionEvidence,
  RolePlanItem,
  TaskPackage,
} from "../../aics-main-flow/types.js";
import { resolveApiModelRefCandidatesForConsumer } from "../../api-connections/metering.js";
import {
  resolveApiModelRuntimeForConsumer,
  type ApiModelRuntimeBinding,
} from "../../api-connections/runtime.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { getActiveSecretsRuntimeSnapshot } from "../../secrets/runtime-state.js";
import { resolveAicsCloudConnectionFromApiConnections } from "./aics-api-connections.js";
import { recordModelUsageToApiMetering } from "./aics-api-metering.js";
import type { GatewayRequestContext, GatewayRequestHandlers, RespondFn } from "./types.js";

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

function objectParam<T>(params: Record<string, unknown>, key: string): T | undefined {
  const value = params[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : undefined;
}

function hasNumericModelUsageEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const modelUsage = value as Record<string, unknown>;
  return (
    typeof modelUsage.totalTokens === "number" ||
    typeof modelUsage.inputTokens === "number" ||
    typeof modelUsage.outputTokens === "number" ||
    typeof modelUsage.costCents === "number"
  );
}

function finiteModelCostCents(evidence: RoleResultExecutionEvidence): number {
  const costCents = evidence.modelUsage?.costCents;
  return typeof costCents === "number" && Number.isFinite(costCents) ? costCents : 0;
}

function existingCostSummary(
  evidence: RoleResultExecutionEvidence,
): NonNullable<RoleResultExecutionEvidence["costSummary"]> | null {
  const value = evidence.costSummary;
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function buildExecutionCostSummary(params: {
  evidence: RoleResultExecutionEvidence;
  ledgerRef: string;
  roleListingId?: string;
  entitlementId?: string;
}): NonNullable<RoleResultExecutionEvidence["costSummary"]> {
  const existing = existingCostSummary(params.evidence);
  if (existing) {
    return {
      ...existing,
      ...(existing.ledgerRef ? {} : { ledgerRef: params.ledgerRef }),
    };
  }
  const ledgerReadback =
    params.ledgerRef && params.ledgerRef.trim() ? getLocalRoleLedgerEntry(params.ledgerRef) : null;
  const listing =
    (params.roleListingId ? getLocalRoleListing(params.roleListingId) : null) ??
    (params.entitlementId
      ? getLocalRoleEntitlement(params.entitlementId)
        ? getLocalRoleListing(getLocalRoleEntitlement(params.entitlementId)!.roleListingId)
        : null
      : null);
  const modelUsageCostCents = finiteModelCostCents(params.evidence);
  const authorizationFeeCents =
    ledgerReadback?.authorizationFeeCents ?? listing?.authorizationFeeCents ?? 0;
  const executionFeeCents = ledgerReadback?.executionFeeCents ?? modelUsageCostCents;
  return {
    authorizationFeeCents,
    executionFeeCents,
    modelUsageCostCents,
    totalCostCents: authorizationFeeCents + executionFeeCents,
    currency: "CNY",
    source: ledgerReadback ? "local_ledger_readback" : "local_execution_evidence",
    ledgerRef: params.ledgerRef,
  };
}

function buildHumanConfirmationRef(params: {
  request?: DispatchToRoleRequest;
  executionId: string;
  existing?: string;
}): string | undefined {
  if (params.existing?.trim()) return params.existing.trim();
  if (params.request?.confirmExecution !== true) return undefined;
  const requestRef = params.request.id || params.request.entitlementId || "local";
  return `human:confirm:${requestRef}:${params.executionId}`;
}

function stringParamAny(params: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringParam(params, key);
    if (value) return value;
  }
  return undefined;
}

function booleanParamAny(params: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => params[key] === true);
}

function pluginAicsConfig(config: OpenClawConfig): Record<string, unknown> {
  const value = config.plugins?.entries?.aics?.config;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pluginAicsString(config: OpenClawConfig, key: string): string | undefined {
  return stringParam(pluginAicsConfig(config), key);
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
    return "missing_api_binding";
  }
  return null;
}

type ExecutionConsoleApiBlock = {
  stage: "dispatch";
  code: "missing_api_binding";
  message: string;
};

type ExecutionConsoleApiRuntime = {
  entryId: string;
  provider: string;
  model: string;
  modelRef: string;
};

async function resolveRoleExecutionApiStatus(config: OpenClawConfig): Promise<{
  apiBlock: ExecutionConsoleApiBlock | null;
  apiRuntime: ExecutionConsoleApiRuntime | null;
}> {
  try {
    const runtime = await resolveOpenAIImageRuntime(config);
    return runtime
      ? {
          apiBlock: null,
          apiRuntime: {
            entryId: runtime.entryId,
            provider: runtime.provider,
            model: runtime.model,
            modelRef: runtime.modelRef,
          },
        }
      : {
          apiRuntime: null,
          apiBlock: {
            stage: "dispatch",
            code: "missing_api_binding",
            message:
              "API 管理未连接可用于图片生成的 OpenAI。请到 API 管理连接 OpenAI；模型显示 auto 是正常的。",
          },
        };
  } catch (error) {
    return {
      apiRuntime: null,
      apiBlock: {
        stage: "dispatch",
        code: "missing_api_binding",
        message:
          error instanceof Error
            ? error.message
            : "API 管理未连接可用于图片生成的 OpenAI。请到 API 管理连接 OpenAI；模型显示 auto 是正常的。",
      },
    };
  }
}

async function resolveOpenAIImageRuntime(
  config: OpenClawConfig,
): ReturnType<typeof resolveApiModelRuntimeForConsumer> {
  const attempts = [
    { consumer: "image" as const, provider: "openai" as const },
    { consumer: "role_execution" as const, provider: "openai" as const },
    { consumer: "model" as const, provider: "openai" as const },
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    const oauthRuntime = resolveOAuthApiModelRuntimeForConsumer(config, attempt);
    if (oauthRuntime) return oauthRuntime;
    try {
      const runtime = await resolveApiModelRuntimeForConsumer(config, attempt);
      if (runtime) return runtime;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length) {
    throw new Error(errors.join("；"));
  }
  return null;
}

function resolveOAuthApiModelRuntimeForConsumer(
  config: OpenClawConfig,
  params: { consumer: "image" | "role_execution" | "model"; provider: "openai" },
): Awaited<ReturnType<typeof resolveApiModelRuntimeForConsumer>> | null {
  const candidates = resolveApiModelRefCandidatesForConsumer(config, params);
  for (const selected of candidates) {
    const entry = config.apiConnections?.entries?.[selected.entryId];
    if (
      !entry ||
      entry.enabled === false ||
      entry.kind !== "model" ||
      entry.provider.toLowerCase() !== "openai" ||
      entry.authMode !== "oauth"
    ) {
      continue;
    }
    const configuredBaseUrl = entry.baseUrl?.trim() || entry.endpoint?.trim();
    return {
      ...selected,
      baseUrl: configuredBaseUrl || "https://api.openai.com/v1",
      apiKey: "",
      authMode: "oauth",
      secretSource: "oauth",
    };
  }
  return null;
}

function localRehearsalImageRuntime(): ApiModelRuntimeBinding {
  return {
    entryId: "local-rehearsal-image",
    provider: "local-rehearsal",
    model: "local-rehearsal-image",
    modelRef: "local-rehearsal/local-image",
    baseUrl: "local://rehearsal",
    apiKey: "",
    authMode: "none",
    secretSource: "plaintext",
  };
}

function buildExecutionConsoleReadModel(
  readModel: AicsMainFlowReadModel,
  options: {
    apiBlock?: ExecutionConsoleApiBlock | null;
    apiRuntime?: ExecutionConsoleApiRuntime | null;
  } = {},
) {
  const objects = readModel.objects;
  const matches = readModel.capabilities.matches;
  const uniqueRequests = readModel.capabilities.uniqueRequests;
  const blockedReasons = [
    ...readModel.blockedReasons.filter((reason) => reason.stage === "role"),
    ...(options.apiBlock ? [options.apiBlock] : []),
  ];
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
      const result = latestResult ? attachLocalExecutionReadback(latestResult) : null;
      const uniqueRequest = match?.uniqueCapabilityRequestId
        ? (uniqueRequests.find((item) => item.id === match.uniqueCapabilityRequestId) ?? null)
        : null;

      const blockedReason =
        executionBlockedReason(task, request, match) ??
        (latestResult ? null : (options.apiBlock?.code ?? null));

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
        confirmExecution: request.confirmExecution === true,
        costConfirmed: request.costConfirmed === true,
        ledgerRef: request.ledgerRef ?? "",
        entitlementId: request.entitlementId ?? "",
        blockedReason,
        selectedModelRef: options.apiRuntime,
        capabilitySummary: match?.summary ?? "等待调度层匹配云端授权能力。",
        allowedTools: request.allowedTools ?? match?.allowedTools ?? [],
        allowedSkills: request.allowedSkills ?? match?.allowedSkills ?? [],
        requiredCapabilityRefs:
          task?.requiredCapabilityRefs ?? request.requiredCapabilityRefs ?? [],
        uniqueCapabilityRequest: uniqueRequest,
        canRun: status === "ready" && !blockedReason,
        updatedAt: request.updatedAt,
        createdAt: request.createdAt,
        result,
        artifactRefs: result?.artifactRefs ?? latestResult?.artifactRefs ?? [],
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
      selectedModelRef: options.apiRuntime,
    },
    executions,
    blockedReasons,
    latest: executions[0] ?? null,
    updatedAt: readModel.updatedAt,
  };
}

function attachLocalExecutionReadback<
  T extends {
    artifactRefs: string[];
    executionEvidence?: RoleResultExecutionEvidence | undefined;
    id?: string;
  },
>(result: T): T {
  const evidence = result.executionEvidence ?? {};
  const auditRecordId = result.artifactRefs
    .find((ref) => ref.startsWith("audit:"))
    ?.replace(/^audit:/u, "");
  const ledgerRef =
    (typeof evidence.ledgerRef === "string" && evidence.ledgerRef.trim()
      ? evidence.ledgerRef.trim()
      : result.artifactRefs.find((ref) => ref.startsWith("ledger:"))) ?? "";
  const ledgerReadback = ledgerRef ? getLocalRoleLedgerEntry(ledgerRef) : null;
  const auditReadback =
    (auditRecordId ? getLocalRoleExecutionAudit(auditRecordId) : null) ??
    (ledgerReadback?.executionId
      ? getLocalRoleExecutionAuditByExecutionId(ledgerReadback.executionId)
      : null) ??
    (typeof result.id === "string" ? getLocalRoleExecutionAuditByExecutionId(result.id) : null);
  if (!ledgerReadback && !auditReadback) return result;
  return {
    ...result,
    executionEvidence: {
      ...evidence,
      ...(auditReadback ? { auditReadback } : {}),
      ...(ledgerReadback ? { ledgerReadback } : {}),
    },
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

function roleTaskRunPreflight(params: Record<string, unknown>):
  | {
      ok: true;
      taskPackage: TaskPackage;
      request: DispatchToRoleRequest | null;
    }
  | {
      ok: false;
      status: "blocked";
      taskPackageId?: string;
      dispatchToRoleRequestId?: string | null;
      blockedReasons: unknown[];
    } {
  try {
    const store = new AicsMainFlowStore();
    const readModel = store.readModel();
    const { taskPackage, request } = selectTaskPackage(readModel, params);
    const existingSucceededResult = readModel.objects.roleResults.find(
      (item) =>
        item.taskPackageId === taskPackage.id &&
        (!request?.id || item.dispatchToRoleRequestId === request.id) &&
        item.outcome === "succeeded",
    );
    if (existingSucceededResult) {
      return {
        ok: false,
        status: "blocked",
        taskPackageId: taskPackage.id,
        dispatchToRoleRequestId: request?.id ?? null,
        blockedReasons: [
          "该派发单已经执行完成并生成结果，不能重复运行。需要重新执行时请先由任务调度生成新的派发单。",
        ],
      };
    }
    const preflight = store.executionPreflight({
      taskPackageId: taskPackage.id,
      ...(request?.id ? { dispatchToRoleRequestId: request.id } : {}),
    });
    if (!preflight.canRun) {
      return {
        ok: false,
        status: "blocked",
        taskPackageId: taskPackage.id,
        dispatchToRoleRequestId: request?.id ?? null,
        blockedReasons: preflight.blockedReasons,
      };
    }
    return { ok: true, taskPackage, request };
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      blockedReasons: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function toStoreOutcome(outcome: RoleResult["outcome"]): "succeeded" | "failed" | "blocked" {
  if (outcome === "succeeded" || outcome === "blocked") return outcome;
  return "failed";
}

function roleResultFailureReasons(runResult: Record<string, unknown>): string[] {
  if (Array.isArray(runResult.blockedReasons) && runResult.blockedReasons.length) {
    return runResult.blockedReasons
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const record = item as Record<string, unknown>;
          return (
            stringParam(record, "message") ??
            stringParam(record, "reason") ??
            stringParam(record, "code") ??
            ""
          );
        }
        return "";
      })
      .filter(Boolean);
  }
  const roleResult = objectParam<Record<string, unknown>>(runResult, "roleResult");
  return [
    roleResult ? stringParam(roleResult, "blockedReason") : undefined,
    roleResult ? stringParam(roleResult, "summary") : undefined,
    stringParam(runResult, "message"),
  ].filter((item): item is string => Boolean(item));
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

async function callExecutionRunFromRoleTask(params: {
  methodParams: Record<string, unknown>;
  context: GatewayRequestContext;
}): Promise<Record<string, unknown>> {
  let captured: { ok: boolean; payload?: unknown; error?: unknown } | undefined;
  await aicsExecutionHandlers["aics.execution.run"]({
    req: {
      type: "req",
      id: "dijie-role-task-run-inner",
      method: "aics.execution.run",
      params: params.methodParams,
    },
    params: params.methodParams,
    client: null,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      captured = { ok, payload, error };
    },
    context: params.context,
  });
  if (!captured?.ok) {
    throw new Error(
      JSON.stringify(captured?.error ?? captured?.payload ?? { error: "execution run failed" }),
    );
  }
  return objectParam<Record<string, unknown>>({ payload: captured.payload }, "payload") ?? {};
}

async function requestCloudExecutionGrant(params: {
  config: OpenClawConfig;
  roleListingId: string;
  entitlementId: string;
}): Promise<{
  mode: "cloud";
  cloudBaseUrl: string;
  executionId: string;
  executionToken: string;
  grant: Record<string, unknown>;
}> {
  const cloud = await resolveAicsCloudConnectionFromApiConnections(params.config);
  const cloudBaseUrl = cloud.cloudBaseUrl ?? pluginAicsString(params.config, "cloudBaseUrl");
  const cloudAccessToken =
    cloud.cloudAccessToken ?? pluginAicsString(params.config, "cloudAccessToken");
  const deviceId = pluginAicsString(params.config, "defaultDeviceId");
  const workspaceRef = pluginAicsString(params.config, "defaultWorkspaceRef");
  const localGatewayId = pluginAicsString(params.config, "defaultLocalGatewayId");
  if (!cloudBaseUrl || !cloudAccessToken || !deviceId || !workspaceRef || !localGatewayId) {
    throw new Error(
      "API 管理未完成云端桥接：需要 cloudBaseUrl、cloudAccessToken、deviceId、workspaceRef、localGatewayId。",
    );
  }

  const response = await fetch(new URL("/dijie/execution-token", cloudBaseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${cloudAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      roleListingId: params.roleListingId,
      entitlementId: params.entitlementId,
      deviceId,
      workspaceRef,
      localGatewayId,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    throw new Error(
      String(payload.error ?? payload.message ?? `POST /dijie/execution-token ${response.status}`),
    );
  }
  const grant = objectParam<Record<string, unknown>>(payload, "grant");
  const executionId = stringParam(grant ?? {}, "executionId");
  const executionToken = stringParam(grant ?? {}, "token");
  if (!grant || !executionId || !executionToken) {
    throw new Error("云端 execution-token 返回缺少 executionId 或 token。");
  }
  return { mode: "cloud", cloudBaseUrl, executionId, executionToken, grant };
}

function requestLocalExecutionGrant(params: { roleListingId: string; entitlementId: string }): {
  mode: "local";
  executionId: string;
  grant: Record<string, unknown>;
} | null {
  const entitlement = getLocalRoleEntitlement(params.entitlementId);
  if (!entitlement || entitlement.status !== "authorized") return null;
  if (entitlement.roleListingId !== params.roleListingId) {
    throw new Error("本地授权与岗位商品不匹配，不能执行。");
  }
  const listing = getLocalRoleListing(params.roleListingId);
  if (!listing || listing.status !== "published") {
    throw new Error("本地岗位商品尚未上架，不能执行。");
  }
  const executionId = `local_exec_${Date.now()}`;
  return {
    mode: "local",
    executionId,
    grant: {
      executionId,
      token: `local_execution_token:${executionId}`,
      roleListingId: listing.roleListingId,
      packageId: listing.rolePackageId,
      packageVersion: "local",
      developerRef: "local-developer",
      listingOwnerRef: "local-admin",
      billingBeneficiaryRef: "local-admin",
      entitlementId: entitlement.entitlementId,
      deviceId: "local-device",
      workspaceRef: entitlement.accountId,
      localGatewayId: "openclaw-local-gateway",
      source: "local_zero_price",
    },
  };
}

function toAuditArtifact(params: {
  executionId: string;
  summary: string;
  artifactRefs: string[];
}): Array<Record<string, unknown>> {
  const refs = params.artifactRefs.length
    ? params.artifactRefs
    : [`artifact:role-result:${params.executionId}:summary`];
  return refs.map((ref, index) => ({
    id: ref.replace(/[^a-zA-Z0-9:_-]+/g, "_").slice(0, 120) || `artifact_${index + 1}`,
    type: index === 0 ? "role_result_summary" : "role_result_artifact",
    title: index === 0 ? "岗位执行结果摘要" : `岗位执行产物 ${index + 1}`,
    mimeType: "text/plain",
    sizeBytes: Math.max(1, Buffer.byteLength(index === 0 ? params.summary : ref, "utf8")),
    previewText: index === 0 ? params.summary.slice(0, 500) : ref,
    content: index === 0 ? params.summary.slice(0, 4000) : ref,
    downloadable: false,
  }));
}

function auditSummaryFromRoleResult(params: {
  grant: Record<string, unknown>;
  roleResult: Record<string, unknown>;
  fallbackExecutionId: string;
}): Record<string, unknown> {
  const roleResult = params.roleResult;
  const executionId =
    stringParam(roleResult, "executionId") ??
    stringParam(roleResult, "id") ??
    stringParam(params.grant, "executionId") ??
    params.fallbackExecutionId;
  const outcome = stringParam(roleResult, "outcome");
  const status = outcome === "succeeded" ? "completed" : "failed";
  const startedAt = Number(roleResult.startedAt) || Date.now();
  const endedAt = Number(roleResult.completedAt) || Date.now();
  const summary = stringParam(roleResult, "summary") ?? "岗位执行未返回摘要。";
  const artifactRefs = Array.isArray(roleResult.artifactRefs)
    ? roleResult.artifactRefs.filter((item): item is string => typeof item === "string")
    : [];
  const modelUsage = objectParam<Record<string, unknown>>(roleResult, "modelUsage") ?? {};
  const toolUsage = objectParam<Record<string, unknown>>(roleResult, "toolUsage") ?? {};
  const artifacts = toAuditArtifact({ executionId, summary, artifactRefs });
  const roleListingId = stringParam(params.grant, "roleListingId") ?? "";
  const packageId = stringParam(params.grant, "packageId") ?? "";
  const packageVersion = stringParam(params.grant, "packageVersion") ?? "";
  const developerRef = stringParam(params.grant, "developerRef") ?? "";
  const listingOwnerRef = stringParam(params.grant, "listingOwnerRef") ?? "";
  const billingBeneficiaryRef = stringParam(params.grant, "billingBeneficiaryRef") ?? "";
  const entitlementId = stringParam(params.grant, "entitlementId") ?? "";
  return {
    executionId,
    deviceId: stringParam(params.grant, "deviceId") ?? "",
    workspaceRef: stringParam(params.grant, "workspaceRef") ?? "",
    roleListingId,
    packageId,
    packageVersion,
    developerRef,
    listingOwnerRef,
    billingBeneficiaryRef,
    entitlementId,
    localGatewayId: stringParam(params.grant, "localGatewayId") ?? "",
    status,
    startedAt,
    endedAt,
    modelProxyUsage: {
      requestCount: 1,
      inputTokens: finiteNumber(modelUsage.inputTokens),
      outputTokens: finiteNumber(modelUsage.outputTokens),
    },
    toolUsage: {
      shellCommands: 0,
      testsRun: 0,
      filesRead: finiteNumber(toolUsage.totalToolCalls),
      filesChanged: 0,
    },
    result: {
      executionId,
      roleListingId,
      packageId,
      packageVersion,
      developerRef,
      listingOwnerRef,
      billingBeneficiaryRef,
      status,
      startedAt,
      endedAt,
      summary,
      changedFiles: [],
      artifacts,
      ...(status === "failed"
        ? { error: stringParam(roleResult, "blockedReason") ?? summary }
        : {}),
    },
  };
}

async function uploadCloudAudit(params: {
  cloudBaseUrl: string;
  executionToken: string;
  auditSummary: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const response = await fetch(new URL("/dijie/audit", params.cloudBaseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.executionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ auditSummary: params.auditSummary }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    throw new Error(
      String(payload.error ?? payload.message ?? `POST /dijie/audit ${response.status}`),
    );
  }
  return payload;
}

function markExecutionAuditUploadBlocked(params: {
  taskPackageId: string;
  dispatchToRoleRequestId?: string;
  executionId: string;
  reason: string;
  ledgerRef?: string;
}) {
  const now = Date.now();
  const resultIds = new Set([params.executionId, `role_result_${params.executionId}`]);
  RoleInstanceStore.markRunBlockedByExecutionId(params.executionId, params.reason);
  return new AicsMainFlowStore().update((state) => {
    const roleResult = state.roleResults.find(
      (item) =>
        resultIds.has(item.id) &&
        item.taskPackageId === params.taskPackageId &&
        (!params.dispatchToRoleRequestId ||
          item.dispatchToRoleRequestId === params.dispatchToRoleRequestId),
    );
    if (roleResult) {
      roleResult.status = "failed";
      roleResult.outcome = "blocked";
      roleResult.summary = params.reason.slice(0, 500);
      roleResult.updatedAt = now;
      roleResult.executionEvidence = {
        ...(roleResult.executionEvidence ?? {}),
        ...(params.ledgerRef ? { ledgerRef: params.ledgerRef } : {}),
        recoverySuggestion: params.reason,
      };
    }
    const request = params.dispatchToRoleRequestId
      ? state.dispatchToRoleRequests.find((item) => item.id === params.dispatchToRoleRequestId)
      : null;
    if (request) {
      request.status = "blocked";
      request.updatedAt = now;
    }
    const task = state.taskPackages.find((item) => item.id === params.taskPackageId);
    if (task) {
      task.status = "blocked";
      task.updatedAt = now;
    }
    state.updatedAt = now;
    return {
      roleResult: roleResult ?? null,
      dispatchToRoleRequest: request,
      taskPackage: task,
    };
  });
}

export const aicsExecutionHandlers: GatewayRequestHandlers = {
  "dijie.roleTask.run": async ({ params, respond, context }) => {
    try {
      const record =
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const roleListingId = stringParamAny(record, "roleListingId", "role_listing_id");
      const entitlementId = stringParamAny(record, "entitlementId", "entitlement_id");
      if (!roleListingId || !entitlementId) {
        respond(true, {
          ok: false,
          status: "blocked",
          blockedReasons: ["岗位执行需要 roleListingId 和 entitlementId。"],
        });
        return;
      }
      if (!booleanParamAny(record, "confirmExecution", "confirm_execution")) {
        respond(true, {
          ok: false,
          status: "blocked",
          blockedReasons: ["岗位执行需要显式传入 confirmExecution=true。"],
        });
        return;
      }
      if (!booleanParamAny(record, "costConfirmed", "cost_confirmed")) {
        respond(true, {
          ok: false,
          status: "blocked",
          blockedReasons: ["岗位执行需要显式传入 costConfirmed=true。"],
        });
        return;
      }
      const preflight = roleTaskRunPreflight(record);
      if (!preflight.ok) {
        respond(true, preflight);
        return;
      }

      const grant =
        requestLocalExecutionGrant({ roleListingId, entitlementId }) ??
        (await requestCloudExecutionGrant({
          config: context.getRuntimeConfig(),
          roleListingId,
          entitlementId,
        }));
      const runResult = await callExecutionRunFromRoleTask({
        methodParams: {
          ...(stringParam(record, "taskPackageId")
            ? { taskPackageId: stringParam(record, "taskPackageId") }
            : {}),
          ...(stringParam(record, "dispatchToRoleRequestId")
            ? { dispatchToRoleRequestId: stringParam(record, "dispatchToRoleRequestId") }
            : {}),
          ...(stringParamAny(record, "workspaceRoot", "workspace_dir")
            ? { workspaceRoot: stringParamAny(record, "workspaceRoot", "workspace_dir") }
            : {}),
          ...(stringParam(record, "modelRef") ? { modelRef: stringParam(record, "modelRef") } : {}),
          ...(booleanParamAny(record, "localRehearsal", "local_rehearsal")
            ? { localRehearsal: true }
            : {}),
        },
        context,
      });

      if (runResult.ok !== true) {
        const blockedReasons = roleResultFailureReasons(runResult);
        const failedRoleResult = objectParam<Record<string, unknown>>(runResult, "roleResult");
        const failedExecutionId =
          (failedRoleResult ? stringParam(failedRoleResult, "executionId") : undefined) ??
          stringParam(runResult, "executionId") ??
          grant.executionId;
        respond(true, {
          ok: false,
          status: runResult.status ?? "blocked",
          executionId: failedExecutionId,
          blockedReasons: blockedReasons.length ? blockedReasons : ["岗位执行未通过预检。"],
          roleResult: runResult.roleResult,
        });
        return;
      }

      const roleResult = objectParam<Record<string, unknown>>(runResult, "roleResult");
      if (!roleResult) {
        throw new Error("岗位执行没有返回 RoleResult。");
      }
      const auditSummary = auditSummaryFromRoleResult({
        grant: grant.grant,
        roleResult,
        fallbackExecutionId: grant.executionId,
      });
      const auditExecutionId = stringParam(auditSummary, "executionId") ?? grant.executionId;
      let auditUpload: Record<string, unknown>;
      if (grant.mode === "cloud") {
        try {
          auditUpload = await uploadCloudAudit({
            cloudBaseUrl: grant.cloudBaseUrl,
            executionToken: grant.executionToken,
            auditSummary,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const roleExecutionEvidence = objectParam<Record<string, unknown>>(
            roleResult,
            "executionEvidence",
          );
          const evidenceLedgerRef = roleExecutionEvidence
            ? stringParam(roleExecutionEvidence, "ledgerRef")
            : undefined;
          const downgraded = markExecutionAuditUploadBlocked({
            taskPackageId: preflight.taskPackage.id,
            ...(preflight.request?.id ? { dispatchToRoleRequestId: preflight.request.id } : {}),
            executionId: auditExecutionId,
            reason,
            ...(evidenceLedgerRef ? { ledgerRef: evidenceLedgerRef } : {}),
          });
          respond(true, {
            ok: false,
            status: "blocked",
            executionId: auditExecutionId,
            blockedReasons: [reason],
            roleResult: downgraded.roleResult ?? roleResult,
          });
          return;
        }
      } else {
        const auditRecordId = `local_audit_${auditExecutionId}`;
        const ledgerRef = `ledger:role_execution:${entitlementId}:${auditExecutionId}`;
        const billingSummary = {
          ledgerRef,
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          source: "local_zero_price",
        };
        auditUpload = {
          ok: true,
          auditRecordId,
          source: "local",
          billingSummary,
        };
        try {
          recordLocalRoleExecutionReadback({
            auditRecordId,
            executionId: auditExecutionId,
            roleListingId,
            entitlementId,
            status: "completed",
            summary: stringParam(roleResult, "summary") ?? "岗位执行完成。",
            ledgerRef,
            billingSummary,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const downgraded = markExecutionAuditUploadBlocked({
            taskPackageId: preflight.taskPackage.id,
            ...(preflight.request?.id ? { dispatchToRoleRequestId: preflight.request.id } : {}),
            executionId: auditExecutionId,
            ledgerRef,
            reason,
          });
          respond(true, {
            ok: false,
            status: "blocked",
            executionId: auditExecutionId,
            blockedReasons: [reason],
            roleResult: downgraded.roleResult ?? roleResult,
          });
          return;
        }
      }
      const roleExecutionEvidence = objectParam<Record<string, unknown>>(
        roleResult,
        "executionEvidence",
      );
      const evidenceLedgerRef = roleExecutionEvidence
        ? stringParam(roleExecutionEvidence, "ledgerRef")
        : undefined;
      const auditBillingSummary =
        objectParam<Record<string, unknown>>(auditUpload, "billingSummary") ?? {};
      const billingSummary = {
        ...auditBillingSummary,
        ...(evidenceLedgerRef && !stringParam(auditBillingSummary, "ledgerRef")
          ? { ledgerRef: evidenceLedgerRef }
          : {}),
      };
      respond(true, {
        ok: true,
        status: "completed",
        executionId: auditExecutionId,
        summary: stringParam(roleResult, "summary") ?? "岗位执行完成。",
        roleResult,
        auditUpload,
        billingSummary,
        mode: grant.mode,
      });
    } catch (error) {
      respond(true, {
        ok: false,
        status: "blocked",
        blockedReasons: [error instanceof Error ? error.message : String(error)],
      });
    }
  },

  "aics.executionConsole.readModel.get": async ({ respond, context }) => {
    try {
      const readModel = new AicsMainFlowStore().readModel();
      const apiStatus = await resolveRoleExecutionApiStatus(context.getRuntimeConfig());
      respond(true, buildExecutionConsoleReadModel(readModel, apiStatus));
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.executionEvidence.readback.get": ({ params, respond }) => {
    try {
      const record =
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const auditRecordId = stringParam(record, "auditRecordId")?.replace(/^audit:/u, "");
      const ledgerRef = stringParam(record, "ledgerRef");
      const executionId = stringParam(record, "executionId");
      const ledger =
        (ledgerRef ? getLocalRoleLedgerEntry(ledgerRef) : null) ??
        (executionId ? getLocalRoleLedgerEntryByExecutionId(executionId) : null);
      const audit =
        (auditRecordId ? getLocalRoleExecutionAudit(auditRecordId) : null) ??
        (executionId ? getLocalRoleExecutionAuditByExecutionId(executionId) : null) ??
        (ledger?.executionId ? getLocalRoleExecutionAuditByExecutionId(ledger.executionId) : null);
      if (audit || ledger) {
        new AicsMainFlowStore().update((state) =>
          recordRoleResultEvidenceReadback(state, {
            executionId: executionId ?? audit?.executionId ?? ledger?.executionId,
            auditReadback: audit,
            ledgerReadback: ledger,
          }),
        );
      }
      if (!audit || !ledger) {
        const missing = [audit ? "" : "审计记录缺失", ledger ? "" : "账本记录缺失"].filter(Boolean);
        respond(true, {
          ok: false,
          status: "missing",
          audit,
          ledger,
          blockedReasons: [`本地执行证据不完整：${missing.join("，")}。`],
        });
        return;
      }
      respond(true, {
        ok: true,
        status: "found",
        audit,
        ledger,
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.execution.artifact.get": ({ params, respond }) => {
    try {
      const record =
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const executionId = stringParam(record, "executionId");
      const artifactRef = stringParam(record, "artifactRef") ?? stringParam(record, "ref");
      if (!executionId || !artifactRef) {
        respond(true, {
          ok: false,
          status: "blocked",
          blockedReasons: ["读取岗位产物需要 executionId 和 artifactRef。"],
        });
        return;
      }
      const run = RoleInstanceStore.getRunByExecutionId(executionId);
      const artifacts = run ? RoleInstanceStore.listArtifacts(run.runId) : [];
      const artifact = artifacts.find((item) => item.relPath === artifactRef);
      if (!run || !artifact) {
        respond(true, {
          ok: false,
          status: "not_found",
          blockedReasons: ["该文件不是本次岗位执行记录中的产物，不能读取。"],
        });
        return;
      }
      const resolved = path.resolve(artifact.relPath);
      if (!existsSync(resolved) || statSync(resolved).size <= 0) {
        respond(true, {
          ok: false,
          status: "missing",
          blockedReasons: ["产物文件不存在或为空。"],
        });
        return;
      }
      const data = readFileSync(resolved).toString("base64");
      const mimeType = mimeTypeForArtifactRef(resolved);
      respond(true, {
        ok: true,
        status: "found",
        executionId,
        artifact: {
          artifactId: artifact.artifactId,
          ref: artifact.relPath,
          name: path.basename(resolved),
          kind: artifact.kind,
          mimeType,
          sizeBytes: statSync(resolved).size,
          sha256: artifact.sha256,
          encoding: "base64",
          data,
          dataUrl: `data:${mimeType};base64,${data}`,
        },
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.execution.result.record": async ({ params, respond, context: gatewayContext }) => {
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
      const existingRoleResultIds = new Set([executionId, `role_result_${executionId}`]);
      const existingRoleResult = readModel.objects.roleResults.find(
        (item) =>
          existingRoleResultIds.has(item.id) &&
          (!request?.id || item.dispatchToRoleRequestId === request.id) &&
          item.taskPackageId === taskPackage.id,
      );
      if (existingRoleResult) {
        const existingLedgerRef =
          existingRoleResult.executionEvidence?.ledgerRef ??
          existingRoleResult.artifactRefs.find((ref) => ref.startsWith("ledger:")) ??
          stringParam(record, "ledgerRef") ??
          "";
        const existingAuditRef =
          existingRoleResult.artifactRefs.find((ref) => ref.startsWith("audit:")) ??
          (stringParam(record, "auditRecordId")
            ? `audit:${stringParam(record, "auditRecordId")}`
            : stringParam(record, "auditRef"));
        respond(true, {
          ok: true,
          status: existingRoleResult.status,
          executionId,
          outcome: existingRoleResult.outcome,
          idempotent: true,
          ...(existingAuditRef ? { auditRef: existingAuditRef } : {}),
          ...(existingLedgerRef ? { ledgerRef: existingLedgerRef } : {}),
        });
        return;
      }
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
      const explicitAuditRef = stringParam(record, "auditRef");
      const ledgerEntryId = stringParam(record, "ledgerEntryId");
      const explicitLedgerRef =
        stringParam(record, "ledgerRef") ?? (ledgerEntryId ? `ledger:${ledgerEntryId}` : "");
      const artifactRefsFromRecord = stringArrayParam(record, "artifactRefs");
      const businessArtifactRefs = artifactRefsFromRecord.filter(
        (ref) =>
          !ref.startsWith("audit:") &&
          !ref.startsWith("ledger:") &&
          !ref.startsWith("memory_candidate:"),
      );
      const executionEvidence =
        objectParam<RoleResultExecutionEvidence>(record, "executionEvidence") ??
        objectParam<RoleResultExecutionEvidence>(record, "evidence") ??
        {};
      const topLevelModelUsage = objectParam<Record<string, unknown>>(record, "modelUsage");
      const incomingExecutionEvidence = {
        ...executionEvidence,
        ...(topLevelModelUsage && !executionEvidence.modelUsage
          ? { modelUsage: topLevelModelUsage as RoleResultExecutionEvidence["modelUsage"] }
          : {}),
      } as RoleResultExecutionEvidence;
      const hasModelUsageEvidence =
        hasNumericModelUsageEvidence(incomingExecutionEvidence.modelUsage) ||
        incomingExecutionEvidence.modelUsageNotApplicable === true;
      if (ok) {
        const blockedReasons: string[] = [];
        if (!businessArtifactRefs.length) {
          blockedReasons.push("岗位执行成功写回必须包含业务产物 artifactRefs。");
        }
        if (!auditRecordId && !explicitAuditRef) {
          blockedReasons.push("岗位执行成功写回必须包含真实审计记录 auditRecordId 或 auditRef。");
        }
        if (!explicitLedgerRef) {
          blockedReasons.push("岗位执行成功写回必须包含真实账本引用 ledgerRef 或 ledgerEntryId。");
        }
        if (!hasModelUsageEvidence) {
          blockedReasons.push(
            "岗位执行成功写回必须包含模型费用证据 modelUsage，或明确声明本次未调用模型。",
          );
        }
        if (blockedReasons.length) {
          respond(true, {
            ok: false,
            status: "blocked",
            taskPackageId: taskPackage.id,
            dispatchToRoleRequestId: request?.id ?? null,
            blockedReasons,
          });
          return;
        }
      }
      const auditRef = auditRecordId
        ? `audit:${auditRecordId}`
        : (explicitAuditRef ?? (ok ? "" : `audit:${executionId}`));
      const ledgerRef =
        explicitLedgerRef ||
        (entitlementId
          ? `ledger:role_execution:${entitlementId}:${executionId}`
          : `ledger:role_execution:${executionId}`);
      const artifactRefs = auditRef ? [...businessArtifactRefs, auditRef] : businessArtifactRefs;
      const roleListingId =
        request?.roleListingId ??
        (entitlementId ? getLocalRoleEntitlement(entitlementId)?.roleListingId : undefined);
      const effectiveExecutionEvidence = {
        ...incomingExecutionEvidence,
        ledgerRef,
        costSummary: buildExecutionCostSummary({
          evidence: incomingExecutionEvidence,
          ledgerRef,
          roleListingId,
          entitlementId,
        }),
        ...(buildHumanConfirmationRef({
          request: request ?? undefined,
          executionId,
          existing: incomingExecutionEvidence.humanConfirmationRef,
        })
          ? {
              humanConfirmationRef: buildHumanConfirmationRef({
                request: request ?? undefined,
                executionId,
                existing: incomingExecutionEvidence.humanConfirmationRef,
              }),
            }
          : {}),
      } as RoleResultExecutionEvidence;

      store.update((state) =>
        runApprovedTask(
          state,
          {
            taskPackageId: taskPackage.id,
            ...(request?.id ? { dispatchToRoleRequestId: request.id } : {}),
            ledgerRef,
            result: {
              id: executionId,
              outcome,
              summary: summary.slice(0, 500),
              artifactRefs,
              executionEvidence: effectiveExecutionEvidence,
            },
          },
          Date.now(),
        ),
      );
      const apiMetering = await recordModelUsageToApiMetering({
        context: gatewayContext,
        consumer: "role_execution",
        executionId,
        modelUsage: effectiveExecutionEvidence.modelUsage as Record<string, unknown> | undefined,
        attribution: {
          roleListingId,
          entitlementId,
          executionId,
          ledgerRef,
          auditRecordId,
        },
      });
      respond(true, {
        ok: true,
        executionId,
        outcome,
        auditRef,
        ledgerRef,
        ...(apiMetering ? { apiMetering } : {}),
      });
    } catch (error) {
      respondError(respond, error);
    }
  },

  "aics.execution.run": async ({ params, respond, context: gatewayContext }) => {
    try {
      const store = new AicsMainFlowStore();
      const readModel = store.readModel();
      const { taskPackage, request, rolePlanItem } = selectTaskPackage(readModel, params);
      const existingSucceededResult = readModel.objects.roleResults.find(
        (item) =>
          item.taskPackageId === taskPackage.id &&
          (!request?.id || item.dispatchToRoleRequestId === request.id) &&
          item.outcome === "succeeded",
      );
      if (existingSucceededResult) {
        respond(true, {
          ok: false,
          status: "blocked",
          taskPackageId: taskPackage.id,
          dispatchToRoleRequestId: request?.id ?? null,
          blockedReasons: [
            "该派发单已经执行完成并生成结果，不能重复运行。需要重新执行时请先由任务调度生成新的派发单。",
          ],
        });
        return;
      }
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
      const runtimeConfig = gatewayContext.getRuntimeConfig();
      let modelRuntime: Awaited<ReturnType<typeof resolveApiModelRuntimeForConsumer>>;
      if (booleanParamAny(params, "localRehearsal", "local_rehearsal")) {
        modelRuntime = localRehearsalImageRuntime();
      } else {
        try {
          modelRuntime = await resolveOpenAIImageRuntime(runtimeConfig);
        } catch (error) {
          respond(true, {
            ok: false,
            status: "blocked",
            taskPackageId: taskPackage.id,
            dispatchToRoleRequestId: request?.id ?? null,
            blockedReasons: [
              error instanceof Error
                ? error.message
                : "API 管理未连接可用于图片生成的 OpenAI。请到 API 管理连接 OpenAI；模型显示 auto 是正常的。",
            ],
          });
          return;
        }
        if (!modelRuntime) {
          respond(true, {
            ok: false,
            status: "blocked",
            taskPackageId: taskPackage.id,
            dispatchToRoleRequestId: request?.id ?? null,
            blockedReasons: [
              "API 管理未连接可用于图片生成的 OpenAI。请到 API 管理连接 OpenAI；模型显示 auto 是正常的。",
            ],
          });
          return;
        }
      }
      const modelRef = stringParam(params, "modelRef") ?? modelRuntime.modelRef;
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

      const engine = createRoleExecutionEngine();
      const allowedTools = request?.allowedTools ?? [
        "core.openai.image.generate",
        "core.workspace.detail.write",
        "core.artifact.quality.check",
        "core.artifact.package.bundle",
      ];
      const allowedSkills = request?.allowedSkills ?? [
        "img:gen",
        "ws:write",
        "quality:check",
        "file:pack",
      ];
      const context = engine.prepare(taskPackage, {
        workspaceRoot,
        modelRef,
        availableTools: allowedTools,
        allowedSkills,
        preflightSnapshot: {
          taskDispatched: true,
          roleAuthorized: Boolean(request?.roleListingId && request?.entitlementId),
          humanConfirmed: request?.confirmExecution === true,
          costConfirmed: request?.costConfirmed === true,
          toolSkillReady: request?.toolSkillReady !== false,
          apiBindingReady: request?.apiBindingReady !== false,
          ledgerRefPresent: Boolean(request?.ledgerRef),
          allowedTools,
          allowedSkills,
          taskPackageId: taskPackage.id,
          ...(request?.id ? { dispatchToRoleRequestId: request.id } : {}),
          ...(request?.roleListingId ? { roleListingId: request.roleListingId } : {}),
          ...(request?.entitlementId ? { entitlementId: request.entitlementId } : {}),
        },
        timeoutMs: 300_000,
      });

      const effectiveRoleListingId =
        request?.roleListingId ?? rolePlanItem?.roleCapabilityRef ?? taskPackage.rolePlanItemId;
      const effectiveEntitlementId = request?.entitlementId;
      const secretsSnapshot = getActiveSecretsRuntimeSnapshot();
      const firstOpenAIAuthStore = secretsSnapshot?.authStores.find((entry) =>
        Object.values(entry.store.profiles ?? {}).some((profile) => profile.provider === "openai"),
      );
      const roleResult = await engine.execute(
        context,
        createRoleProductExecutionExecutor({
          imageRuntime: modelRuntime,
          config: runtimeConfig,
          agentDir: firstOpenAIAuthStore?.agentDir,
          authStore: firstOpenAIAuthStore?.store,
          roleTitle: request?.roleTitle ?? context.rolePackage.manifest.title,
          roleListingId: effectiveRoleListingId,
          categoryCapabilityId: request?.categoryCapabilityId,
          allowedSkillIds: allowedSkills,
          allowedToolRefs: allowedTools,
        }),
      );
      roleResult.roleListingId = effectiveRoleListingId;
      roleResult.roleTitle = request?.roleTitle ?? context.rolePackage.manifest.title;

      const instance = RoleInstanceStore.ensureInstance({
        roleListingId: effectiveRoleListingId,
        roleTitle: request?.roleTitle ?? context.rolePackage.manifest.title,
        workspaceDir: context.workspaceDir,
      });

      RoleInstanceStore.recordRun({
        instanceId: instance.instanceId,
        taskPackageId: taskPackage.id,
        executionId: context.executionId,
        status:
          roleResult.outcome === "succeeded"
            ? "completed"
            : roleResult.outcome === "blocked"
              ? "blocked"
              : "failed",
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
          kind: artifactKindForRef(relPath),
          createdAt: Date.now(),
        })),
      });

      const ledgerRef = effectiveEntitlementId
        ? `ledger:role_execution:${effectiveEntitlementId}:${context.executionId}`
        : `ledger:role_execution:${context.executionId}`;
      const auditRef = `audit:${context.executionId}`;
      const baseExecutionEvidence = {
        ...roleResult.executionEvidence,
        ledgerRef,
      } as RoleResultExecutionEvidence;
      const effectiveExecutionEvidence = {
        ...baseExecutionEvidence,
        ledgerRef,
        costSummary: buildExecutionCostSummary({
          evidence: baseExecutionEvidence,
          ledgerRef,
          roleListingId: effectiveRoleListingId,
          entitlementId: effectiveEntitlementId,
        }),
        ...(buildHumanConfirmationRef({
          request: request ?? undefined,
          executionId: context.executionId,
          existing: baseExecutionEvidence.humanConfirmationRef,
        })
          ? {
              humanConfirmationRef: buildHumanConfirmationRef({
                request: request ?? undefined,
                executionId: context.executionId,
                existing: baseExecutionEvidence.humanConfirmationRef,
              }),
            }
          : {}),
      } as RoleResultExecutionEvidence;
      const responseRoleResult: RoleResult = {
        ...roleResult,
        executionEvidence: effectiveExecutionEvidence,
      };
      store.update((state) =>
        runApprovedTask(state, {
          taskPackageId: taskPackage.id,
          ...(request?.id ? { dispatchToRoleRequestId: request.id } : {}),
          ledgerRef,
          result: {
            id: context.executionId,
            outcome: toStoreOutcome(roleResult.outcome),
            summary: roleResult.summary.slice(0, 500),
            artifactRefs: [...roleResult.artifactRefs, auditRef],
            executionEvidence: effectiveExecutionEvidence,
          },
        }),
      );
      const apiMetering = await recordModelUsageToApiMetering({
        context: gatewayContext,
        consumer: "role_execution",
        executionId: context.executionId,
        modelUsage: {
          provider: modelRuntime.provider,
          model: modelRuntime.model,
          ...roleResult.modelUsage,
        },
        attribution: {
          roleListingId: effectiveRoleListingId,
          entitlementId: effectiveEntitlementId,
          executionId: context.executionId,
          ledgerRef,
          auditRecordId: context.executionId,
        },
      });

      respond(true, {
        ok: roleResult.outcome === "succeeded",
        status: roleResult.outcome === "succeeded" ? "completed" : "blocked",
        ...(roleResult.outcome === "succeeded"
          ? {}
          : { blockedReasons: roleResultFailureReasons({ roleResult }) }),
        executionId: context.executionId,
        modelRef,
        selectedModelRef: {
          entryId: modelRuntime.entryId,
          provider: modelRuntime.provider,
          model: modelRuntime.model,
          modelRef: modelRuntime.modelRef,
        },
        roleResult: responseRoleResult,
        ...(apiMetering ? { apiMetering } : {}),
        instance: { instanceId: instance.instanceId, title: instance.roleTitle },
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
};

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function artifactKindForRef(ref: string): "image" | "video" | "document" | "archive" {
  if (/\.(png|jpe?g|webp|gif)$/iu.test(ref)) return "image";
  if (/\.(mp4|mov|webm)$/iu.test(ref)) return "video";
  if (/\.(zip|tar|gz)$/iu.test(ref)) return "archive";
  return "document";
}

function mimeTypeForArtifactRef(ref: string): string {
  if (/\.png$/iu.test(ref)) return "image/png";
  if (/\.jpe?g$/iu.test(ref)) return "image/jpeg";
  if (/\.webp$/iu.test(ref)) return "image/webp";
  if (/\.gif$/iu.test(ref)) return "image/gif";
  if (/\.html?$/iu.test(ref)) return "text/html; charset=utf-8";
  if (/\.json$/iu.test(ref)) return "application/json";
  if (/\.zip$/iu.test(ref)) return "application/zip";
  return "application/octet-stream";
}
