import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { AICS_ATTRIBUTION_DIMENSIONS } from "./attribution-comparator.js";
import { getPipelineDb, createPipelineTables } from "./db.js";
import {
  buildObservationWorkspaceReadModel,
  type BusinessContext,
  type ObservationEvidence,
  type ObservationSourceAvailabilityInput,
} from "./generic-observation-engine.js";
import { resolveRoleCategoryCapabilityGrant } from "./role-category-capability-resolver.js";
import {
  AICS_MAIN_FLOW_VERSION,
  AicsMainFlowGateError,
  type AicsAuditRef,
  type AicsAccountGoalMode,
  type AicsMainFlowBlockedReason,
  type AicsCapability,
  type AicsCapabilityMatchResult,
  type AicsMainFlowExecutionPreflight,
  type AicsMainFlowInteraction,
  type AicsMainFlowReadiness,
  type AicsMainFlowReadModel,
  type AicsMainFlowRouteTab,
  type AicsMainFlowStage,
  type AicsMainFlowState,
  type AicsOperationCheck,
  type AicsToolSupplyResolution,
  type AicsUniqueCapabilityRequest,
  type AttributionFinding,
  type AttributionReport,
  type CompanyGoal,
  type DispatchProposalReview,
  type DispatchToRoleRequest,
  type ObservationPackage,
  type ObservationSignal,
  type PlanningPackage,
  type RolePlanItem,
  type RoleResult,
  type TaskPackage,
} from "./types.js";

type EntityInput = {
  id?: string;
  auditRefs?: AicsAuditRef[];
};

export type CreateInteractionInput = EntityInput & {
  stage: AicsMainFlowStage;
  message: string;
  proposedNextAction?: string;
};

export type PrepareObservationInput = EntityInput & {
  title: string;
  summary: string;
  signals?: ObservationSignal[];
};

export type PrepareAttributionInput = EntityInput & {
  observationPackageId?: string;
  title: string;
  summary: string;
  findings?: AttributionFinding[];
};

export type CreateGoalCandidateInput = EntityInput & {
  attributionReportId?: string;
  /** 观察包 ID——CompanyGoal 是观察+归因+目标三方共同确认的结果 */
  observationPackageId?: string;
  title: string;
  owner: string;
  metric: string;
  currentValue?: string;
  target: string;
  cycle?: string;
  rationale: string;
  whyNow?: string;
  sourceObservationSignalIds?: string[];
  sourceAttributionFindingIds?: string[];
  blockedReasons?: string[];
  readyForPlanning?: boolean;
};

export type PreparePlanningInput = EntityInput & {
  goalId?: string;
  title: string;
  summary: string;
  rolePlanItems: Array<
    EntityInput & {
      title: string;
      category?: string;
      roleCapabilityRef: string;
      taskIntent: string;
      expectedOutput: string;
      humanConfirmationRequired?: boolean;
      sourceSignalIds?: string[];
      sourceFindingIds?: string[];
      capabilityMatchSummary?: string;
      blockedReasons?: string[];
      acceptanceCriteria?: string[];
    }
  >;
};

export type UpdateRolePlanItemInput = EntityInput & {
  rolePlanItemId: string;
  title?: string;
  category?: string;
  roleCapabilityRef?: string;
  taskIntent?: string;
  expectedOutput?: string;
  humanConfirmationRequired?: boolean;
  capabilityMatchSummary?: string;
  blockedReasons?: string[];
  acceptanceCriteria?: string[];
};

export type CancelRolePlanItemInput = EntityInput & {
  rolePlanItemId: string;
  reason: string;
};

export type CreateDispatchProposalInput = EntityInput & {
  planningPackageId?: string;
  rolePlanItemId?: string;
  title: string;
  riskSummary: string;
  confirmationSummary: string;
};

export type MaterializeTaskPackageInput = EntityInput & {
  dispatchProposalReviewId?: string;
  title: string;
  taskText: string;
  capabilityResolution?: AicsToolSupplyResolution;
  request?: EntityInput & {
    roleListingId?: string;
    roleTitle?: string;
    entitlementId?: string;
    workspaceDir?: string;
  };
};

export type RunApprovedTaskInput = {
  taskPackageId?: string;
  dispatchToRoleRequestId?: string;
  /** 云端岗位编号。调度物化时缺失时，可由正式授权执行补齐。 */
  roleListingId?: string;
  /** 云端岗位标题。调度物化时缺失时，可由正式授权执行补齐。 */
  roleTitle?: string;
  /** 岗位商城授权引用。没有授权不能进入岗位执行。 */
  entitlementId?: string;
  /** 人工执行确认。岗位执行必须由管理者显式确认。 */
  confirmExecution?: boolean;
  /** 本次岗位执行费用确认。v1 只做确认门禁，不接真实支付。 */
  costConfirmed?: boolean;
  /** 费用/ledger 引用，可作为执行结果审计事实回写。 */
  ledgerRef?: string;
  result?: EntityInput & {
    outcome: RoleResult["outcome"];
    summary: string;
    artifactRefs?: string[];
    executionEvidence?: RoleResult["executionEvidence"];
  };
};

type EntityTimestamps = {
  createdAt: number;
  updatedAt: number;
};

export function resolveAicsMainFlowStorePath(
  env: NodeJS.ProcessEnv = process.env,
  homedir?: () => string,
): string {
  return path.join(resolveStateDir(env, homedir), "aics-main-flow", "state.json");
}

export function createEmptyAicsMainFlowState(now = Date.now()): AicsMainFlowState {
  return {
    version: AICS_MAIN_FLOW_VERSION,
    updatedAt: now,
    interactions: [],
    observations: [],
    observationEvidenceRuns: [],
    attributions: [],
    goals: [],
    planningPackages: [],
    rolePlanItems: [],
    dispatchProposalReviews: [],
    taskPackages: [],
    dispatchToRoleRequests: [],
    roleResults: [],
  };
}

function latestByCreatedAt<T extends { createdAt: number }>(items: T[]): T | null {
  return items.reduce<T | null>(
    (latest, item) => (!latest || item.createdAt >= latest.createdAt ? item : latest),
    null,
  );
}

function makeId(prefix: string, explicitId?: string): string {
  return explicitId?.trim() || `${prefix}_${randomUUID()}`;
}

function timestamps(now: number): EntityTimestamps {
  return { createdAt: now, updatedAt: now };
}

function auditRefs(input: EntityInput | undefined): AicsAuditRef[] {
  return input?.auditRefs ? [...input.auditRefs] : [];
}

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseOptionalJsonField<T, K extends string>(
  value: unknown,
  fieldName: K,
): Partial<Record<K, T>> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return { [fieldName]: JSON.parse(value) as T } as Partial<Record<K, T>>;
  } catch {
    return {};
  }
}

const CAPABILITY_BLOCK_MESSAGES: Record<AicsMainFlowBlockedReason["code"], string> = {
  missing_observation_package: "ObservationPackage is required before attribution.",
  missing_attribution_report: "AttributionReport is required before creating goal rationale.",
  missing_confirmed_company_goal: "A user-confirmed CompanyGoal is required before planning.",
  missing_confirmed_planning_package:
    "A confirmed PlanningPackage with RolePlanItem entries is required before dispatch.",
  missing_confirmed_dispatch_proposal:
    "A confirmed DispatchProposalReview is required before materializing a task package.",
  missing_task_package: "TaskPackage is required before role execution.",
  missing_dispatch_to_role_request: "DispatchToRoleRequest is required before role execution.",
  authorization_required: "岗位执行需要云端岗位授权：roleListingId 与 entitlementId 都必须存在。",
  execution_confirmation_required: "岗位执行需要管理者在岗位执行页显式确认。",
  cost_not_confirmed: "岗位执行需要确认本次费用。",
  duplicate_successful_execution:
    "该派发单已经执行完成并生成结果，不能重复运行。需要重新执行时请先由任务调度生成新的派发单。",
  missing_category_binding: "岗位还没有绑定可执行的品类能力。",
  missing_tool_binding: "品类能力缺少可执行组件。",
  missing_skill_binding: "品类能力缺少工作能力流程。",
  tool_skill_not_ready: "岗位能力还没有准备好。",
  missing_api_binding: "岗位执行需要的 API 绑定还没有就绪。",
  skill_disabled: "绑定的工作能力已关闭，不能进入调度执行。",
  skill_missing_dependency: "绑定的工作能力依赖未满足。",
  plugin_tool_disabled: "绑定的插件工具所属插件已关闭。",
  missing_tool_permission: "绑定的工具权限未批准。",
  unique_capability_pending: "独特能力申请仍在等待审核。",
  cloud_capability_not_authorized: "云端商城品类能力未授权。",
  high_risk_needs_human_approval: "高风险能力需要人工批准。",
  unsupported_capability_route: "能力路线当前没有可用执行组件或 API。",
  actor_context_missing: "缺少 actor_context，不能访问云端商城投影。",
};

function capabilityBlockedReason(
  code: AicsMainFlowBlockedReason["code"],
): AicsMainFlowBlockedReason {
  return {
    stage: code === "missing_api_binding" ? "dispatch" : "role",
    code,
    message: CAPABILITY_BLOCK_MESSAGES[code],
  };
}

function normalizeCapabilityBlockCode(reason: string): AicsMainFlowBlockedReason["code"] {
  switch (reason) {
    case "api_binding_required":
      return "missing_api_binding";
    case "missing_api_binding":
    case "missing_category_binding":
    case "missing_tool_binding":
    case "missing_skill_binding":
    case "skill_disabled":
    case "skill_missing_dependency":
    case "plugin_tool_disabled":
    case "missing_tool_permission":
    case "unique_capability_pending":
    case "cloud_capability_not_authorized":
    case "high_risk_needs_human_approval":
    case "unsupported_capability_route":
    case "actor_context_missing":
      return reason;
    default:
      return "tool_skill_not_ready";
  }
}

function normalizeCapabilityBlockedReasons(
  reasons: readonly string[],
): AicsMainFlowBlockedReason["code"][] {
  return [...new Set(reasons.map(normalizeCapabilityBlockCode))];
}

function assertNonEmptyPlanningText(value: string | undefined, fieldName: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_company_goal",
      message: `RolePlanItem ${fieldName} is required before planning can be confirmed.`,
    });
  }
  return trimmed;
}

function assertKnownPlanningSourceIds(params: {
  ids: readonly string[] | undefined;
  allowedIds: readonly string[];
  label: string;
}) {
  const allowed = new Set(params.allowedIds);
  const invalid = (params.ids ?? []).filter((id) => !allowed.has(id));
  if (invalid.length > 0) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_company_goal",
      message: `RolePlanItem ${params.label} must reference confirmed goal sources: ${invalid.join(", ")}`,
    });
  }
}

function confirmed<T extends { status: string }>(item: T | null): T | null {
  return item?.status === "confirmed" ? item : null;
}

function latestConfirmed<T extends { status: string; createdAt: number }>(items: T[]): T | null {
  return confirmed(latestByCreatedAt(items.filter((item) => item.status === "confirmed")));
}

function observationHasSignals(
  observation: ObservationPackage | null | undefined,
): observation is ObservationPackage {
  return Boolean(observation && observation.signals.length > 0);
}

function observationReadyForAttribution(
  observation: ObservationPackage | null | undefined,
): observation is ObservationPackage {
  return Boolean(
    observation &&
    observation.status === "confirmed" &&
    observationHasSignals(observation) &&
    observation.signals.every((signal) => signal.evidenceRefs.length > 0),
  );
}

function attributionReadyForGoal(
  attribution: AttributionReport | null | undefined,
): attribution is AttributionReport {
  return Boolean(
    attribution?.status === "confirmed" &&
    attribution.findings.length > 0 &&
    attribution.findings.every((finding) => finding.observationSignalIds.length > 0),
  );
}

function getReadiness(state: AicsMainFlowState) {
  const latestObservation = latestByCreatedAt(state.observations);
  const latestAttribution = latestByCreatedAt(state.attributions);
  const latestConfirmedGoal = latestConfirmed(state.goals);
  const latestConfirmedPlanning = latestConfirmed(state.planningPackages);
  const latestConfirmedDispatch = latestConfirmed(state.dispatchProposalReviews);
  const latestTaskPackage = latestByCreatedAt(state.taskPackages);
  const latestDispatchRequest = latestByCreatedAt(state.dispatchToRoleRequests);
  return {
    canPrepareAttribution: observationReadyForAttribution(latestObservation),
    canCreateGoalCandidate: attributionReadyForGoal(latestAttribution),
    canPreparePlanning: Boolean(latestConfirmedGoal),
    canCreateDispatchProposal: Boolean(latestConfirmedPlanning),
    canMaterializeTaskPackage: Boolean(latestConfirmedDispatch),
    canEnterRoleExecution: Boolean(latestTaskPackage && latestDispatchRequest),
    canRunApprovedTask: getAicsMainFlowExecutionPreflight(state).canRun,
  };
}

