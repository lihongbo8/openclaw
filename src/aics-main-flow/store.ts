import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { getPipelineDb, createPipelineTables } from "./db.js";
import {
  AICS_MAIN_FLOW_VERSION,
  AicsMainFlowGateError,
  type AicsAuditRef,
  type AicsMainFlowBlockedReason,
  type AicsCapability,
  type AicsCapabilityMatchResult,
  type AicsMainFlowExecutionPreflight,
  type AicsMainFlowInteraction,
  type AicsMainFlowReadModel,
  type AicsMainFlowStage,
  type AicsMainFlowState,
  type AicsOperationCheck,
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
  target: string;
  rationale: string;
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
    }
  >;
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
  request?: EntityInput & {
    roleListingId?: string;
    roleTitle?: string;
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
  /** 记忆候选引用，可作为执行结果审计事实回写。 */
  memoryCandidateRef?: string;
  result?: EntityInput & {
    outcome: RoleResult["outcome"];
    summary: string;
    artifactRefs?: string[];
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
  return Boolean(observation?.status === "confirmed" && observationHasSignals(observation));
}

function attributionReadyForGoal(
  attribution: AttributionReport | null | undefined,
): attribution is AttributionReport {
  return Boolean(attribution?.status === "confirmed" && attribution.findings.length > 0);
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
    blockedReasons.push({
      stage: "role",
      code: "tool_skill_not_ready",
      message: "岗位执行需要工具权限和 Skill 就绪；独特能力 pending 时不能执行。",
    });
  }
  if (hasTaskPackage && hasDispatchToRoleRequest && !hasApiBinding) {
    blockedReasons.push({
      stage: "role",
      code: "api_binding_required",
      message: "岗位执行需要 API 绑定就绪。",
    });
  }
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
    blockedReasons,
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
  if (/电商|商品|主图|详情页|sku|商城|ecommerce/.test(source)) return "电商商品";
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
      "品类通用能力 = 已授权工具权限 + 通用 Skill，用于完成读取、分析、差距判断、建议和统一 JSON 输出。",
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
        reason: "品类通用能力只能覆盖读取、分析、建议和统一输出；该任务需要额外 tool/skill 授权。",
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
          ? "通用能力不足，必须先提交独特能力申请，确认 tool/skill 后才能执行。"
          : uniqueApproved
            ? "独特能力已通过工具与 Skill 管控批准，允许调度请求进入执行确认。"
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
        reason.code === "api_binding_required",
    );
  const artifactRefs = latestResult?.artifactRefs ?? [];
  const hasLedgerRef = artifactRefs.some((ref) => ref.startsWith("ledger:"));
  const hasMemoryCandidateRef = artifactRefs.some((ref) => ref.startsWith("memory_candidate:"));

  return [
    {
      id: "main_flow.observation",
      title: "经营概览到数据分析",
      layer: "main_flow",
      status: checkStatus(state.observations.length > 0, Boolean(state.interactions.length)),
      summary: "经营意图生成岗位商城观察包，覆盖岗位供给、授权转化、执行质量、费用和审核阻塞。",
      routeTab: "observation",
      nextAction:
        state.observations.length > 0 ? "查看数据分析包" : "在经营概览发起岗位商城经营意图",
    },
    {
      id: "main_flow.attribution",
      title: "数据分析到归因分析",
      layer: "main_flow",
      status: checkStatus(state.attributions.length > 0, readiness.canPrepareAttribution),
      summary: "归因层只解释岗位商城运营差距，不直接定目标或执行岗位。",
      routeTab: "attribution",
      nextAction: state.attributions.length > 0 ? "查看归因报告" : "基于观察信号生成归因报告",
    },
    {
      id: "main_flow.goal",
      title: "归因分析到公司目标",
      layer: "main_flow",
      status: checkStatus(Boolean(latestConfirmed(state.goals)), readiness.canCreateGoalCandidate),
      summary: "目标层确认提升首批岗位授权转化与执行成功率。",
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
      summary: "规划层拆成岗位供给、详情页转化、执行质量、授权费用和审核治理。",
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
      summary: "调度层是 TaskPackage 和 DispatchToRoleRequest 的唯一物化入口。",
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
      title: "工具与 Skill 核对",
      layer: "support",
      status: checkStatus(
        capabilities.matches.length > 0 && !hasCapabilityBlock,
        capabilities.matches.length > 0,
        hasCapabilityBlock,
      ),
      summary: "核对岗位所需能力是否已由通用品类能力、工具和 Skill 满足。",
      routeTab: "skills",
      ...(hasCapabilityBlock ? { blockedReason: "存在独特能力或 tool/skill 未满足项。" } : {}),
      nextAction: hasCapabilityBlock ? "到工具与 Skill 处理能力缺口" : "能力满足后返回任务调度",
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
      id: "support.memory_audit",
      title: "审计与记忆回写",
      layer: "support",
      status: checkStatus(hasMemoryCandidateRef, Boolean(latestResult)),
      summary: "核对 RoleResult、artifact、audit、ledger 和 memory candidate 是否形成回写证据。",
      routeTab: "businessOverview",
      nextAction: hasMemoryCandidateRef ? "查看回写证据" : "执行岗位后生成记忆候选引用",
    },
  ];
}

