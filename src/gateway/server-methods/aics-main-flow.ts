import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  compareObservationsToGoal,
  toAttributionInput as comparatorToAttributionInput,
} from "../../aics-main-flow/attribution-comparator.js";
import {
  createCloudMarketplaceProjection,
  validateActorContext,
} from "../../aics-main-flow/cloud-marketplace-projection.js";
import {
  generateGoalCandidate,
  generatePlanningPackage,
  generateDispatchProposal,
  materializeTaskPackage as materializeFromDispatch,
} from "../../aics-main-flow/pipeline-generators.js";
import {
  AicsMainFlowStore,
  confirmDispatch,
  confirmGoal,
  confirmPlanning,
  createDispatchProposal,
  createGoalCandidate,
  createInteraction,
  createWorkBlocks,
  materializeTaskPackage,
  prepareAttribution,
  prepareObservation,
  preparePlanning,
  runApprovedTask,
  type CreateDispatchProposalInput,
  type CreateGoalCandidateInput,
  type CreateInteractionInput,
  type MaterializeTaskPackageInput,
  type PrepareAttributionInput,
  type PrepareObservationInput,
  type PreparePlanningInput,
  type RunApprovedTaskInput,
} from "../../aics-main-flow/store.js";
import { AicsMainFlowGateError } from "../../aics-main-flow/types.js";
import type { AicsMainFlowStage } from "../../aics-main-flow/types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}

function objectParam(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = params[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayParam(params: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = params[key];
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
    : [];
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = stringParam(params, key);
  if (!value) {
    throw new Error(`missing required string param: ${key}`);
  }
  return value;
}

function toInteractionInput(params: Record<string, unknown>): CreateInteractionInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    stage: (stringParam(params, "stage") ?? "observation") as AicsMainFlowStage,
    message: requireString(params, "message"),
    ...(stringParam(params, "proposedNextAction")
      ? { proposedNextAction: stringParam(params, "proposedNextAction") }
      : {}),
  };
}

function toObservationInput(params: Record<string, unknown>): PrepareObservationInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    title: requireString(params, "title"),
    summary: requireString(params, "summary"),
    signals: arrayParam(params, "signals").map((signal, index) => ({
      id: stringParam(signal, "id") ?? `signal_${index + 1}`,
      title: stringParam(signal, "title") ?? "未命名观察信号",
      summary: stringParam(signal, "summary") ?? "",
      evidenceRefs: Array.isArray(signal.evidenceRefs)
        ? signal.evidenceRefs.filter((item): item is string => typeof item === "string")
        : [],
    })),
  };
}

function toAttributionInput(params: Record<string, unknown>): PrepareAttributionInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "observationPackageId")
      ? { observationPackageId: stringParam(params, "observationPackageId") }
      : {}),
    title: requireString(params, "title"),
    summary: requireString(params, "summary"),
    findings: arrayParam(params, "findings").map((finding, index) => ({
      id: stringParam(finding, "id") ?? `finding_${index + 1}`,
      title: stringParam(finding, "title") ?? "未命名归因发现",
      summary: stringParam(finding, "summary") ?? "",
      confidence:
        stringParam(finding, "confidence") === "low" ||
        stringParam(finding, "confidence") === "high"
          ? (stringParam(finding, "confidence") as "low" | "high")
          : "medium",
      observationSignalIds: Array.isArray(finding.observationSignalIds)
        ? finding.observationSignalIds.filter((item): item is string => typeof item === "string")
        : [],
    })),
  };
}

function toGoalInput(params: Record<string, unknown>): CreateGoalCandidateInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "attributionReportId")
      ? { attributionReportId: stringParam(params, "attributionReportId") }
      : {}),
    title: requireString(params, "title"),
    owner: requireString(params, "owner"),
    metric: requireString(params, "metric"),
    target: requireString(params, "target"),
    rationale: requireString(params, "rationale"),
  };
}

function toPlanningInput(params: Record<string, unknown>): PreparePlanningInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "goalId") ? { goalId: stringParam(params, "goalId") } : {}),
    title: requireString(params, "title"),
    summary: requireString(params, "summary"),
    rolePlanItems: arrayParam(params, "rolePlanItems").map((item) => ({
      ...(stringParam(item, "id") ? { id: stringParam(item, "id") } : {}),
      title: stringParam(item, "title") ?? "未命名岗位规划项",
      ...(stringParam(item, "category") ? { category: stringParam(item, "category") } : {}),
      roleCapabilityRef: stringParam(item, "roleCapabilityRef") ?? "unassigned",
      taskIntent: stringParam(item, "taskIntent") ?? "",
      expectedOutput: stringParam(item, "expectedOutput") ?? "",
      humanConfirmationRequired: booleanParam(item, "humanConfirmationRequired") ?? true,
    })),
  };
}

