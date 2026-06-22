import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AicsMainFlowStore,
  confirmAttribution,
  confirmDispatch,
  confirmGoal,
  confirmObservation,
  confirmPlanning,
  confirmRoleExecution,
  confirmRoleExecutionCost,
  createAicsMainFlowReadModel,
  createDispatchProposal,
  createEmptyAicsMainFlowState,
  createGoalCandidate,
  createInteraction,
  materializeTaskPackage,
  prepareAttribution,
  prepareObservation,
  preparePlanning,
  recordObservationEvidenceRun,
  regeneratePlanning,
  runApprovedTask,
  setUniqueCapabilityApprovalForDispatch,
  updateRolePlanItem,
} from "./store.js";
import { AicsMainFlowGateError } from "./types.js";

const observationSignals = [
  { id: "signal-1", title: "经营意图", summary: "人工经营意图", evidenceRefs: ["interaction-1"] },
];

const readyCapabilityResolution = {
  categoryCapabilityId: "cloud:cap-a",
  category: "通用品类",
  allowedTools: ["tool:web_search"],
  allowedSkills: ["skill:image-edit"],
  dispatchReady: true,
  blockedReasons: [],
};

function confirmAuthorizedExecution(
  state: ReturnType<typeof createEmptyAicsMainFlowState>,
  dispatchToRoleRequestId: string,
  now: number,
  overrides: {
    roleListingId?: string;
    roleTitle?: string;
    entitlementId?: string;
    ledgerRef?: string;
  } = {},
) {
  const entitlementId = overrides.entitlementId ?? "entitlement-role-lead-review";
  confirmRoleExecution(
    state,
    {
      dispatchToRoleRequestId,
      roleListingId: overrides.roleListingId ?? "role-lead-review",
      ...(overrides.roleTitle ? { roleTitle: overrides.roleTitle } : {}),
      entitlementId,
    },
    now,
  );
  confirmRoleExecutionCost(
    state,
    {
      dispatchToRoleRequestId,
      entitlementId,
      ledgerRef: overrides.ledgerRef ?? `ledger:${entitlementId}`,
    },
    now + 1,
  );
}

function expectGate(error: unknown, code: AicsMainFlowGateError["code"]) {
  expect(error).toBeInstanceOf(AicsMainFlowGateError);
  expect((error as AicsMainFlowGateError).code).toBe(code);
}

function prepareConfirmedPlanningState() {
  const state = createEmptyAicsMainFlowState(1);
  const observation = prepareObservation(
    state,
    { id: "obs-1", title: "观察", summary: "收入和交付事实", signals: observationSignals },
    2,
  );
  confirmObservation(state, observation.id, 3);
  const attribution = prepareAttribution(
    state,
    {
      id: "attr-1",
      observationPackageId: observation.id,
      title: "归因",
      summary: "增长卡在渠道质量",
      findings: [
        {
          id: "finding-1",
          title: "渠道质量不足",
          summary: "有效线索比例低",
          confidence: "medium",
          observationSignalIds: ["signal-1"],
        },
      ],
    },
    4,
  );
  confirmAttribution(state, attribution.id, 5);
  const goal = createGoalCandidate(
    state,
    {
      id: "goal-1",
      attributionReportId: attribution.id,
      title: "季度增长目标",
      owner: "经营管理层",
      metric: "有效线索数",
      target: "提升有效线索比例",
      rationale: "由归因报告支撑",
    },
    6,
  );
  confirmGoal(state, goal.id, 7);
  const planning = preparePlanning(
    state,
    {
      id: "plan-1",
      goalId: goal.id,
      title: "季度增长规划",
      summary: "由渠道岗位处理线索质量",
      rolePlanItems: [
        {
          id: "role-plan-1",
          title: "线索复盘",
          roleCapabilityRef: "role.lead-review",
          taskIntent: "复盘渠道线索质量",
          expectedOutput: "线索质量报告",
        },
      ],
    },
    8,
  );
  return { state, planning };
}

describe("CompanyGoal production readiness", () => {
  it("creates goal candidates with observation and attribution traceability", () => {
    const state = createEmptyAicsMainFlowState(1);
    const observation = prepareObservation(
      state,
      {
        id: "obs-goal-prod",
        title: "岗位商城观察",
        summary: "系统发现真实经营事实",
        signals: [
          {
            id: "signal-api-blocked",
            title: "API 阻塞",
            summary: "DeepSeek provider 不可用",
            evidenceRefs: ["api-health:deepseek"],
          },
        ],
      },
      2,
    );
    confirmObservation(state, observation.id, 3);
    const attribution = prepareAttribution(
      state,
      {
        id: "attr-goal-prod",
        observationPackageId: observation.id,
        title: "归因报告",
        summary: "API/模型阻塞影响岗位执行",
        findings: [
          {
            id: "finding-api-blocked",
            title: "API / 模型 / 工具 / Skill 问题",
            summary: "模型 provider 不可用，岗位不能执行。",
            confidence: "high",
            observationSignalIds: ["signal-api-blocked"],
          },
        ],
      },
      4,
    );
    confirmAttribution(state, attribution.id, 5);

    const goal = createGoalCandidate(
      state,
      {
        id: "goal-prod",
        title: "清零 API、模型、工具和 Skill 执行阻塞",
        owner: "运营负责人",
        metric: "系统使用阻塞数",
        currentValue: "1 个阻塞",
        target: "阻塞数降到 0",
        cycle: "当前经营周期",
        rationale: "归因显示模型连接阻塞岗位执行。",
      },
      6,
    );

    expect(goal.status).toBe("candidate");
    expect(goal.currentValue).toBe("1 个阻塞");
    expect(goal.cycle).toBe("当前经营周期");
    expect(goal.sourceObservationSignalIds).toEqual(["signal-api-blocked"]);
    expect(goal.sourceAttributionFindingIds).toEqual(["finding-api-blocked"]);
    expect(goal.readyForPlanning).toBe(true);
    expect(goal.whyNow).toContain("观察事实");
  });

  it("rejects goal candidates with source ids outside the confirmed observation and attribution", () => {
    const state = createEmptyAicsMainFlowState(1);
    const observation = prepareObservation(
      state,
      {
        id: "obs-goal-source-check",
        title: "岗位商城观察",
        summary: "系统发现真实经营事实",
        signals: [
          {
            id: "signal-valid",
            title: "API 阻塞",
            summary: "Provider 不可用",
            evidenceRefs: ["api-health:provider"],
          },
        ],
      },
      2,
    );
    confirmObservation(state, observation.id, 3);
    const attribution = prepareAttribution(
      state,
      {
        id: "attr-goal-source-check",
        observationPackageId: observation.id,
        title: "归因报告",
        summary: "API 阻塞影响岗位执行",
        findings: [
          {
            id: "finding-valid",
            title: "API / 模型 / 工具 / Skill 问题",
            summary: "模型 provider 不可用。",
            confidence: "high",
            observationSignalIds: ["signal-valid"],
          },
        ],
      },
      4,
    );
    confirmAttribution(state, attribution.id, 5);

    expect(() =>
      createGoalCandidate(state, {
        id: "goal-invalid-observation-source",
        title: "清零 API 阻塞",
        owner: "运营负责人",
        metric: "阻塞数",
        target: "0",
        rationale: "需要追溯真实观察。",
        sourceObservationSignalIds: ["signal-missing"],
        sourceAttributionFindingIds: ["finding-valid"],
      }),
    ).toThrow(AicsMainFlowGateError);

    expect(() =>
      createGoalCandidate(state, {
        id: "goal-invalid-attribution-source",
        title: "清零 API 阻塞",
        owner: "运营负责人",
        metric: "阻塞数",
        target: "0",
        rationale: "需要追溯真实归因。",
        sourceObservationSignalIds: ["signal-valid"],
        sourceAttributionFindingIds: ["finding-missing"],
      }),
    ).toThrow(AicsMainFlowGateError);
  });

  it("blocks planning when a confirmed goal is not ready for planning", () => {
    const state = createEmptyAicsMainFlowState(1);
    const observation = prepareObservation(
      state,
      { id: "obs-blocked-goal", title: "观察", summary: "证据不足", signals: observationSignals },
      2,
    );
    confirmObservation(state, observation.id, 3);
    const attribution = prepareAttribution(
      state,
      {
        id: "attr-blocked-goal",
        observationPackageId: observation.id,
        title: "归因",
        summary: "还缺数据",
        findings: [
          {
            id: "finding-data-gap",
            title: "风险与数据质量问题",
            summary: "观察数据不足。",
            confidence: "medium",
            observationSignalIds: ["signal-1"],
          },
        ],
      },
      4,
    );
    confirmAttribution(state, attribution.id, 5);
    const goal = createGoalCandidate(
      state,
      {
        id: "goal-blocked",
        title: "补齐经营观察数据基线",
        owner: "运营负责人",
        metric: "证据完整度",
        target: "关键证据完整",
        rationale: "缺数据",
        blockedReasons: ["观察证据不足，暂不能进入正式规划"],
        readyForPlanning: false,
      },
      6,
    );
    confirmGoal(state, goal.id, 7);

    expect(() =>
      preparePlanning(state, {
        title: "不应该生成的规划",
        summary: "目标未就绪",
        rolePlanItems: [
          {
            title: "补数据",
            roleCapabilityRef: "data-collection",
            taskIntent: "补齐数据",
            expectedOutput: "数据清单",
          },
        ],
      }),
    ).toThrow(AicsMainFlowGateError);
  });
});