export function createAicsMainFlowReadModel(state: AicsMainFlowState): AicsMainFlowReadModel {
  const blockedReasons = getAicsMainFlowBlockedReasons(state);
  const currentStage = blockedReasons[0]?.stage ?? "role";
  const capabilities = buildCapabilityReadModel(state);
  const readiness = getReadiness(state);
  const executionPreflight = getAicsMainFlowExecutionPreflight(state);
  return {
    version: AICS_MAIN_FLOW_VERSION,
    updatedAt: state.updatedAt,
    currentStage,
    readiness,
    executionPreflight,
    blockedReasons,
    latest: {
      interaction: latestByCreatedAt(state.interactions),
      observationPackage: latestByCreatedAt(state.observations),
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
        "Confirmed ObservationPackage with at least one observation signal is required before attribution.",
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
    target: input.target,
    rationale: input.rationale,
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
  if (!goalId || !state.goals.some((item) => item.id === goalId && item.status === "confirmed")) {
    throw new AicsMainFlowGateError({
      stage: "goal",
      code: "missing_confirmed_company_goal",
      message: "A user-confirmed CompanyGoal is required before planning.",
    });
  }
  const planningPackageId = makeId("planning_pkg", input.id);
  const rolePlanItems: RolePlanItem[] = input.rolePlanItems.map((item) => ({
    kind: "RolePlanItem",
    id: makeId("role_plan_item", item.id),
    status: "prepared",
    ...timestamps(now),
    auditRefs: auditRefs(item),
    planningPackageId,
    title: item.title,
    ...(item.category ? { category: item.category } : {}),
    roleCapabilityRef: item.roleCapabilityRef,
    taskIntent: item.taskIntent,
    expectedOutput: item.expectedOutput,
    humanConfirmationRequired: item.humanConfirmationRequired ?? true,
  }));
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
  };
  state.planningPackages.push(planning);
  state.rolePlanItems.push(...rolePlanItems);
  state.updatedAt = now;
  return planning;
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
    if (planning.rolePlanItemIds.includes(item.id)) {
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
  const rolePlanItemId = input.rolePlanItemId ?? planning?.rolePlanItemIds[0];
  if (!planning || !rolePlanItemId || !planning.rolePlanItemIds.includes(rolePlanItemId)) {
    throw new AicsMainFlowGateError({
      stage: "planning",
      code: "missing_confirmed_planning_package",
      message: "A confirmed PlanningPackage with RolePlanItem entries is required before dispatch.",
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
  const taskPackage: TaskPackage = {
    kind: "TaskPackage",
    id: makeId("task_pkg", input.id),
    status: match?.status === "needs_unique_capability" ? "blocked" : "materialized",
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
    status: match?.status === "needs_unique_capability" ? "blocked" : "ready",
    ...timestamps(now),
    auditRefs: auditRefs(input.request),
    taskPackageId: taskPackage.id,
    rolePlanItemId: proposal.rolePlanItemId,
    category,
    requiredCapabilityRefs,
    allowedTools: match?.allowedTools ?? [],
    allowedSkills: match?.allowedSkills ?? [],
    ...(match?.uniqueCapabilityRequestId
      ? { capabilityRequestId: match.uniqueCapabilityRequestId }
      : {}),
    ...(input.request?.roleListingId ? { roleListingId: input.request.roleListingId } : {}),
    ...(input.request?.roleTitle ? { roleTitle: input.request.roleTitle } : {}),
    ...(input.request?.workspaceDir ? { workspaceDir: input.request.workspaceDir } : {}),
    confirmExecution: false,
    costConfirmed: false,
    toolSkillReady: match?.status !== "needs_unique_capability",
    apiBindingReady: true,
  };
  state.taskPackages.push(taskPackage);
  state.dispatchToRoleRequests.push(dispatchToRoleRequest);
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
    request.toolSkillReady = approved;
    request.status = approved ? "ready" : "blocked";
    request.updatedAt = now;
    if (approved) {
      request.allowedTools = Array.from(
        new Set([...(request.allowedTools ?? []), "tool.execute.category_specific"]),
      );
      const category = request.category ?? "通用品类";
      request.allowedSkills = Array.from(
        new Set([...(request.allowedSkills ?? []), `skill.${category}.specific_rules`]),
      );
    }
    updatedRequests.push(request);
    const task = state.taskPackages.find((item) => item.id === request.taskPackageId);
    if (task) {
      task.status = approved ? "materialized" : "blocked";
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
  if (taskPackage.status === "blocked" || request.status === "blocked") {
    if (request.capabilityRequestId) {
      throw new AicsMainFlowGateError({
        stage: "role",
        code: "missing_dispatch_to_role_request",
        message:
          "DispatchToRoleRequest is blocked by missing category capability. Confirm the required tool/skill capability before role execution.",
      });
    }
  }
  if (!request.roleListingId && input.roleListingId) {
    request.roleListingId = input.roleListingId;
  }
  if (!request.roleTitle && input.roleTitle) {
    request.roleTitle = input.roleTitle;
  }
  if (!request.entitlementId && input.entitlementId) {
    request.entitlementId = input.entitlementId;
  }
  if (input.confirmExecution === true) {
    request.confirmExecution = true;
  }
  if (input.costConfirmed === true) {
    request.costConfirmed = true;
  }
  if (input.ledgerRef) {
    request.ledgerRef = input.ledgerRef;
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
  request.status = input.result ? "completed" : "running";
  request.updatedAt = now;
  taskPackage.status = input.result ? "completed" : "running";
  taskPackage.updatedAt = now;
  const artifactRefs = [
    ...(input.result?.artifactRefs ? [...input.result.artifactRefs] : []),
    ...(request.ledgerRef ? [request.ledgerRef] : []),
    ...(input.memoryCandidateRef ? [input.memoryCandidateRef] : []),
  ];
  const roleResult: RoleResult | null = input.result
    ? {
        kind: "RoleResult" as const,
        id: makeId("role_result", input.result.id),
        status: input.result.outcome === "succeeded" ? "completed" : input.result.outcome,
        ...timestamps(now),
        auditRefs: auditRefs(input.result),
        taskPackageId: taskPackage.id,
        dispatchToRoleRequestId: request.id,
        outcome: input.result.outcome,
        summary: input.result.summary,
        artifactRefs,
      }
    : null;
  if (roleResult) {
    state.roleResults.push(roleResult);
  }
  state.updatedAt = now;
  return { dispatchToRoleRequest: request, roleResult };
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

  const goals: CompanyGoal[] = all("SELECT * FROM goals ORDER BY created_at").map((row) => ({
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
    target: row.target as string,
    rationale: row.rationale as string,
  }));

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
      ...(row.category ? { category: row.category as string } : {}),
      requiredCapabilityRefs: parseStringArray(row.required_capability_refs),
      allowedTools: parseStringArray(row.allowed_tools),
      allowedSkills: parseStringArray(row.allowed_skills),
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
      "INSERT INTO goals(id,status,attribution_report_id,observation_package_id,title,owner,metric,target,rationale,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      g.id,
      g.status,
      g.attributionReportId,
      g.observationPackageId ?? null,
      g.title,
      g.owner,
      g.metric,
      g.target,
      g.rationale,
      g.createdAt,
      g.updatedAt,
      JSON.stringify(g.auditRefs),
    );
  for (const p of state.planningPackages)
    run(
      "INSERT INTO planning_packages(id,status,goal_id,title,summary,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?)",
      p.id,
      p.status,
      p.goalId,
      p.title,
      p.summary,
      p.createdAt,
      p.updatedAt,
      JSON.stringify(p.auditRefs),
    );
  for (const r of state.rolePlanItems)
    run(
      "INSERT INTO role_plan_items(id,status,planning_package_id,title,category,role_capability_ref,task_intent,expected_output,human_confirmation_required,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      r.id,
      r.status,
      r.planningPackageId,
      r.title,
      r.category ?? null,
      r.roleCapabilityRef,
      r.taskIntent,
      r.expectedOutput,
      r.humanConfirmationRequired ? 1 : 0,
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
      "INSERT INTO dispatch_to_role_requests(id,status,task_package_id,role_plan_item_id,role_listing_id,role_title,entitlement_id,workspace_dir,category,required_capability_refs,allowed_tools,allowed_skills,capability_request_id,confirm_execution,cost_confirmed,ledger_ref,tool_skill_ready,api_binding_ready,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      r.id,
      r.status,
      r.taskPackageId,
      r.rolePlanItemId,
      r.roleListingId ?? null,
      r.roleTitle ?? null,
      r.entitlementId ?? null,
      r.workspaceDir ?? null,
      r.category ?? null,
      JSON.stringify(r.requiredCapabilityRefs ?? []),
      JSON.stringify(r.allowedTools ?? []),
      JSON.stringify(r.allowedSkills ?? []),
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
      "INSERT INTO role_results(id,status,task_package_id,dispatch_to_role_request_id,outcome,summary,artifact_refs,created_at,updated_at,audit_refs) VALUES(?,?,?,?,?,?,?,?,?,?)",
      r.id,
      r.status,
      r.taskPackageId,
      r.dispatchToRoleRequestId,
      r.outcome,
      r.summary,
      JSON.stringify(r.artifactRefs),
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
  constructor(private readonly statePath?: string) {
    if (!statePath) createPipelineTables();
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
