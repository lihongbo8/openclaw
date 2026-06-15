import type { AppViewState } from "../app-view-state.js";

type AicsMainFlowReadModel = {
  version: number;
  updatedAt: number;
  currentStage: string;
  readiness: Record<string, boolean>;
  blockedReasons: Array<{ stage: string; code: string; message: string }>;
  latest: Record<string, { title?: string; summary?: string } | null>;
  counts: Record<string, number>;
  operationChecks?: Array<{
    id: string;
    title: string;
    layer: "main_flow" | "support";
    status: "ready" | "waiting" | "blocked" | "done";
    summary: string;
    routeTab: string;
    blockedReason?: string;
    nextAction: string;
  }>;
};

function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

const MARKETPLACE_OBSERVATION_DOMAINS = [
  {
    id: "cloud_marketplace",
    title: "云端岗位商城观察",
    summary: "观察岗位商品、审核、能力、授权、可调用状态和云端 blocked reason。",
  },
  {
    id: "local_openclaw",
    title: "本地 OpenClaw 运行观察",
    summary: "观察 Gateway、actor_context、API 管理、模型 Provider、工具、Skill 和本地能力路由。",
  },
  {
    id: "role_supply_capability",
    title: "岗位供给与能力观察",
    summary: "观察已有岗位覆盖、缺失岗位、通用能力、独特能力、未授权或不可调用岗位。",
  },
  {
    id: "operator_usage",
    title: "用户/管理者使用观察",
    summary: "观察配置、保存、回显、错误提示、确认/驳回、下一步导航是否真实可用。",
  },
  {
    id: "dispatch_execution_chain",
    title: "调度与执行链路观察",
    summary:
      "观察 CompanyGoal、PlanningPackage、TaskPackage、DispatchToRoleRequest、RoleRun、RoleResult 和产物回写。",
  },
  {
    id: "external_product_competitor",
    title: "外部产品与竞品观察",
    summary: "观察其他 Agent marketplace、插件市场、工具市场、模型控制台、工作流平台的产品做法。",
  },
  {
    id: "external_technology_tool_model",
    title: "外部技术/工具/模型观察",
    summary:
      "观察 DeepSeek、阿里百炼、OpenAI、Anthropic、Gemini、本地模型、浏览器自动化、搜索、文档解析、质检和监控能力。",
  },
  {
    id: "absorbable_capability_library",
    title: "可吸收能力库观察",
    summary: "观察本地开源岗位库、已筛选岗位、工作流模板、Skill/Tool 需求和岗位商品候选。",
  },
  {
    id: "risk_data_quality",
    title: "风险与数据质量观察",
    summary:
      "观察供应商稳定性、模型成本、Key 泄漏、scope 过大、actor_context 缺失、工具越权、外部信息可信度和数据过期冲突。",
  },
] as const;

const MARKETPLACE_ATTRIBUTION_CAUSES = [
  {
    id: "cloud_marketplace_problem",
    title: "云端商城问题",
    summary: "岗位商品、审核、能力、授权、可调用状态或云端 blocked reason 影响目标完成。",
  },
  {
    id: "local_openclaw_problem",
    title: "本地 OpenClaw 问题",
    summary:
      "Gateway、actor_context、API 管理、模型 Provider、工具、Skill 或本地能力路由影响使用。",
  },
  {
    id: "role_supply_problem",
    title: "岗位供给问题",
    summary: "岗位数量、品类覆盖、岗位能力、审核状态或可调用性不足。",
  },
  {
    id: "authorization_billing_problem",
    title: "授权与费用问题",
    summary: "岗位未授权、授权过期、费用确认或额度状态阻塞执行。",
  },
  {
    id: "capability_routing_problem",
    title: "能力路由问题",
    summary: "任务所需能力和岗位能力、工具、Skill 匹配不足。",
  },
  {
    id: "api_model_tool_skill_problem",
    title: "API / 模型 / 工具 / Skill 问题",
    summary: "Provider、API Key、工具依赖、Skill 启用状态或真实工具执行能力不满足。",
  },
  {
    id: "product_experience_problem",
    title: "页面体验问题",
    summary: "管理后台配置、保存、回显、错误提示、确认动作或下一步导航不清晰。",
  },
  {
    id: "dispatch_chain_problem",
    title: "调度链路问题",
    summary: "目标、规划、调度建议、TaskPackage、DispatchToRoleRequest 的链路断裂或状态不清。",
  },
  {
    id: "role_execution_quality_problem",
    title: "岗位执行质量问题",
    summary: "岗位执行失败、产物不合格、回写失败、返工过多或结果不可验收。",
  },
  {
    id: "external_capability_absorption_gap",
    title: "外部能力未吸收",
    summary: "外部岗位、工具、工作流、模型能力或产品设计未进入 OpenClaw 候选能力池。",
  },
  {
    id: "external_product_pressure",
    title: "外部竞品/产品压力",
    summary: "其他 Agent marketplace、插件市场、工具市场或模型平台在能力和体验上形成压力。",
  },
  {
    id: "risk_data_quality_problem",
    title: "风险与数据质量问题",
    summary: "供应商、合规、安全、成本、权限或低可信/过期/冲突数据影响判断。",
  },
  {
    id: "goal_setting_problem",
    title: "目标设定问题",
    summary: "目标缺少基线、指标口径不清、目标值过高或没有覆盖外部机会和风险。",
  },
] as const;