function toDispatchProposalInput(params: Record<string, unknown>): CreateDispatchProposalInput {
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "planningPackageId")
      ? { planningPackageId: stringParam(params, "planningPackageId") }
      : {}),
    ...(stringParam(params, "rolePlanItemId")
      ? { rolePlanItemId: stringParam(params, "rolePlanItemId") }
      : {}),
    title: requireString(params, "title"),
    riskSummary: requireString(params, "riskSummary"),
    confirmationSummary: requireString(params, "confirmationSummary"),
  };
}

function toTaskPackageInput(params: Record<string, unknown>): MaterializeTaskPackageInput {
  const request = objectParam(params, "request");
  return {
    ...(stringParam(params, "id") ? { id: stringParam(params, "id") } : {}),
    ...(stringParam(params, "dispatchProposalReviewId")
      ? { dispatchProposalReviewId: stringParam(params, "dispatchProposalReviewId") }
      : {}),
    title: requireString(params, "title"),
    taskText: requireString(params, "taskText"),
    request: {
      ...(stringParam(request, "id") ? { id: stringParam(request, "id") } : {}),
      ...(stringParam(request, "roleListingId")
        ? { roleListingId: stringParam(request, "roleListingId") }
        : {}),
      ...(stringParam(request, "roleTitle")
        ? { roleTitle: stringParam(request, "roleTitle") }
        : {}),
      ...(stringParam(request, "workspaceDir")
        ? { workspaceDir: stringParam(request, "workspaceDir") }
        : {}),
    },
  };
}

function toRunApprovedTaskInput(params: Record<string, unknown>): RunApprovedTaskInput {
  const result = objectParam(params, "result");
  const outcome = stringParam(result, "outcome");
  return {
    ...(stringParam(params, "taskPackageId")
      ? { taskPackageId: stringParam(params, "taskPackageId") }
      : {}),
    ...(stringParam(params, "dispatchToRoleRequestId")
      ? { dispatchToRoleRequestId: stringParam(params, "dispatchToRoleRequestId") }
      : {}),
    ...(stringParam(params, "roleListingId")
      ? { roleListingId: stringParam(params, "roleListingId") }
      : {}),
    ...(stringParam(params, "roleTitle") ? { roleTitle: stringParam(params, "roleTitle") } : {}),
    ...(stringParam(params, "entitlementId")
      ? { entitlementId: stringParam(params, "entitlementId") }
      : {}),
    ...(booleanParam(params, "confirmExecution") !== undefined
      ? { confirmExecution: booleanParam(params, "confirmExecution") }
      : {}),
    ...(booleanParam(params, "costConfirmed") !== undefined
      ? { costConfirmed: booleanParam(params, "costConfirmed") }
      : {}),
    ...(stringParam(params, "ledgerRef") ? { ledgerRef: stringParam(params, "ledgerRef") } : {}),
    ...(stringParam(params, "memoryCandidateRef")
      ? { memoryCandidateRef: stringParam(params, "memoryCandidateRef") }
      : {}),
    ...(outcome === "succeeded" || outcome === "failed" || outcome === "blocked"
      ? {
          result: {
            ...(stringParam(result, "id") ? { id: stringParam(result, "id") } : {}),
            outcome,
            summary: stringParam(result, "summary") ?? "",
            artifactRefs: Array.isArray(result.artifactRefs)
              ? result.artifactRefs.filter((item): item is string => typeof item === "string")
              : [],
          },
        }
      : {}),
  };
}

function respondError(respond: RespondFn, error: unknown): void {
  if (error instanceof AicsMainFlowGateError) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, error.message, {
        details: {
          code: error.code,
          stage: error.stage,
        },
      }),
    );
    return;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}

function requireActorContext(params: Record<string, unknown>): void {
  const reason = validateActorContext(params.actor_context);
  if (reason) {
    throw new Error(reason);
  }
}

type ClosedLoopCheckStatus = "pass" | "blocked" | "skipped";

type ClosedLoopReadinessCheck = {
  id: string;
  label: string;
  status: ClosedLoopCheckStatus;
  message: string;
  httpStatus?: number;
};