export function getAicsMainFlowExecutionPreflight(
  state: AicsMainFlowState,
  input: { taskPackageId?: string; dispatchToRoleRequestId?: string } = {},
): AicsMainFlowExecutionPreflight {
  const taskPackageId = input.taskPackageId ?? latestByCreatedAt(state.taskPackages)?.id;
  const dispatchToRoleRequestId =
    input.dispatchToRoleRequestId ?? latestByCreatedAt(state.dispatchToRoleRequests)?.id;
  const latestTaskPackage = taskPackageId
    ? (state.taskPackages.find((item) => item.id === taskPackageId) ?? null)
    : null;
  const latestDispatchRequest = dispatchToRoleRequestId
    ? (state.dispatchToRoleRequests.find(
        (item) =>
          item.id === dispatchToRoleRequestId &&
          (!latestTaskPackage || item.taskPackageId === latestTaskPackage.id),
      ) ?? null)
    : null;
  const hasTaskPackage = Boolean(latestTaskPackage);
  const hasDispatchToRoleRequest = Boolean(latestDispatchRequest);
  const hasCapabilityBlock = Boolean(
    latestDispatchRequest?.capabilityRequestId &&
    (latestTaskPackage?.status === "blocked" || latestDispatchRequest.status === "blocked"),
  );
  const hasEntitlement = Boolean(
    latestDispatchRequest?.roleListingId && latestDispatchRequest.entitlementId,
  );
  const hasExecutionConfirmation = latestDispatchRequest?.confirmExecution === true;
  const hasCostConfirmation = latestDispatchRequest?.costConfirmed === true;
  const hasToolSkillReadiness = Boolean(
    latestDispatchRequest && latestDispatchRequest.toolSkillReady !== false && !hasCapabilityBlock,
  );
  const hasApiBinding = Boolean(
    latestDispatchRequest && latestDispatchRequest.apiBindingReady !== false,
  );
  const capabilityBlockedReasons = latestDispatchRequest?.capabilityBlockedReasons ?? [];
  const blockedReasons: AicsMainFlowBlockedReason[] = [];
  if (!hasTaskPackage) {
    blockedReasons.push({
      stage: "dispatch",
      code: "missing_task_package",
      message: "TaskPackage is required before role execution.",
    });
  }
  if (!hasDispatchToRoleRequest) {
    blockedReasons.push({
      stage: "dispatch",
      code: "missing_dispatch_to_role_request",
      message: "DispatchToRoleRequest is required before role execution.",
    });
  }
  if (hasTaskPackage && hasDispatchToRoleRequest && !hasEntitlement) {
    blockedReasons.push({
      stage: "role",
      code: "authorization_required",
      message: "岗位执行需要云端岗位授权：roleListingId 与 entitlementId 都必须存在。",
    });
  }
  if (hasTaskPackage && hasDispatchToRoleRequest && !hasExecutionConfirmation) {
    blockedReasons.push({
      stage: "role",
      code: "execution_confirmation_required",
      message: "岗位执行需要管理者在岗位执行页显式确认。",
    });
  }
  if (hasTaskPackage && hasDispatchToRoleRequest && !hasCostConfirmation) {
    blockedReasons.push({
      stage: "role",
      code: "cost_not_confirmed",
      message: "岗位执行需要确认本次费用。",
    });
  }
  if (hasTaskPackage && hasDispatchToRoleRequest && !hasToolSkillReadiness) {
    const explicitToolSkillBlocks = capabilityBlockedReasons.filter(
      (reason) => reason !== "missing_api_binding",
    );
    if (explicitToolSkillBlocks.length) {
      blockedReasons.push(...explicitToolSkillBlocks.map(capabilityBlockedReason));
    } else {
      if ((latestDispatchRequest?.allowedTools ?? []).length === 0) {
        blockedReasons.push(capabilityBlockedReason("missing_tool_binding"));
      }
      if ((latestDispatchRequest?.allowedSkills ?? []).length === 0) {
        blockedReasons.push(capabilityBlockedReason("missing_skill_binding"));
      }
      blockedReasons.push(capabilityBlockedReason("tool_skill_not_ready"));
    }
  }
  if (hasTaskPackage && hasDispatchToRoleRequest && !hasApiBinding) {
    blockedReasons.push(capabilityBlockedReason("missing_api_binding"));
  }
  const seen = new Set<string>();
  const dedupedBlockedReasons = blockedReasons.filter((reason) => {
    const key = `${reason.stage}:${reason.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    ...(taskPackageId ? { taskPackageId } : {}),
    ...(dispatchToRoleRequestId ? { dispatchToRoleRequestId } : {}),
    hasTaskPackage,
    hasDispatchToRoleRequest,
    hasEntitlement,
    hasExecutionConfirmation,
    hasCostConfirmation,
    hasToolSkillReadiness,
    hasApiBinding,
    blockedReasons: dedupedBlockedReasons,
    canRun: Boolean(
      latestTaskPackage &&
      latestDispatchRequest &&
      hasEntitlement &&
      hasExecutionConfirmation &&
      hasCostConfirmation &&
      hasToolSkillReadiness &&
      hasApiBinding,
    ),
  };
}

export function getAicsMainFlowBlockedReasons(
  state: AicsMainFlowState,
): AicsMainFlowBlockedReason[] {
  const readiness = getReadiness(state);
  const reasons: AicsMainFlowBlockedReason[] = [];
  if (!readiness.canPrepareAttribution) {
    reasons.push({
      stage: "observation",
      code: "missing_observation_package",
      message: "ObservationPackage is required before attribution.",
    });
  }
  if (!readiness.canCreateGoalCandidate) {
    reasons.push({
      stage: "attribution",
      code: "missing_attribution_report",
      message: "AttributionReport is required before creating goal rationale.",
    });
  }
  if (!readiness.canPreparePlanning) {
    reasons.push({
      stage: "goal",
      code: "missing_confirmed_company_goal",
      message: "A user-confirmed CompanyGoal is required before planning.",
    });
  }
  if (!readiness.canCreateDispatchProposal) {
    reasons.push({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "A confirmed PlanningPackage with RolePlanItem entries is required before dispatch.",
    });
  }
  if (!readiness.canMaterializeTaskPackage) {
    reasons.push({
      stage: "dispatch",
      code: "missing_confirmed_dispatch_proposal",
      message:
        "A confirmed DispatchProposalReview is required before materializing a task package.",
    });
  }
  if (!latestByCreatedAt(state.taskPackages)) {
    reasons.push({
      stage: "dispatch",
      code: "missing_task_package",
      message: "TaskPackage is required before role execution.",
    });
  }
  if (!latestByCreatedAt(state.dispatchToRoleRequests)) {
    reasons.push({
      stage: "dispatch",
      code: "missing_dispatch_to_role_request",
      message: "DispatchToRoleRequest is required before role execution.",
    });
  }
  if (readiness.canEnterRoleExecution) {
    reasons.push(...getAicsMainFlowExecutionPreflight(state).blockedReasons);
  }
  return reasons;
}

function requireGate(state: AicsMainFlowState, code: AicsMainFlowBlockedReason["code"]): void {
  const reason = getAicsMainFlowBlockedReasons(state).find((item) => item.code === code);
  if (reason) {
    throw new AicsMainFlowGateError(reason);
  }
}

function inferCategory(...texts: Array<string | undefined>): string {
  const source = texts.filter(Boolean).join(" ").toLowerCase();
  if (/岗位商城|岗位商品|授权转化|执行成功率|role marketplace|marketplace/.test(source))
    return "岗位商城";
  if (/岗位|商品|商城|role|listing/.test(source)) return "岗位商城";
  if (/短视频|视频|直播|douyin|抖音/.test(source)) return "内容视频";
  if (/客服|售后|退款|投诉/.test(source)) return "客服售后";
  if (/库存|供应链|采购|交期/.test(source)) return "供应链";
  return "通用品类";
}

function categoryCommonCapability(category: string): AicsCapability {
  const slug = category.replace(/\s+/g, "-").toLowerCase();
  return {
    id: `category_common:${slug}`,
    scope: "category_common",
    category,
    label: `${category}通用能力`,
    description:
      "品类通用能力 = 已授权能力组件 + 通用工作能力流程，用于完成读取、分析、差距判断、建议和统一输出。",
    tools: [
      { id: "tool.read.product_profile", label: "读取产品资料", kind: "read", status: "granted" },
      {
        id: "tool.read.business_context",
        label: "读取经营上下文",
        kind: "read",
        status: "granted",
      },
      {
        id: "tool.execute.report_draft",
        label: "生成报告/建议草稿",
        kind: "execute",
        status: "granted",
      },
      {
        id: "tool.high_risk.external_action",
        label: "对外发布/改价/资金动作",
        kind: "high_risk",
        status: "needs_human_confirm",
      },
    ],
    skills: [
      {
        id: "skill.current_to_target_gap",
        label: "当前状态到目标状态差距分析",
        version: "local-v1",
        status: "granted",
        outputSchema: "unified_json",
      },
      {
        id: "skill.category_common_output",
        label: `${category}通用输出规则`,
        version: "local-v1",
        status: "granted",
        outputSchema: "unified_json",
      },
    ],
    approvalStatus: "approved",
    humanConfirmRequired: false,
  };
}

function needsUniqueCapability(item: RolePlanItem): boolean {
  const text =
    `${item.title} ${item.taskIntent} ${item.expectedOutput} ${item.roleCapabilityRef}`.toLowerCase();
  return /独特|专属|掌静脉|合规|comfy|发布|改价|退款|资金|采购|外部/.test(text);
}

function uniqueCapabilityApprovedInDispatch(state: AicsMainFlowState, requestId: string): boolean {
  return state.dispatchToRoleRequests.some(
    (request) =>
      request.capabilityRequestId === requestId &&
      request.toolSkillReady !== false &&
      request.status !== "blocked",
  );
}

function buildCapabilityReadModel(state: AicsMainFlowState): AicsMainFlowReadModel["capabilities"] {
  const categoryByItem = new Map<string, string>();
  for (const item of state.rolePlanItems) {
    const planning = state.planningPackages.find((pkg) => pkg.id === item.planningPackageId);
    const goal = planning ? state.goals.find((g) => g.id === planning.goalId) : undefined;
    categoryByItem.set(
      item.id,
      item.category ??
        inferCategory(
          item.title,
          item.taskIntent,
          item.expectedOutput,
          goal?.title,
          goal?.rationale,
        ),
    );
  }
  const categories = [...new Set([...categoryByItem.values(), "通用品类"])];
  const categoryCommon = categories.map(categoryCommonCapability);
  const uniqueRequests: AicsUniqueCapabilityRequest[] = [];
  const matches: AicsCapabilityMatchResult[] = [];

  for (const item of state.rolePlanItems) {
    const category = categoryByItem.get(item.id) ?? "通用品类";
    const common =
      categoryCommon.find((cap) => cap.category === category) ?? categoryCommonCapability(category);
    const requestId = `unique_cap_req:${item.id}`;
    const requiresUnique = needsUniqueCapability(item);
    const uniqueApproved = requiresUnique && uniqueCapabilityApprovedInDispatch(state, requestId);
    if (requiresUnique) {
      uniqueRequests.push({
        id: requestId,
        category,
        rolePlanItemId: item.id,
        missingCapability: `${category}独特能力：${item.roleCapabilityRef}`,
        capabilityType: "both",
        neededTools: ["tool.execute.category_specific"],
        neededSkills: [`skill.${category}.specific_rules`],
        reason: "品类通用能力只能覆盖读取、分析、建议和统一输出；该任务需要额外能力授权。",
        riskLevel: item.humanConfirmationRequired ? "high" : "medium",
        status: uniqueApproved ? "approved" : "requested",
        humanConfirmRequired: true,
      });
    }
    const missingTools =
      requiresUnique && !uniqueApproved ? ["tool.execute.category_specific"] : [];
    const missingSkills =
      requiresUnique && !uniqueApproved ? [`skill.${category}.specific_rules`] : [];
    matches.push({
      rolePlanItemId: item.id,
      category,
      requiredCapabilityRef: item.roleCapabilityRef,
      commonCapabilityId: common.id,
      ...(requiresUnique ? { uniqueCapabilityRequestId: requestId } : {}),
      status: requiresUnique && !uniqueApproved ? "needs_unique_capability" : "satisfied",
      allowedTools: [
        ...common.tools.filter((tool) => tool.status === "granted").map((tool) => tool.id),
        ...(uniqueApproved ? ["tool.execute.category_specific"] : []),
      ],
      allowedSkills: common.skills
        .filter((skill) => skill.status === "granted")
        .map((skill) => skill.id)
        .concat(uniqueApproved ? [`skill.${category}.specific_rules`] : []),
      missingTools,
      missingSkills,
      summary:
        requiresUnique && !uniqueApproved
          ? "通用能力不足，必须先提交独特能力申请，确认能力配置后才能执行。"
          : uniqueApproved
            ? "独特能力已通过能力配置管控批准，允许调度请求进入执行确认。"
            : "品类通用能力已满足，允许调度生成结构化任务包。",
    });
  }

  return { categoryCommon, uniqueRequests, matches };
}

function checkStatus(done: boolean, ready: boolean, blocked = false): AicsOperationCheck["status"] {
  if (done) return "done";
  if (blocked) return "blocked";
  return ready ? "ready" : "waiting";
}

function buildOperationChecks(params: {
  state: AicsMainFlowState;
  readiness: ReturnType<typeof getReadiness>;
  blockedReasons: AicsMainFlowBlockedReason[];
  capabilities: AicsMainFlowReadModel["capabilities"];
}): AicsOperationCheck[] {
  const { state, readiness, blockedReasons, capabilities } = params;
  const latestTask = latestByCreatedAt(state.taskPackages);
  const latestRequest = latestByCreatedAt(state.dispatchToRoleRequests);
  const latestResult = latestByCreatedAt(state.roleResults);
  const hasCapabilityBlock = capabilities.matches.some((match) => match.status !== "satisfied");
  const hasRoleExecutionBlock =
    latestTask?.status === "blocked" ||
    latestRequest?.status === "blocked" ||
    blockedReasons.some(
      (reason) =>
        reason.code === "authorization_required" ||
        reason.code === "execution_confirmation_required" ||
        reason.code === "cost_not_confirmed" ||
        reason.code === "tool_skill_not_ready" ||
        reason.code === "missing_api_binding",
    );
  const artifactRefs = latestResult?.artifactRefs ?? [];
  const hasLedgerRef = artifactRefs.some((ref) => ref.startsWith("ledger:"));
  const hasAuditRef = artifactRefs.some((ref) => ref.startsWith("audit:"));
  const hasBusinessArtifactRef = artifactRefs.some(isBusinessArtifactRef);

  return [
    {
      id: "main_flow.observation",
      title: "经营概览到数据分析",
      layer: "main_flow",
      status: checkStatus(state.observations.length > 0, Boolean(state.interactions.length)),
      summary:
        "经营意图生成岗位商城观察包，覆盖云端商城、本地 OpenClaw、岗位供给、用户使用、调度执行、外部产品、外部技术、可吸收能力和风险数据质量。",
      routeTab: "observation",
      nextAction:
        state.observations.length > 0 ? "查看数据分析包" : "在经营概览发起岗位商城经营意图",
    },
    {
      id: "main_flow.attribution",
      title: "数据分析到归因分析",
      layer: "main_flow",
      status: checkStatus(state.attributions.length > 0, readiness.canPrepareAttribution),
      summary:
        "归因层解释岗位商城目标差距，区分云端商城、本地端、能力路由、API/模型、页面体验、调度执行、外部能力、竞品压力和风险数据质量。",
      routeTab: "attribution",
      nextAction: state.attributions.length > 0 ? "查看归因报告" : "基于观察信号生成归因报告",
    },
    {
      id: "main_flow.goal",
      title: "归因分析到公司目标",
      layer: "main_flow",
      status: checkStatus(Boolean(latestConfirmed(state.goals)), readiness.canCreateGoalCandidate),
      summary: "目标层确认岗位商城真实可用目标、产品目标、能力吸收目标和风险控制目标。",
      routeTab: "goals",
      nextAction: latestConfirmed(state.goals) ? "查看已确认目标" : "创建并确认公司目标候选",
    },
    {
      id: "main_flow.planning",
      title: "公司目标到规划方案",
      layer: "main_flow",
      status: checkStatus(
        Boolean(latestConfirmed(state.planningPackages)),
        readiness.canPreparePlanning,
      ),
      summary: "规划层生成岗位商城方案、工作块和 RolePlanItem，再经人工确认进入调度层。",
      routeTab: "company",
      nextAction: latestConfirmed(state.planningPackages) ? "查看规划方案" : "生成并确认规划方案",
    },
    {
      id: "main_flow.dispatch",
      title: "规划方案到任务调度",
      layer: "main_flow",
      status: checkStatus(
        Boolean(latestConfirmed(state.dispatchProposalReviews)),
        readiness.canCreateDispatchProposal,
      ),
      summary: "调度层读取真实岗位授权、能力路由、能力配置和 API 状态，物化派发单和执行队列项。",
      routeTab: "workboard",
      nextAction: latestConfirmed(state.dispatchProposalReviews)
        ? "查看已确认调度"
        : "创建并确认调度建议",
    },
    {
      id: "main_flow.execution",
      title: "任务调度到岗位执行",
      layer: "main_flow",
      status: checkStatus(
        Boolean(latestResult),
        readiness.canEnterRoleExecution,
        hasRoleExecutionBlock,
      ),
      summary: "岗位执行只能消费已授权、已确认费用的调度请求，并回写 RoleResult。",
      routeTab: "aics",
      ...(hasRoleExecutionBlock ? { blockedReason: "岗位授权、费用确认或能力匹配尚未完成。" } : {}),
      nextAction: latestResult ? "查看岗位执行结果" : "在岗位执行页运行已授权调度请求",
    },
    {
      id: "support.tools_skills",
      title: "岗位能力核对",
      layer: "support",
      status: checkStatus(
        capabilities.matches.length > 0 && !hasCapabilityBlock,
        capabilities.matches.length > 0,
        hasCapabilityBlock,
      ),
      summary: "核对岗位所需能力是否已由通用品类能力、能力组件和工作能力流程满足。",
      routeTab: "skills",
      ...(hasCapabilityBlock ? { blockedReason: "存在独特能力或能力配置未满足项。" } : {}),
      nextAction: hasCapabilityBlock ? "到能力配置处理能力缺口" : "能力满足后返回任务调度",
    },
    {
      id: "support.usage_billing",
      title: "费用与授权核对",
      layer: "support",
      status: checkStatus(
        hasLedgerRef,
        Boolean(latestRequest?.roleListingId),
        hasRoleExecutionBlock && !hasLedgerRef,
      ),
      summary:
        "核对 roleListingId、entitlementId、confirmExecution、costConfirmed 和 ledger 回写。",
      routeTab: "usage",
      ...(hasRoleExecutionBlock && !hasLedgerRef
        ? { blockedReason: "缺少岗位授权、人工执行确认或本次费用确认。" }
        : {}),
      nextAction: hasLedgerRef ? "查看费用/ledger 回写" : "到费用与授权完成执行前确认",
    },
    {
      id: "support.api_management",
      title: "API 管理核对",
      layer: "support",
      status: checkStatus(Boolean(latestRequest?.roleListingId), state.rolePlanItems.length > 0),
      summary: "核对云端岗位桥、岗位目录、授权状态和执行审计读取入口是否可用。",
      routeTab: "apiManagement",
      nextAction: latestRequest?.roleListingId
        ? "API 桥已绑定到调度请求"
        : "到 API 管理确认云端岗位桥配置",
    },
    {
      id: "support.audit_ledger",
      title: "审计与账本回写",
      layer: "support",
      status: checkStatus(
        Boolean(latestResult && hasBusinessArtifactRef && hasAuditRef && hasLedgerRef),
        Boolean(latestResult),
      ),
      summary: "核对 RoleResult、业务产物、audit 和 ledger 是否形成可回看的本地执行证据。",
      routeTab: "aics",
      nextAction:
        latestResult && hasBusinessArtifactRef && hasAuditRef && hasLedgerRef
          ? "查看岗位执行证据"
          : "执行岗位后读回业务产物、审计记录和账本记录",
    },
  ];
}

const STAGE_GUIDANCE_COPY: Record<
  AicsMainFlowStage,
  Omit<AicsMainFlowReadModel["stageGuidance"], "stage">
> = {
  observation: {
    title: "数据分析",
    description:
      "根据当前业务动态发现内部数据、外部信息、工具和 Skill 证据源，只整理事实，不直接定目标。",
    primaryActionLabel: "开始观察",
    primaryActionTarget: "observation",
    nextStepLabel: "确认后进入归因分析",
  },
  attribution: {
    title: "归因分析",
    description: "基于已确认观察解释目标差距的主因、影响和证据，不能脱离事实编原因。",
    primaryActionLabel: "开始归因",
    primaryActionTarget: "attribution",
    nextStepLabel: "确认后进入公司目标",
  },
  goal: {
    title: "公司目标",
    description: "把观察和归因收敛成可治理目标，明确指标、周期、负责人和确认状态。",
    primaryActionLabel: "确认目标",
    primaryActionTarget: "goals",
    nextStepLabel: "确认后进入规划方案",
  },
  planning: {
    title: "规划方案",
    description: "把已确认公司目标拆成经营工作块和岗位工作项，形成调度层可读取的正式规划包。",
    primaryActionLabel: "确认规划",
    primaryActionTarget: "company",
    nextStepLabel: "确认后进入任务调度",
  },
  dispatch: {
    title: "任务调度",
    description:
      "检查岗位授权、能力匹配、能力配置和 API 条件，生成派发单和执行队列项，不直接执行岗位。",
    primaryActionLabel: "检查并派发",
    primaryActionTarget: "workboard",
    nextStepLabel: "派发成功后进入岗位执行",
  },
  role: {
    title: "岗位执行",
    description:
      "只运行已派发、已授权、已确认费用和执行条件的岗位任务，并回写结果、审计和账本证据。",
    primaryActionLabel: "确认并运行",
    primaryActionTarget: "aics",
    nextStepLabel: "完成后查看执行结果和产物",
  },
};

function buildStageGuidance(params: {
  state: AicsMainFlowState;
  stage: AicsMainFlowStage;
  readiness: ReturnType<typeof getReadiness>;
  executionPreflight: AicsMainFlowExecutionPreflight;
}): AicsMainFlowReadModel["stageGuidance"] {
  const { state, stage, readiness, executionPreflight } = params;
  const copy = STAGE_GUIDANCE_COPY[stage];
  const latestObservation = latestByCreatedAt(state.observations);
  const latestAttribution = latestByCreatedAt(state.attributions);
  const latestGoal = latestConfirmed(state.goals);
  const latestPlanning = latestConfirmed(state.planningPackages);
  const latestDispatch = latestConfirmed(state.dispatchProposalReviews);
  const hasTaskPackage = Boolean(latestByCreatedAt(state.taskPackages));
  const hasDispatchRequest = Boolean(latestByCreatedAt(state.dispatchToRoleRequests));

  if (stage === "observation") {
    if (!latestObservation) {
      return {
        stage,
        ...copy,
        primaryActionLabel: "开始观察",
        primaryActionTarget: "businessOverview",
        nextStepLabel: "先生成数据分析包，再确认后进入归因分析",
      };
    }
    if (!observationHasSignals(latestObservation)) {
      return {
        stage,
        ...copy,
        primaryActionLabel: "开始观察",
        primaryActionTarget: "observation",
        nextStepLabel: "数据分析包缺少可用事实，不能进入归因",
      };
    }
    if (!observationReadyForAttribution(latestObservation)) {
      return {
        stage,
        ...copy,
        primaryActionLabel: "确认观察",
        primaryActionTarget: "observation",
        nextStepLabel: "确认后进入归因分析",
      };
    }
    return {
      stage,
      ...copy,
      primaryActionLabel: "开始归因",
      primaryActionTarget: "attribution",
      nextStepLabel: "数据分析已确认，可以生成归因报告",
    };
  }

  if (stage === "attribution") {
    if (!readiness.canPrepareAttribution) {
      return {
        stage,
        ...copy,
        primaryActionLabel: "去数据分析",
        primaryActionTarget: "observation",
        nextStepLabel: "需要先确认数据分析包",
      };
    }
    if (!latestAttribution) {
      return {
        stage,
        ...copy,
        primaryActionLabel: "开始归因",
        primaryActionTarget: "attribution",
        nextStepLabel: "生成后确认主因、影响和证据",
      };
    }
    if (!attributionReadyForGoal(latestAttribution)) {
      return {
        stage,
        ...copy,
        primaryActionLabel: "确认归因",
        primaryActionTarget: "attribution",
        nextStepLabel: "确认后进入公司目标",
      };
    }
    return {
      stage,
      ...copy,
      primaryActionLabel: "去公司目标",
      primaryActionTarget: "goals",
      nextStepLabel: "归因已确认，可以创建公司目标",
    };
  }

  if (stage === "goal") {
    return {
      stage,
      ...copy,
      primaryActionLabel: latestGoal ? "去规划方案" : "确认目标",
      primaryActionTarget: latestGoal ? "company" : "goals",
      nextStepLabel: latestGoal
        ? "公司目标已确认，可以进入规划拆解"
        : "需要先把归因收敛成公司目标并确认",
    };
  }

  if (stage === "planning") {
    return {
      stage,
      ...copy,
      primaryActionLabel: latestPlanning ? "去任务调度" : "确认规划",
      primaryActionTarget: latestPlanning ? "workboard" : "company",
      nextStepLabel: latestPlanning
        ? "规划方案已确认，可以检查并派发"
        : "需要把公司目标拆成正式规划包",
    };
  }

  if (stage === "dispatch") {
    if (!latestDispatch) {
      return {
        stage,
        ...copy,
        primaryActionLabel: "检查并派发",
        primaryActionTarget: "workboard",
        nextStepLabel: "先完成派发预检，确认后生成派发单",
      };
    }
    if (!hasTaskPackage || !hasDispatchRequest) {
      return {
        stage,
        ...copy,
        primaryActionLabel: "生成派发单",
        primaryActionTarget: "workboard",
        nextStepLabel: "派发预检已确认，下一步生成派发单和执行队列",
      };
    }
    return {
      stage,
      ...copy,
      primaryActionLabel: "去岗位执行",
      primaryActionTarget: "aics",
      nextStepLabel: "派发单已生成，可以进入岗位执行",
    };
  }

  return {
    stage,
    ...copy,
    primaryActionLabel: executionPreflight.canRun ? "确认并运行" : "处理执行阻塞",
    primaryActionTarget: executionPreflight.canRun ? "aics" : "aics",
    nextStepLabel: executionPreflight.canRun
      ? "执行条件已满足，可以运行岗位任务"
      : "需要先处理授权、费用、API 或岗位能力阻塞",
  };
}

function buildStageProgress(params: {
  state: AicsMainFlowState;
  currentStage: AicsMainFlowStage;
  executionPreflight: AicsMainFlowExecutionPreflight;
  executionClosure: AicsMainFlowReadModel["executionClosure"];
  blockedReasons: AicsMainFlowBlockedReason[];
}): AicsMainFlowReadModel["stageProgress"] {
  const { state, currentStage, executionPreflight, executionClosure, blockedReasons } = params;
  const latestObservation = latestByCreatedAt(state.observations);
  const latestAttribution = latestByCreatedAt(state.attributions);
  const latestGoal = latestConfirmed(state.goals);
  const latestPlanning = latestConfirmed(state.planningPackages);
  const latestDispatch = latestConfirmed(state.dispatchProposalReviews);
  const latestTaskPackage = latestByCreatedAt(state.taskPackages);
  const latestDispatchRequest = latestByCreatedAt(state.dispatchToRoleRequests);
  const latestRoleResult = latestByCreatedAt(state.roleResults);

  const completedByStage: Record<AicsMainFlowStage, boolean> = {
    observation: Boolean(latestObservation && observationReadyForAttribution(latestObservation)),
    attribution: Boolean(latestAttribution && attributionReadyForGoal(latestAttribution)),
    goal: Boolean(latestGoal),
    planning: Boolean(latestPlanning),
    dispatch: Boolean(latestTaskPackage && latestDispatchRequest),
    role: executionClosure.status === "completed",
  };
  const blockedByStage: Record<AicsMainFlowStage, boolean> = {
    observation: Boolean(latestObservation && !observationHasSignals(latestObservation)),
    attribution: blockedReasons.some((reason) => reason.stage === "attribution"),
    goal: blockedReasons.some((reason) => reason.stage === "goal"),
    planning: blockedReasons.some((reason) => reason.stage === "planning"),
    dispatch: blockedReasons.some((reason) => reason.stage === "dispatch"),
    role: executionClosure.status === "blocked" || executionClosure.status === "failed",
  };
  const previousComplete: Record<AicsMainFlowStage, boolean> = {
    observation: true,
    attribution: completedByStage.observation,
    goal: completedByStage.observation && completedByStage.attribution,
    planning: completedByStage.observation && completedByStage.attribution && completedByStage.goal,
    dispatch:
      completedByStage.observation &&
      completedByStage.attribution &&
      completedByStage.goal &&
      completedByStage.planning,
    role:
      completedByStage.observation &&
      completedByStage.attribution &&
      completedByStage.goal &&
      completedByStage.planning &&
      completedByStage.dispatch,
  };
  const statusFor = (
    stage: AicsMainFlowStage,
  ): AicsMainFlowReadModel["stageProgress"][number]["status"] => {
    if (completedByStage[stage]) return "completed";
    if (blockedByStage[stage]) return "blocked";
    if (stage === currentStage) return "current";
    if (previousComplete[stage]) return "available";
    return "locked";
  };
  const statusLabelFor = (
    status: AicsMainFlowReadModel["stageProgress"][number]["status"],
  ): string => {
    if (status === "completed") return "已完成";
    if (status === "current") return "当前处理";
    if (status === "available") return "可处理";
    if (status === "blocked") return "需修复";
    return "未开放";
  };
  const blockerCountFor = (stage: AicsMainFlowStage) =>
    blockedReasons.filter((reason) => reason.stage === stage).length +
    (stage === "role" && executionClosure.status === "blocked"
      ? executionClosure.missingEvidence.length
      : 0);
  const rows: Array<{
    stage: AicsMainFlowStage;
    label: string;
    routeTab: AicsMainFlowRouteTab;
    summary: string;
    nextAction: string;
    actionLabel: string;
    actionTab: AicsMainFlowRouteTab;
    evidenceCount: number;
  }> = [
    {
      stage: "observation",
      label: "数据分析",
      routeTab: "observation",
      summary: latestObservation
        ? `已形成数据分析包：${latestObservation.title}`
        : "还没有数据分析包；先从经营概览输入真实经营问题。",
      nextAction: completedByStage.observation ? "交给归因分析解释主因。" : "补齐并确认可用事实。",
      actionLabel: latestObservation ? "查看数据分析" : "发起经营意图",
      actionTab: latestObservation ? "observation" : "businessOverview",
      evidenceCount: latestObservation?.signals.length ?? 0,
    },
    {
      stage: "attribution",
      label: "归因分析",
      routeTab: "attribution",
      summary: latestAttribution
        ? `已形成归因报告：${latestAttribution.title}`
        : "等待已确认的数据分析包，解释目标差距的主因和证据。",
      nextAction: completedByStage.attribution ? "交给公司目标收敛指标。" : "生成并确认归因报告。",
      actionLabel: "进入归因分析",
      actionTab: "attribution",
      evidenceCount: latestAttribution?.findings.length ?? 0,
    },
    {
      stage: "goal",
      label: "公司目标",
      routeTab: "goals",
      summary: latestGoal
        ? `已确认公司目标：${latestGoal.title}`
        : "等待归因结果收敛为可治理目标。",
      nextAction: completedByStage.goal ? "交给规划方案拆解工作。" : "创建并确认公司目标。",
      actionLabel: "进入公司目标",
      actionTab: "goals",
      evidenceCount: state.goals.filter((goal) => goal.status === "confirmed").length,
    },
    {
      stage: "planning",
      label: "规划方案",
      routeTab: "company",
      summary: latestPlanning
        ? `已确认规划方案：${latestPlanning.title}`
        : "等待公司目标拆成经营工作块和岗位工作项。",
      nextAction: completedByStage.planning ? "交给任务调度生成派发单。" : "生成并确认规划方案。",
      actionLabel: "进入规划方案",
      actionTab: "company",
      evidenceCount: state.rolePlanItems.length,
    },
    {
      stage: "dispatch",
      label: "任务调度",
      routeTab: "workboard",
      summary: latestDispatch
        ? `调度预检已形成：${latestDispatch.title}`
        : "等待规划工作项做授权、能力、API、工具和费用预检。",
      nextAction: completedByStage.dispatch
        ? "交给岗位执行确认运行。"
        : "检查并生成派发单和执行队列。",
      actionLabel: "进入任务调度",
      actionTab: "workboard",
      evidenceCount: state.taskPackages.length + state.dispatchToRoleRequests.length,
    },
    {
      stage: "role",
      label: "岗位执行",
      routeTab: "aics",
      summary: latestRoleResult
        ? `最近执行结果：${latestRoleResult.summary}`
        : executionPreflight.canRun
          ? "执行条件已满足，等待人工确认运行。"
          : "等待已派发、已授权、费用确认、API 和岗位能力就绪。",
      nextAction: completedByStage.role
        ? "结果可回到数据分析作为下一轮证据。"
        : "完成执行并读回产物、审计、账本和模型证据。",
      actionLabel: "进入岗位执行",
      actionTab: "aics",
      evidenceCount: state.roleResults.length,
    },
  ];

  return rows.map((row) => {
    const status = statusFor(row.stage);
    return {
      ...row,
      status,
      statusLabel: statusLabelFor(status),
      blockerCount: blockerCountFor(row.stage),
    };
  });
}

function resolveBlocker(
  reason: AicsMainFlowBlockedReason,
): AicsMainFlowReadModel["blockerResolutions"][number] {
  const copy: Record<
    AicsMainFlowBlockedReason["code"],
    Omit<AicsMainFlowReadModel["blockerResolutions"][number], "code">
  > = {
    missing_observation_package: {
      humanMessage: "还没有可用于分析的数据包。",
      impact: "归因分析无法开始，后面的目标、规划、调度和岗位执行都会停住。",
      fixTab: "businessOverview",
      fixActionLabel: "去经营概览发起经营意图",
    },
    missing_attribution_report: {
      humanMessage: "还没有基于观察数据生成并确认的归因报告。",
      impact: "公司目标缺少事实依据，不能进入正式目标治理。",
      fixTab: "attribution",
      fixActionLabel: "去归因分析生成报告",
    },
    missing_confirmed_company_goal: {
      humanMessage: "还没有用户确认后的公司目标。",
      impact: "规划方案不能凭空拆解岗位工作项。",
      fixTab: "goals",
      fixActionLabel: "去公司目标确认目标",
    },
    missing_confirmed_planning_package: {
      humanMessage: "还没有确认后的规划方案和岗位工作项。",
      impact: "任务调度没有可派发的正式工作来源。",
      fixTab: "company",
      fixActionLabel: "去规划方案生成工作项",
    },
    missing_confirmed_dispatch_proposal: {
      humanMessage: "还没有确认后的派发预检。",
      impact: "系统还不能物化正式派发单。",
      fixTab: "workboard",
      fixActionLabel: "去任务调度检查并派发",
    },
    missing_task_package: {
      humanMessage: "还没有正式派发单。",
      impact: "岗位执行没有可运行的任务包。",
      fixTab: "workboard",
      fixActionLabel: "去任务调度生成派发单",
    },
    missing_dispatch_to_role_request: {
      humanMessage: "还没有执行队列项。",
      impact: "岗位执行页没有可运行的岗位任务。",
      fixTab: "workboard",
      fixActionLabel: "去任务调度生成执行队列",
    },
    authorization_required: {
      humanMessage: "岗位还没有正式授权。",
      impact: "不能把派发单交给岗位运行。",
      fixTab: "usage",
      fixActionLabel: "去费用与授权处理",
    },
    execution_confirmation_required: {
      humanMessage: "还没有人工确认本次执行。",
      impact: "系统不能自动绕过管理者确认去运行岗位。",
      fixTab: "aics",
      fixActionLabel: "去岗位执行确认",
    },
    cost_not_confirmed: {
      humanMessage: "还没有确认本次费用。",
      impact: "执行前缺少账本依据，不能先跑任务再补费用。",
      fixTab: "usage",
      fixActionLabel: "去费用与授权确认",
    },
    duplicate_successful_execution: {
      humanMessage: "这个派发单已经执行完成。",
      impact: "同一个派发单不能重复执行，避免重复扣费、重复产物和审计账本混乱。",
      fixTab: "workboard",
      fixActionLabel: "去任务调度重新生成派发单",
    },
    missing_category_binding: {
      humanMessage: "岗位工作项还没有绑定可用的品类能力。",
      impact: "能力路由无法判断该派给哪个岗位能力执行。",
      fixTab: "skills",
      fixActionLabel: "去能力配置处理",
    },
    missing_tool_binding: {
      humanMessage: "品类能力缺少可执行组件。",
      impact: "执行时无法调用完成任务所需的能力组件。",
      fixTab: "skills",
      fixActionLabel: "去能力配置处理",
    },
    missing_skill_binding: {
      humanMessage: "品类能力缺少工作能力流程。",
      impact: "执行时缺少稳定的岗位能力流程。",
      fixTab: "skills",
      fixActionLabel: "去能力配置处理",
    },
    tool_skill_not_ready: {
      humanMessage: "岗位能力还没准备好。",
      impact: "任务即使派发也无法稳定运行。",
      fixTab: "skills",
      fixActionLabel: "去能力配置检查",
    },
    missing_api_binding: {
      humanMessage: "岗位执行缺少模型或工具 API 连接。",
      impact: "运行岗位时无法调用真实模型或外部工具。",
      fixTab: "apiManagement",
      fixActionLabel: "去 API 管理配置",
    },
    skill_disabled: {
      humanMessage: "所需工作能力已关闭。",
      impact: "调度不能把任务派给不可用能力。",
      fixTab: "skills",
      fixActionLabel: "去能力配置启用",
    },
    skill_missing_dependency: {
      humanMessage: "工作能力依赖还没满足。",
      impact: "岗位执行会缺少必要依赖。",
      fixTab: "skills",
      fixActionLabel: "去能力配置补依赖",
    },
    plugin_tool_disabled: {
      humanMessage: "插件工具所在插件已关闭。",
      impact: "岗位执行不能调用该能力组件。",
      fixTab: "skills",
      fixActionLabel: "去能力配置启用",
    },
    missing_tool_permission: {
      humanMessage: "能力权限还未批准。",
      impact: "岗位执行无法安全调用该能力。",
      fixTab: "skills",
      fixActionLabel: "去能力配置审核权限",
    },
    unique_capability_pending: {
      humanMessage: "独特能力申请还在审核中。",
      impact: "调度暂时不能把任务派给这条能力路线。",
      fixTab: "skills",
      fixActionLabel: "去能力配置查看申请",
    },
    cloud_capability_not_authorized: {
      humanMessage: "云端商城品类能力未授权。",
      impact: "本地端不能确认该岗位能力可调用。",
      fixTab: "usage",
      fixActionLabel: "去费用与授权处理",
    },
    high_risk_needs_human_approval: {
      humanMessage: "高风险能力需要人工批准。",
      impact: "调度必须先经过人工确认才能继续。",
      fixTab: "skills",
      fixActionLabel: "去能力配置审核风险",
    },
    unsupported_capability_route: {
      humanMessage: "当前能力路线没有可用执行组件或 API。",
      impact: "系统无法把这个岗位工作项转成可执行任务。",
      fixTab: "skills",
      fixActionLabel: "去能力配置补能力",
    },
    actor_context_missing: {
      humanMessage: "缺少云端访问身份上下文。",
      impact: "本地端不能读取云端商城授权、能力和审核投影。",
      fixTab: "apiManagement",
      fixActionLabel: "去 API 管理补连接身份",
    },
  };
  return { code: reason.code, ...copy[reason.code] };
}

function buildBlockerResolutions(
  blockedReasons: AicsMainFlowBlockedReason[],
): AicsMainFlowReadModel["blockerResolutions"] {
  const seen = new Set<AicsMainFlowBlockedReason["code"]>();
  return blockedReasons
    .filter((reason) => {
      if (seen.has(reason.code)) return false;
      seen.add(reason.code);
      return true;
    })
    .map(resolveBlocker);
}

function buildPreconditions(params: {
  state: AicsMainFlowState;
  readiness: ReturnType<typeof getReadiness>;
  executionPreflight: AicsMainFlowExecutionPreflight;
}): AicsMainFlowReadModel["preconditions"] {
  const { state, readiness, executionPreflight } = params;
  const latestGoal = latestConfirmed(state.goals);
  const latestPlanning = latestConfirmed(state.planningPackages);
  const latestDispatch = latestConfirmed(state.dispatchProposalReviews);
  return [
    {
      id: "observation_package",
      label: "数据分析包",
      status: observationReadyForAttribution(latestByCreatedAt(state.observations))
        ? "met"
        : state.observations.length > 0
          ? "blocked"
          : "missing",
      message: observationReadyForAttribution(latestByCreatedAt(state.observations))
        ? `已有 ${state.observations.length} 个已确认数据分析包。`
        : state.observations.length > 0
          ? "数据分析包还未确认或缺少可用事实。"
          : "还没有数据分析包，先从经营概览发起经营意图。",
      fixTab: "businessOverview",
      fixActionLabel: "去经营概览",
    },
    {
      id: "attribution_report",
      label: "归因报告",
      status:
        state.attributions.length > 0
          ? "met"
          : readiness.canPrepareAttribution
            ? "missing"
            : "blocked",
      message:
        state.attributions.length > 0
          ? `已有 ${state.attributions.length} 个归因报告。`
          : readiness.canPrepareAttribution
            ? "数据分析已就绪，可以生成归因报告。"
            : "需要先完成并确认数据分析。",
      fixTab: "attribution",
      fixActionLabel: "去归因分析",
    },
    {
      id: "company_goal",
      label: "已确认公司目标",
      status: latestGoal ? "met" : readiness.canCreateGoalCandidate ? "missing" : "blocked",
      message: latestGoal
        ? `已确认公司目标：${latestGoal.title}`
        : readiness.canCreateGoalCandidate
          ? "归因已就绪，可以创建并确认公司目标。"
          : "需要先完成归因分析。",
      fixTab: "goals",
      fixActionLabel: "去公司目标",
    },
    {
      id: "planning_package",
      label: "已确认规划方案",
      status: latestPlanning ? "met" : readiness.canPreparePlanning ? "missing" : "blocked",
      message: latestPlanning
        ? `已确认规划方案：${latestPlanning.title}`
        : readiness.canPreparePlanning
          ? "公司目标已确认，可以生成规划方案。"
          : "需要先确认公司目标。",
      fixTab: "company",
      fixActionLabel: "去规划方案",
    },
    {
      id: "dispatch_package",
      label: "派发单和执行队列",
      status:
        executionPreflight.hasTaskPackage && executionPreflight.hasDispatchToRoleRequest
          ? "met"
          : latestDispatch || readiness.canMaterializeTaskPackage
            ? "missing"
            : "blocked",
      message:
        executionPreflight.hasTaskPackage && executionPreflight.hasDispatchToRoleRequest
          ? "派发单和执行队列已生成。"
          : latestDispatch || readiness.canMaterializeTaskPackage
            ? "调度预检已就绪，可以生成派发单和执行队列。"
            : "需要先完成规划方案和调度预检。",
      fixTab: "workboard",
      fixActionLabel: "去任务调度",
    },
    {
      id: "role_execution_gate",
      label: "岗位执行闸门",
      status: executionPreflight.canRun
        ? "met"
        : executionPreflight.hasDispatchToRoleRequest
          ? "blocked"
          : "missing",
      message: executionPreflight.canRun
        ? "授权、人工确认、费用确认、岗位能力和 API 均已就绪。"
        : executionPreflight.hasDispatchToRoleRequest
          ? "执行前还需要处理授权、费用、岗位能力或 API 阻塞。"
          : "还没有可执行队列项。",
      fixTab: executionPreflight.hasDispatchToRoleRequest ? "aics" : "workboard",
      fixActionLabel: executionPreflight.hasDispatchToRoleRequest ? "去岗位执行" : "去任务调度",
    },
  ];
}

function buildHandoffPreview(
  state: AicsMainFlowState,
  stage: AicsMainFlowStage,
): AicsMainFlowReadModel["handoffPreview"] {
  switch (stage) {
    case "observation":
      return {
        fromStage: "observation",
        toStage: "attribution",
        outputLabel: "数据分析包",
        outputCount: state.observations.length,
        summary: "确认后的数据分析包会成为归因分析的事实依据。",
      };
    case "attribution":
      return {
        fromStage: "attribution",
        toStage: "goal",
        outputLabel: "归因报告",
        outputCount: state.attributions.length,
        summary: "归因报告会说明目标差距的主因、影响和证据。",
      };
    case "goal":
      return {
        fromStage: "goal",
        toStage: "planning",
        outputLabel: "公司目标",
        outputCount: state.goals.filter((goal) => goal.status === "confirmed").length,
        summary: "确认后的公司目标才允许进入规划拆解。",
      };
    case "planning":
      return {
        fromStage: "planning",
        toStage: "dispatch",
        outputLabel: "岗位工作项",
        outputCount: state.rolePlanItems.length,
        summary: "岗位工作项会进入任务调度做能力匹配和派发预检。",
      };
    case "dispatch":
      return {
        fromStage: "dispatch",
        toStage: "role",
        outputLabel: "派发单 / 执行队列项",
        outputCount: state.taskPackages.length + state.dispatchToRoleRequests.length,
        summary: "派发单和执行队列项生成后，岗位执行页才能运行任务。",
      };
    case "role":
      return {
        fromStage: "role",
        toStage: "observation",
        outputLabel: "执行结果",
        outputCount: state.roleResults.length,
        summary: "执行结果、业务产物、审计和账本会回写为下一轮观察证据。",
      };
  }
}

function buildOperatorRecommendation(params: {
  stageGuidance: AicsMainFlowReadModel["stageGuidance"];
  blockerResolutions: AicsMainFlowReadModel["blockerResolutions"];
  handoffPreview: AicsMainFlowReadModel["handoffPreview"];
  executionClosure: AicsMainFlowReadModel["executionClosure"];
}): AicsMainFlowReadModel["operatorRecommendation"] {
  const { stageGuidance, blockerResolutions, handoffPreview, executionClosure } = params;
  const blocker = blockerResolutions[0];
  if (blocker) {
    return {
      title: "先处理当前卡点",
      summary: `${blocker.humanMessage}${blocker.impact ? ` ${blocker.impact}` : ""}`,
      severity: "warning",
      actionLabel: blocker.fixActionLabel,
      actionTab: blocker.fixTab,
    };
  }
  if (executionClosure.status === "completed") {
    return {
      title: "闭环已完成，可进入下一轮观察",
      summary: "业务结果、产物、审计、账本和模型费用证据已读回，可以作为下一轮数据分析证据候选。",
      severity: "success",
      actionLabel: "查看数据分析",
      actionTab: "observation",
    };
  }
  return {
    title: "建议下一步",
    summary: `${stageGuidance.nextStepLabel}。本层会交付 ${handoffPreview.outputLabel}：${handoffPreview.summary}`,
    severity: "info",
    actionLabel: stageGuidance.primaryActionLabel,
    actionTab: stageGuidance.primaryActionTarget,
  };
}

function buildStageBoundary(stage: AicsMainFlowStage): AicsMainFlowReadModel["stageBoundary"] {
  const boundaries: Record<AicsMainFlowStage, AicsMainFlowReadModel["stageBoundary"]> = {
    observation: {
      allowed: ["采集内外部经营事实", "标记数据可信度、缺失和风险", "确认可用于归因的数据分析包"],
      prohibited: ["直接归因", "直接创建公司目标", "直接调度岗位执行"],
      evidenceRequired: [
        "内部经营数据",
        "云端商城数据",
        "本地 OpenClaw 状态",
        "外部机会与风险证据",
      ],
    },
    attribution: {
      allowed: ["解释主因、影响和证据", "要求补数据", "确认可进入目标层的归因报告"],
      prohibited: ["脱离观察事实编原因", "直接定目标", "直接生成任务或派发单"],
      evidenceRequired: ["已确认数据分析包", "可追溯观察信号", "主因置信度和影响说明"],
    },
    goal: {
      allowed: ["创建候选公司目标", "确认指标、目标值、负责人和周期", "把目标交给规划层"],
      prohibited: ["绕过归因凭空定目标", "在目标页拆任务", "在目标页执行岗位"],
      evidenceRequired: ["归因报告", "目标指标", "目标值", "负责人或治理口径"],
    },
    planning: {
      allowed: ["拆经营工作块", "生成岗位工作项", "补齐验收标准和能力匹配", "确认正式规划包"],
      prohibited: ["绕过目标生成规划", "绕过调度创建执行任务", "直接调用岗位或 provider"],
      evidenceRequired: ["已确认公司目标", "岗位工作项", "目标产物", "验收标准", "能力匹配说明"],
    },
    dispatch: {
      allowed: ["检查规划工作项", "匹配授权岗位和能力", "生成派发单和执行队列"],
      prohibited: ["在调度页运行岗位", "替用户确认费用", "派发未授权或能力不满足的岗位"],
      evidenceRequired: ["正式规划包", "岗位授权", "能力匹配", "API/岗位能力预检", "派发确认"],
    },
    role: {
      allowed: ["运行已派发岗位任务", "确认执行和费用", "读回业务结果、产物、审计和账本"],
      prohibited: ["运行未派发任务", "缺费用确认先执行", "用本地合成结果伪装完成"],
      evidenceRequired: [
        "派发单",
        "执行队列",
        "岗位授权",
        "费用确认",
        "业务产物",
        "审计和账本读回",
      ],
    },
  };
  return boundaries[stage];
}

function buildAccountGoalMode(params: {
  state: AicsMainFlowState;
  currentStage: AicsMainFlowStage;
  stageGuidance: AicsMainFlowReadModel["stageGuidance"];
  stageProgress: AicsMainFlowReadModel["stageProgress"];
  blockerResolutions: AicsMainFlowReadModel["blockerResolutions"];
  executionClosure: AicsMainFlowReadModel["executionClosure"];
  operatorRecommendation: AicsMainFlowReadModel["operatorRecommendation"];
}): AicsAccountGoalMode {
  const {
    state,
    currentStage,
    stageGuidance,
    stageProgress,
    blockerResolutions,
    executionClosure,
    operatorRecommendation,
  } = params;
  const latestGoal = latestByCreatedAt(state.goals);
  const blocker = blockerResolutions[0];
  const status: AicsAccountGoalMode["status"] = (() => {
    if (executionClosure.status === "completed") return "completed";
    if (executionClosure.status === "running") return "running";
    if (blocker) return "blocked";
    if (executionClosure.status === "ready_to_run") return "ready_to_run";
    if (currentStage === "dispatch") return "ready_to_dispatch";
    if (currentStage === "planning" || currentStage === "goal") return "ready_to_plan";
    return "needs_setup";
  })();
  const currentBlocker = blocker
    ? {
        title: "当前卡点",
        reason: `${blocker.humanMessage}${blocker.impact ? ` ${blocker.impact}` : ""}`,
        actionLabel: blocker.fixActionLabel,
        actionTab: blocker.fixTab,
      }
    : undefined;
  const headline =
    status === "completed"
      ? "本轮岗位执行闭环已完成"
      : currentBlocker
        ? "账号经营链路有卡点需要处理"
        : operatorRecommendation.title;
  return {
    accountLabel: "当前账号",
    status,
    headline,
    plainSummary:
      status === "completed"
        ? "业务结果、产物、审计、账本和模型费用证据已读回，可进入下一轮观察。"
        : operatorRecommendation.summary,
    ...(latestGoal
      ? {
          currentGoal: {
            title: latestGoal.title,
            metric: latestGoal.metric,
            target: latestGoal.target,
            owner: latestGoal.owner,
            status: latestGoal.status,
          },
        }
      : {}),
    ...(currentBlocker ? { currentBlocker } : {}),
    nextStep: {
      label: operatorRecommendation.actionLabel || stageGuidance.primaryActionLabel,
      tab: operatorRecommendation.actionTab || stageGuidance.primaryActionTarget,
      reason: currentBlocker?.reason ?? stageGuidance.nextStepLabel,
    },
    chatCapabilities: {
      canReadAccountData: true,
      canCreateCandidates: true,
      cannotBypassMainFlow: true,
      humanLabel:
        "主对话框可以读取账号经营数据、解释卡点、生成候选和导航确认点，但不能绕过六层直接执行。",
    },
    stageCards: stageProgress.map((item) => ({
      label: item.label,
      statusLabel: item.statusLabel,
      nextAction: item.nextAction,
      routeTab: item.routeTab,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function executionModelUsageIsPresent(modelUsage: unknown): boolean {
  if (!isRecord(modelUsage)) return false;
  return (
    typeof modelUsage.totalTokens === "number" ||
    typeof modelUsage.inputTokens === "number" ||
    typeof modelUsage.outputTokens === "number" ||
    typeof modelUsage.costCents === "number"
  );
}

function executionAuditReadbackIsPresent(auditReadback: unknown): boolean {
  if (!isRecord(auditReadback)) return false;
  const auditRecordId = auditReadback.auditRecordId;
  return typeof auditRecordId === "string" && auditRecordId.trim().length > 0;
}

function executionLedgerReadbackIsPresent(ledgerReadback: unknown): boolean {
  if (!isRecord(ledgerReadback)) return false;
  const ledgerRef = ledgerReadback.ledgerRef;
  return typeof ledgerRef === "string" && ledgerRef.trim().length > 0;
}

function executionModelUsageEvidence(evidence: RoleResult["executionEvidence"] | undefined): {
  hasEvidence: boolean;
  status: "recorded" | "not_applicable" | "missing";
  message: string;
} {
  if (executionModelUsageIsPresent(evidence?.modelUsage)) {
    return {
      hasEvidence: true,
      status: "recorded",
      message: "模型费用证据已记录。",
    };
  }
  if (evidence?.modelUsageNotApplicable === true) {
    return {
      hasEvidence: true,
      status: "not_applicable",
      message:
        typeof evidence.modelUsageNotApplicableReason === "string" &&
        evidence.modelUsageNotApplicableReason.trim()
          ? evidence.modelUsageNotApplicableReason.trim()
          : "本次执行未调用模型，因此无模型费用证据。",
    };
  }
  return {
    hasEvidence: false,
    status: "missing",
    message: "模型费用证据缺失。",
  };
}

function productionSuccessEvidenceGaps(params: {
  result: NonNullable<RunApprovedTaskInput["result"]>;
  artifactRefs: string[];
  effectiveLedgerRef?: string;
  request: DispatchToRoleRequest;
}): string[] {
  if (params.result.outcome !== "succeeded") return [];
  const evidence = params.result.executionEvidence;
  const businessArtifactRefs = params.artifactRefs.filter(isBusinessArtifactRef);
  const hasAuditReference =
    auditRefs(params.result).length > 0 ||
    params.artifactRefs.some((ref) => ref.startsWith("audit:")) ||
    executionAuditReadbackIsPresent(evidence?.auditReadback);
  const hasLedgerReference =
    Boolean(params.effectiveLedgerRef?.trim()) ||
    (typeof evidence?.ledgerRef === "string" && evidence.ledgerRef.trim().length > 0) ||
    params.artifactRefs.some((ref) => ref.startsWith("ledger:")) ||
    executionLedgerReadbackIsPresent(evidence?.ledgerReadback);
  const hasCostSummary = isRecord(evidence?.costSummary);
  const hasModelUsage =
    executionModelUsageIsPresent(evidence?.modelUsage) ||
    evidence?.modelUsageNotApplicable === true;
  const hasHumanConfirmation =
    params.request.confirmExecution !== true ||
    (typeof evidence?.humanConfirmationRef === "string" &&
      evidence.humanConfirmationRef.trim().length > 0);

  return [
    businessArtifactRefs.length ? "" : "业务产物缺失，请重新执行并生成可验收产物",
    hasAuditReference ? "" : "审计记录缺失，请联系系统开发者检查审计写回",
    hasLedgerReference ? "" : "账本记录缺失，请到费用与授权检查账本写回",
    hasCostSummary ? "" : "费用摘要缺失，请到费用与授权确认费用记录",
    hasModelUsage ? "" : "模型费用证据缺失，请记录 modelUsage 或声明本次未调用模型",
    hasHumanConfirmation ? "" : "人工确认记录缺失，请回到岗位执行确认本次执行",
  ].filter(Boolean);
}

function roleResultBusinessArtifactRefs(roleResult: RoleResult | null): string[] {
  return (roleResult?.artifactRefs ?? []).filter(isBusinessArtifactRef);
}

function isBusinessArtifactRef(ref: string): boolean {
  return (
    !ref.startsWith("audit:") && !ref.startsWith("ledger:") && !ref.startsWith("memory_candidate:")
  );
}

function businessArtifactSummaryLabel(refs: readonly string[]): string {
  if (!refs.length) return "缺失";
  const labels = refs.slice(0, 3).map((ref, index) => {
    const value = ref.trim();
    if (!value) return `业务产物 ${index + 1}`;
    return value;
  });
  return refs.length > 3 ? `${labels.join("、")} 等 ${refs.length} 个` : labels.join("、");
}

function businessArtifactObservationTitle(ref: string, index: number): string {
  const trimmed = ref.trim();
  if (!trimmed) return `业务产物 ${index + 1}`;
  if (trimmed.startsWith("artifact:role-result:")) return `岗位执行业务产物 ${index + 1}`;
  if (trimmed.startsWith("artifact:")) {
    const readable = trimmed
      .replace(/^artifact:/, "")
      .replace(/[:_-]+/g, " ")
      .trim();
    return readable || `业务产物 ${index + 1}`;
  }
  return trimmed;
}

function auditEvidenceSummaryLabel(roleResult: RoleResult | null): string {
  if (!roleResult) return "缺失";
  const auditReadback = roleResult.executionEvidence?.auditReadback;
  if (isRecord(auditReadback)) {
    const auditRecordId = auditReadback.auditRecordId;
    if (typeof auditRecordId === "string" && auditRecordId.trim()) return auditRecordId.trim();
  }
  const auditRef = roleResult.artifactRefs.find((ref) => ref.startsWith("audit:"));
  return auditRef?.trim() || "缺失";
}

function ledgerEvidenceSummaryLabel(roleResult: RoleResult | null): string {
  if (!roleResult) return "缺失";
  const ledgerReadback = roleResult.executionEvidence?.ledgerReadback;
  if (isRecord(ledgerReadback)) {
    const ledgerRef = ledgerReadback.ledgerRef;
    if (typeof ledgerRef === "string" && ledgerRef.trim()) return ledgerRef.trim();
  }
  const ledgerRef = roleResult.executionEvidence?.ledgerRef;
  if (typeof ledgerRef === "string" && ledgerRef.trim()) return ledgerRef.trim();
  const artifactLedgerRef = roleResult.artifactRefs.find((ref) => ref.startsWith("ledger:"));
  return artifactLedgerRef?.trim() || "缺失";
}

function modelUsageSummaryLabel(params: {
  modelUsageEvidence: ReturnType<typeof executionModelUsageEvidence>;
  evidence: RoleResult["executionEvidence"] | undefined;
}): string {
  const { modelUsageEvidence, evidence } = params;
  if (modelUsageEvidence.status === "not_applicable") {
    return `本次未调用模型 · ${modelUsageEvidence.message}`;
  }
  const modelUsage = evidence?.modelUsage;
  if (executionModelUsageIsPresent(modelUsage) && isRecord(modelUsage)) {
    const parts = [
      typeof modelUsage.totalTokens === "number" ? `${modelUsage.totalTokens} Token` : "",
      typeof modelUsage.costCents === "number" ? `¥${(modelUsage.costCents / 100).toFixed(2)}` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "已记录模型费用证据";
  }
  return modelUsageEvidence.message;
}

function costCentsLabel(value: unknown, decimals = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `¥${(value / 100).toFixed(decimals)}`
    : "未记录";
}

function costSummaryLabel(evidence: RoleResult["executionEvidence"] | undefined): string {
  const costSummary = evidence?.costSummary;
  if (!isRecord(costSummary)) return "缺失";
  const parts = [
    `授权 ${costCentsLabel(costSummary.authorizationFeeCents)}`,
    `执行 ${costCentsLabel(costSummary.executionFeeCents)}`,
  ];
  if (typeof costSummary.modelUsageCostCents === "number") {
    parts.push(`模型 ${costCentsLabel(costSummary.modelUsageCostCents, 4)}`);
  }
  if (typeof costSummary.totalCostCents === "number") {
    parts.push(`合计 ${costCentsLabel(costSummary.totalCostCents, 4)}`);
  }
  return parts.join(" · ");
}

function roleResultHasCostSummary(roleResult: RoleResult | null): boolean {
  return isRecord(roleResult?.executionEvidence?.costSummary);
}

function roleResultHasHumanConfirmation(params: {
  roleResult: RoleResult | null;
  dispatchRequest: DispatchToRoleRequest | null;
}): boolean {
  if (params.dispatchRequest?.confirmExecution !== true) return true;
  const ref = params.roleResult?.executionEvidence?.humanConfirmationRef;
  return typeof ref === "string" && ref.trim().length > 0;
}

function executionClosureEvidenceSummary(params: {
  roleResult: RoleResult | null;
  businessArtifactRefs: string[];
  hasAudit: boolean;
  hasLedger: boolean;
  hasModelUsage: boolean;
  hasCostSummary: boolean;
  hasHumanConfirmation: boolean;
  modelUsageEvidence: ReturnType<typeof executionModelUsageEvidence>;
  dispatchRequest: DispatchToRoleRequest | null;
}): AicsMainFlowReadModel["executionClosure"]["evidenceSummary"] {
  const {
    roleResult,
    businessArtifactRefs,
    hasAudit,
    hasLedger,
    hasModelUsage,
    hasCostSummary,
    hasHumanConfirmation,
    modelUsageEvidence,
    dispatchRequest,
  } = params;
  return [
    {
      label: "业务产物",
      value: businessArtifactSummaryLabel(businessArtifactRefs),
      status: businessArtifactRefs.length ? "available" : "missing",
    },
    {
      label: "审计记录",
      value: hasAudit ? auditEvidenceSummaryLabel(roleResult) : "缺失",
      status: hasAudit ? "available" : "missing",
    },
    {
      label: "账本记录",
      value: hasLedger ? ledgerEvidenceSummaryLabel(roleResult) : "缺失",
      status: hasLedger ? "available" : "missing",
    },
    {
      label: "模型费用",
      value: modelUsageSummaryLabel({
        modelUsageEvidence,
        evidence: roleResult?.executionEvidence,
      }),
      status: hasModelUsage ? "available" : "missing",
    },
    {
      label: "费用摘要",
      value: costSummaryLabel(roleResult?.executionEvidence),
      status: hasCostSummary ? "available" : "missing",
    },
    ...(dispatchRequest?.confirmExecution === true
      ? [
          {
            label: "人工确认",
            value: roleResult?.executionEvidence?.humanConfirmationRef?.trim() || "缺失",
            status: hasHumanConfirmation ? "available" : "missing",
          } as const,
        ]
      : []),
  ];
}

function roleResultHasAuditEvidence(roleResult: RoleResult | null): boolean {
  if (!roleResult) return false;
  return executionAuditReadbackIsPresent(roleResult.executionEvidence?.auditReadback);
}

function roleResultHasAuditReference(roleResult: RoleResult | null): boolean {
  if (!roleResult) return false;
  return roleResult.artifactRefs.some((ref) => ref.startsWith("audit:"));
}

function roleResultHasLedgerEvidence(roleResult: RoleResult | null): boolean {
  if (!roleResult) return false;
  return executionLedgerReadbackIsPresent(roleResult.executionEvidence?.ledgerReadback);
}

function roleResultHasLedgerReference(roleResult: RoleResult | null): boolean {
  if (!roleResult) return false;
  const evidence = roleResult.executionEvidence;
  return (
    (typeof evidence?.ledgerRef === "string" && evidence.ledgerRef.trim().length > 0) ||
    roleResult.artifactRefs.some((ref) => ref.startsWith("ledger:"))
  );
}

function roleResultRecoveryAction(
  roleResult: RoleResult | null,
): AicsMainFlowReadModel["executionClosure"]["recoveryActions"][number] | null {
  if (!roleResult || (roleResult.outcome !== "failed" && roleResult.outcome !== "blocked")) {
    return null;
  }
  const recoveryText = [
    roleResult.summary,
    roleResult.executionEvidence?.recoverySuggestion,
    ...(roleResult.executionEvidence?.steps ?? []).flatMap((step) => [
      step.outputSummary ?? "",
      ...(Array.isArray(step.toolCalls)
        ? step.toolCalls.map((toolCall) => toolCall.error ?? "")
        : []),
    ]),
  ]
    .join(" ")
    .toLowerCase();
  if (/api|provider|model|模型|连接|key|token|401|403|429|5\d\d/.test(recoveryText)) {
    return {
      label: "去 API 管理检查模型连接",
      targetTab: "apiManagement",
      reason: roleResult.executionEvidence?.recoverySuggestion ?? roleResult.summary,
    };
  }
  if (/ledger|账本|费用|cost|billing|quota|余额|额度/.test(recoveryText)) {
    return {
      label: "去费用与授权检查账本和额度",
      targetTab: "usage",
      reason: roleResult.executionEvidence?.recoverySuggestion ?? roleResult.summary,
    };
  }
  if (/授权|entitlement|rolelisting|未授权|permission|scope/.test(recoveryText)) {
    return {
      label: "去费用与授权检查岗位授权",
      targetTab: "usage",
      reason: roleResult.executionEvidence?.recoverySuggestion ?? roleResult.summary,
    };
  }
  if (/tool|skill|插件|工具|能力|依赖/.test(recoveryText)) {
    return {
      label: "去能力配置检查能力依赖",
      targetTab: "skills",
      reason: roleResult.executionEvidence?.recoverySuggestion ?? roleResult.summary,
    };
  }
  return {
    label: "回到岗位执行查看失败详情",
    targetTab: "aics",
    reason: roleResult.executionEvidence?.recoverySuggestion ?? roleResult.summary,
  };
}

function productionFinalGate(): AicsMainFlowReadModel["executionClosure"]["productionFinalGate"] {
  return {
    status: "not_evaluated",
    requiredVerdict: "production_plus_passed",
    reason:
      "本地版岗位闭环已完成；下面是未来云端 SaaS、多账号和真实远端部署的追加验收，不阻塞当前本地版使用。",
    nextAction:
      "本地版可跳过；需要上线云端 SaaS、使用者中心或真实远端商城时，再运行 production-plus orchestrator。",
    operatorChecklist: [
      {
        label: "连接真实云端商城",
        detail: "填写并探测云端商城地址，确认审核、授权、岗位和商品接口都能读取。",
        requiredInput: "DIJIE_CLOUD_BASE_URL",
      },
      {
        label: "打开本地 OpenClaw UI",
        detail:
          "确认本地管理后台可以被浏览器访问，persona 测试会真实点击 API 管理、费用与授权、任务调度和岗位执行。",
        requiredInput: "OPENCLAW_LOCAL_URL",
      },
      {
        label: "准备云端桥接与执行令牌",
        detail: "让本地 gateway 可以安全调用云端桥接接口，并验证岗位执行 token。",
        requiredInput: "DIJIE_INTERNAL_BRIDGE_BEARER / DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
      },
      {
        label: "准备三类真人身份",
        detail:
          "开发者、管理者、购买者身份都要能登录或调用；没有分身份 token 时可用云端通用 token 代替。",
        requiredInput:
          "DIJIE_VENDOR_ACCESS_TOKEN / DIJIE_ADMIN_ACCESS_TOKEN / DIJIE_BUYER_ACCESS_TOKEN",
      },
      {
        label: "跑云端 SaaS 最终验收",
        detail:
          "云端部署时再验证多账号、远端商城、云端授权、同步本地、主流程调度执行、账本审计读回全链路。",
        requiredInput: "production_plus_passed",
      },
    ],
    operatorSteps: [
      {
        step: "1. 连接两个地址",
        status: "blocked",
        action:
          "填云端商城 API 地址和本地 OpenClaw UI 地址，然后重新跑 readiness；两个地址都必须可访问。",
        requiredInputs: ["DIJIE_CLOUD_BASE_URL", "OPENCLAW_LOCAL_URL"],
      },
      {
        step: "2. 准备执行通行证",
        status: "blocked",
        action:
          "填本地到云端的 bridge bearer 和执行令牌公钥；页面和证据只显示字段名，不显示密钥值。",
        requiredInputs: ["DIJIE_INTERNAL_BRIDGE_BEARER", "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM"],
      },
      {
        step: "3. 准备三类真人身份",
        status: "blocked",
        action: "准备开发者、审核管理者、购买者访问令牌；也可以先用云端通用访问令牌替代三类身份。",
        requiredInputs: [
          "DIJIE_VENDOR_ACCESS_TOKEN",
          "DIJIE_ADMIN_ACCESS_TOKEN",
          "DIJIE_BUYER_ACCESS_TOKEN",
          "DIJIE_CLOUD_ACCESS_TOKEN",
        ],
      },
      {
        step: "4. 跑云端 SaaS 最终验收",
        status: "pending",
        action:
          "云端 SaaS readiness 全部通过后，运行 final manifest 校验和 production-plus orchestrator；只有 verdict 为 production_plus_passed 才算云端 SaaS 通过。",
      },
    ],
    requiredInputs: [
      "DIJIE_CLOUD_BASE_URL",
      "OPENCLAW_LOCAL_URL",
      "DIJIE_INTERNAL_BRIDGE_BEARER",
      "DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM",
      "DIJIE_VENDOR_ACCESS_TOKEN 或 DIJIE_CLOUD_ACCESS_TOKEN",
      "DIJIE_ADMIN_ACCESS_TOKEN 或 DIJIE_CLOUD_ACCESS_TOKEN",
      "DIJIE_BUYER_ACCESS_TOKEN 或 DIJIE_CLOUD_ACCESS_TOKEN",
    ],
    readinessCommand:
      "node scripts/persona/aics-production-plus-readiness.mjs --probe-endpoints --output-dir /private/tmp/aics-production-plus-readiness",
    finalCommand:
      'node scripts/persona/aics-production-plus-orchestrator.mjs --seed-file docs/aics-persona-runs/<runId>/api-seed.json --production-plus-final --probe-endpoints --final-manifest docs/aics-persona-runs/<runId>/final-manifest.json --base-url "$DIJIE_CLOUD_BASE_URL" --openclaw-url "$OPENCLAW_LOCAL_URL" --run-id <runId> --output-dir docs/aics-persona-runs/<runId>',
    secretHandling:
      "只填写环境变量名和占位符，不把 token、私有 URL、prompt、包正文或用户数据写入证据。",
  };
}

function buildObservationBusinessContext(state: AicsMainFlowState): BusinessContext {
  const latestInteraction = latestByCreatedAt(state.interactions);
  const latestGoal = latestByCreatedAt(state.goals);
  const latestPlanning = latestByCreatedAt(state.planningPackages);
  const latestTask = latestByCreatedAt(state.taskPackages);
  const currentConcern = [
    latestInteraction?.message,
    latestGoal?.title,
    latestPlanning?.summary,
    latestTask?.taskText,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("；");
  const updatedAt = new Date(state.updatedAt).toISOString();
  return {
    id: "main-flow-business-context",
    accountId: "local-account",
    businessName: latestGoal?.owner ? `${latestGoal.owner}的业务` : "OpenClaw 业务账号",
    businessDescription:
      currentConcern ||
      "根据当前账号的经营输入、公司目标、规划方案、调度派发、岗位执行结果和外部信息动态生成观察对象。",
    operatingModel:
      "主对话框统一读取账号数据，AICS 六层主流程负责观察、归因、目标、规划、调度和岗位执行。",
    productsOrServices: ["岗位商品", "能力授权", "本地 OpenClaw 执行", "工具与 Skill 能力"],
    customers: ["商城运营人员", "岗位购买者", "本地端使用者"],
    channels: ["云端岗位商城", "OpenClaw 本地端", "主对话框", "API Gateway"],
    revenueModel: "岗位授权、能力使用和真实执行服务",
    currentConcern,
    createdAt: updatedAt,
    updatedAt,
  };
}

function observationObjectId(suffix: string): string {
  return `main-flow-business-context:${suffix}`;
}

function buildObservationSourceInputs(
  state: AicsMainFlowState,
): ObservationSourceAvailabilityInput[] {
  return [
    {
      id: "aics-main-flow-read-model",
      label: "AICS 主流程内部数据",
      sourceKind: "internal_read_model",
      observedObjects: [
        observationObjectId("business-health"),
        observationObjectId("customer-action"),
        observationObjectId("role-supply"),
        observationObjectId("execution-chain"),
        observationObjectId("api-tool-skill"),
      ],
      freshnessHours: 1,
      requiredScopes: ["internal:aics_read_model"],
    },
    {
      id: "observation-package-store",
      label: "已确认或已准备的观察包",
      sourceKind: "internal_read_model",
      observedObjects: [
        observationObjectId("business-health"),
        observationObjectId("customer-action"),
        observationObjectId("external-factor"),
      ],
      ...(state.observations.length ? { freshnessHours: 24 } : {}),
      requiredScopes: ["internal:observation_package_read"],
    },
    {
      id: "role-result-readback",
      label: "岗位执行结果回读",
      sourceKind: "internal_read_model",
      observedObjects: [
        observationObjectId("business-health"),
        observationObjectId("execution-chain"),
        observationObjectId("api-tool-skill"),
      ],
      ...(state.roleResults.length ? { freshnessHours: 24 } : {}),
      requiredScopes: ["internal:role_result_readback"],
    },
    {
      id: "tool-skill-capability-status",
      label: "工具与 Skill 可用性",
      sourceKind: "tool",
      observedObjects: [
        observationObjectId("api-tool-skill"),
        observationObjectId("execution-chain"),
      ],
      freshnessHours: 6,
      requiredScopes: ["local:tool_skill_status_read"],
    },
    {
      id: "external-market-intelligence",
      label: "外部产品、技术和风险信息",
      sourceKind: "external_web_search",
      observedObjects: [observationObjectId("external-factor")],
      riskLevel: "medium",
      requiredUserApproval: true,
    },
  ];
}

function buildObservationAvailableScopes(state: AicsMainFlowState): string[] {
  const latestDispatch = latestByCreatedAt(state.dispatchToRoleRequests);
  return [
    "internal:aics_read_model",
    ...(state.observations.length ? ["internal:observation_package_read"] : []),
    ...(state.roleResults.length ? ["internal:role_result_readback"] : []),
    ...(latestDispatch && latestDispatch.toolSkillReady !== false
      ? ["local:tool_skill_status_read"]
      : []),
  ];
}

function buildObservationEvidenceFromState(
  state: AicsMainFlowState,
  businessContext: BusinessContext,
): ObservationEvidence[] {
  const observedAt = businessContext.updatedAt;
  const evidence: ObservationEvidence[] = [];
  for (const observation of state.observations) {
    for (const signal of observation.signals) {
      evidence.push({
        id: `evidence:${observation.id}:${signal.id}`,
        businessContextId: businessContext.id,
        objectId: observationObjectId("business-health"),
        statement: `${signal.title}：${signal.summary}`,
        sourceKind: "internal",
        sourceLabel: observation.title,
        sourceRef: signal.evidenceRefs[0] ?? observation.id,
        observedAt,
        confidence: signal.evidenceRefs.length ? "high" : "medium",
        freshness: observation.status === "confirmed" ? "fresh" : "unknown",
        qualityFlags: signal.evidenceRefs.length ? [] : ["needs_evidence_ref"],
      });
    }
  }
  for (const [index, result] of state.roleResults.entries()) {
    const executionEvidence = result.executionEvidence;
    const hasAudit = executionAuditReadbackIsPresent(executionEvidence?.auditReadback);
    const hasLedger = executionLedgerReadbackIsPresent(executionEvidence?.ledgerReadback);
    const hasModelEvidence = Boolean(
      executionEvidence?.modelUsage ||
      executionEvidence?.modelUsageNotApplicable === true ||
      executionEvidence?.modelUsageNotApplicableReason,
    );
    evidence.push({
      id: `evidence:${result.id}:business-result`,
      businessContextId: businessContext.id,
      objectId: observationObjectId("execution-chain"),
      statement: `岗位执行${result.outcome === "succeeded" ? "成功" : result.outcome === "blocked" ? "阻塞" : "失败"}：${result.summary}`,
      sourceKind: "internal",
      sourceLabel: "岗位执行结果回读",
      sourceRef: `上一轮岗位执行结果 ${index + 1}`,
      rawRef: result.id,
      observedAt,
      confidence:
        result.outcome === "succeeded" && hasAudit && hasLedger && hasModelEvidence
          ? "high"
          : "medium",
      freshness: "fresh",
      qualityFlags: [
        ...(hasAudit ? [] : ["missing_audit_readback"]),
        ...(hasLedger ? [] : ["missing_ledger_readback"]),
        ...(hasModelEvidence ? [] : ["missing_model_usage_evidence"]),
        ...(result.artifactRefs.length ? [] : ["missing_business_artifact"]),
      ],
    });
  }
  return evidence;
}

function buildObservationWorkspace(
  state: AicsMainFlowState,
): AicsMainFlowReadModel["observationWorkspace"] {
  const businessContext = buildObservationBusinessContext(state);
  return buildObservationWorkspaceReadModel({
    businessContext,
    availableSources: buildObservationSourceInputs(state),
    availableScopes: buildObservationAvailableScopes(state),
    evidence: buildObservationEvidenceFromState(state, businessContext),
    missingData: state.observations.length
      ? []
      : [
          {
            objectId: observationObjectId("business-health"),
            question: "当前业务健康状态的真实证据是什么？",
            reason: "还没有形成可进入归因的观察包。",
            repairAction: "先从主对话框发起经营意图，或连接内部/外部观察来源后采集证据。",
          },
        ],
  });
}

function attributionDimensionForFinding(finding: AttributionFinding): string {
  const source = `${finding.title} ${finding.summary}`.toLowerCase();
  const matchers: Array<[string, RegExp]> = [
    ["商城问题", /商城|商品|上架|审核|购买|转化/],
    ["本地服务问题", /本地|openclaw|gateway|runtime|服务|连接/],
    ["岗位供给问题", /岗位|供给|品类|样例|质量/],
    ["授权问题", /授权|entitlement|购买|可调用/],
    ["能力路由问题", /能力|路由|匹配|category|capability/],
    ["API / 模型 / 工具 / Skill 问题", /api|模型|provider|工具|skill|secret/],
    ["页面体验问题", /页面|按钮|点击|表单|体验|导航/],
    ["调度链路问题", /调度|派发|队列|规划|dispatch/],
    ["岗位执行质量问题", /执行|产物|失败|阻塞|审计|账本/],
    ["外部能力未吸收", /外部能力|可吸收|工具生态|模型公告/],
    ["外部产品压力", /竞品|产品压力|外部产品|市场/],
    ["风险与数据质量问题", /风险|数据质量|低可信|缺失|过期|冲突/],
    ["目标设定问题", /目标|指标|周期|负责人|目标值/],
  ];
  return matchers.find(([, pattern]) => pattern.test(source))?.[0] ?? "风险与数据质量问题";
}

function buildAttributionSummary(params: {
  state: AicsMainFlowState;
  readiness: AicsMainFlowReadiness;
}): AicsMainFlowReadModel["attributionSummary"] {
  const attribution = latestByCreatedAt(params.state.attributions);
  const findings = attribution?.findings ?? [];
  const topFindings = findings.slice(0, 3).map((finding) => ({
    id: finding.id,
    title: finding.title,
    summary: finding.summary,
    confidence: finding.confidence,
    evidenceCount: finding.observationSignalIds.length,
    dimension: attributionDimensionForFinding(finding),
  }));
  const matchedDimensions = Array.from(new Set(topFindings.map((finding) => finding.dimension)));
  const evidenceCount = findings.reduce(
    (sum, finding) => sum + finding.observationSignalIds.length,
    0,
  );
  const missingEvidenceCount = findings.filter(
    (finding) => finding.observationSignalIds.length === 0,
  ).length;
  const lowConfidenceCount = findings.filter((finding) => finding.confidence === "low").length;
  const missingData = [
    ...(!attribution ? ["还没有归因报告。"] : []),
    ...(findings.length === 0 && attribution ? ["归因报告没有问题发现。"] : []),
    ...(missingEvidenceCount ? [`${missingEvidenceCount} 个问题缺少观察证据。`] : []),
    ...(lowConfidenceCount ? [`${lowConfidenceCount} 个问题可信度较低。`] : []),
  ];

  return {
    dimensions: [...AICS_ATTRIBUTION_DIMENSIONS],
    matchedDimensions,
    topFindings,
    evidenceCount,
    missingEvidenceCount,
    lowConfidenceCount,
    canCreateGoalCandidate: params.readiness.canCreateGoalCandidate,
    userMessage: params.readiness.canCreateGoalCandidate
      ? "归因已引用观察证据，可以生成目标候选。"
      : missingData.length
        ? missingData.join(" ")
        : "需要先确认归因报告后才能生成目标候选。",
    missingData,
  };
}

function goalStatusLabel(status: CompanyGoal["status"] | undefined): string {
  if (status === "confirmed") return "已确认";
  if (status === "candidate") return "候选目标";
  if (status === "draft") return "草稿";
  if (status === "rejected") return "已拒绝";
  if (status === "completed") return "已完成";
  return "还没有目标";
}

function buildGoalSummary(state: AicsMainFlowState): AicsMainFlowReadModel["goalSummary"] {
  const confirmedGoal = [...state.goals].reverse().find((goal) => goal.status === "confirmed");
  const candidateGoal = [...state.goals].reverse().find((goal) => goal.status === "candidate");
  const goal = confirmedGoal ?? candidateGoal ?? latestByCreatedAt(state.goals);
  if (!goal) {
    return {
      hasGoal: false,
      statusLabel: "还没有目标",
      observationSourceCount: 0,
      attributionSourceCount: 0,
      blockedReasons: [],
      readyForPlanning: false,
      canConfirm: false,
      userMessage: "还没有公司目标。需要先完成数据分析和归因分析，再生成目标候选。",
      nextAction: "去数据分析和归因分析补齐事实与原因",
    };
  }

  const observationSourceCount = goal.sourceObservationSignalIds?.length ?? 0;
  const attributionSourceCount = goal.sourceAttributionFindingIds?.length ?? 0;
  const blockedReasons = goal.blockedReasons ?? [];
  const sourceReady = observationSourceCount > 0 && attributionSourceCount > 0;
  const readyForPlanning =
    goal.status === "confirmed" &&
    goal.readyForPlanning !== false &&
    blockedReasons.length === 0 &&
    sourceReady;
  const canConfirm = goal.status === "candidate" && sourceReady && blockedReasons.length === 0;

  return {
    hasGoal: true,
    goalId: goal.id,
    title: goal.title,
    statusLabel: goalStatusLabel(goal.status),
    metric: goal.metric,
    currentValue: goal.currentValue ?? "待确认",
    target: goal.target,
    cycle: goal.cycle ?? "待确认",
    owner: goal.owner,
    observationSourceCount,
    attributionSourceCount,
    blockedReasons,
    readyForPlanning,
    canConfirm,
    userMessage: readyForPlanning
      ? "目标已确认且来源完整，可以进入规划方案。"
      : canConfirm
        ? "目标候选来源完整，需要用户确认后才能进入规划方案。"
        : blockedReasons.length
          ? `目标仍有阻塞：${blockedReasons.join("；")}`
          : sourceReady
            ? "目标还未确认，确认后才能进入规划方案。"
            : "目标缺少观察或归因来源，不能进入规划方案。",
    nextAction: readyForPlanning
      ? "去规划方案拆工作块"
      : canConfirm
        ? "在公司目标页确认目标"
        : sourceReady
          ? "确认目标或处理目标阻塞"
          : "回到数据分析和归因分析补齐来源",
  };
}

function planningStatusLabel(status: PlanningPackage["status"] | undefined): string {
  if (status === "confirmed") return "已确认";
  if (status === "prepared") return "待确认";
  if (status === "cancelled") return "已取消";
  if (status === "rejected") return "已拒绝";
  return "还没有规划";
}

function planningRoleLabel(roleCapabilityRef: string): string {
  if (/channel|growth|conversion|marketing|推广|增长|转化/i.test(roleCapabilityRef)) {
    return "渠道增长岗位";
  }
  if (/listing|product|detail|商品|详情|审核/i.test(roleCapabilityRef)) {
    return "岗位商品运营岗位";
  }
  if (/api|model|connection|provider|模型|连接/i.test(roleCapabilityRef)) {
    return "系统连接运营岗位";
  }
  if (/authorization|billing|usage|ledger|授权|费用|账本/i.test(roleCapabilityRef)) {
    return "费用与授权运营岗位";
  }
  if (/quality|execution|dispatch|执行|调度|质检/i.test(roleCapabilityRef)) {
    return "执行质量运营岗位";
  }
  if (/external|risk|competitor|外部|风险|竞品/i.test(roleCapabilityRef)) {
    return "外部观察与风险岗位";
  }
  return "待匹配岗位";
}

function buildPlanningSummary(state: AicsMainFlowState): AicsMainFlowReadModel["planningSummary"] {
  const planning = [...state.planningPackages]
    .filter((item) => item.status !== "cancelled")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!planning) {
    return {
      hasPlanning: false,
      statusLabel: "还没有规划",
      workBlockCount: 0,
      dispatchableCount: 0,
      blockedCount: 0,
      missingAcceptanceCount: 0,
      readyForDispatch: false,
      userMessage: "还没有规划方案。需要先确认公司目标，再生成工作块。",
      nextAction: "去公司目标确认目标",
      workBlocks: [],
    };
  }

  const items = state.rolePlanItems.filter((item) => item.planningPackageId === planning.id);
  const workBlocks = items.map((item) => {
    const acceptanceCount = item.acceptanceCriteria?.filter(Boolean).length ?? 0;
    const blockedReason = item.blockedReasons?.filter(Boolean).join("；");
    const dispatchable =
      planning.status === "confirmed" &&
      item.status === "confirmed" &&
      item.dispatchStatus !== "blocked" &&
      item.dispatchStatus !== "dispatched" &&
      acceptanceCount > 0 &&
      !blockedReason;
    return {
      id: item.id,
      title: item.title,
      roleLabel: planningRoleLabel(item.roleCapabilityRef),
      taskIntent: item.taskIntent,
      expectedOutput: item.expectedOutput,
      acceptanceCount,
      dispatchable,
      ...(blockedReason ? { blockedReason } : {}),
    };
  });
  const dispatchableCount = workBlocks.filter((item) => item.dispatchable).length;
  const blockedCount = workBlocks.filter((item) => item.blockedReason).length;
  const missingAcceptanceCount = workBlocks.filter((item) => item.acceptanceCount === 0).length;
  const readyForDispatch =
    planning.status === "confirmed" &&
    workBlocks.length > 0 &&
    dispatchableCount > 0 &&
    blockedCount === 0 &&
    missingAcceptanceCount === 0;

  return {
    hasPlanning: true,
    planningPackageId: planning.id,
    title: planning.title,
    statusLabel: planningStatusLabel(planning.status),
    revision: planning.revision,
    workBlockCount: workBlocks.length,
    dispatchableCount,
    blockedCount,
    missingAcceptanceCount,
    readyForDispatch,
    userMessage: readyForDispatch
      ? "规划方案已确认，工作块具备进入任务调度的基础条件。"
      : planning.status !== "confirmed"
        ? "规划方案还未确认，确认后才能进入任务调度。"
        : blockedCount
          ? `${blockedCount} 个工作块仍有阻塞，不能全部进入任务调度。`
          : missingAcceptanceCount
            ? `${missingAcceptanceCount} 个工作块缺少验收标准，不能进入任务调度。`
            : "规划方案还需要补齐可调度工作块。",
    nextAction: readyForDispatch
      ? "去任务调度检查并派发"
      : planning.status !== "confirmed"
        ? "在规划方案页确认规划"
        : blockedCount || missingAcceptanceCount
          ? "补齐工作块阻塞和验收标准"
          : "生成或补齐工作块",
    workBlocks: workBlocks.slice(0, 6),
  };
}

function preflightHasCode(
  executionPreflight: AicsMainFlowExecutionPreflight,
  code: string,
): boolean {
  return executionPreflight.blockedReasons.some((reason) => reason.code === code);
}

function buildDispatchSummary(params: {
  state: AicsMainFlowState;
  readiness: AicsMainFlowReadiness;
  executionPreflight: AicsMainFlowExecutionPreflight;
  planningSummary: AicsMainFlowReadModel["planningSummary"];
}): AicsMainFlowReadModel["dispatchSummary"] {
  const { state, readiness, executionPreflight, planningSummary } = params;
  const hasConfirmedGoal = Boolean(latestConfirmed(state.goals));
  const hasConfirmedPlanning = Boolean(latestConfirmed(state.planningPackages));
  const hasDispatchProposal = Boolean(latestByCreatedAt(state.dispatchProposalReviews));
  const hasTaskPackage = executionPreflight.hasTaskPackage;
  const hasDispatchQueue = executionPreflight.hasDispatchToRoleRequest;
  const latestDispatch = latestByCreatedAt(state.dispatchToRoleRequests);
  const authorized = Boolean(latestDispatch?.roleListingId && latestDispatch.entitlementId);
  const apiReady =
    executionPreflight.hasApiBinding &&
    !preflightHasCode(executionPreflight, "missing_api_binding");
  const toolSkillReady =
    executionPreflight.hasToolSkillReadiness &&
    !executionPreflight.blockedReasons.some((reason) =>
      [
        "missing_tool_binding",
        "missing_skill_binding",
        "tool_skill_not_ready",
        "skill_disabled",
        "skill_missing_dependency",
        "plugin_tool_disabled",
        "missing_tool_permission",
        "unique_capability_pending",
        "cloud_capability_not_authorized",
        "unsupported_capability_route",
      ].includes(reason.code),
    );
  const costReady =
    !latestDispatch || latestDispatch.costConfirmed === true || Boolean(latestDispatch.ledgerRef);
  const actorContextReady =
    !preflightHasCode(executionPreflight, "actor_context_missing") &&
    !preflightHasCode(executionPreflight, "missing_actor_context");
  const canCreateDispatch =
    readiness.canCreateDispatchProposal ||
    readiness.canMaterializeTaskPackage ||
    planningSummary.dispatchableCount > 0;
  const canEnterRoleExecution = hasTaskPackage && hasDispatchQueue;
  const checks = [
    {
      label: "目标已确认",
      ok: hasConfirmedGoal,
      detail: hasConfirmedGoal ? "公司目标已确认。" : "先到公司目标页确认目标。",
      targetTab: "goals" as const,
    },
    {
      label: "规划已确认",
      ok: hasConfirmedPlanning && planningSummary.dispatchableCount > 0,
      detail:
        hasConfirmedPlanning && planningSummary.dispatchableCount > 0
          ? "规划方案已确认，并有可派发工作块。"
          : "先到规划方案页确认工作块。",
      targetTab: "company" as const,
    },
    {
      label: "岗位已授权",
      ok: authorized || !hasDispatchQueue,
      detail: authorized ? "已绑定岗位授权。" : "生成执行队列后需要岗位授权。",
      targetTab: "usage" as const,
    },
    {
      label: "API 可用",
      ok: apiReady || !hasDispatchQueue,
      detail: apiReady ? "API 连接满足当前执行队列。" : "去 API 管理补齐模型或工具连接。",
      targetTab: "apiManagement" as const,
    },
    {
      label: "工具 / Skill 可用",
      ok: toolSkillReady || !hasDispatchQueue,
      detail: toolSkillReady
        ? "工具和 Skill 满足当前执行队列。"
        : "去工具与 Skill 处理缺依赖或未启用能力。",
      targetTab: "skills" as const,
    },
    {
      label: "费用已确认",
      ok: costReady,
      detail: costReady ? "费用/账本条件已满足或尚未生成执行队列。" : "去费用与授权确认本次费用。",
      targetTab: "usage" as const,
    },
    {
      label: "账号上下文完整",
      ok: actorContextReady,
      detail: actorContextReady
        ? "账号身份和调用范围完整。"
        : "去 API 管理检查 actor_context 和 scope。",
      targetTab: "apiManagement" as const,
    },
  ];
  const failedChecks = checks.filter((check) => !check.ok);

  return {
    hasConfirmedGoal,
    hasConfirmedPlanning,
    hasDispatchProposal,
    hasTaskPackage,
    hasDispatchQueue,
    authorized,
    apiReady,
    toolSkillReady,
    costReady,
    actorContextReady,
    dispatchableWorkBlockCount: planningSummary.dispatchableCount,
    canCreateDispatch,
    canEnterRoleExecution,
    userMessage: canEnterRoleExecution
      ? "派发单和执行队列已生成，可以进入岗位执行页确认运行。"
      : failedChecks.length
        ? `暂不能派发：${failedChecks.map((check) => check.label).join("、")} 需要处理。`
        : canCreateDispatch
          ? "调度前置条件已满足，可以检查并生成派发单和执行队列。"
          : "还没有可派发工作块，需要先确认规划方案。",
    nextAction: canEnterRoleExecution
      ? "去岗位执行确认并运行"
      : (failedChecks[0]?.detail ??
        (canCreateDispatch ? "在任务调度页检查并派发" : "去规划方案确认工作块")),
    boundary: "任务调度只生成派发单和执行队列，不直接调用模型、不运行岗位。",
    checks,
  };
}

function roleExecutionStatusLabel(
  status: AicsMainFlowReadModel["executionClosure"]["status"],
): string {
  const labels: Record<AicsMainFlowReadModel["executionClosure"]["status"], string> = {
    not_ready: "未就绪",
    ready_to_run: "可确认运行",
    running: "运行中",
    completed: "闭环完成",
    blocked: "已阻塞",
    failed: "执行失败",
  };
  return labels[status];
}

function buildRoleExecutionSummary(
  executionClosure: AicsMainFlowReadModel["executionClosure"],
): AicsMainFlowReadModel["roleExecutionSummary"] {
  const hasBusinessResult = executionClosure.evidenceReadback.hasRoleResult;
  const hasBusinessArtifact = executionClosure.evidenceReadback.hasBusinessArtifact;
  const hasAudit = executionClosure.evidenceReadback.hasAudit;
  const hasLedger = executionClosure.evidenceReadback.hasLedger;
  const hasModelUsage = executionClosure.evidenceReadback.hasModelUsage;
  const canMarkCompleted =
    executionClosure.status === "completed" &&
    hasBusinessResult &&
    hasBusinessArtifact &&
    hasAudit &&
    hasLedger &&
    hasModelUsage &&
    executionClosure.missingEvidence.length === 0;
  const nextObservationReady =
    Boolean(executionClosure.nextObservationCandidate) && canMarkCompleted;

  return {
    statusLabel: roleExecutionStatusLabel(executionClosure.status),
    canRun: executionClosure.canRun,
    canMarkCompleted,
    hasBusinessResult,
    hasBusinessArtifact,
    hasAudit,
    hasLedger,
    hasModelUsage,
    missingEvidence: executionClosure.missingEvidence,
    ...(executionClosure.businessResult?.summary
      ? { businessResultSummary: executionClosure.businessResult.summary }
      : {}),
    nextObservationReady,
    userMessage: canMarkCompleted
      ? "岗位执行闭环已完成，业务结果和证据都已读回，可以作为下一轮观察候选。"
      : executionClosure.status === "ready_to_run"
        ? "执行前条件已满足，需要用户在岗位执行页确认并运行。"
        : executionClosure.status === "running"
          ? "岗位正在运行，等待业务结果、产物和证据回写。"
          : executionClosure.missingEvidence.length
            ? `岗位执行还不能算完成：${executionClosure.missingEvidence.join("；")}`
            : "岗位执行还未就绪，需要先完成调度、授权、费用、API 或工具/Skill 条件。",
    nextAction: canMarkCompleted
      ? "去数据分析确认下一轮观察候选"
      : (executionClosure.recoveryActions[0]?.label ??
        (executionClosure.canRun ? "在岗位执行页确认并运行" : "处理岗位执行阻塞")),
    boundary: "岗位执行只运行调度层派发的任务；缺产物、审计、账本或模型费用证据时不能显示完成。",
    recoveryActions: executionClosure.recoveryActions,
  };
}

function buildNextObservationSummary(
  executionClosure: AicsMainFlowReadModel["executionClosure"],
  roleExecutionSummary: AicsMainFlowReadModel["roleExecutionSummary"],
): AicsMainFlowReadModel["nextObservationSummary"] {
  const candidate = executionClosure.nextObservationCandidate;
  if (!candidate) {
    return {
      hasCandidate: false,
      readyForReview: false,
      title: "还没有执行结果可作为下一轮观察",
      summary: "需要先完成岗位执行，并读回业务结果、产物、审计、账本和模型费用证据。",
      artifactTitles: [],
      auditComplete: false,
      ledgerComplete: false,
      modelUsageEvidence: "missing",
      recoveryActions: roleExecutionSummary.recoveryActions,
      userMessage: "还没有下一轮观察候选。先完成调度和岗位执行闭环。",
      nextAction: roleExecutionSummary.nextAction,
      boundary: "不会自动创建新目标；只有执行结果形成观察候选后，仍需用户确认进入下一轮分析。",
    };
  }
  const readyForReview =
    roleExecutionSummary.canMarkCompleted ||
    Boolean(candidate.failureReason) ||
    executionClosure.status === "blocked" ||
    executionClosure.status === "failed";

  return {
    hasCandidate: true,
    readyForReview,
    title: candidate.title,
    summary: candidate.summary,
    artifactTitles: candidate.artifactTitles,
    auditComplete: candidate.auditComplete,
    ledgerComplete: candidate.ledgerComplete,
    modelUsageEvidence: candidate.modelUsageEvidence,
    ...(candidate.failureReason ? { failureReason: candidate.failureReason } : {}),
    recoveryActions: candidate.recoveryActions,
    userMessage: roleExecutionSummary.canMarkCompleted
      ? "上一轮执行结果证据完整，可以到数据分析页复核并确认下一轮观察。"
      : candidate.failureReason
        ? "这次执行暴露出新的问题，可以作为下一轮观察候选，但需要先处理失败原因。"
        : "执行结果已经形成观察候选，但证据仍需复核。",
    nextAction: "去数据分析复核下一轮观察候选",
    boundary: candidate.boundary,
  };
}

function executionClosureReadinessChecks(params: {
  taskPackage: TaskPackage | null;
  dispatchRequest: DispatchToRoleRequest | null;
}): AicsMainFlowReadModel["executionClosure"]["readinessChecks"] {
  const { taskPackage, dispatchRequest } = params;
  const hasTaskPackage = Boolean(taskPackage);
  const hasDispatchRequest = Boolean(dispatchRequest);
  const hasAuthorization = Boolean(dispatchRequest?.roleListingId && dispatchRequest.entitlementId);
  const hasExecutionConfirmation = dispatchRequest?.confirmExecution === true;
  const hasCostConfirmation = dispatchRequest?.costConfirmed === true;
  const hasToolSkillReadiness = Boolean(
    dispatchRequest && dispatchRequest.toolSkillReady !== false,
  );
  const hasApiBinding = Boolean(dispatchRequest && dispatchRequest.apiBindingReady !== false);
  return [
    {
      label: "派发单",
      status: hasTaskPackage ? "passed" : "missing",
      detail: hasTaskPackage ? "任务调度已生成派发单。" : "需要先在任务调度生成派发单。",
      targetTab: "workboard",
    },
    {
      label: "执行队列",
      status: hasDispatchRequest ? "passed" : "missing",
      detail: hasDispatchRequest ? "岗位执行队列项已生成。" : "需要先生成岗位执行队列项。",
      targetTab: "workboard",
    },
    {
      label: "岗位授权",
      status: hasAuthorization ? "passed" : "missing",
      detail: hasAuthorization
        ? "已绑定 roleListingId 和 entitlementId。"
        : "需要在费用与授权确认岗位授权。",
      targetTab: "usage",
    },
    {
      label: "人工执行确认",
      status: hasExecutionConfirmation ? "passed" : "missing",
      detail: hasExecutionConfirmation
        ? "已确认本次执行。"
        : "需要在岗位执行页或费用与授权确认本次执行。",
      targetTab: "aics",
    },
    {
      label: "费用确认",
      status: hasCostConfirmation ? "passed" : "missing",
      detail: hasCostConfirmation ? "已确认本次费用和账本入口。" : "需要在费用与授权确认费用。",
      targetTab: "usage",
    },
    {
      label: "岗位能力",
      status: hasToolSkillReadiness ? "passed" : "missing",
      detail: hasToolSkillReadiness
        ? "调度投影中的岗位能力条件已满足。"
        : "需要处理能力依赖或能力路由阻塞。",
      targetTab: "skills",
    },
    {
      label: "API 连接",
      status: hasApiBinding ? "passed" : "missing",
      detail: hasApiBinding ? "岗位执行所需 API 绑定可用。" : "需要在 API 管理补齐模型或工具连接。",
      targetTab: "apiManagement",
    },
  ];
}

function buildExecutionClosure(params: {
  state: AicsMainFlowState;
  executionPreflight: AicsMainFlowExecutionPreflight;
}): AicsMainFlowReadModel["executionClosure"] {
  const { state, executionPreflight } = params;
  const taskPackage = latestByCreatedAt(state.taskPackages);
  const dispatchRequest = latestByCreatedAt(state.dispatchToRoleRequests);
  const roleResult = dispatchRequest
    ? (latestByCreatedAt(
        state.roleResults.filter((result) => result.dispatchToRoleRequestId === dispatchRequest.id),
      ) ?? latestByCreatedAt(state.roleResults))
    : latestByCreatedAt(state.roleResults);
  const businessArtifactRefs = roleResultBusinessArtifactRefs(roleResult);
  const hasRoleResult = Boolean(roleResult);
  const hasBusinessArtifact = businessArtifactRefs.length > 0;
  const hasAudit = roleResultHasAuditEvidence(roleResult);
  const hasLedger = roleResultHasLedgerEvidence(roleResult);
  const hasAuditReference = roleResultHasAuditReference(roleResult);
  const hasLedgerReference = roleResultHasLedgerReference(roleResult);
  const modelUsageEvidence = executionModelUsageEvidence(roleResult?.executionEvidence);
  const hasModelUsage = modelUsageEvidence.hasEvidence;
  const hasCostSummary = roleResultHasCostSummary(roleResult);
  const hasHumanConfirmation = roleResultHasHumanConfirmation({ roleResult, dispatchRequest });
  const readinessChecks = executionClosureReadinessChecks({ taskPackage, dispatchRequest });
  const evidenceSummary = executionClosureEvidenceSummary({
    roleResult,
    businessArtifactRefs,
    hasAudit,
    hasLedger,
    hasModelUsage,
    hasCostSummary,
    hasHumanConfirmation,
    modelUsageEvidence,
    dispatchRequest,
  });
  const missingEvidence = [
    hasRoleResult ? "" : "执行结果缺失",
    hasBusinessArtifact ? "" : "业务产物缺失",
    hasAudit ? "" : hasAuditReference ? "审计记录未读回" : "审计记录缺失",
    hasLedger ? "" : hasLedgerReference ? "账本记录未读回" : "账本记录缺失",
    hasModelUsage ? "" : "模型费用证据缺失",
    hasCostSummary ? "" : "费用摘要缺失",
    hasHumanConfirmation ? "" : "人工确认记录缺失",
  ].filter(Boolean);
  const recoveryActions: AicsMainFlowReadModel["executionClosure"]["recoveryActions"] = [];

  if (!taskPackage || !dispatchRequest) {
    recoveryActions.push({
      label: "去任务调度生成派发单",
      targetTab: "workboard",
      reason: "岗位执行必须先有派发单和执行队列项。",
    });
  }
  if (dispatchRequest && (!dispatchRequest.roleListingId || !dispatchRequest.entitlementId)) {
    recoveryActions.push({
      label: "去费用与授权处理岗位授权",
      targetTab: "usage",
      reason: "岗位执行需要 roleListingId 和 entitlementId。",
    });
  }
  if (dispatchRequest && dispatchRequest.costConfirmed !== true) {
    recoveryActions.push({
      label: "去费用与授权确认费用",
      targetTab: "usage",
      reason: "岗位运行前必须确认本次费用和 ledgerRef。",
    });
  }
  if (dispatchRequest && dispatchRequest.apiBindingReady === false) {
    recoveryActions.push({
      label: "去 API 管理补模型或工具连接",
      targetTab: "apiManagement",
      reason: "岗位执行缺少可用 API 绑定。",
    });
  }
  if (dispatchRequest && dispatchRequest.toolSkillReady === false) {
    recoveryActions.push({
      label: "去能力配置处理能力",
      targetTab: "skills",
      reason: "岗位执行所需能力尚未就绪。",
    });
  }
  if (dispatchRequest && !executionPreflight.canRun && recoveryActions.length === 0) {
    recoveryActions.push({
      label: "去岗位执行处理确认项",
      targetTab: "aics",
      reason: "执行前确认项尚未全部满足。",
    });
  }
  const failedRecoveryAction = roleResultRecoveryAction(roleResult);
  if (failedRecoveryAction) {
    recoveryActions.push(failedRecoveryAction);
  }
  if (roleResult && missingEvidence.length > 0) {
    recoveryActions.push({
      label: "回到岗位执行查看证据缺口",
      targetTab: "aics",
      reason: missingEvidence.join("，"),
    });
  }

  const status: AicsMainFlowReadModel["executionClosure"]["status"] = (() => {
    if (roleResult?.outcome === "failed") return "failed";
    if (roleResult?.outcome === "blocked") return "blocked";
    if (roleResult?.outcome === "succeeded") {
      return missingEvidence.length === 0 ? "completed" : "blocked";
    }
    if (dispatchRequest?.status === "running" || taskPackage?.status === "running")
      return "running";
    if (!taskPackage || !dispatchRequest) return "not_ready";
    if (executionPreflight.canRun) return "ready_to_run";
    return "blocked";
  })();
  const nextObservationCandidate: AicsMainFlowReadModel["executionClosure"]["nextObservationCandidate"] =
    roleResult
      ? {
          title:
            roleResult.outcome === "succeeded"
              ? "上一轮执行结果可以用于新的数据分析"
              : "这次执行暴露出新的问题",
          summary: roleResult.summary,
          artifactTitles: businessArtifactRefs.map(businessArtifactObservationTitle),
          auditComplete: hasAudit,
          ledgerComplete: hasLedger,
          modelUsageEvidence: modelUsageEvidence.status,
          ...(roleResult.outcome !== "succeeded"
            ? {
                failureReason:
                  roleResult.executionEvidence?.recoverySuggestion ??
                  roleResult.summary ??
                  "岗位执行未完成，需要进入下一轮观察分析。",
              }
            : {}),
          recoveryActions,
          boundary: "只作为观察候选，不会自动创建新目标，仍需用户确认后进入下一轮分析。",
        }
      : undefined;

  return {
    status,
    canRun: executionPreflight.canRun,
    readinessChecks,
    ...(taskPackage?.id ? { taskPackageId: taskPackage.id } : {}),
    ...(dispatchRequest?.id ? { dispatchToRoleRequestId: dispatchRequest.id } : {}),
    ...(roleResult?.executionEvidence?.executionId
      ? { executionId: roleResult.executionEvidence.executionId }
      : {}),
    ...(dispatchRequest?.roleListingId ? { roleListingId: dispatchRequest.roleListingId } : {}),
    ...(dispatchRequest?.entitlementId ? { entitlementId: dispatchRequest.entitlementId } : {}),
    ...(roleResult
      ? {
          businessResult: {
            summary: roleResult.summary,
            artifactRefs: businessArtifactRefs,
          },
        }
      : {}),
    ...(nextObservationCandidate ? { nextObservationCandidate } : {}),
    evidenceReadback: {
      hasRoleResult,
      hasBusinessArtifact,
      hasAudit,
      hasLedger,
      hasModelUsage,
      hasCostSummary,
      hasHumanConfirmation,
      modelUsageStatus: modelUsageEvidence.status,
      modelUsageMessage: modelUsageEvidence.message,
    },
    evidenceSummary,
    missingEvidence,
    productionFinalGate: productionFinalGate(),
    recoveryActions,
  };
}

export function createAicsMainFlowReadModel(state: AicsMainFlowState): AicsMainFlowReadModel {
  const blockedReasons = getAicsMainFlowBlockedReasons(state);
  const currentStage = blockedReasons[0]?.stage ?? "role";
  const capabilities = buildCapabilityReadModel(state);
  const readiness = getReadiness(state);
  const executionPreflight = getAicsMainFlowExecutionPreflight(state);
  const blockerResolutions = buildBlockerResolutions(blockedReasons);
  const executionClosure = buildExecutionClosure({ state, executionPreflight });
  const roleExecutionSummary = buildRoleExecutionSummary(executionClosure);
  const nextObservationSummary = buildNextObservationSummary(
    executionClosure,
    roleExecutionSummary,
  );
  const stageGuidance = buildStageGuidance({
    state,
    stage: currentStage,
    readiness,
    executionPreflight,
  });
  const handoffPreview = buildHandoffPreview(state, currentStage);
  const stageProgress = buildStageProgress({
    state,
    currentStage,
    executionPreflight,
    executionClosure,
    blockedReasons,
  });
  const observationWorkspace = buildObservationWorkspace(state);
  const attributionSummary = buildAttributionSummary({ state, readiness });
  const goalSummary = buildGoalSummary(state);
  const planningSummary = buildPlanningSummary(state);
  const dispatchSummary = buildDispatchSummary({
    state,
    readiness,
    executionPreflight,
    planningSummary,
  });
  const operatorRecommendation = buildOperatorRecommendation({
    stageGuidance,
    blockerResolutions,
    handoffPreview,
    executionClosure,
  });
  return {
    version: AICS_MAIN_FLOW_VERSION,
    updatedAt: state.updatedAt,
    currentStage,
    readiness,
    executionPreflight,
    blockedReasons,
    stageGuidance,
    stageProgress,
    preconditions: buildPreconditions({ state, readiness, executionPreflight }),
    blockerResolutions,
    handoffPreview,
    operatorRecommendation,
    accountGoalMode: buildAccountGoalMode({
      state,
      currentStage,
      stageGuidance,
      stageProgress,
      blockerResolutions,
      executionClosure,
      operatorRecommendation,
    }),
    stageBoundary: buildStageBoundary(currentStage),
    executionClosure,
    observationWorkspace,
    attributionSummary,
    goalSummary,
    planningSummary,
    dispatchSummary,
    roleExecutionSummary,
    nextObservationSummary,
    latest: {
      interaction: latestByCreatedAt(state.interactions),
      observationPackage: latestByCreatedAt(state.observations),
      observationEvidenceRun: latestByCreatedAt(state.observationEvidenceRuns ?? []),
      attributionReport: latestByCreatedAt(state.attributions),
      companyGoal: latestByCreatedAt(state.goals),
      planningPackage: latestByCreatedAt(state.planningPackages),
      rolePlanItem: latestByCreatedAt(state.rolePlanItems),
      dispatchProposalReview: latestByCreatedAt(state.dispatchProposalReviews),
      taskPackage: latestByCreatedAt(state.taskPackages),
      dispatchToRoleRequest: latestByCreatedAt(state.dispatchToRoleRequests),
      roleResult: latestByCreatedAt(state.roleResults),
    },
    counts: {
      interactions: state.interactions.length,
      observations: state.observations.length,
      observationEvidenceRuns: state.observationEvidenceRuns?.length ?? 0,
      attributions: state.attributions.length,
      goals: state.goals.length,
      planningPackages: state.planningPackages.length,
      rolePlanItems: state.rolePlanItems.length,
      dispatchProposalReviews: state.dispatchProposalReviews.length,
      taskPackages: state.taskPackages.length,
      dispatchToRoleRequests: state.dispatchToRoleRequests.length,
      roleResults: state.roleResults.length,
    },
    objects: {
      interactions: state.interactions,
      observations: state.observations,
      observationEvidenceRuns: state.observationEvidenceRuns ?? [],
      attributions: state.attributions,
      goals: state.goals,
      planningPackages: state.planningPackages,
      rolePlanItems: state.rolePlanItems,
      dispatchProposalReviews: state.dispatchProposalReviews,
      taskPackages: state.taskPackages,
      dispatchToRoleRequests: state.dispatchToRoleRequests,
      roleResults: state.roleResults,
    },
    // managementBreakdown: 公司管理拆解数据
    workBlocks: (state.workBlocks ?? []).filter((w) => !w.isStale),
    workBlockRoles: state.workBlockRoles ?? [],
    workBlockTaskCandidates: state.workBlockTaskCandidates ?? [],
    operationChecks: buildOperationChecks({ state, readiness, blockedReasons, capabilities }),
    capabilities,
  };
}

export function createInteraction(
  state: AicsMainFlowState,
  input: CreateInteractionInput,
  now = Date.now(),
): AicsMainFlowInteraction {
  const interaction: AicsMainFlowInteraction = {
    kind: "Interaction",
    id: makeId("interaction", input.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    stage: input.stage,
    message: input.message,
    ...(input.proposedNextAction ? { proposedNextAction: input.proposedNextAction } : {}),
  };
  state.interactions.push(interaction);
  state.updatedAt = now;
  return interaction;
}

export function prepareObservation(
  state: AicsMainFlowState,
  input: PrepareObservationInput,
  now = Date.now(),
): ObservationPackage {
  const observation: ObservationPackage = {
    kind: "ObservationPackage",
    id: makeId("obs_pkg", input.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    title: input.title,
    summary: input.summary,
    signals: input.signals ? [...input.signals] : [],
  };
  state.observations.push(observation);
  state.updatedAt = now;
  return observation;
}

export function recordObservationEvidenceRun(
  state: AicsMainFlowState,
  input: {
    id?: string;
    planId: string;
    status: "completed" | "blocked" | "failed";
    observationPackageId?: string;
    acceptedCount: number;
    needsReviewCount: number;
    rejectedCount: number;
    missingCount: number;
    blockedReasons: string[];
    runResultJson: string;
  },
  now = Date.now(),
) {
  const runRecord = {
    id: makeId("obs_evidence_run", input.id),
    planId: input.planId,
    status: input.status,
    ...(input.observationPackageId ? { observationPackageId: input.observationPackageId } : {}),
    acceptedCount: input.acceptedCount,
    needsReviewCount: input.needsReviewCount,
    rejectedCount: input.rejectedCount,
    missingCount: input.missingCount,
    blockedReasons: [...input.blockedReasons],
    runResultJson: input.runResultJson,
    createdAt: now,
  };
  state.observationEvidenceRuns = [...(state.observationEvidenceRuns ?? []), runRecord];
  state.updatedAt = now;
  return runRecord;
}

export function confirmObservation(
  state: AicsMainFlowState,
  observationPackageId: string,
  now = Date.now(),
): ObservationPackage {
  const observation = state.observations.find((item) => item.id === observationPackageId);
  if (!observation || !observationHasSignals(observation)) {
    throw new AicsMainFlowGateError({
      stage: "observation",
      code: "missing_observation_package",
      message: "ObservationPackage must contain at least one signal before confirmation.",
    });
  }
  observation.status = "confirmed";
  observation.updatedAt = now;
  state.updatedAt = now;
  return observation;
}

export function rejectObservation(
  state: AicsMainFlowState,
  observationPackageId: string,
  now = Date.now(),
): ObservationPackage {
  const observation = state.observations.find((item) => item.id === observationPackageId);
  if (!observation) {
    throw new AicsMainFlowGateError({
      stage: "observation",
      code: "missing_observation_package",
      message: "ObservationPackage is required before rejection.",
    });
  }
  observation.status = "rejected";
  observation.updatedAt = now;
  state.updatedAt = now;
  return observation;
}

export function markObservationDataMissing(
  state: AicsMainFlowState,
  observationPackageId: string,
  summary = "待补真实经营数据",
  now = Date.now(),
): ObservationPackage {
  const observation = state.observations.find((item) => item.id === observationPackageId);
  if (!observation) {
    throw new AicsMainFlowGateError({
      stage: "observation",
      code: "missing_observation_package",
      message: "ObservationPackage is required before marking data gaps.",
    });
  }
  observation.status = "prepared";
  observation.summary = `${observation.summary}\n数据缺口：${summary}`.trim();
  observation.updatedAt = now;
  state.updatedAt = now;
  return observation;
}

export function prepareAttribution(
  state: AicsMainFlowState,
  input: PrepareAttributionInput,
  now = Date.now(),
): AttributionReport {
  const observationPackageId =
    input.observationPackageId ?? latestByCreatedAt(state.observations)?.id;
  if (!observationPackageId) {
    throw new AicsMainFlowGateError({
      stage: "observation",
      code: "missing_observation_package",
      message:
        "ObservationPackage with at least one observation signal is required before attribution.",
    });
  }
  const observation = state.observations.find((item) => item.id === observationPackageId);
  if (!observation || !observationReadyForAttribution(observation)) {
    throw new AicsMainFlowGateError({
      stage: "observation",
      code: "missing_observation_package",
      message:
        "ObservationPackage with at least one non-rejected observation signal is required before attribution.",
    });
  }
  const attribution: AttributionReport = {
    kind: "AttributionReport",
    id: makeId("attr_report", input.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    observationPackageId,
    title: input.title,
    summary: input.summary,
    findings: input.findings ? [...input.findings] : [],
  };
  state.attributions.push(attribution);
  state.updatedAt = now;
  return attribution;
}

export function confirmAttribution(
  state: AicsMainFlowState,
  attributionReportId: string,
  now = Date.now(),
): AttributionReport {
  const attribution = state.attributions.find((item) => item.id === attributionReportId);
  if (!attribution || attribution.findings.length === 0) {
    throw new AicsMainFlowGateError({
      stage: "attribution",
      code: "missing_attribution_report",
      message: "AttributionReport must contain at least one finding before confirmation.",
    });
  }
  if (attribution.findings.some((finding) => finding.observationSignalIds.length === 0)) {
    throw new AicsMainFlowGateError({
      stage: "attribution",
      code: "missing_attribution_report",
      message:
        "AttributionReport findings must reference observation evidence before confirmation.",
    });
  }
  attribution.status = "confirmed";
  attribution.updatedAt = now;
  state.updatedAt = now;
  return attribution;
}

export function rejectAttribution(
  state: AicsMainFlowState,
  attributionReportId: string,
  now = Date.now(),
): AttributionReport {
  const attribution = state.attributions.find((item) => item.id === attributionReportId);
  if (!attribution) {
    throw new AicsMainFlowGateError({
      stage: "attribution",
      code: "missing_attribution_report",
      message: "AttributionReport is required before rejection.",
    });
  }
  attribution.status = "rejected";
  attribution.updatedAt = now;
  state.updatedAt = now;
  return attribution;
}

export function requestAttributionMoreData(
  state: AicsMainFlowState,
  attributionReportId: string,
  summary = "归因需要补充经营数据",
  now = Date.now(),
): AttributionReport {
  const attribution = state.attributions.find((item) => item.id === attributionReportId);
  if (!attribution) {
    throw new AicsMainFlowGateError({
      stage: "attribution",
      code: "missing_attribution_report",
      message: "AttributionReport is required before requesting more data.",
    });
  }
  attribution.status = "prepared";
  attribution.summary = `${attribution.summary}\n补数据要求：${summary}`.trim();
  attribution.updatedAt = now;
  state.updatedAt = now;
  return attribution;
}

export function createGoalCandidate(
  state: AicsMainFlowState,
  input: CreateGoalCandidateInput,
  now = Date.now(),
): CompanyGoal {
  // CompanyGoal = 观察+归因+目标的共同结果，需要两层的门禁
  requireGate(state, "missing_attribution_report");
  const observationPackageId =
    input.observationPackageId ?? latestByCreatedAt(state.observations)?.id;
  const attributionReportId =
    input.attributionReportId ?? latestByCreatedAt(state.attributions)?.id;
  const observation = state.observations.find((item) => item.id === observationPackageId);
  if (!observationPackageId || !observationReadyForAttribution(observation)) {
    throw new AicsMainFlowGateError({
      stage: "observation",
      code: "missing_observation_package",
      message:
        "Confirmed ObservationPackage with at least one observation signal is required before creating a CompanyGoal candidate. CompanyGoal 是观察+归因+目标三方共同确认的结果。",
    });
  }
  const attribution = state.attributions.find((item) => item.id === attributionReportId);
  if (!attributionReportId || !attributionReadyForGoal(attribution)) {
    throw new AicsMainFlowGateError({
      stage: "attribution",
      code: "missing_attribution_report",
      message:
        "Confirmed AttributionReport with at least one finding is required before creating goal rationale. CompanyGoal 是观察+归因+目标三方共同确认的结果。",
    });
  }
  const sourceObservationSignalIds = input.sourceObservationSignalIds?.length
    ? input.sourceObservationSignalIds
    : observation.signals.map((signal) => signal.id);
  const sourceAttributionFindingIds = input.sourceAttributionFindingIds?.length
    ? input.sourceAttributionFindingIds
    : attribution.findings.map((finding) => finding.id);
  const observationSignalIds = new Set(observation.signals.map((signal) => signal.id));
  const attributionFindingIds = new Set(attribution.findings.map((finding) => finding.id));
  if (sourceObservationSignalIds.some((id) => !observationSignalIds.has(id))) {
    throw new AicsMainFlowGateError({
      stage: "goal",
      code: "missing_attribution_report",
      message:
        "CompanyGoal sourceObservationSignalIds must reference confirmed observation signals.",
    });
  }
  if (sourceAttributionFindingIds.some((id) => !attributionFindingIds.has(id))) {
    throw new AicsMainFlowGateError({
      stage: "goal",
      code: "missing_attribution_report",
      message:
        "CompanyGoal sourceAttributionFindingIds must reference confirmed attribution findings.",
    });
  }
  const blockedReasons = input.blockedReasons ?? [];
  const readyForPlanning =
    input.readyForPlanning ??
    (sourceObservationSignalIds.length > 0 &&
      sourceAttributionFindingIds.length > 0 &&
      blockedReasons.length === 0);
  const goal: CompanyGoal = {
    kind: "CompanyGoal",
    id: makeId("goal", input.id),
    status: "candidate",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    attributionReportId,
    observationPackageId,
    title: input.title,
    owner: input.owner,
    metric: input.metric,
    ...(input.currentValue ? { currentValue: input.currentValue } : {}),
    target: input.target,
    ...(input.cycle ? { cycle: input.cycle } : {}),
    rationale: input.rationale,
    whyNow:
      input.whyNow ??
      `基于 ${sourceObservationSignalIds.length} 条观察事实和 ${sourceAttributionFindingIds.length} 条归因发现生成，需用户确认后进入规划。`,
    sourceObservationSignalIds,
    sourceAttributionFindingIds,
    blockedReasons,
    readyForPlanning,
  };
  state.goals.push(goal);
  state.updatedAt = now;
  return goal;
}

export function confirmGoal(
  state: AicsMainFlowState,
  goalId: string,
  now = Date.now(),
): CompanyGoal {
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal) {
    throw new AicsMainFlowGateError({
      stage: "goal",
      code: "missing_confirmed_company_goal",
      message: "CompanyGoal must exist before it can be confirmed.",
    });
  }
  goal.status = "confirmed";
  goal.updatedAt = now;
  state.updatedAt = now;
  return goal;
}

export function preparePlanning(
  state: AicsMainFlowState,
  input: PreparePlanningInput,
  now = Date.now(),
): PlanningPackage {
  requireGate(state, "missing_confirmed_company_goal");
  const goalId = input.goalId ?? latestConfirmed(state.goals)?.id;
  const goal = state.goals.find((item) => item.id === goalId && item.status === "confirmed");
  if (!goalId || !goal) {
    throw new AicsMainFlowGateError({
      stage: "goal",
      code: "missing_confirmed_company_goal",
      message: "A user-confirmed CompanyGoal is required before planning.",
    });
  }
  if (goal.readyForPlanning === false || (goal.blockedReasons?.length ?? 0) > 0) {
    throw new AicsMainFlowGateError({
      stage: "goal",
      code: "missing_confirmed_company_goal",
      message: `CompanyGoal is confirmed but not ready for planning: ${
        goal.blockedReasons?.join("；") || "目标仍需补齐来源证据或解除阻塞"
      }`,
    });
  }
  const sourceObservationPackageId =
    goal.observationPackageId ?? latestConfirmed(state.observations)?.id;
  const sourceAttributionReportId = goal.attributionReportId;
  const sourceSignalIds = sourceObservationPackageId
    ? (state.observations
        .find((item) => item.id === sourceObservationPackageId)
        ?.signals.map((signal) => signal.id) ?? [])
    : [];
  const sourceFindingIds =
    state.attributions
      .find((item) => item.id === sourceAttributionReportId)
      ?.findings.map((finding) => finding.id) ?? [];
  const revision =
    state.planningPackages
      .filter((item) => item.goalId === goalId)
      .reduce((max, item) => {
        return Math.max(max, item.revision ?? 0);
      }, 0) + 1;
  const planningPackageId = makeId("planning_pkg", input.id);
  const rolePlanItems: RolePlanItem[] = input.rolePlanItems.map((item) => {
    assertKnownPlanningSourceIds({
      ids: item.sourceSignalIds,
      allowedIds: sourceSignalIds,
      label: "sourceSignalIds",
    });
    assertKnownPlanningSourceIds({
      ids: item.sourceFindingIds,
      allowedIds: sourceFindingIds,
      label: "sourceFindingIds",
    });
    const title = assertNonEmptyPlanningText(item.title, "title");
    const roleCapabilityRef = assertNonEmptyPlanningText(
      item.roleCapabilityRef,
      "roleCapabilityRef",
    );
    const taskIntent = assertNonEmptyPlanningText(item.taskIntent, "taskIntent");
    const expectedOutput = assertNonEmptyPlanningText(item.expectedOutput, "expectedOutput");
    const acceptanceCriteria =
      item.acceptanceCriteria?.map((criterion) => criterion.trim()).filter(Boolean) ?? [];
    return {
      kind: "RolePlanItem",
      id: makeId("role_plan_item", item.id),
      status: "prepared",
      ...timestamps(now),
      auditRefs: auditRefs(item),
      planningPackageId,
      title,
      ...(item.category ? { category: item.category } : {}),
      roleCapabilityRef,
      taskIntent,
      expectedOutput,
      humanConfirmationRequired: item.humanConfirmationRequired ?? true,
      sourceSignalIds: item.sourceSignalIds ?? sourceSignalIds,
      sourceFindingIds: item.sourceFindingIds ?? sourceFindingIds,
      dispatchStatus:
        item.blockedReasons && item.blockedReasons.length > 0 ? "blocked" : "not_dispatched",
      dispatchProposalIds: [],
      ...(item.capabilityMatchSummary
        ? { capabilityMatchSummary: item.capabilityMatchSummary.trim() }
        : {}),
      blockedReasons: item.blockedReasons ?? [],
      acceptanceCriteria: acceptanceCriteria.length
        ? acceptanceCriteria
        : [`交付物符合：${expectedOutput}`],
    };
  });
  const planning: PlanningPackage = {
    kind: "PlanningPackage",
    id: planningPackageId,
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    goalId,
    title: input.title,
    summary: input.summary,
    rolePlanItemIds: rolePlanItems.map((item) => item.id),
    revision,
    ...(sourceObservationPackageId ? { sourceObservationPackageId } : {}),
    sourceAttributionReportId,
  };
  state.planningPackages.push(planning);
  state.rolePlanItems.push(...rolePlanItems);
  state.updatedAt = now;
  return planning;
}

export function regeneratePlanning(
  state: AicsMainFlowState,
  input: PreparePlanningInput,
  now = Date.now(),
): PlanningPackage {
  const previous = state.planningPackages.filter(
    (item) => item.goalId === (input.goalId ?? latestConfirmed(state.goals)?.id),
  );
  const planning = preparePlanning(state, input, now);
  for (const item of previous) {
    if (item.id === planning.id || item.status === "cancelled") continue;
    item.status = "cancelled";
    item.statusReason = `superseded_by:${planning.id}`;
    item.supersededByPlanningPackageId = planning.id;
    item.updatedAt = now;
  }
  state.updatedAt = now;
  return planning;
}

export function updateRolePlanItem(
  state: AicsMainFlowState,
  input: UpdateRolePlanItemInput,
  now = Date.now(),
): RolePlanItem {
  const item = state.rolePlanItems.find((entry) => entry.id === input.rolePlanItemId);
  if (!item) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "RolePlanItem must exist before it can be updated.",
    });
  }
  if (typeof input.title === "string" && input.title.trim()) item.title = input.title.trim();
  if (typeof input.category === "string") item.category = input.category.trim() || undefined;
  if (typeof input.roleCapabilityRef === "string" && input.roleCapabilityRef.trim()) {
    item.roleCapabilityRef = input.roleCapabilityRef.trim();
  }
  if (typeof input.taskIntent === "string" && input.taskIntent.trim()) {
    item.taskIntent = input.taskIntent.trim();
  }
  if (typeof input.expectedOutput === "string" && input.expectedOutput.trim()) {
    item.expectedOutput = input.expectedOutput.trim();
  }
  if (typeof input.humanConfirmationRequired === "boolean") {
    item.humanConfirmationRequired = input.humanConfirmationRequired;
  }
  if (typeof input.capabilityMatchSummary === "string") {
    item.capabilityMatchSummary = input.capabilityMatchSummary.trim() || undefined;
  }
  if (Array.isArray(input.blockedReasons)) {
    item.blockedReasons = input.blockedReasons.filter(Boolean);
    if (item.blockedReasons.length > 0) item.dispatchStatus = "blocked";
  }
  if (Array.isArray(input.acceptanceCriteria)) {
    item.acceptanceCriteria = input.acceptanceCriteria.filter(Boolean);
  }
  item.auditRefs = [...item.auditRefs, ...auditRefs(input)];
  item.updatedAt = now;
  state.updatedAt = now;
  return item;
}

export function cancelRolePlanItem(
  state: AicsMainFlowState,
  input: CancelRolePlanItemInput,
  now = Date.now(),
): RolePlanItem {
  const item = state.rolePlanItems.find((entry) => entry.id === input.rolePlanItemId);
  if (!item) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "RolePlanItem must exist before it can be cancelled.",
    });
  }
  item.status = "cancelled";
  item.dispatchStatus = "blocked";
  item.blockedReasons = [...(item.blockedReasons ?? []), input.reason].filter(Boolean);
  item.auditRefs = [...item.auditRefs, ...auditRefs(input)];
  item.updatedAt = now;
  state.updatedAt = now;
  return item;
}

export function confirmPlanning(
  state: AicsMainFlowState,
  planningPackageId: string,
  now = Date.now(),
): PlanningPackage {
  const planning = state.planningPackages.find((item) => item.id === planningPackageId);
  if (!planning || planning.rolePlanItemIds.length === 0) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "PlanningPackage with RolePlanItem entries must exist before dispatch.",
    });
  }
  planning.status = "confirmed";
  planning.updatedAt = now;
  for (const item of state.rolePlanItems) {
    if (planning.rolePlanItemIds.includes(item.id) && item.status !== "cancelled") {
      item.status = "confirmed";
      item.updatedAt = now;
    }
  }
  state.updatedAt = now;
  return planning;
}

export function createDispatchProposal(
  state: AicsMainFlowState,
  input: CreateDispatchProposalInput,
  now = Date.now(),
): DispatchProposalReview {
  requireGate(state, "missing_confirmed_planning_package");
  const planningPackageId = input.planningPackageId ?? latestConfirmed(state.planningPackages)?.id;
  const planning = state.planningPackages.find(
    (item) => item.id === planningPackageId && item.status === "confirmed",
  );
  const confirmedRolePlanItemIds =
    planning?.rolePlanItemIds.filter((id) =>
      state.rolePlanItems.some((item) => item.id === id && item.status === "confirmed"),
    ) ?? [];
  const rolePlanItemId =
    input.rolePlanItemId ??
    (confirmedRolePlanItemIds.length === 1 ? confirmedRolePlanItemIds[0] : undefined);
  if (!planning || !rolePlanItemId || !planning.rolePlanItemIds.includes(rolePlanItemId)) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message:
        "A confirmed PlanningPackage and an explicit confirmed RolePlanItem are required before dispatch.",
    });
  }
  const rolePlanItem = state.rolePlanItems.find(
    (item) => item.id === rolePlanItemId && item.status === "confirmed",
  );
  if (!rolePlanItem) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message:
        "A confirmed PlanningPackage and an explicit confirmed RolePlanItem are required before dispatch.",
    });
  }
  if (
    rolePlanItem.status === "cancelled" ||
    rolePlanItem.dispatchStatus === "blocked" ||
    (rolePlanItem.blockedReasons?.length ?? 0) > 0
  ) {
    throw new AicsMainFlowGateError({
      stage: "dispatch",
      code: "missing_confirmed_planning_package",
      message: `RolePlanItem is not dispatchable: ${
        rolePlanItem.blockedReasons?.join("；") || "工作块已取消或存在阻塞"
      }`,
    });
  }
  if ((rolePlanItem.acceptanceCriteria?.filter(Boolean).length ?? 0) === 0) {
    throw new AicsMainFlowGateError({
      stage: "dispatch",
      code: "missing_confirmed_planning_package",
      message: "RolePlanItem acceptanceCriteria is required before dispatch.",
    });
  }
  const proposal: DispatchProposalReview = {
    kind: "DispatchProposalReview",
    id: makeId("dispatch_review", input.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    planningPackageId: planning.id,
    rolePlanItemId,
    title: input.title,
    riskSummary: input.riskSummary,
    confirmationSummary: input.confirmationSummary,
  };
  state.dispatchProposalReviews.push(proposal);
  rolePlanItem.dispatchStatus = "ready_for_dispatch";
  rolePlanItem.dispatchProposalIds = [...(rolePlanItem.dispatchProposalIds ?? []), proposal.id];
  rolePlanItem.updatedAt = now;
  state.updatedAt = now;
  return proposal;
}

export function confirmDispatch(
  state: AicsMainFlowState,
  dispatchProposalReviewId: string,
  now = Date.now(),
): DispatchProposalReview {
  const proposal = state.dispatchProposalReviews.find(
    (item) => item.id === dispatchProposalReviewId,
  );
  if (!proposal) {
    throw new AicsMainFlowGateError({
      stage: "dispatch",
      code: "missing_confirmed_dispatch_proposal",
      message: "DispatchProposalReview must exist before it can be confirmed.",
    });
  }
  proposal.status = "confirmed";
  proposal.updatedAt = now;
  state.updatedAt = now;
  return proposal;
}

export function materializeTaskPackage(
  state: AicsMainFlowState,
  input: MaterializeTaskPackageInput,
  now = Date.now(),
): { taskPackage: TaskPackage; dispatchToRoleRequest: DispatchToRoleRequest } {
  requireGate(state, "missing_confirmed_dispatch_proposal");
  const dispatchProposalReviewId =
    input.dispatchProposalReviewId ?? latestConfirmed(state.dispatchProposalReviews)?.id;
  const proposal = state.dispatchProposalReviews.find(
    (item) => item.id === dispatchProposalReviewId && item.status === "confirmed",
  );
  if (!proposal) {
    throw new AicsMainFlowGateError({
      stage: "dispatch",
      code: "missing_confirmed_dispatch_proposal",
      message:
        "A confirmed DispatchProposalReview is required before materializing a task package.",
    });
  }
  const planning = state.planningPackages.find((item) => item.id === proposal.planningPackageId);
  if (!planning) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "PlanningPackage is required before materializing a task package.",
    });
  }
  const rolePlanItem = state.rolePlanItems.find((item) => item.id === proposal.rolePlanItemId);
  const match = buildCapabilityReadModel(state).matches.find(
    (item) => item.rolePlanItemId === proposal.rolePlanItemId,
  );
  const category =
    match?.category ??
    rolePlanItem?.category ??
    inferCategory(rolePlanItem?.title, rolePlanItem?.taskIntent);
  const requiredCapabilityRefs = rolePlanItem?.roleCapabilityRef
    ? [rolePlanItem.roleCapabilityRef]
    : [];
  const resolution = input.capabilityResolution;
  const roleCategoryCapabilityGrant = resolveRoleCategoryCapabilityGrant(resolution);
  const resolutionBlockedReasons = [...roleCategoryCapabilityGrant.capabilityBlockedReasons];
  if (match?.status === "needs_unique_capability") {
    resolutionBlockedReasons.push("unique_capability_pending");
  }
  const resolvedAllowedTools = roleCategoryCapabilityGrant.allowedTools;
  const resolvedAllowedSkills = roleCategoryCapabilityGrant.allowedSkills;
  const capabilityBlockedReasons = normalizeCapabilityBlockedReasons(resolutionBlockedReasons);
  const hasApiBindingBlock = capabilityBlockedReasons.includes("missing_api_binding");
  const hasToolSkillBlock = capabilityBlockedReasons.some(
    (reason) => reason !== "missing_api_binding",
  );
  const apiBindingReady = !hasApiBindingBlock;
  const toolSkillReady =
    match?.status !== "needs_unique_capability" &&
    !hasToolSkillBlock &&
    resolvedAllowedTools.length > 0 &&
    resolvedAllowedSkills.length > 0;
  const materializationBlocked = !toolSkillReady || !apiBindingReady;
  const taskPackage: TaskPackage = {
    kind: "TaskPackage",
    id: makeId("task_pkg", input.id),
    status: materializationBlocked ? "blocked" : "materialized",
    ...timestamps(now),
    auditRefs: auditRefs(input),
    goalId: planning.goalId,
    planningPackageId: planning.id,
    rolePlanItemId: proposal.rolePlanItemId,
    dispatchProposalReviewId: proposal.id,
    title: input.title,
    taskText: input.taskText,
    category,
    requiredCapabilityRefs,
  };
  const dispatchToRoleRequest: DispatchToRoleRequest = {
    kind: "DispatchToRoleRequest",
    id: makeId("dispatch_role_req", input.request?.id),
    status: materializationBlocked ? "blocked" : "ready",
    ...timestamps(now),
    auditRefs: auditRefs(input.request),
    taskPackageId: taskPackage.id,
    rolePlanItemId: proposal.rolePlanItemId,
    ...(roleCategoryCapabilityGrant.categoryCapabilityId
      ? { categoryCapabilityId: roleCategoryCapabilityGrant.categoryCapabilityId }
      : {}),
    category,
    requiredCapabilityRefs,
    allowedTools: resolvedAllowedTools,
    allowedSkills: resolvedAllowedSkills,
    capabilityBlockedReasons,
    ...(match?.uniqueCapabilityRequestId
      ? { capabilityRequestId: match.uniqueCapabilityRequestId }
      : {}),
    ...(input.request?.roleListingId ? { roleListingId: input.request.roleListingId } : {}),
    ...(input.request?.roleTitle ? { roleTitle: input.request.roleTitle } : {}),
    ...(input.request?.entitlementId ? { entitlementId: input.request.entitlementId } : {}),
    ...(input.request?.workspaceDir ? { workspaceDir: input.request.workspaceDir } : {}),
    confirmExecution: false,
    costConfirmed: false,
    toolSkillReady,
    apiBindingReady,
  };
  state.taskPackages.push(taskPackage);
  state.dispatchToRoleRequests.push(dispatchToRoleRequest);
  if (rolePlanItem) {
    rolePlanItem.dispatchStatus = materializationBlocked ? "blocked" : "dispatched";
    rolePlanItem.dispatchProposalIds = [
      ...new Set([...(rolePlanItem.dispatchProposalIds ?? []), proposal.id]),
    ];
    rolePlanItem.blockedReasons = materializationBlocked ? capabilityBlockedReasons : [];
    rolePlanItem.updatedAt = now;
  }
  state.updatedAt = now;
  return { taskPackage, dispatchToRoleRequest };
}

export function confirmRoleExecution(
  state: AicsMainFlowState,
  input: RunApprovedTaskInput,
  now = Date.now(),
): DispatchToRoleRequest {
  requireGate(state, "missing_dispatch_to_role_request");
  const dispatchToRoleRequestId =
    input.dispatchToRoleRequestId ?? latestByCreatedAt(state.dispatchToRoleRequests)?.id;
  const request = state.dispatchToRoleRequests.find((item) => item.id === dispatchToRoleRequestId);
  if (!request) {
    throw new AicsMainFlowGateError({
      stage: "role",
      code: "missing_dispatch_to_role_request",
      message: "DispatchToRoleRequest is required before execution confirmation.",
    });
  }
  if (input.roleListingId) request.roleListingId = input.roleListingId;
  if (input.roleTitle) request.roleTitle = input.roleTitle;
  if (input.entitlementId) request.entitlementId = input.entitlementId;
  request.confirmExecution = true;
  request.updatedAt = now;
  state.updatedAt = now;
  return request;
}

export function confirmRoleExecutionCost(
  state: AicsMainFlowState,
  input: RunApprovedTaskInput,
  now = Date.now(),
): DispatchToRoleRequest {
  requireGate(state, "missing_dispatch_to_role_request");
  const dispatchToRoleRequestId =
    input.dispatchToRoleRequestId ?? latestByCreatedAt(state.dispatchToRoleRequests)?.id;
  const request = state.dispatchToRoleRequests.find((item) => item.id === dispatchToRoleRequestId);
  if (!request) {
    throw new AicsMainFlowGateError({
      stage: "role",
      code: "missing_dispatch_to_role_request",
      message: "DispatchToRoleRequest is required before cost confirmation.",
    });
  }
  if (input.entitlementId) request.entitlementId = input.entitlementId;
  if (input.ledgerRef) request.ledgerRef = input.ledgerRef;
  request.costConfirmed = true;
  request.updatedAt = now;
  state.updatedAt = now;
  return request;
}

export function setUniqueCapabilityApprovalForDispatch(
  state: AicsMainFlowState,
  input: {
    capabilityRequestId: string;
    status: "approved" | "blocked" | "pending_review";
  },
  now = Date.now(),
): { updatedRequests: DispatchToRoleRequest[]; updatedTaskPackages: TaskPackage[] } {
  const updatedRequests: DispatchToRoleRequest[] = [];
  const updatedTaskPackages: TaskPackage[] = [];
  const approved = input.status === "approved";
  for (const request of state.dispatchToRoleRequests) {
    if (request.capabilityRequestId !== input.capabilityRequestId) continue;
    if (approved) {
      request.allowedTools = Array.from(
        new Set([...(request.allowedTools ?? []), "tool.execute.category_specific"]),
      );
      const category = request.category ?? "通用品类";
      request.allowedSkills = Array.from(
        new Set([...(request.allowedSkills ?? []), `skill.${category}.specific_rules`]),
      );
    }
    request.capabilityBlockedReasons = approved
      ? (request.capabilityBlockedReasons ?? []).filter(
          (reason) => reason !== "unique_capability_pending",
        )
      : Array.from(
          new Set([...(request.capabilityBlockedReasons ?? []), "unique_capability_pending"]),
        );
    const remainingCapabilityBlocks = request.capabilityBlockedReasons.filter(
      (reason) => reason !== "missing_api_binding",
    );
    request.toolSkillReady =
      approved &&
      remainingCapabilityBlocks.length === 0 &&
      (request.allowedTools ?? []).length > 0 &&
      (request.allowedSkills ?? []).length > 0;
    request.apiBindingReady = !(request.capabilityBlockedReasons ?? []).includes(
      "missing_api_binding",
    );
    request.status = request.toolSkillReady && request.apiBindingReady ? "ready" : "blocked";
    request.updatedAt = now;
    updatedRequests.push(request);
    const task = state.taskPackages.find((item) => item.id === request.taskPackageId);
    if (task) {
      task.status = request.status === "ready" ? "materialized" : "blocked";
      task.updatedAt = now;
      updatedTaskPackages.push(task);
    }
  }
  if (updatedRequests.length || updatedTaskPackages.length) {
    state.updatedAt = now;
  }
  return { updatedRequests, updatedTaskPackages };
}

export function runApprovedTask(
  state: AicsMainFlowState,
  input: RunApprovedTaskInput,
  now = Date.now(),
): { dispatchToRoleRequest: DispatchToRoleRequest; roleResult: RoleResult | null } {
  requireGate(state, "missing_task_package");
  requireGate(state, "missing_dispatch_to_role_request");
  const taskPackageId = input.taskPackageId ?? latestByCreatedAt(state.taskPackages)?.id;
  const dispatchToRoleRequestId =
    input.dispatchToRoleRequestId ?? latestByCreatedAt(state.dispatchToRoleRequests)?.id;
  const taskPackage = state.taskPackages.find((item) => item.id === taskPackageId);
  const request = state.dispatchToRoleRequests.find(
    (item) => item.id === dispatchToRoleRequestId && item.taskPackageId === taskPackageId,
  );
  if (!taskPackage) {
    throw new AicsMainFlowGateError({
      stage: "role",
      code: "missing_task_package",
      message: "TaskPackage is required before role execution.",
    });
  }
  if (!request) {
    throw new AicsMainFlowGateError({
      stage: "role",
      code: "missing_dispatch_to_role_request",
      message: "DispatchToRoleRequest is required before role execution.",
    });
  }
  const existingSucceededResult = state.roleResults.find(
    (item) =>
      item.taskPackageId === taskPackage.id &&
      item.dispatchToRoleRequestId === request.id &&
      item.outcome === "succeeded",
  );
  if (existingSucceededResult) {
    throw new AicsMainFlowGateError({
      stage: "role",
      code: "duplicate_successful_execution",
      message:
        "该派发单已经执行完成并生成结果，不能重复运行。需要重新执行时请先由任务调度生成新的派发单。",
    });
  }
  // Execution consumes a previously authorized DispatchToRoleRequest.
  // Authorization, execution confirmation, cost confirmation, and ledger setup
  // must be written by confirmRoleExecution / confirmRoleExecutionCost first.
  const preflight = getAicsMainFlowExecutionPreflight(state, {
    taskPackageId: taskPackage.id,
    dispatchToRoleRequestId: request.id,
  });
  const capabilityBlock = preflight.blockedReasons.find((reason) =>
    [
      "missing_category_binding",
      "missing_tool_binding",
      "missing_skill_binding",
      "tool_skill_not_ready",
      "missing_api_binding",
      "skill_disabled",
      "skill_missing_dependency",
      "plugin_tool_disabled",
      "missing_tool_permission",
      "unique_capability_pending",
      "cloud_capability_not_authorized",
      "high_risk_needs_human_approval",
      "unsupported_capability_route",
      "actor_context_missing",
    ].includes(reason.code),
  );
  if (capabilityBlock) {
    request.status = "blocked";
    request.updatedAt = now;
    taskPackage.status = "blocked";
    taskPackage.updatedAt = now;
    state.updatedAt = now;
    throw new AicsMainFlowGateError(capabilityBlock);
  }
  const missingAuthorization =
    !request.roleListingId || !request.entitlementId || request.confirmExecution !== true;
  if (missingAuthorization) {
    request.status = "blocked";
    request.updatedAt = now;
    taskPackage.status = "blocked";
    taskPackage.updatedAt = now;
    state.updatedAt = now;
    throw new AicsMainFlowGateError({
      stage: "role",
      code: "authorization_required",
      message:
        "岗位执行需要先完成岗位授权和人工执行确认。请到「费用与授权」确认 roleListingId、entitlementId 和 confirmExecution 后再运行。",
    });
  }
  if (request.costConfirmed !== true) {
    request.status = "blocked";
    request.updatedAt = now;
    taskPackage.status = "blocked";
    taskPackage.updatedAt = now;
    state.updatedAt = now;
    throw new AicsMainFlowGateError({
      stage: "role",
      code: "cost_not_confirmed",
      message: "岗位执行需要先确认本次费用。请到「费用与授权」确认 costConfirmed 后再运行。",
    });
  }
  if (input.ledgerRef) {
    request.ledgerRef = input.ledgerRef;
  }
  const effectiveLedgerRef = input.ledgerRef ?? request.ledgerRef;
  const artifactRefs = [
    ...(input.result?.artifactRefs ? [...input.result.artifactRefs] : []),
    ...(effectiveLedgerRef ? [effectiveLedgerRef] : []),
  ];
  const successEvidenceGaps = input.result
    ? productionSuccessEvidenceGaps({
        result: input.result,
        artifactRefs,
        effectiveLedgerRef,
        request,
      })
    : [];
  const effectiveOutcome: RoleResult["outcome"] =
    input.result && input.result.outcome === "succeeded" && successEvidenceGaps.length
      ? "blocked"
      : (input.result?.outcome ?? "blocked");
  const effectiveResultStatus = effectiveOutcome === "succeeded" ? "completed" : effectiveOutcome;
  const effectiveExecutionEvidence =
    input.result && successEvidenceGaps.length
      ? ({
          ...(input.result.executionEvidence ?? {}),
          recoverySuggestion: `岗位执行证据不完整，不能显示完成：${successEvidenceGaps.join("；")}`,
          validation: {
            ...(input.result.executionEvidence?.validation ?? {}),
            passed: false,
            checkedContracts: input.result.executionEvidence?.validation?.checkedContracts ?? [],
            failures: [
              ...(input.result.executionEvidence?.validation?.failures ?? []),
              ...successEvidenceGaps,
            ],
          },
        } satisfies NonNullable<RoleResult["executionEvidence"]>)
      : input.result?.executionEvidence;
  request.status = input.result ? effectiveResultStatus : "running";
  request.updatedAt = now;
  taskPackage.status = input.result ? effectiveResultStatus : "running";
  taskPackage.updatedAt = now;
  const roleResult: RoleResult | null = input.result
    ? {
        kind: "RoleResult" as const,
        id: makeId("role_result", input.result.id),
        status: effectiveResultStatus,
        ...timestamps(now),
        auditRefs: auditRefs(input.result),
        taskPackageId: taskPackage.id,
        dispatchToRoleRequestId: request.id,
        outcome: effectiveOutcome,
        summary: successEvidenceGaps.length
          ? `岗位执行被阻塞：${successEvidenceGaps.join("；")}`
          : input.result.summary,
        artifactRefs,
        ...(effectiveExecutionEvidence ? { executionEvidence: effectiveExecutionEvidence } : {}),
      }
    : null;
  if (roleResult) {
    state.roleResults.push(roleResult);
  }
  state.updatedAt = now;
  return { dispatchToRoleRequest: request, roleResult };
}

export function recordRoleResultEvidenceReadback(
  state: AicsMainFlowState,
  input: {
    executionId?: string;
    auditReadback?: Record<string, unknown> | null;
    ledgerReadback?: Record<string, unknown> | null;
  },
  now = Date.now(),
): RoleResult | null {
  const executionId = input.executionId?.trim();
  const auditExecutionId =
    typeof input.auditReadback?.executionId === "string"
      ? input.auditReadback.executionId.trim()
      : "";
  const ledgerExecutionId =
    typeof input.ledgerReadback?.executionId === "string"
      ? input.ledgerReadback.executionId.trim()
      : "";
  const effectiveExecutionId = executionId || auditExecutionId || ledgerExecutionId;
  const auditRecordId =
    typeof input.auditReadback?.auditRecordId === "string"
      ? input.auditReadback.auditRecordId.trim()
      : "";
  const ledgerRef =
    typeof input.ledgerReadback?.ledgerRef === "string"
      ? input.ledgerReadback.ledgerRef.trim()
      : "";
  const roleResult = state.roleResults.find((result) => {
    const evidence = result.executionEvidence;
    return (
      (effectiveExecutionId &&
        (result.id === effectiveExecutionId ||
          result.id === `role_result_${effectiveExecutionId}` ||
          evidence?.executionId === effectiveExecutionId)) ||
      (auditRecordId &&
        result.artifactRefs.some(
          (ref) => ref === `audit:${auditRecordId}` || ref === auditRecordId,
        )) ||
      (ledgerRef &&
        (evidence?.ledgerRef === ledgerRef || result.artifactRefs.some((ref) => ref === ledgerRef)))
    );
  });
  if (!roleResult) return null;
  roleResult.executionEvidence = {
    ...(roleResult.executionEvidence ?? {}),
    ...(effectiveExecutionId ? { executionId: effectiveExecutionId } : {}),
    ...(input.auditReadback ? { auditReadback: input.auditReadback } : {}),
    ...(input.ledgerReadback ? { ledgerReadback: input.ledgerReadback } : {}),
  };
  roleResult.updatedAt = now;
  state.updatedAt = now;
  return roleResult;
}

// ═══ SQLite persistence ═══

function loadStateFromSqlite(): AicsMainFlowState {
  const db = getPipelineDb();
  const all = (sql: string, ...params: unknown[]): Record<string, unknown>[] =>
    db.prepare(sql).all(...(params as any)) as Record<string, unknown>[];

  const observations: ObservationPackage[] = [];
  for (const row of all("SELECT * FROM observations ORDER BY created_at")) {
    const signals = all("SELECT * FROM observation_signals WHERE observation_id = ?", row.id);
    observations.push({
      kind: "ObservationPackage",
      id: row.id as string,
      status: row.status as ObservationPackage["status"],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      auditRefs: JSON.parse((row.audit_refs as string) || "[]"),
      title: row.title as string,
      summary: row.summary as string,
      signals: signals.map((s) => ({
        id: s.id as string,
        title: s.title as string,
        summary: s.summary as string,
        evidenceRefs: JSON.parse((s.evidence_refs as string) || "[]"),
      })),
    });
  }
  const observationEvidenceRuns = all(
    "SELECT * FROM observation_evidence_runs ORDER BY created_at",
  ).map((row) => ({
    id: row.id as string,
    planId: row.plan_id as string,
    status: row.status as "completed" | "blocked" | "failed",
    ...(row.observation_package_id
      ? { observationPackageId: row.observation_package_id as string }
      : {}),
    acceptedCount: Number(row.accepted_count ?? 0),
    needsReviewCount: Number(row.needs_review_count ?? 0),
    rejectedCount: Number(row.rejected_count ?? 0),
    missingCount: Number(row.missing_count ?? 0),
    blockedReasons: parseStringArray(row.blocked_reasons),
    runResultJson: (row.run_result_json as string) || "{}",
    createdAt: Number(row.created_at ?? Date.now()),
  }));

  const attributions: AttributionReport[] = [];
  for (const row of all("SELECT * FROM attributions ORDER BY created_at")) {
    const findings = all("SELECT * FROM attribution_findings WHERE attribution_id = ?", row.id);
    attributions.push({
      kind: "AttributionReport",
      id: row.id as string,
      status: row.status as AttributionReport["status"],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      auditRefs: JSON.parse((row.audit_refs as string) || "[]"),
      observationPackageId: row.observation_package_id as string,
      title: row.title as string,
      summary: row.summary as string,
      findings: findings.map((f) => ({
        id: f.id as string,
        title: f.title as string,
        summary: f.summary as string,
        confidence: f.confidence as "low" | "medium" | "high",
        observationSignalIds: JSON.parse((f.observation_signal_ids as string) || "[]"),
      })),
    });
  }

  const goals: CompanyGoal[] = all("SELECT * FROM goals ORDER BY created_at").map((row) => {
    const blockedReasons = parseStringArray(row.blocked_reasons);
    return {
      kind: "CompanyGoal" as const,
      id: row.id as string,
      status: row.status as CompanyGoal["status"],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      auditRefs: JSON.parse((row.audit_refs as string) || "[]"),
      attributionReportId: row.attribution_report_id as string,
      observationPackageId: row.observation_package_id as string | undefined,
      title: row.title as string,
      owner: row.owner as string,
      metric: row.metric as string,
      ...(row.current_value ? { currentValue: row.current_value as string } : {}),
      target: row.target as string,
      ...(row.cycle ? { cycle: row.cycle as string } : {}),
      rationale: row.rationale as string,
      ...(row.why_now ? { whyNow: row.why_now as string } : {}),
      sourceObservationSignalIds: parseStringArray(row.source_observation_signal_ids),
      sourceAttributionFindingIds: parseStringArray(row.source_attribution_finding_ids),
      blockedReasons,
      readyForPlanning: Boolean(row.ready_for_planning) || blockedReasons.length === 0,
    };
  });

  const planningPackages: PlanningPackage[] = [];
  for (const row of all("SELECT * FROM planning_packages ORDER BY created_at")) {
    const items = all("SELECT * FROM role_plan_items WHERE planning_package_id = ?", row.id);
    planningPackages.push({
      kind: "PlanningPackage",
      id: row.id as string,
      status: row.status as PlanningPackage["status"],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      auditRefs: JSON.parse((row.audit_refs as string) || "[]"),
      goalId: row.goal_id as string,
      title: row.title as string,
      summary: row.summary as string,
      rolePlanItemIds: items.map((r) => r.id as string),
      revision: Number(row.revision ?? 1),
      ...(row.source_observation_package_id
        ? { sourceObservationPackageId: row.source_observation_package_id as string }
        : {}),
      ...(row.source_attribution_report_id
        ? { sourceAttributionReportId: row.source_attribution_report_id as string }
        : {}),
      ...(row.status_reason ? { statusReason: row.status_reason as string } : {}),
      ...(row.superseded_by_planning_package_id
        ? { supersededByPlanningPackageId: row.superseded_by_planning_package_id as string }
        : {}),
    });
  }

  const allRolePlanItems: RolePlanItem[] = all(
    "SELECT * FROM role_plan_items ORDER BY created_at",
  ).map((row) => ({
    kind: "RolePlanItem",
    id: row.id as string,
    status: row.status as RolePlanItem["status"],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    auditRefs: JSON.parse((row.audit_refs as string) || "[]"),
    planningPackageId: row.planning_package_id as string,
    title: row.title as string,
    ...(row.category ? { category: row.category as string } : {}),
    roleCapabilityRef: row.role_capability_ref as string,
    taskIntent: row.task_intent as string,
    expectedOutput: row.expected_output as string,
    humanConfirmationRequired: Boolean(row.human_confirmation_required),
    sourceSignalIds: parseStringArray(row.source_signal_ids),
    sourceFindingIds: parseStringArray(row.source_finding_ids),
    dispatchStatus: (row.dispatch_status as RolePlanItem["dispatchStatus"]) ?? "not_dispatched",
    dispatchProposalIds: parseStringArray(row.dispatch_proposal_ids),
    ...(row.capability_match_summary
      ? { capabilityMatchSummary: row.capability_match_summary as string }
      : {}),
    blockedReasons: parseStringArray(row.blocked_reasons),
    acceptanceCriteria: parseStringArray(row.acceptance_criteria),
  }));

  const dispatchProposalReviews: DispatchProposalReview[] = all(
    "SELECT * FROM dispatch_proposal_reviews ORDER BY created_at",
  ).map((row) => ({
    kind: "DispatchProposalReview" as const,
    id: row.id as string,
    status: row.status as DispatchProposalReview["status"],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    auditRefs: JSON.parse((row.audit_refs as string) || "[]"),
    planningPackageId: row.planning_package_id as string,
    rolePlanItemId: row.role_plan_item_id as string,
    title: row.title as string,
    riskSummary: row.risk_summary as string,
    confirmationSummary: row.confirmation_summary as string,
  }));

  const taskPackages: TaskPackage[] = all("SELECT * FROM task_packages ORDER BY created_at").map(
    (row) => ({
      kind: "TaskPackage" as const,
      id: row.id as string,
      status: row.status as TaskPackage["status"],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      auditRefs: JSON.parse((row.audit_refs as string) || "[]"),
      goalId: row.goal_id as string,
      planningPackageId: row.planning_package_id as string,
      rolePlanItemId: row.role_plan_item_id as string,
      dispatchProposalReviewId: row.dispatch_proposal_review_id as string,
      title: row.title as string,
      taskText: row.task_text as string,
      ...(row.category ? { category: row.category as string } : {}),
      requiredCapabilityRefs: parseStringArray(row.required_capability_refs),
    }),
  );

  const dispatchToRoleRequests: DispatchToRoleRequest[] = all(
    "SELECT * FROM dispatch_to_role_requests ORDER BY created_at",
  ).map((row) => {
    const r: DispatchToRoleRequest = {
      kind: "DispatchToRoleRequest" as const,
      id: row.id as string,
      status: row.status as DispatchToRoleRequest["status"],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      auditRefs: JSON.parse((row.audit_refs as string) || "[]"),
      taskPackageId: row.task_package_id as string,
      rolePlanItemId: row.role_plan_item_id as string,
      ...(row.category_capability_id
        ? { categoryCapabilityId: row.category_capability_id as string }
        : {}),
      ...(row.category ? { category: row.category as string } : {}),
      requiredCapabilityRefs: parseStringArray(row.required_capability_refs),
      allowedTools: parseStringArray(row.allowed_tools),
      allowedSkills: parseStringArray(row.allowed_skills),
      capabilityBlockedReasons: normalizeCapabilityBlockedReasons(
        parseStringArray(row.capability_blocked_reasons),
      ),
      ...(row.capability_request_id
        ? { capabilityRequestId: row.capability_request_id as string }
        : {}),
      confirmExecution: Boolean(row.confirm_execution),
      costConfirmed: Boolean(row.cost_confirmed),
      toolSkillReady: row.tool_skill_ready === undefined ? true : Boolean(row.tool_skill_ready),
      apiBindingReady: row.api_binding_ready === undefined ? true : Boolean(row.api_binding_ready),
    };
    if (row.role_listing_id) r.roleListingId = row.role_listing_id as string;
    if (row.role_title) r.roleTitle = row.role_title as string;
    if (row.entitlement_id) r.entitlementId = row.entitlement_id as string;
    if (row.workspace_dir) r.workspaceDir = row.workspace_dir as string;
    if (row.ledger_ref) r.ledgerRef = row.ledger_ref as string;
    return r;
  });

  const roleResults: RoleResult[] = all("SELECT * FROM role_results ORDER BY created_at").map(
    (row) => ({
      kind: "RoleResult" as const,
      id: row.id as string,
      status: row.status as RoleResult["status"],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      auditRefs: JSON.parse((row.audit_refs as string) || "[]"),
      taskPackageId: row.task_package_id as string,
      dispatchToRoleRequestId: row.dispatch_to_role_request_id as string,
      outcome: row.outcome as RoleResult["outcome"],
      summary: row.summary as string,
      artifactRefs: JSON.parse((row.artifact_refs as string) || "[]"),
      ...parseOptionalJsonField<RoleResult["executionEvidence"], "executionEvidence">(
        row.execution_evidence,
        "executionEvidence",
      ),
    }),
  );

  // managementBreakdown
  const workBlocks = all("SELECT * FROM work_blocks WHERE is_stale = 0 ORDER BY created_at").map(
    (r) => ({
      id: r.id as string,
      goalId: r.goal_id as string,
      name: r.name as string,
      purpose: r.purpose as string,
      progressGauge: r.progress_gauge as string,
      status: r.status as string,
      blockedReason: r.blocked_reason as string | undefined,
      nextConfirm: r.next_confirm as string | undefined,
      revision: r.revision as number,
      isStale: Boolean(r.is_stale),
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    }),
  );
  const workBlockRoles = all("SELECT * FROM work_block_roles ORDER BY created_at").map((r) => ({
    id: r.id as string,
    workBlockId: r.work_block_id as string,
    roleListingId: r.role_listing_id as string,
    roleTitle: r.role_title as string,
    status: r.status as string,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }));
  const workBlockTaskCandidates = all(
    "SELECT * FROM work_block_task_candidates ORDER BY created_at",
  ).map((r) => ({
    id: r.id as string,
    workBlockId: r.work_block_id as string,
    roleId: r.role_id as string | undefined,
    title: r.title as string,
    targetDeliverable: r.target_deliverable as string,
    status: r.status as string,
    completionPct: r.completion_pct as number,
    blockedReason: r.blocked_reason as string | undefined,
    nextConfirm: r.next_confirm as string | undefined,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }));

  return {
    version: AICS_MAIN_FLOW_VERSION,
    updatedAt: Date.now(),
    interactions: [],
    observations,
    observationEvidenceRuns,
    attributions,
    goals,
    planningPackages,
    rolePlanItems: allRolePlanItems,
    dispatchProposalReviews,
    taskPackages,
    dispatchToRoleRequests,
    roleResults,
    workBlocks,
    workBlockRoles,
    workBlockTaskCandidates,
  };
}

function syncStateToSqlite(state: AicsMainFlowState): void {
  const db = getPipelineDb();
  const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as any));

  for (const t of [
    "role_results",
    "dispatch_to_role_requests",
    "task_packages",
    "dispatch_proposal_reviews",
    "role_plan_items",
    "planning_packages",
    "work_block_task_candidates",
    "work_block_roles",
    "work_blocks",
    "goals",
    "attribution_findings",
    "attributions",
    "observation_signals",
    "observation_evidence_runs",
    "observations",
  ]) {
    run(`DELETE FROM ${t}`);
  }

  for (const o of state.observations) {
    run(
      "INSERT INTO observations(id,status,title,summary,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?)",
      o.id,
      o.status,
      o.title,
      o.summary,
      o.createdAt,
      o.updatedAt,
      JSON.stringify(o.auditRefs),
    );
    for (const s of o.signals)
      run(
        "INSERT INTO observation_signals(id,observation_id,title,summary,evidence_refs) VALUES(?,?,?,?,?)",
        s.id,
        o.id,
        s.title,
        s.summary,
        JSON.stringify(s.evidenceRefs),
      );
  }
  for (const runItem of state.observationEvidenceRuns ?? []) {
    run(
      "INSERT INTO observation_evidence_runs(id,plan_id,status,observation_package_id,accepted_count,needs_review_count,rejected_count,missing_count,blocked_reasons,run_result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      runItem.id,
      runItem.planId,
      runItem.status,
      runItem.observationPackageId ?? null,
      runItem.acceptedCount,
      runItem.needsReviewCount,
      runItem.rejectedCount,
      runItem.missingCount,
      JSON.stringify(runItem.blockedReasons),
      runItem.runResultJson,
      runItem.createdAt,
    );
  }
  for (const a of state.attributions) {
    run(
      "INSERT INTO attributions(id,status,observation_package_id,title,summary,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?)",
      a.id,
      a.status,
      a.observationPackageId,
      a.title,
      a.summary,
      a.createdAt,
      a.updatedAt,
      JSON.stringify(a.auditRefs),
    );
    for (const f of a.findings)
      run(
        "INSERT INTO attribution_findings(id,attribution_id,title,summary,confidence,observation_signal_ids) VALUES(?,?,?,?,?,?)",
        f.id,
        a.id,
        f.title,
        f.summary,
        f.confidence,
        JSON.stringify(f.observationSignalIds),
      );
  }
  for (const g of state.goals)
    run(
      "INSERT INTO goals(id,status,attribution_report_id,observation_package_id,title,owner,metric,current_value,target,cycle,rationale,why_now,source_observation_signal_ids,source_attribution_finding_ids,blocked_reasons,ready_for_planning,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      g.id,
      g.status,
      g.attributionReportId,
      g.observationPackageId ?? null,
      g.title,
      g.owner,
      g.metric,
      g.currentValue ?? null,
      g.target,
      g.cycle ?? null,
      g.rationale,
      g.whyNow ?? null,
      JSON.stringify(g.sourceObservationSignalIds ?? []),
      JSON.stringify(g.sourceAttributionFindingIds ?? []),
      JSON.stringify(g.blockedReasons ?? []),
      g.readyForPlanning === false ? 0 : 1,
      g.createdAt,
      g.updatedAt,
      JSON.stringify(g.auditRefs),
    );
  for (const p of state.planningPackages)
    run(
      "INSERT INTO planning_packages(id,status,goal_id,title,summary,revision,source_observation_package_id,source_attribution_report_id,status_reason,superseded_by_planning_package_id,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      p.id,
      p.status,
      p.goalId,
      p.title,
      p.summary,
      p.revision ?? 1,
      p.sourceObservationPackageId ?? null,
      p.sourceAttributionReportId ?? null,
      p.statusReason ?? null,
      p.supersededByPlanningPackageId ?? null,
      p.createdAt,
      p.updatedAt,
      JSON.stringify(p.auditRefs),
    );
  for (const r of state.rolePlanItems)
    run(
      "INSERT INTO role_plan_items(id,status,planning_package_id,title,category,role_capability_ref,task_intent,expected_output,human_confirmation_required,source_signal_ids,source_finding_ids,dispatch_status,dispatch_proposal_ids,capability_match_summary,blocked_reasons,acceptance_criteria,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      r.id,
      r.status,
      r.planningPackageId,
      r.title,
      r.category ?? null,
      r.roleCapabilityRef,
      r.taskIntent,
      r.expectedOutput,
      r.humanConfirmationRequired ? 1 : 0,
      JSON.stringify(r.sourceSignalIds ?? []),
      JSON.stringify(r.sourceFindingIds ?? []),
      r.dispatchStatus ?? "not_dispatched",
      JSON.stringify(r.dispatchProposalIds ?? []),
      r.capabilityMatchSummary ?? null,
      JSON.stringify(r.blockedReasons ?? []),
      JSON.stringify(r.acceptanceCriteria ?? []),
      r.createdAt,
      r.updatedAt,
      JSON.stringify(r.auditRefs),
    );
  for (const d of state.dispatchProposalReviews)
    run(
      "INSERT INTO dispatch_proposal_reviews(id,status,planning_package_id,role_plan_item_id,title,risk_summary,confirmation_summary,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?)",
      d.id,
      d.status,
      d.planningPackageId,
      d.rolePlanItemId,
      d.title,
      d.riskSummary,
      d.confirmationSummary,
      d.createdAt,
      d.updatedAt,
      JSON.stringify(d.auditRefs),
    );
  for (const t of state.taskPackages)
    run(
      "INSERT INTO task_packages(id,status,goal_id,planning_package_id,role_plan_item_id,dispatch_proposal_review_id,title,task_text,category,required_capability_refs,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      t.id,
      t.status,
      t.goalId,
      t.planningPackageId,
      t.rolePlanItemId,
      t.dispatchProposalReviewId,
      t.title,
      t.taskText,
      t.category ?? null,
      JSON.stringify(t.requiredCapabilityRefs ?? []),
      t.createdAt,
      t.updatedAt,
      JSON.stringify(t.auditRefs),
    );
  for (const r of state.dispatchToRoleRequests)
    run(
      "INSERT INTO dispatch_to_role_requests(id,status,task_package_id,role_plan_item_id,role_listing_id,role_title,entitlement_id,workspace_dir,category_capability_id,category,required_capability_refs,allowed_tools,allowed_skills,capability_blocked_reasons,capability_request_id,confirm_execution,cost_confirmed,ledger_ref,tool_skill_ready,api_binding_ready,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      r.id,
      r.status,
      r.taskPackageId,
      r.rolePlanItemId,
      r.roleListingId ?? null,
      r.roleTitle ?? null,
      r.entitlementId ?? null,
      r.workspaceDir ?? null,
      r.categoryCapabilityId ?? null,
      r.category ?? null,
      JSON.stringify(r.requiredCapabilityRefs ?? []),
      JSON.stringify(r.allowedTools ?? []),
      JSON.stringify(r.allowedSkills ?? []),
      JSON.stringify(r.capabilityBlockedReasons ?? []),
      r.capabilityRequestId ?? null,
      r.confirmExecution ? 1 : 0,
      r.costConfirmed ? 1 : 0,
      r.ledgerRef ?? null,
      r.toolSkillReady === false ? 0 : 1,
      r.apiBindingReady === false ? 0 : 1,
      r.createdAt,
      r.updatedAt,
      JSON.stringify(r.auditRefs),
    );
  for (const r of state.roleResults)
    run(
      "INSERT INTO role_results(id,status,task_package_id,dispatch_to_role_request_id,outcome,summary,artifact_refs,execution_evidence,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      r.id,
      r.status,
      r.taskPackageId,
      r.dispatchToRoleRequestId,
      r.outcome,
      r.summary,
      JSON.stringify(r.artifactRefs),
      r.executionEvidence ? JSON.stringify(r.executionEvidence) : null,
      r.createdAt,
      r.updatedAt,
      JSON.stringify(r.auditRefs),
    );

  // managementBreakdown
  for (const w of state.workBlocks ?? [])
    run(
      "INSERT INTO work_blocks(id,goal_id,name,purpose,progress_gauge,status,blocked_reason,next_confirm,revision,is_stale,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      w.id,
      w.goalId,
      w.name,
      w.purpose,
      w.progressGauge,
      w.status,
      w.blockedReason ?? null,
      w.nextConfirm ?? null,
      w.revision,
      w.isStale ? 1 : 0,
      w.createdAt,
      w.updatedAt,
    );
  for (const r of state.workBlockRoles ?? [])
    run(
      "INSERT INTO work_block_roles(id,work_block_id,role_listing_id,role_title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      r.id,
      r.workBlockId,
      r.roleListingId,
      r.roleTitle,
      r.status,
      r.createdAt,
      r.updatedAt,
    );
  for (const t of state.workBlockTaskCandidates ?? [])
    run(
      "INSERT INTO work_block_task_candidates(id,work_block_id,role_id,title,target_deliverable,status,completion_pct,blocked_reason,next_confirm,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      t.id,
      t.workBlockId,
      t.roleId ?? null,
      t.title,
      t.targetDeliverable,
      t.status,
      t.completionPct,
      t.blockedReason ?? null,
      t.nextConfirm ?? null,
      t.createdAt,
      t.updatedAt,
    );
}

export class AicsMainFlowStore {
  constructor(
    private readonly statePath?: string,
    options: { initializeSchema?: boolean } = {},
  ) {
    if (!statePath && options.initializeSchema !== false) createPipelineTables();
  }
  private readState(): AicsMainFlowState {
    if (!this.statePath) return loadStateFromSqlite();
    if (!fs.existsSync(this.statePath)) return createEmptyAicsMainFlowState();
    return JSON.parse(fs.readFileSync(this.statePath, "utf8")) as AicsMainFlowState;
  }
  private writeState(state: AicsMainFlowState): void {
    if (!this.statePath) {
      syncStateToSqlite(state);
      return;
    }
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }
  readModel(): AicsMainFlowReadModel {
    return createAicsMainFlowReadModel(this.readState());
  }
  executionPreflight(input?: {
    taskPackageId?: string;
    dispatchToRoleRequestId?: string;
  }): AicsMainFlowExecutionPreflight {
    return getAicsMainFlowExecutionPreflight(this.readState(), input);
  }
  update<T>(mutate: (state: AicsMainFlowState) => T): T {
    const state = this.readState();
    const result = mutate(state);
    this.writeState(state);
    return result;
  }
}

// ═══ managementBreakdown ═══

export type WorkBlock = {
  id: string;
  goalId: string;
  name: string;
  purpose: string;
  progressGauge: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  blockedReason?: string;
  nextConfirm?: string;
  revision: number;
  isStale: boolean;
  createdAt: number;
  updatedAt: number;
};

export type WorkBlockRole = {
  id: string;
  workBlockId: string;
  roleListingId: string;
  roleTitle: string;
  status: "assigned" | "authorized" | "executing";
  createdAt: number;
  updatedAt: number;
};

export type WorkBlockTaskCandidate = {
  id: string;
  workBlockId: string;
  roleId?: string;
  title: string;
  targetDeliverable: string;
  status: "candidate" | "dispatched" | "running" | "completed";
  completionPct: number;
  blockedReason?: string;
  nextConfirm?: string;
  createdAt: number;
  updatedAt: number;
};

export function createWorkBlocks(
  state: AicsMainFlowState,
  goalId: string,
  blocks: Array<{
    name: string;
    purpose: string;
    progressGauge: string;
    roles?: Array<{ roleListingId: string; roleTitle: string }>;
    tasks?: Array<{ title: string; targetDeliverable: string }>;
  }>,
  now = Date.now(),
): WorkBlock[] {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) throw new Error(`Goal not found: ${goalId}`);
  if (goal.status !== "confirmed")
    throw new Error("只有已确认的 CompanyGoal 才能生成公司管理拆解。");

  // 旧拆解标记 stale
  for (const wb of state.workBlocks ?? []) {
    if (wb.goalId === goalId) wb.isStale = true;
  }
  const revision = (state.workBlocks?.filter((w) => w.goalId === goalId).length ?? 0) + 1;

  const results: WorkBlock[] = [];
  state.workBlocks = state.workBlocks ?? [];
  state.workBlockRoles = state.workBlockRoles ?? [];
  state.workBlockTaskCandidates = state.workBlockTaskCandidates ?? [];

  for (const b of blocks) {
    const wb: WorkBlock = {
      id: makeId("wb"),
      goalId,
      name: b.name,
      purpose: b.purpose,
      progressGauge: b.progressGauge,
      status: "pending",
      revision,
      isStale: false,
      createdAt: now,
      updatedAt: now,
    };
    state.workBlocks.push(wb);

    for (const r of b.roles ?? []) {
      state.workBlockRoles!.push({
        id: makeId("wbr"),
        workBlockId: wb.id,
        roleListingId: r.roleListingId,
        roleTitle: r.roleTitle,
        status: "assigned",
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const t of b.tasks ?? []) {
      state.workBlockTaskCandidates!.push({
        id: makeId("wbtc"),
        workBlockId: wb.id,
        title: t.title,
        targetDeliverable: t.targetDeliverable,
        status: "candidate",
        completionPct: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    results.push(wb);
  }
  state.updatedAt = now;
  return results;
}

export function listWorkBlocks(
  state: AicsMainFlowState,
  goalId: string,
): Array<WorkBlock & { roles: WorkBlockRole[]; tasks: WorkBlockTaskCandidate[] }> {
  return (state.workBlocks ?? [])
    .filter((w) => w.goalId === goalId)
    .map((w) => ({
      ...w,
      status: w.status as WorkBlock["status"],
      roles: (state.workBlockRoles ?? []).filter((r) => r.workBlockId === w.id) as WorkBlockRole[],
      tasks: (state.workBlockTaskCandidates ?? []).filter(
        (t) => t.workBlockId === w.id,
      ) as WorkBlockTaskCandidate[],
    })) as Array<WorkBlock & { roles: WorkBlockRole[]; tasks: WorkBlockTaskCandidate[] }>;
}

export function dispatchTaskCandidate(
  state: AicsMainFlowState,
  taskCandidateId: string,
  now = Date.now(),
): WorkBlockTaskCandidate {
  const task = (state.workBlockTaskCandidates ?? []).find((t) => t.id === taskCandidateId);
  if (!task) throw new Error(`Task candidate not found: ${taskCandidateId}`);
  task.status = "dispatched" as WorkBlockTaskCandidate["status"];
  task.updatedAt = now;
  state.updatedAt = now;
  return task as WorkBlockTaskCandidate;
}