function buildMarketplaceObservationSignals(intent: string, evidenceRef: string) {
  return [
    {
      id: "business_intent",
      title: "经营意图",
      summary: intent,
      evidenceRefs: [evidenceRef],
    },
    ...MARKETPLACE_OBSERVATION_DOMAINS.map((domain) => ({
      id: domain.id,
      title: domain.title,
      summary: domain.summary,
      evidenceRefs: [evidenceRef],
    })),
  ];
}

function buildMarketplaceAttributionFindings(signals: Array<Record<string, unknown>>) {
  const signalIds = signals.map((signal) => text(signal.id)).filter(Boolean);
  const hasSignal = (id: string) => signalIds.includes(id);
  return MARKETPLACE_ATTRIBUTION_CAUSES.map((cause) => {
    const linkedSignalIds = signalIds.filter((signalId) => {
      if (cause.id.includes("cloud_marketplace")) return signalId === "cloud_marketplace";
      if (cause.id.includes("local_openclaw")) return signalId === "local_openclaw";
      if (cause.id.includes("role_supply")) return signalId === "role_supply_capability";
      if (cause.id.includes("authorization")) return signalId === "cloud_marketplace";
      if (cause.id.includes("capability")) return signalId === "role_supply_capability";
      if (cause.id.includes("api_model")) return signalId === "external_technology_tool_model";
      if (cause.id.includes("product_experience")) return signalId === "operator_usage";
      if (cause.id.includes("dispatch")) return signalId === "dispatch_execution_chain";
      if (cause.id.includes("role_execution")) return signalId === "dispatch_execution_chain";
      if (cause.id.includes("external_capability"))
        return signalId === "absorbable_capability_library";
      if (cause.id.includes("external_product")) return signalId === "external_product_competitor";
      if (cause.id.includes("risk")) return signalId === "risk_data_quality";
      return false;
    });
    return {
      id: `finding_${cause.id}`,
      title: cause.title,
      summary: `${cause.summary} 需要结合真实观察证据、云端商城投影、本地运行状态和外部采集结果确认。`,
      confidence: linkedSignalIds.length > 0 && hasSignal("business_intent") ? "medium" : "low",
      observationSignalIds: linkedSignalIds.length ? linkedSignalIds : signalIds.slice(0, 1),
    };
  });
}

function latestDispatchRequest(state: AppViewState): Record<string, unknown> {
  const readModel = state.aicsMainFlow?.readModel as Record<string, unknown> | null | undefined;
  const latest = readModel?.latest as Record<string, unknown> | undefined;
  const request = latest?.dispatchToRoleRequest;
  return request && typeof request === "object" && !Array.isArray(request)
    ? (request as Record<string, unknown>)
    : {};
}