type AicsBridgeConfig = {
  cloudBaseUrl?: string;
  cloudAccessToken?: string;
  cloudAccessTokenConfiguredButUnresolved?: boolean;
  defaultDeviceId?: string;
  defaultWorkspaceRef?: string;
  defaultLocalGatewayId?: string;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSecretRefLike(value: unknown): boolean {
  const record = recordValue(value);
  return (
    (record.source === "env" || record.source === "file" || record.source === "exec") &&
    typeof record.id === "string"
  );
}

function resolveAicsBridgeConfig(config: OpenClawConfig): AicsBridgeConfig {
  const pluginConfig = recordValue(config.plugins?.entries?.aics?.config);
  const cloudAccessTokenValue = pluginConfig.cloudAccessToken;
  return {
    cloudBaseUrl: trimString(pluginConfig.cloudBaseUrl),
    cloudAccessToken: trimString(cloudAccessTokenValue),
    cloudAccessTokenConfiguredButUnresolved:
      !trimString(cloudAccessTokenValue) && isSecretRefLike(cloudAccessTokenValue),
    defaultDeviceId: trimString(pluginConfig.defaultDeviceId),
    defaultWorkspaceRef: trimString(pluginConfig.defaultWorkspaceRef),
    defaultLocalGatewayId: trimString(pluginConfig.defaultLocalGatewayId),
  };
}

function closedLoopCheck(
  id: string,
  label: string,
  status: ClosedLoopCheckStatus,
  message: string,
  httpStatus?: number,
): ClosedLoopReadinessCheck {
  return { id, label, status, message, ...(httpStatus ? { httpStatus } : {}) };
}

function roleListingIdFromInstalledRole(value: unknown): string | undefined {
  const record = recordValue(value);
  const role = recordValue(record.role);
  return (
    trimString(record.roleListingId) ??
    trimString(record.role_listing_id) ??
    trimString(role.roleListingId) ??
    trimString(role.id)
  );
}

function entitlementIdFromInstalledRole(value: unknown): string | undefined {
  const record = recordValue(value);
  return (
    trimString(record.entitlementId) ??
    trimString(record.entitlement_id) ??
    trimString(record.orderId) ??
    trimString(record.order_id)
  );
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; payload: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: Record<string, unknown> = {};
    try {
      payload = recordValue(await response.json());
    } catch {
      payload = {};
    }
    return { status: response.status, ok: response.ok, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function createClosedLoopReadiness(config: OpenClawConfig, params: Record<string, unknown>) {
  const bridge = resolveAicsBridgeConfig(config);
  const timeoutMs = Math.max(500, Math.min(15_000, Number(params.timeoutMs ?? 5_000) || 5_000));
  const live = params.live !== false;
  const checks: ClosedLoopReadinessCheck[] = [];

  checks.push(
    bridge.cloudBaseUrl
      ? closedLoopCheck("cloudBaseUrl", "云端地址", "pass", "cloudBaseUrl 已配置。")
      : closedLoopCheck(
          "cloudBaseUrl",
          "云端地址",
          "blocked",
          "请先在 API 管理同步云端商城 API 的 Base URL。",
        ),
  );
  checks.push(
    bridge.cloudAccessToken
      ? closedLoopCheck("cloudAccessToken", "云端账号 Token", "pass", "cloudAccessToken 已解析。")
      : bridge.cloudAccessTokenConfiguredButUnresolved
        ? closedLoopCheck(
            "cloudAccessToken",
            "云端账号 Token",
            "blocked",
            "cloudAccessToken 是 SecretRef，但当前运行时还没有解析到真实值。",
          )
        : closedLoopCheck(
            "cloudAccessToken",
            "云端账号 Token",
            "blocked",
            "请先在 API 管理填写并同步云端商城 API Key。",
          ),
  );
  checks.push(
    bridge.defaultDeviceId && bridge.defaultWorkspaceRef && bridge.defaultLocalGatewayId
      ? closedLoopCheck(
          "localExecutionContext",
          "本地执行上下文",
          "pass",
          "device/workspace/localGateway 已配置。",
        )
      : closedLoopCheck(
          "localExecutionContext",
          "本地执行上下文",
          "blocked",
          "缺少 defaultDeviceId、defaultWorkspaceRef 或 defaultLocalGatewayId。",
        ),
  );

  const hasBlockingConfig = checks.some((item) => item.status === "blocked");
  if (!live || hasBlockingConfig || !bridge.cloudBaseUrl || !bridge.cloudAccessToken) {
    if (!live)
      checks.push(
        closedLoopCheck("liveProbe", "云端探测", "skipped", "live=false，已跳过云端探测。"),
      );
    return {
      ok: checks.every((item) => item.status !== "blocked"),
      status: checks.some((item) => item.status === "blocked") ? "blocked" : "ready",
      live,
      checks,
      context: {
        cloudBaseUrl: bridge.cloudBaseUrl ?? null,
        deviceId: bridge.defaultDeviceId ?? null,
        workspaceRef: bridge.defaultWorkspaceRef ?? null,
        localGatewayId: bridge.defaultLocalGatewayId ?? null,
      },
    };
  }

  const myRolesUrl = new URL("/dijie/my-roles", bridge.cloudBaseUrl);
  if (bridge.defaultWorkspaceRef)
    myRolesUrl.searchParams.set("workspaceRef", bridge.defaultWorkspaceRef);
  if (bridge.defaultDeviceId) myRolesUrl.searchParams.set("deviceId", bridge.defaultDeviceId);

  let selectedRoleListingId = trimString(params.roleListingId);
  let selectedEntitlementId = trimString(params.entitlementId);
  let rolesCount = 0;
  try {
    const myRoles = await fetchJsonWithTimeout(
      myRolesUrl.toString(),
      { headers: { authorization: `Bearer ${bridge.cloudAccessToken}` } },
      timeoutMs,
    );
    const roles = Array.isArray(myRoles.payload.roles) ? myRoles.payload.roles : [];
    rolesCount = roles.length;
    if (!myRoles.ok || myRoles.payload.ok === false) {
      checks.push(
        closedLoopCheck(
          "myRoles",
          "我的岗位",
          "blocked",
          "GET /dijie/my-roles 未通过。",
          myRoles.status,
        ),
      );
    } else if (roles.length === 0) {
      checks.push(
        closedLoopCheck(
          "myRoles",
          "我的岗位",
          "blocked",
          "当前账号没有已授权岗位，请先发布并授权商城运营岗位。",
          myRoles.status,
        ),
      );
    } else {
      const selectedRole = selectedRoleListingId
        ? roles.find((role) => roleListingIdFromInstalledRole(role) === selectedRoleListingId)
        : roles[0];
      selectedRoleListingId = roleListingIdFromInstalledRole(selectedRole);
      selectedEntitlementId = selectedEntitlementId ?? entitlementIdFromInstalledRole(selectedRole);
      checks.push(
        closedLoopCheck(
          "myRoles",
          "我的岗位",
          "pass",
          `GET /dijie/my-roles 返回 ${roles.length} 个已授权岗位。`,
          myRoles.status,
        ),
      );
    }
  } catch (error) {
    checks.push(
      closedLoopCheck(
        "myRoles",
        "我的岗位",
        "blocked",
        error instanceof Error ? error.message : "GET /dijie/my-roles 请求失败。",
      ),
    );
  }

  if (
    selectedRoleListingId &&
    selectedEntitlementId &&
    bridge.defaultDeviceId &&
    bridge.defaultWorkspaceRef &&
    bridge.defaultLocalGatewayId
  ) {
    try {
      const executionToken = await fetchJsonWithTimeout(
        new URL("/dijie/execution-token", bridge.cloudBaseUrl).toString(),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${bridge.cloudAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            roleListingId: selectedRoleListingId,
            entitlementId: selectedEntitlementId,
            deviceId: bridge.defaultDeviceId,
            workspaceRef: bridge.defaultWorkspaceRef,
            localGatewayId: bridge.defaultLocalGatewayId,
          }),
        },
        timeoutMs,
      );
      checks.push(
        executionToken.ok && executionToken.payload.ok !== false
          ? closedLoopCheck(
              "executionToken",
              "执行令牌",
              "pass",
              "POST /dijie/execution-token 已通过。",
              executionToken.status,
            )
          : closedLoopCheck(
              "executionToken",
              "执行令牌",
              "blocked",
              "POST /dijie/execution-token 未通过。",
              executionToken.status,
            ),
      );
    } catch (error) {
      checks.push(
        closedLoopCheck(
          "executionToken",
          "执行令牌",
          "blocked",
          error instanceof Error ? error.message : "POST /dijie/execution-token 请求失败。",
        ),
      );
    }
  } else {
    checks.push(
      closedLoopCheck(
        "executionToken",
        "执行令牌",
        "blocked",
        "缺少 roleListingId、entitlementId 或本地执行上下文，无法申请 execution token。",
      ),
    );
  }

  return {
    ok: checks.every((item) => item.status !== "blocked"),
    status: checks.some((item) => item.status === "blocked") ? "blocked" : "ready",
    live,
    checks,
    context: {
      cloudBaseUrl: bridge.cloudBaseUrl,
      deviceId: bridge.defaultDeviceId ?? null,
      workspaceRef: bridge.defaultWorkspaceRef ?? null,
      localGatewayId: bridge.defaultLocalGatewayId ?? null,
      roleListingId: selectedRoleListingId ?? null,
      entitlementId: selectedEntitlementId ?? null,
      rolesCount,
    },
  };
}

export const aicsMainFlowHandlers: GatewayRequestHandlers = {
  "aics.cloudMarketplace.auditQueue.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.audit);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.capabilities.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.capabilities);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.uniqueCapabilityRequests.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.capabilities.uniqueRequests);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.businessSummary.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.businessSummary);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.dispatcherRoleReadModel.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.dispatcherRoleReadModel);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.dispatcherRoleSelection.create": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const roleListingId = requireString(params, "roleListingId");
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      const role = projection.dispatcherRoleReadModel.callableRoles.find(
        (candidate) => candidate.roleListingId === roleListingId,
      );
      if (!role) {
        throw new Error("dispatcher_role_not_authorized");
      }
      respond(true, {
        selectionId: `dispatcher_role_selection:${role.roleListingId}`,
        role,
        priceSnapshot: "cloud_marketplace_summary_only",
        entitlementStatus: "approved",
      });
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.cloudMarketplace.apiHealth.get": ({ params, respond }) => {
    try {
      requireActorContext(params);
      const projection = createCloudMarketplaceProjection(new AicsMainFlowStore().readModel());
      respond(true, projection.apiHealth);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.closedLoop.readiness.get": async ({ params, context, respond }) => {
    try {
      const readiness = await createClosedLoopReadiness(context.getRuntimeConfig(), params);
      respond(true, readiness);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.readModel.get": ({ respond }) => {
    try {
      respond(true, new AicsMainFlowStore().readModel());
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.interaction.create": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        createInteraction(state, toInteractionInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.observation.prepare": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        prepareObservation(state, toObservationInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.attribution.prepare": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        prepareAttribution(state, toAttributionInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.goal.candidate.create": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        createGoalCandidate(state, toGoalInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.goal.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmGoal(state, requireString(params, "goalId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.prepare": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        preparePlanning(state, toPlanningInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.planning.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmPlanning(state, requireString(params, "planningPackageId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.management.workBlocks.create": ({ params, respond }) => {
    try {
      const goalId = requireString(params, "goalId");
      const blocks = arrayParam(params, "blocks").map((block) => ({
        name: stringParam(block, "name") ?? "未命名工作块",
        purpose: stringParam(block, "purpose") ?? "承接已确认 CompanyGoal 的经营拆解。",
        progressGauge: stringParam(block, "progressGauge") ?? "待定义完成口径",
        roles: arrayParam(block, "roles").map((role) => ({
          roleListingId: stringParam(role, "roleListingId") ?? "unassigned",
          roleTitle: stringParam(role, "roleTitle") ?? "待授权岗位",
        })),
        tasks: arrayParam(block, "tasks").map((task) => ({
          title: stringParam(task, "title") ?? "未命名任务候选",
          targetDeliverable: stringParam(task, "targetDeliverable") ?? "待定义交付物",
        })),
      }));
      if (!blocks.length) {
        throw new Error("missing required blocks");
      }
      const result = new AicsMainFlowStore().update((state) =>
        createWorkBlocks(state, goalId, blocks),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.proposal.create": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        createDispatchProposal(state, toDispatchProposalInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.confirm": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        confirmDispatch(state, requireString(params, "dispatchProposalReviewId")),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.materializeTaskPackage": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        materializeTaskPackage(state, toTaskPackageInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
  "aics.mainFlow.dispatch.runApprovedTask": ({ params, respond }) => {
    try {
      const result = new AicsMainFlowStore().update((state) =>
        runApprovedTask(state, toRunApprovedTaskInput(params)),
      );
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },

  // ====================================================================
  // Auto-pipeline: 一键推进五层流程
  // ====================================================================

  /**
   * 自动执行归因→目标→规划→调度管道。
   *
   * 输入：owner（目标负责人名称）
   * 流程：
   *   1. 取最新的 ObservationPackage 和 CompanyGoal
   *   2. 归因对比：compareObservationsToGoal()
   *   3. 生成目标候选：generateGoalCandidate()
   *   4. 目标确认后生成规划：generatePlanningPackage()
   *   5. 规划确认后生成调度建议：generateDispatchProposal()
   *   6. 调度确认后物化 TaskPackage：materializeTaskPackage()
   *
   * 每层都在 HumanConfirm 门禁处等待确认。
   */
  "aics.mainFlow.auto.generatePipeline": ({ params, respond }) => {
    try {
      const owner = stringParam(params, "owner") ?? "迭界AI系统";
      const store = new AicsMainFlowStore();
      const readModel = store.readModel();
      const steps: string[] = [];
      const result: Record<string, unknown> = {};

      const latestObs = readModel.latest.observationPackage;
      const latestGoal = readModel.latest.companyGoal;

      if (!latestObs || !latestGoal) {
        result.ok = false;
        result.error = [
          !latestObs ? "缺少 ObservationPackage" : null,
          !latestGoal ? "缺少已确认的 CompanyGoal" : null,
        ]
          .filter(Boolean)
          .join("；");
        respond(true, result);
        return;
      }

      const compareResult = compareObservationsToGoal({
        observation: latestObs,
        previousGoal: latestGoal,
      });

      if (compareResult.dataInsufficient) {
        // 数据不足：只创建归因报告
        const attrInput = comparatorToAttributionInput(compareResult, latestObs.id);
        store.update((state) => {
          prepareAttribution(state, attrInput);
          return state;
        });
        steps.push(`归因(数据不足): ${compareResult.dataInsufficientReason}`);
      } else {
        // 在一个 update 中完成完整的五层管道
        store.update((state) => {
          // 1. 归因
          const attrInput = comparatorToAttributionInput(compareResult, latestObs.id);
          prepareAttribution(state, attrInput);
          const attrReport = state.attributions.at(-1);
          steps.push(`归因: ${attrInput.title}`);

          if (!attrReport) return state;

          // 2. 目标候选（观察+归因 → CompanyGoal）
          const goalCandidate = generateGoalCandidate({
            attributionResult: compareResult,
            attributionReportId: attrReport.id,
            observationPackageId: latestObs.id,
            owner,
          });
          createGoalCandidate(state, goalCandidate);
          const newGoal = state.goals.at(-1);
          steps.push(`目标候选: ${newGoal?.title ?? "(无)"}`);

          if (!newGoal) return state;

          // 3. 确认目标
          confirmGoal(state, newGoal.id);
          const confirmedGoal = state.goals.find((g) => g.id === newGoal.id);
          if (!confirmedGoal || confirmedGoal.status !== "confirmed") return state;

          // 4. 规划
          const planningResult = generatePlanningPackage({
            goal: confirmedGoal,
            attributionReport: attrReport,
            observationPackage: latestObs,
          });
          preparePlanning(state, planningResult.planning);
          const planning = state.planningPackages.at(-1);
          steps.push(
            `规划: ${planning?.title ?? "(无)"} (${planningResult.rolePlanItems.length} 项)`,
          );

          if (!planning) return state;

          // 5. 确认规划
          confirmPlanning(state, planning.id);
          const confirmedPlanning = state.planningPackages.find(
            (p) => p.id === planning.id && p.status === "confirmed",
          );
          if (!confirmedPlanning) return state;

          // 6. 调度建议 + 确认 + 物化
          const dispatchResults = generateDispatchProposal({
            planningPackage: confirmedPlanning,
            rolePlanItems: planningResult.rolePlanItems,
          });

          for (const { proposal } of dispatchResults) {
            createDispatchProposal(state, proposal);
            const dispatch = state.dispatchProposalReviews.at(-1);
            if (dispatch) {
              confirmDispatch(state, dispatch.id);
              const confirmedDispatch = state.dispatchProposalReviews.find(
                (d) => d.id === dispatch.id && d.status === "confirmed",
              );
              if (confirmedDispatch) {
                const materialized = materializeFromDispatch({
                  dispatchProposal: confirmedDispatch,
                  rolePlanItem:
                    planningResult.rolePlanItems.find(
                      (item) => item.id === proposal.rolePlanItemId,
                    ) ?? planningResult.rolePlanItems[0],
                });
                materializeTaskPackage(state, materialized);
              }
            }
          }
          steps.push(`调度: ${dispatchResults.length} 个 TaskPackage 已物化`);

          return state;
        });
      }

      result.steps = steps;
      result.readModel = store.readModel();
      result.ok = true;
      respond(true, result);
    } catch (error) {
      respondError(respond, error);
    }
  },
};
