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
        title: "经营意图初始观察包",
        summary:
          "由经营概览提交的岗位商城经营意图生成。当前只记录岗位供给、授权转化、执行质量、费用和审核阻塞的观察范围，不伪造真实 KPI。",
        signals: [
          {
            id: "business_intent",
            title: "经营意图",
            summary: intent,
            evidenceRefs: [interactionId],
          },
          {
            id: "role_supply",
            title: "岗位供给",
            summary: "观察首批岗位商品数量、能力标签、上架状态和供给缺口。",
            evidenceRefs: [interactionId],
          },
          {
            id: "authorization_conversion",
            title: "授权转化",
            summary: "观察岗位商品详情页访问、授权点击、授权成功和未授权阻塞。",
            evidenceRefs: [interactionId],
          },
          {
            id: "execution_quality",
            title: "执行质量",
            summary: "观察岗位执行成功率、失败原因、产物回写和用户反馈。",
            evidenceRefs: [interactionId],
          },
          {
            id: "cost_usage",
            title: "费用消耗",
            summary: "观察一次授权费、岗位运行费用、ledger 记录和费用确认状态。",
            evidenceRefs: [interactionId],
          },
          {
            id: "review_blockers",
            title: "审核阻塞",
            summary: "观察岗位审核、能力目录、云端岗位桥和本地调度之间的确认点。",
            evidenceRefs: [interactionId],
          },
          {
            id: "initial_confidence",
            title: "初步可信度",
            summary: "来源为人工输入，可信度待数据分析和归因分析继续验证。",
            evidenceRefs: [interactionId],
          },
        ],
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
    const findings = signals.slice(0, 3).map((signal, index) => ({
      id: `finding_${String(signal.id ?? index).replace(/[^a-zA-Z0-9_-]+/g, "_")}`,
      title: `归因线索：${text(signal.title) || `观察信号 ${index + 1}`}`,
      summary: `${text(signal.summary) || "观察信号需要进一步验证。"} 当前结论来自本地经营意图和观察包，待补真实经营数据验证。`,
      confidence: "low",
      observationSignalIds: [text(signal.id)].filter(Boolean),
    }));
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