function selectAuthorizedRoleForDispatch(state: AppViewState): {
  roleListingId: string;
  roleTitle?: string;
  entitlementId: string;
} | null {
  const request = latestDispatchRequest(state);
  const requestedRoleListingId = text(request.roleListingId);
  const formRoleListingId = text(state.aicsRoleBuilder?.form?.roleListingId);
  const formEntitlementId = text(state.aicsRoleBuilder?.form?.entitlementId);
  if (
    formRoleListingId &&
    formEntitlementId &&
    (!requestedRoleListingId || requestedRoleListingId === formRoleListingId)
  ) {
    const roleTitle = text(request.roleTitle);
    return {
      roleListingId: formRoleListingId,
      entitlementId: formEntitlementId,
      ...(roleTitle ? { roleTitle } : {}),
    };
  }

  const roles = state.aicsMarketplace?.roles ?? [];
  const exact = requestedRoleListingId
    ? roles.find(
        (role) => (role.roleListingId || role.id) === requestedRoleListingId && role.entitlementId,
      )
    : undefined;
  const fallback = roles.find((role) => role.entitlementId);
  const selected = exact ?? fallback;
  if (!selected?.entitlementId) {
    return null;
  }
  return {
    roleListingId: selected.roleListingId || selected.id,
    entitlementId: selected.entitlementId,
    ...(selected.title ? { roleTitle: selected.title } : {}),
  };
}

let refreshSeq = 0;

function requestUpdate(state: AppViewState): void {
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestHostUpdate?.();
  (
    state as unknown as { requestUpdate?: () => void; requestHostUpdate?: () => void }
  ).requestUpdate?.();
}

export async function refreshAicsMainFlowReadModel(state: AppViewState): Promise<void> {
  const seq = ++refreshSeq;
  const mainFlow = state.aicsMainFlow ?? {};
  state.aicsMainFlow = { ...mainFlow, loading: true, error: null };
  requestUpdate(state);

  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    const readModel = await state.client.request<AicsMainFlowReadModel>(
      "aics.mainFlow.readModel.get",
      {},
    );
    if (seq !== refreshSeq) return;
    state.aicsMainFlow = { loading: false, error: null, readModel };
  } catch (err) {
    if (seq !== refreshSeq) return;
    state.aicsMainFlow = {
      loading: false,
      error: err instanceof Error ? err.message : String(err),
      readModel: (mainFlow as unknown as { readModel?: AicsMainFlowReadModel }).readModel ?? null,
    };
  }
  requestUpdate(state);
}

async function callMainFlow(
  state: AppViewState,
  method: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  try {
    if (!state.client) throw new Error("Gateway client is not connected.");
    state.aicsMainFlow = { ...(state.aicsMainFlow ?? {}), loading: true, error: null };
    requestUpdate(state);
    await state.client.request(method, params);
    await refreshAicsMainFlowReadModel(state);
    return true;
  } catch (err) {
    state.aicsMainFlow = {
      ...(state.aicsMainFlow ?? {}),
      loading: false,
      error: err instanceof Error ? err.message : `${method} 调用失败`,
    };
    requestUpdate(state);
    return false;
  }
}