function prepareMaterializedExecutionState() {
  const { state, planning } = prepareConfirmedPlanningState();
  confirmPlanning(state, planning.id, 9);
  const proposal = createDispatchProposal(
    state,
    {
      id: "dispatch-proposal-closure",
      planningPackageId: planning.id,
      rolePlanItemId: planning.rolePlanItemIds[0],
      title: "派发岗位工作项",
      riskSummary: "低风险",
      confirmationSummary: "确认派发给授权岗位。",
    },
    10,
  );
  confirmDispatch(state, proposal.id, 11);
  const materialized = materializeTaskPackage(
    state,
    {
      id: "task-package-closure",
      dispatchProposalReviewId: proposal.id,
      title: "执行闭环任务",
      taskText: "生成可审计执行结果。",
      capabilityResolution: readyCapabilityResolution,
      request: {
        id: "dispatch-request-closure",
        roleListingId: "role-listing-closure",
        roleTitle: "闭环执行岗位",
        entitlementId: "entitlement-closure",
      },
    },
    12,
  );
  return { state, materialized };
}

describe("AICS main flow store", () => {
  it("builds humanized stage guidance, preconditions, blocker fixes, and handoff preview", () => {
    const empty = createAicsMainFlowReadModel(createEmptyAicsMainFlowState(1));
    expect(empty.stageGuidance.title).toBe("数据分析");
    expect(empty.stageGuidance.primaryActionLabel).toBe("开始观察");
    expect(empty.stageGuidance.primaryActionTarget).toBe("businessOverview");
    expect(empty.preconditions.find((item) => item.id === "observation_package")).toMatchObject({
      status: "missing",
      fixTab: "businessOverview",
    });
    expect(
      empty.blockerResolutions.find((item) => item.code === "missing_observation_package"),
    ).toMatchObject({
      humanMessage: "还没有可用于分析的数据包。",
      fixTab: "businessOverview",
    });
    expect(empty.handoffPreview).toMatchObject({
      fromStage: "observation",
      toStage: "attribution",
      outputLabel: "数据分析包",
      outputCount: 0,
    });
    expect(empty.operatorRecommendation).toMatchObject({
      title: "先处理当前卡点",
      severity: "warning",
      actionTab: "businessOverview",
    });
    expect(empty.stageBoundary).toMatchObject({
      allowed: expect.arrayContaining(["采集内外部经营事实"]),
      prohibited: expect.arrayContaining(["直接调度岗位执行"]),
      evidenceRequired: expect.arrayContaining(["云端商城数据"]),
    });
    expect(empty.observationWorkspace.guidance.status).toBe("needs_review");
    expect(empty.observationWorkspace.objects.map((item) => item.name)).toEqual(
      expect.arrayContaining(["业务健康状态", "用户关键动作", "外部机会与风险"]),
    );
    expect(
      empty.observationWorkspace.sources.find(
        (source) => source.id === "aics-main-flow-read-model",
      ),
    ).toMatchObject({
      canAccess: true,
    });
    expect(
      empty.observationWorkspace.sources.find(
        (source) => source.id === "observation-package-store",
      ),
    ).toMatchObject({
      canAccess: false,
      missingRequirement: expect.stringContaining("internal:observation_package_read"),
    });
    expect(
      empty.observationWorkspace.sources.find(
        (source) => source.id === "external-market-intelligence",
      ),
    ).toMatchObject({
      canAccess: false,
      missingRequirement: expect.stringContaining("需要用户授权"),
    });
    expect(empty.observationWorkspace.toolPlans.some((plan) => plan.status === "ready")).toBe(true);
    expect(empty.observationWorkspace.toolPlans.some((plan) => plan.status === "blocked")).toBe(
      true,
    );
    expect(empty.observationWorkspace.candidate.canConfirm).toBe(false);

    const { state } = prepareConfirmedPlanningState();
    const planningReadModel = createAicsMainFlowReadModel(state);
    expect(planningReadModel.stageGuidance.title).toBe("规划方案");
    expect(planningReadModel.stageGuidance.primaryActionLabel).toBe("确认规划");
    expect(
      planningReadModel.preconditions.find((item) => item.id === "company_goal"),
    ).toMatchObject({
      status: "met",
      fixTab: "goals",
    });
    expect(planningReadModel.handoffPreview).toMatchObject({
      fromStage: "planning",
      toStage: "dispatch",
      outputLabel: "岗位工作项",
      outputCount: 1,
    });
    expect(planningReadModel.operatorRecommendation).toMatchObject({
      title: "先处理当前卡点",
      severity: "warning",
      actionTab: "company",
    });
    expect(planningReadModel.stageBoundary).toMatchObject({
      allowed: expect.arrayContaining(["生成岗位工作项"]),
      prohibited: expect.arrayContaining(["绕过调度创建执行任务"]),
      evidenceRequired: expect.arrayContaining(["验收标准"]),
    });
  });

  it("tracks planning revision, evidence sources and role item readiness", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    const item = state.rolePlanItems.find((entry) => entry.id === planning.rolePlanItemIds[0]);

    expect(planning.revision).toBe(1);
    expect(planning.sourceObservationPackageId).toBe("obs-1");
    expect(planning.sourceAttributionReportId).toBe("attr-1");
    expect(item?.sourceSignalIds).toEqual(["signal-1"]);
    expect(item?.sourceFindingIds).toEqual(["finding-1"]);
    expect(item?.dispatchStatus).toBe("not_dispatched");
    expect(item?.acceptanceCriteria).toEqual(["交付物符合：线索质量报告"]);
    expect(createAicsMainFlowReadModel(state).planningSummary).toMatchObject({
      hasPlanning: true,
      title: planning.title,
      statusLabel: "待确认",
      workBlockCount: 1,
      dispatchableCount: 0,
      blockedCount: 0,
      missingAcceptanceCount: 0,
      readyForDispatch: false,
      nextAction: "在规划方案页确认规划",
    });

    updateRolePlanItem(
      state,
      {
        rolePlanItemId: "role-plan-1",
        acceptanceCriteria: ["交付物能进入调度层", "能力匹配说明完整"],
        capabilityMatchSummary: "匹配渠道复盘岗位。",
      },
      9,
    );

    expect(item?.acceptanceCriteria).toEqual(["交付物能进入调度层", "能力匹配说明完整"]);
    expect(item?.capabilityMatchSummary).toBe("匹配渠道复盘岗位。");

    confirmPlanning(state, planning.id, 10);
    expect(createAicsMainFlowReadModel(state).planningSummary).toMatchObject({
      statusLabel: "已确认",
      workBlockCount: 1,
      dispatchableCount: 1,
      readyForDispatch: true,
      nextAction: "去任务调度检查并派发",
    });
    expect(createAicsMainFlowReadModel(state).planningSummary.workBlocks[0]).toMatchObject({
      title: item?.title,
      roleLabel: "待匹配岗位",
      expectedOutput: item?.expectedOutput,
      acceptanceCount: 2,
      dispatchable: true,
    });
  });

  it("rejects planning work blocks without required task fields or valid source refs", () => {
    const { state } = prepareConfirmedPlanningState();

    expect(() =>
      preparePlanning(state, {
        title: "缺字段规划",
        summary: "岗位工作项缺少可执行信息",
        rolePlanItems: [
          {
            title: " ",
            roleCapabilityRef: "role.ops",
            taskIntent: "处理任务",
            expectedOutput: "报告",
          },
        ],
      }),
    ).toThrow(AicsMainFlowGateError);

    expect(() =>
      preparePlanning(state, {
        title: "错误来源规划",
        summary: "岗位工作项引用不存在的观察来源",
        rolePlanItems: [
          {
            title: "岗位项",
            roleCapabilityRef: "role.ops",
            taskIntent: "处理任务",
            expectedOutput: "报告",
            sourceSignalIds: ["signal-missing"],
            sourceFindingIds: ["finding-1"],
          },
        ],
      }),
    ).toThrow(AicsMainFlowGateError);

    expect(() =>
      preparePlanning(state, {
        title: "错误归因来源规划",
        summary: "岗位工作项引用不存在的归因来源",
        rolePlanItems: [
          {
            title: "岗位项",
            roleCapabilityRef: "role.ops",
            taskIntent: "处理任务",
            expectedOutput: "报告",
            sourceSignalIds: ["signal-1"],
            sourceFindingIds: ["finding-missing"],
          },
        ],
      }),
    ).toThrow(AicsMainFlowGateError);
  });

  it("summarizes execution closure for not-ready, blocked, completed, and incomplete readback states", () => {
    const empty = createAicsMainFlowReadModel(createEmptyAicsMainFlowState(1));
    expect(empty.executionClosure.status).toBe("not_ready");
    expect(empty.roleExecutionSummary).toMatchObject({
      statusLabel: "未就绪",
      canRun: false,
      canMarkCompleted: false,
      nextObservationReady: false,
      nextAction: "去任务调度生成派发单",
    });
    expect(empty.executionClosure.recoveryActions[0]).toMatchObject({
      targetTab: "workboard",
    });
    expect(empty.executionClosure.readinessChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "派发单",
          status: "missing",
          targetTab: "workboard",
        }),
        expect.objectContaining({
          label: "执行队列",
          status: "missing",
          targetTab: "workboard",
        }),
      ]),
    );
    expect(empty.accountGoalMode).toMatchObject({
      accountLabel: "当前账号",
      status: "blocked",
      headline: "账号经营链路有卡点需要处理",
      chatCapabilities: {
        canReadAccountData: true,
        canCreateCandidates: true,
        cannotBypassMainFlow: true,
      },
      nextStep: {
        tab: "businessOverview",
      },
    });
    expect(empty.accountGoalMode.stageCards.map((stage) => stage.label)).toEqual([
      "数据分析",
      "归因分析",
      "公司目标",
      "规划方案",
      "任务调度",
      "岗位执行",
    ]);

    const { state, materialized } = prepareMaterializedExecutionState();
    const blocked = createAicsMainFlowReadModel(state).executionClosure;
    expect(blocked.status).toBe("blocked");
    expect(blocked.recoveryActions.map((action) => action.targetTab)).toContain("usage");
    expect(blocked.readinessChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "派发单", status: "passed" }),
        expect.objectContaining({ label: "执行队列", status: "passed" }),
        expect.objectContaining({ label: "岗位授权", status: "passed" }),
        expect.objectContaining({ label: "人工执行确认", status: "missing" }),
        expect.objectContaining({ label: "费用确认", status: "missing" }),
      ]),
    );

    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 13, {
      roleListingId: "role-listing-closure",
      roleTitle: "闭环执行岗位",
      entitlementId: "entitlement-closure",
      ledgerRef: "ledger:role_execution:entitlement-closure:exec-closure",
    });
    const ready = createAicsMainFlowReadModel(state).executionClosure;
    expect(ready.status).toBe("ready_to_run");
    expect(ready.readinessChecks.every((check) => check.status === "passed")).toBe(true);
    expect(createAicsMainFlowReadModel(state).roleExecutionSummary).toMatchObject({
      statusLabel: "可确认运行",
      canRun: true,
      canMarkCompleted: false,
      userMessage: "执行前条件已满足，需要用户在岗位执行页确认并运行。",
      nextAction: "在岗位执行页确认并运行",
    });

    runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        ledgerRef: "ledger:role_execution:entitlement-closure:exec-closure",
        result: {
          id: "exec-closure",
          outcome: "succeeded",
          summary: "闭环任务完成。",
          artifactRefs: ["artifact:role-result:exec-closure:summary", "audit:audit-exec-closure"],
          executionEvidence: {
            executionId: "exec-closure",
            ledgerRef: "ledger:role_execution:entitlement-closure:exec-closure",
            humanConfirmationRef: "human:confirm:dispatch_to_role_request_1:exec-closure",
            costSummary: {
              authorizationFeeCents: 0,
              executionFeeCents: 0,
              modelUsageCostCents: 0,
              totalCostCents: 0,
              currency: "CNY",
              source: "local_ledger",
              ledgerRef: "ledger:role_execution:entitlement-closure:exec-closure",
            },
            modelUsage: {
              inputTokens: 100,
              outputTokens: 60,
              totalTokens: 160,
              costCents: 0,
            },
          },
        },
      },
      15,
    );
    const missingReadback = createAicsMainFlowReadModel(state).executionClosure;
    expect(missingReadback.status).toBe("blocked");
    expect(missingReadback.missingEvidence).toEqual(
      expect.arrayContaining(["审计记录未读回", "账本记录未读回"]),
    );

    state.roleResults[0].executionEvidence = {
      ...(state.roleResults[0].executionEvidence ?? {}),
      auditReadback: {},
      ledgerReadback: {},
    };
    const emptyReadback = createAicsMainFlowReadModel(state).executionClosure;
    expect(emptyReadback.status).toBe("blocked");
    expect(emptyReadback.missingEvidence).toEqual(
      expect.arrayContaining(["审计记录未读回", "账本记录未读回"]),
    );
    const emptyReadbackObservationEvidence = createAicsMainFlowReadModel(
      state,
    ).observationWorkspace.evidence.find((item) => item.id.includes("business-result"));
    expect(emptyReadbackObservationEvidence).toMatchObject({
      qualityFlags: expect.arrayContaining(["missing_audit_readback", "missing_ledger_readback"]),
      confidence: "medium",
    });

    state.roleResults[0].executionEvidence = {
      ...(state.roleResults[0].executionEvidence ?? {}),
      auditReadback: { auditRecordId: "audit-exec-closure" },
      ledgerReadback: { ledgerRef: "ledger:role_execution:entitlement-closure:exec-closure" },
    };
    const completed = createAicsMainFlowReadModel(state).executionClosure;
    expect(completed.status).toBe("completed");
    expect(completed.productionFinalGate).toMatchObject({
      status: "not_evaluated",
      requiredVerdict: "production_plus_passed",
    });
    expect(completed.productionFinalGate.requiredInputs).toContain("DIJIE_CLOUD_BASE_URL");
    expect(completed.productionFinalGate.operatorChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "连接真实云端商城",
          requiredInput: "DIJIE_CLOUD_BASE_URL",
        }),
      ]),
    );
    expect(completed.productionFinalGate.operatorSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "1. 连接两个地址",
          requiredInputs: expect.arrayContaining(["DIJIE_CLOUD_BASE_URL", "OPENCLAW_LOCAL_URL"]),
        }),
        expect.objectContaining({
          step: "4. 跑云端 SaaS 最终验收",
          status: "pending",
        }),
      ]),
    );
    expect(completed.productionFinalGate.finalCommand).toContain(
      "aics-production-plus-orchestrator.mjs",
    );
    expect(completed.evidenceReadback).toMatchObject({
      hasRoleResult: true,
      hasBusinessArtifact: true,
      hasAudit: true,
      hasLedger: true,
      hasModelUsage: true,
      modelUsageStatus: "recorded",
    });
    expect(completed.evidenceSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "业务产物",
          value: "artifact:role-result:exec-closure:summary",
          status: "available",
        }),
        expect.objectContaining({
          label: "审计记录",
          value: "audit-exec-closure",
          status: "available",
        }),
        expect.objectContaining({
          label: "账本记录",
          value: "ledger:role_execution:entitlement-closure:exec-closure",
          status: "available",
        }),
        expect.objectContaining({
          label: "模型费用",
          value: "160 Token · ¥0.00",
          status: "available",
        }),
      ]),
    );
    expect(completed.businessResult?.summary).toBe("闭环任务完成。");
    expect(completed.nextObservationCandidate).toMatchObject({
      title: "上一轮执行结果可以用于新的数据分析",
      summary: "闭环任务完成。",
      artifactTitles: ["岗位执行业务产物 1"],
      auditComplete: true,
      ledgerComplete: true,
      modelUsageEvidence: "recorded",
      boundary: "只作为观察候选，不会自动创建新目标，仍需用户确认后进入下一轮分析。",
    });

    const completedReadModel = createAicsMainFlowReadModel(state);
    expect(completedReadModel.roleExecutionSummary).toMatchObject({
      statusLabel: "闭环完成",
      canMarkCompleted: true,
      hasBusinessResult: true,
      hasBusinessArtifact: true,
      hasAudit: true,
      hasLedger: true,
      hasModelUsage: true,
      nextObservationReady: true,
      nextAction: "去数据分析确认下一轮观察候选",
    });
    expect(completedReadModel.nextObservationSummary).toMatchObject({
      hasCandidate: true,
      readyForReview: true,
      title: "上一轮执行结果可以用于新的数据分析",
      summary: "闭环任务完成。",
      auditComplete: true,
      ledgerComplete: true,
      modelUsageEvidence: "recorded",
      nextAction: "去数据分析复核下一轮观察候选",
      boundary: "只作为观察候选，不会自动创建新目标，仍需用户确认后进入下一轮分析。",
    });
    expect(
      completedReadModel.observationWorkspace.evidence.find((item) =>
        item.id.includes("business-result"),
      ),
    ).toMatchObject({
      sourceLabel: "岗位执行结果回读",
      sourceRef: "上一轮岗位执行结果 1",
      rawRef: state.roleResults[0].id,
      qualityFlags: [],
    });
    expect(completedReadModel.accountGoalMode).toMatchObject({
      status: "completed",
      headline: "本轮岗位执行闭环已完成",
      plainSummary: "业务结果、产物、审计、账本和模型费用证据已读回，可进入下一轮观察。",
      currentGoal: {
        title: "季度增长目标",
        metric: "有效线索数",
        target: "提升有效线索比例",
      },
    });
    expect(completedReadModel.accountGoalMode.chatCapabilities.humanLabel).toContain(
      "不能绕过六层直接执行",
    );

    const stageProgress = completedReadModel.stageProgress;
    expect(stageProgress.map((stage) => stage.label)).toEqual([
      "数据分析",
      "归因分析",
      "公司目标",
      "规划方案",
      "任务调度",
      "岗位执行",
    ]);
    expect(stageProgress.find((stage) => stage.stage === "role")).toMatchObject({
      status: "completed",
      actionTab: "aics",
    });
  });

  it("treats explicit no-model usage evidence as a completed execution closure", () => {
    const { state, materialized } = prepareMaterializedExecutionState();
    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 13, {
      roleListingId: "role-listing-closure",
      roleTitle: "闭环执行岗位",
      entitlementId: "entitlement-closure",
      ledgerRef: "ledger:role_execution:entitlement-closure:exec-tool-only",
    });

    runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        ledgerRef: "ledger:role_execution:entitlement-closure:exec-tool-only",
        result: {
          id: "exec-tool-only",
          outcome: "succeeded",
          summary: "本地文件打包完成，未调用模型。",
          artifactRefs: ["artifact:role-result:exec-tool-only:zip", "audit:audit-exec-tool-only"],
          executionEvidence: {
            executionId: "exec-tool-only",
            ledgerRef: "ledger:role_execution:entitlement-closure:exec-tool-only",
            humanConfirmationRef: "human:confirm:dispatch_to_role_request_1:exec-tool-only",
            costSummary: {
              authorizationFeeCents: 0,
              executionFeeCents: 0,
              totalCostCents: 0,
              currency: "CNY",
              source: "local_ledger",
              ledgerRef: "ledger:role_execution:entitlement-closure:exec-tool-only",
            },
            modelUsageNotApplicable: true,
            modelUsageNotApplicableReason: "本次由本地文件打包工具完成，未调用模型。",
            auditReadback: { auditRecordId: "audit-exec-tool-only" },
            ledgerReadback: {
              ledgerRef: "ledger:role_execution:entitlement-closure:exec-tool-only",
            },
          },
        },
      },
      15,
    );

    const closure = createAicsMainFlowReadModel(state).executionClosure;
    expect(closure).toMatchObject({
      status: "completed",
      evidenceReadback: {
        hasModelUsage: true,
        modelUsageStatus: "not_applicable",
        modelUsageMessage: "本次由本地文件打包工具完成，未调用模型。",
      },
      missingEvidence: [],
    });
  });

  it("routes failed execution recovery to the page that can fix the blocker", () => {
    const { state, materialized } = prepareMaterializedExecutionState();
    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 13, {
      roleListingId: "role-listing-closure",
      roleTitle: "闭环执行岗位",
      entitlementId: "entitlement-closure",
      ledgerRef: "ledger:role_execution:entitlement-closure:exec-api-failed",
    });

    runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        ledgerRef: "ledger:role_execution:entitlement-closure:exec-api-failed",
        result: {
          id: "exec-api-failed",
          outcome: "failed",
          summary: "DeepSeek API 401：模型连接不可用。",
          artifactRefs: [],
          executionEvidence: {
            executionId: "exec-api-failed",
            ledgerRef: "ledger:role_execution:entitlement-closure:exec-api-failed",
            modelUsage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costCents: 0,
            },
            recoverySuggestion: "请到 API 管理检查 role_execution 模型 Provider 的 SecretRef。",
            steps: [
              {
                stepIndex: 1,
                stepName: "model_execution",
                status: "failed",
                inputSummary: "执行闭环任务",
                outputSummary: "DeepSeek API 401",
                toolCalls: [],
              },
            ],
          },
        },
      },
      15,
    );

    const closure = createAicsMainFlowReadModel(state).executionClosure;
    expect(closure.status).toBe("failed");
    expect(closure.recoveryActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "去 API 管理检查模型连接",
          targetTab: "apiManagement",
          reason: "请到 API 管理检查 role_execution 模型 Provider 的 SecretRef。",
        }),
      ]),
    );
  });

  it("supersedes previous planning package when regenerating a plan", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    const next = regeneratePlanning(
      state,
      {
        id: "plan-2",
        goalId: "goal-1",
        title: "季度增长规划 v2",
        summary: "增加商城运营承接",
        rolePlanItems: [
          {
            id: "role-plan-2",
            title: "渠道推广增长",
            roleCapabilityRef: "role.channel-growth",
            taskIntent: "拆解渠道推广动作",
            expectedOutput: "渠道推广计划",
          },
        ],
      },
      10,
    );

    expect(next.revision).toBe(2);
    expect(planning.status).toBe("cancelled");
    expect(planning.supersededByPlanningPackageId).toBe(next.id);
  });

  it("enforces the observation to attribution to confirmed goal gates", () => {
    const state = createEmptyAicsMainFlowState(1);

    expect(() => prepareAttribution(state, { title: "归因", summary: "缺观察" }, 2)).toThrowError(
      AicsMainFlowGateError,
    );
    try {
      prepareAttribution(state, { title: "归因", summary: "缺观察" }, 2);
    } catch (error) {
      expectGate(error, "missing_observation_package");
    }

    const emptyObservation = prepareObservation(
      state,
      { id: "obs-1", title: "观察", summary: "事实" },
      3,
    );
    expect(createAicsMainFlowReadModel(state).readiness.canPrepareAttribution).toBe(false);
    try {
      prepareAttribution(
        state,
        {
          id: "attr-empty",
          observationPackageId: emptyObservation.id,
          title: "归因",
          summary: "空观察包",
        },
        4,
      );
    } catch (error) {
      expectGate(error, "missing_observation_package");
    }

    const observation = prepareObservation(
      state,
      { id: "obs-2", title: "观察", summary: "事实", signals: observationSignals },
      5,
    );
    expect(createAicsMainFlowReadModel(state).readiness.canPrepareAttribution).toBe(false);
    expect(createAicsMainFlowReadModel(state).stageGuidance.primaryActionLabel).toBe("确认观察");
    confirmObservation(state, observation.id, 6);
    expect(createAicsMainFlowReadModel(state).readiness.canPrepareAttribution).toBe(true);

    const attributionWithoutEvidence = prepareAttribution(
      state,
      {
        id: "attr-without-evidence",
        observationPackageId: observation.id,
        title: "无证据归因",
        summary: "缺少观察证据引用",
        findings: [
          {
            id: "finding-without-evidence",
            title: "凭空原因",
            summary: "不能确认",
            confidence: "medium",
            observationSignalIds: [],
          },
        ],
      },
      7,
    );
    expect(() => confirmAttribution(state, attributionWithoutEvidence.id, 8)).toThrow(
      AicsMainFlowGateError,
    );
    const blockedAttributionReadModel = createAicsMainFlowReadModel(state);
    expect(blockedAttributionReadModel.readiness.canCreateGoalCandidate).toBe(false);
    expect(blockedAttributionReadModel.attributionSummary).toMatchObject({
      evidenceCount: 0,
      missingEvidenceCount: 1,
      canCreateGoalCandidate: false,
      missingData: expect.arrayContaining(["1 个问题缺少观察证据。"]),
    });

    const noEvidenceState = createEmptyAicsMainFlowState(20);
    const noEvidenceObservation = prepareObservation(
      noEvidenceState,
      {
        id: "obs-no-evidence",
        title: "无证据观察",
        summary: "只有描述，没有来源证据。",
        signals: [
          {
            id: "signal-no-evidence",
            title: "无来源事实",
            summary: "不能进入归因",
            evidenceRefs: [],
          },
        ],
      },
      21,
    );
    confirmObservation(noEvidenceState, noEvidenceObservation.id, 22);
    const noEvidenceReadModel = createAicsMainFlowReadModel(noEvidenceState);
    expect(noEvidenceReadModel.readiness.canPrepareAttribution).toBe(false);
    expect(noEvidenceReadModel.observationWorkspace.candidate.canConfirm).toBe(false);
    expect(
      noEvidenceReadModel.observationWorkspace.candidate.qualitySummary.rejected,
    ).toBeGreaterThan(0);
    expect(() =>
      prepareAttribution(
        noEvidenceState,
        {
          id: "attr-no-evidence",
          observationPackageId: noEvidenceObservation.id,
          title: "不能生成的归因",
          summary: "缺证据引用",
        },
        23,
      ),
    ).toThrow(AicsMainFlowGateError);

    const attribution = prepareAttribution(
      state,
      {
        id: "attr-1",
        observationPackageId: observation.id,
        title: "归因",
        summary: "原因",
        findings: [
          {
            id: "finding-1",
            title: "原因",
            summary: "渠道质量不足",
            confidence: "medium",
            observationSignalIds: ["signal-1"],
          },
        ],
      },
      9,
    );
    expect(createAicsMainFlowReadModel(state).readiness.canCreateGoalCandidate).toBe(false);
    confirmAttribution(state, attribution.id, 10);
    const confirmedAttributionReadModel = createAicsMainFlowReadModel(state);
    expect(confirmedAttributionReadModel.readiness.canCreateGoalCandidate).toBe(true);
    expect(confirmedAttributionReadModel.attributionSummary).toMatchObject({
      evidenceCount: 1,
      missingEvidenceCount: 0,
      canCreateGoalCandidate: true,
      userMessage: "归因已引用观察证据，可以生成目标候选。",
    });
    expect(confirmedAttributionReadModel.attributionSummary.topFindings[0]).toMatchObject({
      title: "原因",
      evidenceCount: 1,
    });
    const goal = createGoalCandidate(
      state,
      {
        id: "goal-1",
        attributionReportId: attribution.id,
        title: "目标",
        owner: "经营管理层",
        metric: "收入",
        target: "提升收入",
        rationale: "来自归因报告",
      },
      11,
    );
    const candidateGoalReadModel = createAicsMainFlowReadModel(state);
    expect(candidateGoalReadModel.goalSummary).toMatchObject({
      hasGoal: true,
      title: "目标",
      statusLabel: "候选目标",
      observationSourceCount: 1,
      attributionSourceCount: 1,
      canConfirm: true,
      readyForPlanning: false,
      nextAction: "在公司目标页确认目标",
    });

    expect(() =>
      preparePlanning(
        state,
        {
          title: "规划",
          summary: "目标未确认",
          rolePlanItems: [
            {
              title: "岗位项",
              roleCapabilityRef: "role.ops",
              taskIntent: "处理任务",
              expectedOutput: "报告",
            },
          ],
        },
        10,
      ),
    ).toThrowError(AicsMainFlowGateError);

    confirmGoal(state, goal.id, 12);
    expect(createAicsMainFlowReadModel(state).goalSummary).toMatchObject({
      statusLabel: "已确认",
      canConfirm: false,
      readyForPlanning: true,
      nextAction: "去规划方案拆工作块",
    });
  });

  it("enforces planning, dispatch, task package and role request gates", () => {
    const { state, planning } = prepareConfirmedPlanningState();

    try {
      createDispatchProposal(
        state,
        { title: "调度", riskSummary: "低风险", confirmationSummary: "待确认" },
        7,
      );
    } catch (error) {
      expectGate(error, "missing_confirmed_planning_package");
    }

    confirmPlanning(state, planning.id, 8);
    expect(createAicsMainFlowReadModel(state).dispatchSummary).toMatchObject({
      hasConfirmedGoal: true,
      hasConfirmedPlanning: true,
      dispatchableWorkBlockCount: 1,
      canCreateDispatch: true,
      canEnterRoleExecution: false,
      nextAction: "在任务调度页检查并派发",
    });

    const { state: blockedState, planning: blockedPlanning } = prepareConfirmedPlanningState();
    confirmPlanning(blockedState, blockedPlanning.id, 8);
    updateRolePlanItem(
      blockedState,
      {
        rolePlanItemId: blockedPlanning.rolePlanItemIds[0],
        blockedReasons: ["缺少 API 或岗位授权，暂不能派发"],
      },
      9,
    );
    expect(() =>
      createDispatchProposal(blockedState, {
        planningPackageId: blockedPlanning.id,
        rolePlanItemId: blockedPlanning.rolePlanItemIds[0],
        title: "不应派发",
        riskSummary: "存在阻塞",
        confirmationSummary: "不允许派发",
      }),
    ).toThrow(AicsMainFlowGateError);

    const { state: noAcceptanceState, planning: noAcceptancePlanning } =
      prepareConfirmedPlanningState();
    confirmPlanning(noAcceptanceState, noAcceptancePlanning.id, 8);
    updateRolePlanItem(
      noAcceptanceState,
      {
        rolePlanItemId: noAcceptancePlanning.rolePlanItemIds[0],
        acceptanceCriteria: [],
      },
      9,
    );
    expect(() =>
      createDispatchProposal(noAcceptanceState, {
        planningPackageId: noAcceptancePlanning.id,
        rolePlanItemId: noAcceptancePlanning.rolePlanItemIds[0],
        title: "不应派发",
        riskSummary: "缺少验收",
        confirmationSummary: "不允许派发",
      }),
    ).toThrow(AicsMainFlowGateError);

    const proposal = createDispatchProposal(
      state,
      {
        id: "dispatch-1",
        planningPackageId: planning.id,
        rolePlanItemId: planning.rolePlanItemIds[0],
        title: "调度复核",
        riskSummary: "需要人工确认费用",
        confirmationSummary: "确认岗位和工作区",
      },
      9,
    );

    try {
      materializeTaskPackage(
        state,
        { title: "任务包", taskText: "执行线索复盘", dispatchProposalReviewId: proposal.id },
        10,
      );
    } catch (error) {
      expectGate(error, "missing_confirmed_dispatch_proposal");
    }

    confirmDispatch(state, proposal.id, 11);
    try {
      runApprovedTask(state, {}, 12);
    } catch (error) {
      expectGate(error, "missing_task_package");
    }

    const materialized = materializeTaskPackage(
      state,
      {
        id: "task-1",
        dispatchProposalReviewId: proposal.id,
        title: "任务包",
        taskText: "执行线索复盘",
        capabilityResolution: readyCapabilityResolution,
        request: { id: "dispatch-request-1", roleListingId: "role-lead-review" },
      },
      13,
    );
    expect(createAicsMainFlowReadModel(state).dispatchSummary).toMatchObject({
      hasTaskPackage: true,
      hasDispatchQueue: true,
      canEnterRoleExecution: true,
      nextAction: "去岗位执行确认并运行",
      boundary: "任务调度只生成派发单和执行队列，不直接调用模型、不运行岗位。",
    });
    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 14, {
      roleListingId: "role-lead-review",
      entitlementId: "entitlement-role-lead-review",
    });
    const run = runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
      },
      16,
    );

    expect(run.dispatchToRoleRequest.status).toBe("running");
    expect(createAicsMainFlowReadModel(state).readiness.canRunApprovedTask).toBe(true);
  });

  it("blocks task materialization without a tool supply resolution", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    confirmPlanning(state, planning.id, 8);
    const proposal = createDispatchProposal(
      state,
      {
        id: "dispatch-no-resolution",
        planningPackageId: planning.id,
        rolePlanItemId: planning.rolePlanItemIds[0],
        title: "调度预检",
        riskSummary: "必须读取工具与 Skill 绑定",
        confirmationSummary: "没有绑定解析不能执行",
      },
      9,
    );
    confirmDispatch(state, proposal.id, 10);

    const materialized = materializeTaskPackage(
      state,
      {
        id: "task-no-resolution",
        dispatchProposalReviewId: proposal.id,
        title: "任务包",
        taskText: "执行线索复盘",
      },
      11,
    );

    expect(materialized.taskPackage.status).toBe("blocked");
    expect(materialized.dispatchToRoleRequest.toolSkillReady).toBe(false);
    expect(materialized.dispatchToRoleRequest.allowedTools).toEqual([]);
    expect(materialized.dispatchToRoleRequest.allowedSkills).toEqual([]);
    expect(materialized.dispatchToRoleRequest.capabilityBlockedReasons).toEqual(
      expect.arrayContaining([
        "missing_category_binding",
        "missing_tool_binding",
        "missing_skill_binding",
      ]),
    );
  });

  it("uses tool supply resolution when materializing dispatch requests", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    confirmPlanning(state, planning.id, 8);
    const proposal = createDispatchProposal(
      state,
      {
        id: "dispatch-resolution",
        planningPackageId: planning.id,
        rolePlanItemId: planning.rolePlanItemIds[0],
        title: "调度复核",
        riskSummary: "检查工具 Skill 绑定",
        confirmationSummary: "确认能力组合",
      },
      9,
    );
    confirmDispatch(state, proposal.id, 10);

    const blocked = materializeTaskPackage(
      state,
      {
        id: "task-resolution-blocked",
        dispatchProposalReviewId: proposal.id,
        title: "任务包",
        taskText: "执行线索复盘",
        capabilityResolution: {
          categoryCapabilityId: "cloud:cap-a",
          category: "通用品类",
          allowedTools: [],
          allowedSkills: [],
          dispatchReady: false,
          blockedReasons: [
            "missing_category_binding",
            "missing_tool_binding",
            "missing_skill_binding",
          ],
        },
      },
      11,
    );

    expect(blocked.taskPackage.status).toBe("blocked");
    expect(blocked.dispatchToRoleRequest.status).toBe("blocked");
    expect(blocked.dispatchToRoleRequest.categoryCapabilityId).toBe("cloud:cap-a");
    expect(blocked.dispatchToRoleRequest.toolSkillReady).toBe(false);
    expect(blocked.dispatchToRoleRequest.allowedTools).toEqual([]);
    expect(blocked.dispatchToRoleRequest.allowedSkills).toEqual([]);
    expect(createAicsMainFlowReadModel(state).executionPreflight.blockedReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_tool_binding" }),
        expect.objectContaining({ code: "missing_skill_binding" }),
      ]),
    );

    const ready = materializeTaskPackage(
      state,
      {
        id: "task-resolution-ready",
        dispatchProposalReviewId: proposal.id,
        title: "任务包",
        taskText: "执行线索复盘",
        capabilityResolution: {
          categoryCapabilityId: "cloud:cap-a",
          category: "通用品类",
          allowedTools: ["tool:web_search"],
          allowedSkills: ["skill:image-edit"],
          dispatchReady: true,
          blockedReasons: [],
        },
      },
      12,
    );

    expect(ready.taskPackage.status).toBe("materialized");
    expect(ready.dispatchToRoleRequest.status).toBe("ready");
    expect(ready.dispatchToRoleRequest.categoryCapabilityId).toBe("cloud:cap-a");
    expect(ready.dispatchToRoleRequest.toolSkillReady).toBe(true);
    expect(ready.dispatchToRoleRequest.apiBindingReady).toBe(true);
    expect(ready.dispatchToRoleRequest.allowedTools).toEqual(
      expect.arrayContaining([
        "tool:web_search",
        "core.openai.image.generate",
        "core.workspace.detail.write",
        "core.artifact.quality.check",
        "core.artifact.package.bundle",
      ]),
    );
    expect(ready.dispatchToRoleRequest.allowedSkills).toEqual(
      expect.arrayContaining([
        "skill:image-edit",
        "img:gen",
        "ws:write",
        "quality:check",
        "file:pack",
      ]),
    );
  });

  it("carries a known entitlement into the dispatch request without auto-confirming execution", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    confirmPlanning(state, planning.id, 8);
    const proposal = createDispatchProposal(
      state,
      {
        id: "dispatch-with-entitlement",
        planningPackageId: planning.id,
        rolePlanItemId: planning.rolePlanItemIds[0],
        title: "调度复核",
        riskSummary: "已选择授权岗位，但执行仍需人工确认",
        confirmationSummary: "确认授权岗位后生成派发单",
      },
      9,
    );
    confirmDispatch(state, proposal.id, 10);

    const materialized = materializeTaskPackage(
      state,
      {
        id: "task-with-entitlement",
        dispatchProposalReviewId: proposal.id,
        title: "任务包",
        taskText: "执行线索复盘",
        capabilityResolution: readyCapabilityResolution,
        request: {
          roleListingId: "local_rolelisting_marketplace_ops",
          roleTitle: "商城运营诊断官",
          entitlementId: "local_entitlement_marketplace_ops",
        },
      },
      11,
    );

    expect(materialized.dispatchToRoleRequest.roleListingId).toBe(
      "local_rolelisting_marketplace_ops",
    );
    expect(materialized.dispatchToRoleRequest.entitlementId).toBe(
      "local_entitlement_marketplace_ops",
    );
    expect(materialized.dispatchToRoleRequest.confirmExecution).toBe(false);
    expect(materialized.dispatchToRoleRequest.costConfirmed).toBe(false);
  });

  it("blocks role execution when a dispatch request has no usable tool or skill bindings", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    confirmPlanning(state, planning.id, 8);
    const proposal = createDispatchProposal(
      state,
      {
        id: "dispatch-missing-bindings",
        planningPackageId: planning.id,
        rolePlanItemId: planning.rolePlanItemIds[0],
        title: "调度预检",
        riskSummary: "缺少本地 Tool/Skill 组合",
        confirmationSummary: "确认能力组合后才能执行",
      },
      9,
    );
    confirmDispatch(state, proposal.id, 10);
    const materialized = materializeTaskPackage(
      state,
      {
        id: "task-missing-bindings",
        dispatchProposalReviewId: proposal.id,
        title: "任务包",
        taskText: "执行线索复盘",
        capabilityResolution: {
          categoryCapabilityId: "cloud:cap-a",
          category: "通用品类",
          allowedTools: [],
          allowedSkills: [],
          dispatchReady: false,
          blockedReasons: [
            "missing_category_binding",
            "missing_tool_binding",
            "missing_skill_binding",
          ],
        },
      },
      11,
    );

    expect(materialized.dispatchToRoleRequest.toolSkillReady).toBe(false);
    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 12);
    try {
      runApprovedTask(
        state,
        {
          taskPackageId: materialized.taskPackage.id,
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        },
        14,
      );
    } catch (error) {
      expectGate(error, "missing_category_binding");
    }
    expect(materialized.taskPackage.status).toBe("blocked");
    expect(materialized.dispatchToRoleRequest.status).toBe("blocked");
  });

  it("keeps tool skill readiness separate from missing API bindings", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    confirmPlanning(state, planning.id, 8);
    const proposal = createDispatchProposal(
      state,
      {
        id: "dispatch-missing-api",
        planningPackageId: planning.id,
        rolePlanItemId: planning.rolePlanItemIds[0],
        title: "API 绑定预检",
        riskSummary: "工具和 Skill 已绑定但 API 缺失",
        confirmationSummary: "补齐 API 绑定后才能执行",
      },
      9,
    );
    confirmDispatch(state, proposal.id, 10);
    const materialized = materializeTaskPackage(
      state,
      {
        id: "task-missing-api",
        dispatchProposalReviewId: proposal.id,
        title: "任务包",
        taskText: "执行线索复盘",
        capabilityResolution: {
          categoryCapabilityId: "cloud:cap-a",
          category: "通用品类",
          allowedTools: ["tool:web_search"],
          allowedSkills: ["skill:image-edit"],
          dispatchReady: false,
          blockedReasons: ["missing_api_binding"],
        },
      },
      11,
    );

    expect(materialized.dispatchToRoleRequest.toolSkillReady).toBe(true);
    expect(materialized.dispatchToRoleRequest.apiBindingReady).toBe(false);
    expect(createAicsMainFlowReadModel(state).executionPreflight.blockedReasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missing_api_binding" })]),
    );
    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 12);
    let duplicateError: unknown;
    try {
      runApprovedTask(
        state,
        {
          taskPackageId: materialized.taskPackage.id,
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        },
        14,
      );
    } catch (error) {
      expectGate(error, "missing_api_binding");
    }
    expect(materialized.taskPackage.status).toBe("blocked");
    expect(materialized.dispatchToRoleRequest.status).toBe("blocked");
  });

  it("blocks high-risk category capability execution until human approval", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    confirmPlanning(state, planning.id, 8);
    const proposal = createDispatchProposal(
      state,
      {
        id: "dispatch-high-risk-capability",
        planningPackageId: planning.id,
        rolePlanItemId: planning.rolePlanItemIds[0],
        title: "高风险能力预检",
        riskSummary: "能力会触达外部动作，必须人工批准",
        confirmationSummary: "确认高风险能力后才能执行",
      },
      9,
    );
    confirmDispatch(state, proposal.id, 10);
    const materialized = materializeTaskPackage(
      state,
      {
        id: "task-high-risk-capability",
        dispatchProposalReviewId: proposal.id,
        title: "任务包",
        taskText: "执行需要高风险能力的动作",
        capabilityResolution: {
          categoryCapabilityId: "cloud:cap-high-risk",
          category: "通用品类",
          allowedTools: ["tool:external_write"],
          allowedSkills: ["skill:external_operate"],
          dispatchReady: false,
          blockedReasons: ["high_risk_needs_human_approval"],
        },
      },
      11,
    );

    expect(materialized.dispatchToRoleRequest.categoryCapabilityId).toBe("cloud:cap-high-risk");
    expect(materialized.dispatchToRoleRequest.toolSkillReady).toBe(false);
    expect(materialized.dispatchToRoleRequest.apiBindingReady).toBe(true);
    expect(createAicsMainFlowReadModel(state).executionPreflight.blockedReasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "high_risk_needs_human_approval" })]),
    );
    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 12);
    try {
      runApprovedTask(
        state,
        {
          taskPackageId: materialized.taskPackage.id,
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        },
        14,
      );
    } catch (error) {
      expectGate(error, "high_risk_needs_human_approval");
      expect((error as Error).message).toContain("高风险能力");
    }
    expect(materialized.taskPackage.status).toBe("blocked");
    expect(materialized.dispatchToRoleRequest.status).toBe("blocked");
  });

  it("blocks role execution until marketplace authorization and cost are confirmed", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    confirmPlanning(state, planning.id, 8);
    const proposal = createDispatchProposal(
      state,
      {
        id: "dispatch-auth",
        planningPackageId: planning.id,
        rolePlanItemId: planning.rolePlanItemIds[0],
        title: "岗位商城执行调度",
        riskSummary: "需要费用与授权确认",
        confirmationSummary: "确认 roleListingId、entitlementId 和费用",
      },
      9,
    );
    confirmDispatch(state, proposal.id, 10);
    const materialized = materializeTaskPackage(
      state,
      {
        id: "task-auth",
        dispatchProposalReviewId: proposal.id,
        title: "任务包：岗位商品信息架构优化",
        taskText: "优化岗位商城首批岗位商品的能力说明、授权说明和输出样例",
        capabilityResolution: readyCapabilityResolution,
        request: {
          id: "dispatch-request-auth",
          roleListingId: "role_marketplace_listing_operations",
        },
      },
      11,
    );

    try {
      runApprovedTask(
        state,
        {
          taskPackageId: materialized.taskPackage.id,
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        },
        12,
      );
    } catch (error) {
      expectGate(error, "authorization_required");
      expect((error as Error).message).toContain("费用与授权");
    }
    expect(materialized.taskPackage.status).toBe("blocked");
    expect(materialized.dispatchToRoleRequest.status).toBe("blocked");

    try {
      runApprovedTask(
        state,
        {
          taskPackageId: materialized.taskPackage.id,
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
          entitlementId: "entitlement-role-marketplace-visual",
          confirmExecution: true,
        },
        13,
      );
    } catch (error) {
      expectGate(error, "authorization_required");
      expect((error as Error).message).toContain("费用与授权");
    }

    confirmRoleExecution(
      state,
      {
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        roleListingId: "role_marketplace_listing_operations",
        entitlementId: "entitlement-role-marketplace-visual",
      },
      14,
    );
    try {
      runApprovedTask(
        state,
        {
          taskPackageId: materialized.taskPackage.id,
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        },
        15,
      );
    } catch (error) {
      expectGate(error, "cost_not_confirmed");
      expect((error as Error).message).toContain("费用");
    }

    confirmRoleExecutionCost(
      state,
      {
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        entitlementId: "entitlement-role-marketplace-visual",
        ledgerRef: "ledger:role-usage-1",
      },
      16,
    );
    const run = runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        result: {
          outcome: "succeeded",
          summary: "岗位商品信息架构优化建议已完成。",
          artifactRefs: [
            "artifact:role-marketplace-listing-brief",
            "audit:audit-role-marketplace-1",
          ],
          executionEvidence: {
            humanConfirmationRef: "human:confirm:dispatch-request-auth:exec-auth",
            costSummary: {
              authorizationFeeCents: 0,
              executionFeeCents: 0,
              modelUsageCostCents: 0,
              totalCostCents: 0,
              currency: "CNY",
              source: "local_ledger",
              ledgerRef: "ledger:role-usage-1",
            },
            toolUsage: {
              totalToolCalls: 1,
              successfulCalls: 1,
              failedCalls: 0,
            },
            modelUsage: {
              inputTokens: 1280,
              outputTokens: 620,
              totalTokens: 1900,
              costCents: 0,
            },
          },
        },
      },
      17,
    );

    expect(run.dispatchToRoleRequest.status).toBe("completed");
    expect(run.roleResult?.artifactRefs).toEqual([
      "artifact:role-marketplace-listing-brief",
      "audit:audit-role-marketplace-1",
      "ledger:role-usage-1",
    ]);
    expect(run.roleResult?.executionEvidence?.modelUsage).toEqual({
      inputTokens: 1280,
      outputTokens: 620,
      totalTokens: 1900,
      costCents: 0,
    });
    expect(run.roleResult?.executionEvidence?.toolUsage?.totalToolCalls).toBe(1);

    let duplicateError: unknown;
    try {
      runApprovedTask(
        state,
        {
          taskPackageId: materialized.taskPackage.id,
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
          result: {
            outcome: "succeeded",
            summary: "重复执行同一个派发单。",
            artifactRefs: ["artifact:duplicate", "audit:audit-duplicate"],
            executionEvidence: {
              humanConfirmationRef: "human:confirm:dispatch-request-auth:duplicate",
              ledgerRef: "ledger:role-usage-1",
              costSummary: {
                authorizationFeeCents: 0,
                executionFeeCents: 0,
                modelUsageCostCents: 0,
                totalCostCents: 0,
                currency: "CNY",
                source: "local_ledger",
                ledgerRef: "ledger:role-usage-1",
              },
              modelUsageNotApplicable: true,
              modelUsageNotApplicableReason: "重复执行测试不调用模型。",
            },
          },
        },
        18,
      );
    } catch (error) {
      duplicateError = error;
    }
    expectGate(duplicateError, "duplicate_successful_execution");

    duplicateError = undefined;
    try {
      runApprovedTask(
        state,
        {
          taskPackageId: materialized.taskPackage.id,
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        },
        19,
      );
    } catch (error) {
      duplicateError = error;
    }
    expectGate(duplicateError, "duplicate_successful_execution");
  });

  it("downgrades claimed successful role results to blocked when production evidence is incomplete", () => {
    const { state, materialized } = prepareMaterializedExecutionState();
    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 13, {
      roleListingId: "role-listing-closure",
      roleTitle: "闭环执行岗位",
      entitlementId: "entitlement-closure",
      ledgerRef: "ledger:role_execution:entitlement-closure:exec-incomplete",
    });

    const run = runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        result: {
          id: "exec-incomplete",
          outcome: "succeeded",
          summary: "调用方声称岗位执行完成。",
          artifactRefs: [],
        },
      },
      15,
    );

    expect(run.dispatchToRoleRequest.status).toBe("blocked");
    expect(run.roleResult).toMatchObject({
      status: "blocked",
      outcome: "blocked",
      summary: expect.stringContaining("岗位执行被阻塞"),
    });
    expect(run.roleResult?.executionEvidence?.recoverySuggestion).toContain("业务产物缺失");
    expect(run.roleResult?.executionEvidence?.recoverySuggestion).toContain("审计记录缺失");
    expect(run.roleResult?.executionEvidence?.recoverySuggestion).toContain("费用摘要缺失");
    expect(run.roleResult?.executionEvidence?.recoverySuggestion).toContain("模型费用证据缺失");
    expect(run.roleResult?.executionEvidence?.recoverySuggestion).toContain("人工确认记录缺失");
    expect(createAicsMainFlowReadModel(state).executionClosure).toMatchObject({
      status: "blocked",
      evidenceReadback: {
        hasBusinessArtifact: false,
      },
    });
  });

  it("does not count memory candidates as business artifacts for successful role results", () => {
    const { state, materialized } = prepareMaterializedExecutionState();
    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 13, {
      roleListingId: "role-listing-closure",
      roleTitle: "闭环执行岗位",
      entitlementId: "entitlement-closure",
      ledgerRef: "ledger:role_execution:entitlement-closure:exec-memory-only",
    });

    const run = runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        result: {
          id: "exec-memory-only",
          outcome: "succeeded",
          summary: "执行器只沉淀了候选记忆，但没有业务产物。",
          artifactRefs: ["memory_candidate:candidate-1", "audit:audit-memory-only"],
          executionEvidence: {
            ledgerRef: "ledger:role_execution:entitlement-closure:exec-memory-only",
            humanConfirmationRef: "human:confirm:dispatch_to_role_request_1:exec-memory-only",
            costSummary: {
              authorizationFeeCents: 0,
              executionFeeCents: 0,
              modelUsageCostCents: 0,
              totalCostCents: 0,
              currency: "CNY",
              source: "local_ledger",
              ledgerRef: "ledger:role_execution:entitlement-closure:exec-memory-only",
            },
            modelUsageNotApplicable: true,
            modelUsageNotApplicableReason: "本次只登记候选记忆。",
            auditReadback: { auditRecordId: "audit-memory-only" },
            ledgerReadback: {
              ledgerRef: "ledger:role_execution:entitlement-closure:exec-memory-only",
            },
          },
        },
      },
      15,
    );

    expect(run.dispatchToRoleRequest.status).toBe("blocked");
    expect(run.roleResult?.outcome).toBe("blocked");
    expect(run.roleResult?.executionEvidence?.recoverySuggestion).toContain("业务产物缺失");
    expect(createAicsMainFlowReadModel(state).executionClosure).toMatchObject({
      status: "blocked",
      evidenceReadback: {
        hasBusinessArtifact: false,
      },
      businessResult: {
        artifactRefs: [],
      },
    });
  });

  it("blocks role execution when a role plan item needs a unique tool/skill capability", () => {
    const { state, planning } = prepareConfirmedPlanningState();
    const item = state.rolePlanItems.find(
      (candidate) => candidate.id === planning.rolePlanItemIds[0],
    );
    expect(item).toBeTruthy();
    item!.title = "岗位商城付费结算规则发布";
    item!.roleCapabilityRef = "role-marketplace.billing.publish.unique";
    item!.taskIntent = "发布岗位授权费用规则，需要独特品类 Skill";
    item!.expectedOutput = "合规费用规则草稿";
    item!.humanConfirmationRequired = true;

    confirmPlanning(state, planning.id, 8);
    const proposal = createDispatchProposal(
      state,
      {
        id: "dispatch-unique",
        planningPackageId: planning.id,
        rolePlanItemId: planning.rolePlanItemIds[0],
        title: "费用规则调度",
        riskSummary: "需要独特能力申请",
        confirmationSummary: "确认 tool/skill 后才能执行",
      },
      9,
    );
    confirmDispatch(state, proposal.id, 10);

    const readModelBefore = createAicsMainFlowReadModel(state);
    expect(readModelBefore.capabilities.uniqueRequests).toHaveLength(1);
    expect(readModelBefore.capabilities.matches[0]?.status).toBe("needs_unique_capability");

    const materialized = materializeTaskPackage(
      state,
      {
        id: "task-unique",
        dispatchProposalReviewId: proposal.id,
        title: "任务包：费用规则",
        taskText: "岗位 + 动作 + 输入 + 输出要求 + 风险限制",
        capabilityResolution: readyCapabilityResolution,
        request: { id: "dispatch-request-unique" },
      },
      11,
    );

    expect(materialized.taskPackage.status).toBe("blocked");
    expect(materialized.dispatchToRoleRequest.status).toBe("blocked");
    expect(materialized.dispatchToRoleRequest.capabilityRequestId).toBe(
      "unique_cap_req:role-plan-1",
    );
    expect(createAicsMainFlowReadModel(state).readiness.canRunApprovedTask).toBe(false);

    try {
      runApprovedTask(
        state,
        {
          taskPackageId: materialized.taskPackage.id,
          dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        },
        12,
      );
    } catch (error) {
      expectGate(error, "unique_capability_pending");
      expect((error as Error).message).toContain("独特能力");
    }

    const approval = setUniqueCapabilityApprovalForDispatch(
      state,
      { capabilityRequestId: "unique_cap_req:role-plan-1", status: "approved" },
      13,
    );
    expect(approval.updatedRequests).toHaveLength(1);
    expect(approval.updatedTaskPackages).toHaveLength(1);
    expect(materialized.taskPackage.status).toBe("materialized");
    expect(materialized.dispatchToRoleRequest.status).toBe("ready");
    expect(materialized.dispatchToRoleRequest.toolSkillReady).toBe(true);
    expect(materialized.dispatchToRoleRequest.allowedTools).toContain(
      "tool.execute.category_specific",
    );
    expect(materialized.dispatchToRoleRequest.allowedSkills).toContain(
      "skill.岗位商城.specific_rules",
    );

    const readModelAfterApproval = createAicsMainFlowReadModel(state);
    expect(readModelAfterApproval.capabilities.uniqueRequests[0]?.status).toBe("approved");
    expect(readModelAfterApproval.capabilities.matches[0]?.status).toBe("satisfied");
    expect(
      readModelAfterApproval.executionPreflight.blockedReasons.map((reason) => reason.code),
    ).not.toContain("tool_skill_not_ready");

    confirmAuthorizedExecution(state, materialized.dispatchToRoleRequest.id, 14, {
      roleListingId: "role-billing-publisher",
      entitlementId: "entitlement-billing-publisher",
    });
    const run = runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
      },
      16,
    );
    expect(run.dispatchToRoleRequest.status).toBe("running");
  });

  it("persists state and exposes a read model", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aics-main-flow-store-"));
    try {
      const store = new AicsMainFlowStore(path.join(dir, "state.json"));
      const observation = store.update((state) =>
        prepareObservation(
          state,
          { id: "obs-1", title: "观察", summary: "事实", signals: observationSignals },
          2,
        ),
      );

      expect(observation.id).toBe("obs-1");
      const readModel = store.readModel();
      expect(readModel.latest.observationPackage?.id).toBe("obs-1");
      expect(readModel.counts.interactions).toBe(0);
      expect(readModel.blockedReasons.map((reason) => reason.code)).toContain(
        "missing_attribution_report",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes interactions in the read model", () => {
    const state = createEmptyAicsMainFlowState(1);
    const interaction = createInteraction(
      state,
      {
        id: "interaction-1",
        stage: "observation",
        message: "提升岗位商城首批岗位授权转化与执行成功率",
        proposedNextAction: "prepare_observation_package",
      },
      2,
    );

    const readModel = createAicsMainFlowReadModel(state);
    expect(readModel.latest.interaction?.id).toBe(interaction.id);
    expect(readModel.counts.interactions).toBe(1);
    expect(readModel.objects.interactions).toHaveLength(1);
  });

  it("persists observation evidence run summaries in the read model", () => {
    const state = createEmptyAicsMainFlowState(1);
    const observation = prepareObservation(
      state,
      { id: "obs-1", title: "观察", summary: "事实", signals: observationSignals },
      2,
    );
    const runRecord = recordObservationEvidenceRun(
      state,
      {
        id: "run-1",
        planId: "plan-1",
        status: "blocked",
        observationPackageId: observation.id,
        acceptedCount: 1,
        needsReviewCount: 2,
        rejectedCount: 3,
        missingCount: 4,
        blockedReasons: ["外部来源需要授权"],
        runResultJson: JSON.stringify({ planId: "plan-1", status: "blocked" }),
      },
      3,
    );

    const readModel = createAicsMainFlowReadModel(state);
    expect(readModel.latest.observationEvidenceRun?.id).toBe(runRecord.id);
    expect(readModel.counts.observationEvidenceRuns).toBe(1);
    expect(readModel.objects.observationEvidenceRuns[0]).toMatchObject({
      id: "run-1",
      acceptedCount: 1,
      rejectedCount: 3,
      blockedReasons: ["外部来源需要授权"],
    });
  });
});