export const aicsMainFlow = {
  refresh: refreshAicsMainFlowReadModel,

  async submitBusinessIntent(s: AppViewState, intentText: string): Promise<boolean> {
    const intent = intentText.trim();
    if (!intent) {
      s.aicsMainFlow = {
        ...(s.aicsMainFlow ?? {}),
        loading: false,
        error: "请先填写经营意图。",
      };
      requestUpdate(s);
      return false;
    }
    try {
      if (!s.client) throw new Error("Gateway client is not connected.");
      s.aicsMainFlow = { ...(s.aicsMainFlow ?? {}), loading: true, error: null };
      requestUpdate(s);
      const interaction = await s.client.request<{ id?: string }>(
        "aics.mainFlow.interaction.create",
        {
          stage: "observation",
          message: intent,
          proposedNextAction: "prepare_observation_package",
        },
      );
      const interactionId = interaction?.id ?? "interaction:latest";
      await s.client.request("aics.mainFlow.observation.prepare", {
        title: "岗位商城观察包",
        summary:
          "由经营概览提交的岗位商城经营意图生成。观察范围固定为云端岗位商城、本地 OpenClaw、岗位供给与能力、用户使用、调度执行、外部产品、外部技术、可吸收能力库、风险与数据质量。",
        signals: buildMarketplaceObservationSignals(intent, interactionId),
      });
      await refreshAicsMainFlowReadModel(s);
      s.businessIntentDraft = "";
      s.setTab?.("observation");
      requestUpdate(s);
      return true;
    } catch (err) {
      s.aicsMainFlow = {
        ...(s.aicsMainFlow ?? {}),
        loading: false,
        error: err instanceof Error ? err.message : "经营意图提交失败",
      };
      requestUpdate(s);
      return false;
    }
  },

  prepareObservation: (s: AppViewState, title: string, summary: string) =>
    callMainFlow(s, "aics.mainFlow.observation.prepare", { title, summary, signals: [] }),

  confirmObservation: (s: AppViewState, observationPackageId: string) =>
    callMainFlow(s, "aics.mainFlow.observation.confirm", { observationPackageId }),

  rejectObservation: (s: AppViewState, observationPackageId: string) =>
    callMainFlow(s, "aics.mainFlow.observation.reject", { observationPackageId }),

  markObservationDataMissing: (s: AppViewState, observationPackageId: string) =>
    callMainFlow(s, "aics.mainFlow.observation.markDataMissing", {
      observationPackageId,
      summary: "待补真实经营数据",
    }),

  prepareAttribution: (s: AppViewState, title: string, summary: string) => {
    const readModel = s.aicsMainFlow?.readModel as Record<string, unknown> | null | undefined;
    const latest = readModel?.latest as Record<string, unknown> | undefined;
    const observation = latest?.observationPackage as Record<string, unknown> | undefined;
    const signals = Array.isArray(observation?.signals)
      ? (observation.signals as Array<Record<string, unknown>>)
      : [];
    const findings = buildMarketplaceAttributionFindings(signals);
    return callMainFlow(s, "aics.mainFlow.attribution.prepare", {
      title,
      summary,
      findings: findings.length
        ? findings
        : [
            {
              id: "finding_data_gap",
              title: "数据不足",
              summary: "观察包缺少可归因信号，需要回到数据分析补充经营数据。",
              confidence: "low",
              observationSignalIds: [],
            },
          ],
    });
  },

  confirmAttribution: (s: AppViewState, attributionReportId: string) =>
    callMainFlow(s, "aics.mainFlow.attribution.confirm", { attributionReportId }),

  rejectAttribution: (s: AppViewState, attributionReportId: string) =>
    callMainFlow(s, "aics.mainFlow.attribution.reject", { attributionReportId }),

  requestAttributionMoreData: (s: AppViewState, attributionReportId: string) =>
    callMainFlow(s, "aics.mainFlow.attribution.requestMoreData", {
      attributionReportId,
      summary: "归因结论不足，需要补充真实经营数据。",
    }),

  createGoalCandidate: (
    s: AppViewState,
    title: string,
    owner: string,
    metric: string,
    target: string,
    rationale: string,
  ) =>
    callMainFlow(s, "aics.mainFlow.goal.candidate.create", {
      title,
      owner,
      metric,
      target,
      rationale,
    }),

  confirmGoal: (s: AppViewState, goalId: string) =>
    callMainFlow(s, "aics.mainFlow.goal.confirm", { goalId }),

  createManagementBreakdown: (s: AppViewState, goalId: string) =>
    callMainFlow(s, "aics.mainFlow.management.workBlocks.create", {
      goalId,
      blocks: [
        {
          name: "岗位供给",
          purpose: "把已确认 CompanyGoal 拆到云端商城岗位商品、品类能力和独特能力申请。",
          progressGauge: "岗位商品可审核、能力包可绑定、缺口可进入独特能力申请。",
          roles: [
            { roleListingId: "cloud-marketplace-operator", roleTitle: "云端商城运营" },
            { roleListingId: "capability-auditor", roleTitle: "能力审核员" },
          ],
          tasks: [
            { title: "梳理岗位商品与能力目录", targetDeliverable: "岗位供给清单与能力缺口表" },
            { title: "提交独特能力申请草稿", targetDeliverable: "独特能力申请包" },
          ],
        },
        {
          name: "授权转化",
          purpose: "管理岗位授权状态、API 供给、调用范围和 actor_context。",
          progressGauge: "授权可读、scope 明确、缺 API 或缺权限能给出 blocked reason。",
          roles: [
            { roleListingId: "api-admin", roleTitle: "API 管理员" },
            { roleListingId: "dispatcher-admin", roleTitle: "调度管理员" },
          ],
          tasks: [
            {
              title: "检查商城 API 与工具/Skill API 绑定",
              targetDeliverable: "API 绑定与风险报告",
            },
            { title: "确认岗位调度授权范围", targetDeliverable: "DispatchToRoleRequest 授权清单" },
          ],
        },
        {
          name: "执行质量",
          purpose: "跟踪已授权岗位执行结果、失败原因、产物回写和复盘材料。",
          progressGauge: "TaskPackage 可追踪、RoleResult 可回写、失败可归因。",
          roles: [{ roleListingId: "role-execution-reviewer", roleTitle: "岗位执行审核" }],
          tasks: [
            {
              title: "建立岗位执行质量口径",
              targetDeliverable: "执行成功率、失败原因、回写完整度",
            },
            { title: "准备岗位结果复盘材料", targetDeliverable: "RoleResult 复盘摘要" },
          ],
        },
        {
          name: "费用与审核",
          purpose: "把费用确认、ledger、风险项和人工审核纳入调度前门禁。",
          progressGauge: "费用已确认、ledger 可追踪、高风险动作有人审。",
          roles: [
            { roleListingId: "finance-auditor", roleTitle: "费用审核员" },
            { roleListingId: "risk-reviewer", roleTitle: "风险审核员" },
          ],
          tasks: [
            { title: "建立费用确认与 ledger 引用", targetDeliverable: "费用确认记录与账本引用" },
            { title: "确认高风险工具与 Skill 人工审批", targetDeliverable: "风险审批清单" },
          ],
        },
      ],
    }),

  preparePlanning: (
    s: AppViewState,
    title: string,
    summary: string,
    rolePlanItems: Array<Record<string, unknown>>,
  ) => callMainFlow(s, "aics.mainFlow.planning.prepare", { title, summary, rolePlanItems }),

  confirmPlanning: (s: AppViewState, planningPackageId: string) =>
    callMainFlow(s, "aics.mainFlow.planning.confirm", { planningPackageId }),

  createDispatchProposal: (
    s: AppViewState,
    title: string,
    riskSummary: string,
    confirmationSummary: string,
  ) =>
    callMainFlow(s, "aics.mainFlow.dispatch.proposal.create", {
      title,
      riskSummary,
      confirmationSummary,
    }),

  confirmDispatch: (s: AppViewState, dispatchProposalReviewId: string) =>
    callMainFlow(s, "aics.mainFlow.dispatch.confirm", { dispatchProposalReviewId }),

  materializeTaskPackage: (s: AppViewState, title: string, taskText: string) => {
    const authorizedRole = selectAuthorizedRoleForDispatch(s);
    return callMainFlow(s, "aics.mainFlow.dispatch.materializeTaskPackage", {
      title,
      taskText,
      ...(authorizedRole
        ? {
            request: {
              roleListingId: authorizedRole.roleListingId,
              roleTitle: authorizedRole.roleTitle,
            },
          }
        : {}),
    });
  },

  runApprovedTask: (s: AppViewState, taskPackageId: string) => {
    return callMainFlow(s, "aics.mainFlow.dispatch.runApprovedTask", {
      taskPackageId,
    });
  },

  confirmExecution: (s: AppViewState, dispatchToRoleRequestId: string) => {
    const authorizedRole = selectAuthorizedRoleForDispatch(s);
    return callMainFlow(s, "aics.mainFlow.execution.confirm", {
      dispatchToRoleRequestId,
      ...(authorizedRole
        ? {
            roleListingId: authorizedRole.roleListingId,
            ...(authorizedRole.roleTitle ? { roleTitle: authorizedRole.roleTitle } : {}),
            entitlementId: authorizedRole.entitlementId,
          }
        : {}),
    });
  },

  confirmExecutionCost: (s: AppViewState, dispatchToRoleRequestId: string) => {
    const authorizedRole = selectAuthorizedRoleForDispatch(s);
    return callMainFlow(s, "aics.mainFlow.execution.cost.confirm", {
      dispatchToRoleRequestId,
      ...(authorizedRole
        ? {
            entitlementId: authorizedRole.entitlementId,
            ledgerRef: `ledger:pending:${authorizedRole.entitlementId}`,
          }
        : {}),
    });
  },

  autoGeneratePipeline: (s: AppViewState) =>
    callMainFlow(s, "aics.mainFlow.auto.generatePipeline", { owner: "迭界AI" }),
};
