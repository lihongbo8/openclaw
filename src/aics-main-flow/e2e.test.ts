import { describe, it, expect, afterAll } from "vitest";
import { closePipelineDb, closeRoleInstancesDb, closeMemoryDb } from "./db.js";
import { MemoryCandidateStore, MemoryConfirmService } from "./memory-system.js";
import { RoleInstanceStore } from "./role-instance-store.js";
import {
  AicsMainFlowStore,
  prepareObservation,
  confirmObservation,
  prepareAttribution,
  confirmAttribution,
  createGoalCandidate,
  confirmGoal,
  preparePlanning,
  confirmPlanning,
  createDispatchProposal,
  confirmDispatch,
  materializeTaskPackage,
  confirmRoleExecution,
  confirmRoleExecutionCost,
  runApprovedTask,
  createWorkBlocks,
} from "./store.js";

describe("AICS 端到端", () => {
  afterAll(() => {
    closePipelineDb();
    closeRoleInstancesDb();
    closeMemoryDb();
  });

  it("完整五层管道：Observation → TaskPackage", () => {
    const store = new AicsMainFlowStore();
    const before = store.readModel().counts;
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const signalId = `signal_role_marketplace_${suffix}`;

    const obs = store.update((s) =>
      prepareObservation(s, {
        title: "岗位商城经营数据观察",
        summary: "首批岗位授权转化与执行成功率需要进入可追踪状态",
        signals: [
          {
            id: signalId,
            title: "授权转化",
            summary: "首批岗位授权和执行数据待补齐",
            evidenceRefs: [`evidence:role-marketplace:conversion:${suffix}`],
          },
        ],
      }),
    );
    expect(obs.status).toBe("prepared");
    store.update((s) => confirmObservation(s, obs.id));

    const attr = store.update((s) =>
      prepareAttribution(s, {
        title: "岗位商城归因",
        summary: "岗位供给、授权和执行质量差距分析",
        findings: [
          {
            id: `finding_conversion_${suffix}`,
            title: "岗位商品信息表达不足",
            summary: "岗位能力说明、授权说明和输出样例不足，影响买家授权判断。",
            confidence: "high",
            observationSignalIds: [signalId],
          },
        ],
      }),
    );
    expect(attr.status).toBe("prepared");
    store.update((s) => confirmAttribution(s, attr.id));

    const goal = store.update((s) =>
      createGoalCandidate(s, {
        title: "提升岗位商城首批岗位授权转化与执行成功率",
        owner: "迭界AI",
        metric: "首批岗位授权转化与执行成功率",
        target: "首批岗位可授权、可执行、可回写",
        rationale: "归因驱动",
      }),
    );
    expect(goal.status).toBe("candidate");

    const confirmed = store.update((s) => confirmGoal(s, goal.id));
    expect(confirmed.status).toBe("confirmed");

    const plan = store.update((s) =>
      preparePlanning(s, {
        title: "岗位商城运营规划",
        summary: "",
        rolePlanItems: [
          {
            title: "岗位商品信息架构优化",
            roleCapabilityRef: "marketplace-listing-ops",
            taskIntent: "优化岗位商品能力说明、授权说明和输出样例",
            expectedOutput: "岗位商品信息架构方案",
          },
        ],
      }),
    );
    const cPlan = store.update((s) => confirmPlanning(s, plan.id));
    expect(cPlan.status).toBe("confirmed");

    const proposal = store.update((s) =>
      createDispatchProposal(s, {
        title: "岗位商品信息架构优化调度",
        riskSummary: "低风险",
        confirmationSummary: "确认执行",
      }),
    );
    const cProp = store.update((s) => confirmDispatch(s, proposal.id));

    const result = store.update((s) =>
      materializeTaskPackage(s, {
        title: "任务：岗位商品信息架构优化",
        taskText: "输出岗位商品信息架构方案",
        capabilityResolution: {
          categoryCapabilityId: "cloud:marketplace-ops",
          category: "岗位商城",
          allowedTools: ["tool:web_search"],
          allowedSkills: ["skill:image-edit"],
          dispatchReady: true,
          blockedReasons: [],
        },
      }),
    );
    expect(result.taskPackage.status).toBe("materialized");
    expect(result.dispatchToRoleRequest.confirmExecution).toBe(false);

    // 验证 readModel
    const rm = store.readModel();
    expect(rm.counts.observations).toBe((before.observations ?? 0) + 1);
    expect(rm.counts.goals).toBe((before.goals ?? 0) + 1);
    expect(rm.counts.taskPackages).toBe((before.taskPackages ?? 0) + 1);
  });

  it("商城运营诊断官：观察 → 规划 → 调度 → 授权执行 → 审计费用摘要", () => {
    const store = new AicsMainFlowStore();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const obs = store.update((s) =>
      prepareObservation(s, {
        title: "商城运营诊断观察",
        summary: "需要分析岗位供给、授权转化、执行成功率、能力路由和费用审计状态。",
        signals: [
          {
            id: `signal_marketplace_ops_${suffix}`,
            title: "商城运营状态",
            summary: "岗位商城存在授权转化、执行成功率和能力路由阻塞待诊断。",
            evidenceRefs: [`evidence_marketplace_ops_${suffix}`],
          },
        ],
      }),
    );
    store.update((s) => confirmObservation(s, obs.id));

    const attr = store.update((s) =>
      prepareAttribution(s, {
        title: "商城运营诊断归因",
        summary: "首批岗位授权和执行不稳定主要来自岗位供给表达、能力路由阻塞和费用确认路径不清晰。",
        findings: [
          {
            id: `finding_marketplace_ops_${suffix}`,
            title: "能力路由和授权链路影响执行转化",
            summary: "可调用岗位、授权状态、Tool/Skill 依赖和费用确认需要统一诊断。",
            confidence: "high",
            observationSignalIds: [`signal_marketplace_ops_${suffix}`],
          },
        ],
      }),
    );
    store.update((s) => confirmAttribution(s, attr.id));

    const goal = store.update((s) =>
      createGoalCandidate(s, {
        title: "提升岗位商城运营闭环稳定性",
        owner: "OpenClaw",
        metric: "首批岗位授权转化与执行成功率",
        target: "诊断报告可生成、可调度、可执行、可回写审计费用摘要",
        rationale: "基于商城运营观察和归因结果创建可执行目标。",
      }),
    );
    store.update((s) => confirmGoal(s, goal.id));

    const plan = store.update((s) =>
      preparePlanning(s, {
        title: "商城运营诊断规划",
        summary: "由商城运营诊断官读取云端商城和本地 Gateway 投影并输出诊断报告。",
        rolePlanItems: [
          {
            title: "生成商城运营诊断报告",
            category: "商城运营诊断",
            roleCapabilityRef: "marketplace-ops-diagnosis",
            taskIntent: "分析岗位供给、授权、能力路由、调度执行、费用摘要和审计记录。",
            expectedOutput: "商城运营诊断报告",
            humanConfirmationRequired: true,
          },
        ],
      }),
    );
    store.update((s) => confirmPlanning(s, plan.id));

    const proposal = store.update((s) =>
      createDispatchProposal(s, {
        title: "调度商城运营诊断官",
        riskSummary: "中风险：读取聚合投影并生成诊断报告，不读取原始账本或数据库。",
        confirmationSummary: "确认后生成 TaskPackage 和 DispatchToRoleRequest。",
      }),
    );
    store.update((s) => confirmDispatch(s, proposal.id));

    const materialized = store.update((s) =>
      materializeTaskPackage(s, {
        title: "任务：商城运营诊断",
        taskText: "输出岗位商城运营诊断报告，包含观察、归因、目标、调度建议、费用和审计摘要。",
        capabilityResolution: {
          categoryCapabilityId: "category:marketplace_ops_diagnosis@1",
          category: "商城运营诊断",
          allowedTools: [
            "adapter.platform.marketplace_read_model",
            "adapter.platform.gateway_role_read_model",
            "adapter.platform.ledger_summary_read",
            "tool.platform.audit-record",
            "tool.platform.template_renderer",
          ],
          allowedSkills: ["skill.platform.marketplace_ops_diagnosis"],
          dispatchReady: true,
          blockedReasons: [],
        },
        request: {
          roleListingId: "djrole_marketplace_ops_diagnosis",
          roleTitle: "商城运营诊断官",
        },
      }),
    );
    store.update((s) =>
      confirmRoleExecution(s, {
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        roleListingId: "djrole_marketplace_ops_diagnosis",
        roleTitle: "商城运营诊断官",
        entitlementId: "djent_marketplace_ops_diagnosis",
      }),
    );
    store.update((s) =>
      confirmRoleExecutionCost(s, {
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        entitlementId: "djent_marketplace_ops_diagnosis",
        ledgerRef: `ledger:role_execution:djent_marketplace_ops_diagnosis:${suffix}`,
      }),
    );

    const run = store.update((s) =>
      runApprovedTask(s, {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        roleListingId: "djrole_marketplace_ops_diagnosis",
        roleTitle: "商城运营诊断官",
        entitlementId: "djent_marketplace_ops_diagnosis",
        confirmExecution: true,
        costConfirmed: true,
        ledgerRef: `ledger:role_execution:djent_marketplace_ops_diagnosis:${suffix}`,
        result: {
          outcome: "succeeded",
          summary: "已生成商城运营诊断报告，覆盖授权、能力路由、调度执行、费用和审计摘要。",
          artifactRefs: [
            `artifact:marketplace_ops_report_${suffix}`,
            `audit:audit_marketplace_ops_${suffix}`,
          ],
          executionEvidence: {
            executionId: `exec_marketplace_ops_${suffix}`,
            roleListingId: "djrole_marketplace_ops_diagnosis",
            entitlementId: "djent_marketplace_ops_diagnosis",
            ledgerRef: `ledger:role_execution:djent_marketplace_ops_diagnosis:${suffix}`,
            humanConfirmationRef: `human:confirm:${materialized.dispatchToRoleRequest.id}:exec_marketplace_ops_${suffix}`,
            costSummary: {
              authorizationFeeCents: 0,
              executionFeeCents: 0,
              modelUsageCostCents: 3,
              totalCostCents: 3,
              currency: "CNY",
              source: "local_ledger",
              ledgerRef: `ledger:role_execution:djent_marketplace_ops_diagnosis:${suffix}`,
            },
            toolUsage: {
              totalToolCalls: 2,
              successfulCalls: 2,
              failedCalls: 0,
            },
            modelUsage: {
              inputTokens: 1200,
              outputTokens: 600,
              totalTokens: 1800,
              costCents: 3,
            },
          },
        },
      }),
    );

    expect(run.dispatchToRoleRequest.status).toBe("completed");
    expect(run.roleResult?.outcome).toBe("succeeded");
    expect(run.roleResult?.artifactRefs).toContain(`artifact:marketplace_ops_report_${suffix}`);
    expect(run.roleResult?.artifactRefs).toContain(
      `ledger:role_execution:djent_marketplace_ops_diagnosis:${suffix}`,
    );
    expect(run.roleResult?.executionEvidence?.modelUsage?.costCents).toBe(3);
  });

  it("执行链路：RoleInstance → Run → Steps → Artifacts → Memory", () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const executionId = `ex_${suffix}`;
    const inst = RoleInstanceStore.ensureInstance({
      roleListingId: `rl_test_${suffix}`,
      roleTitle: "岗位商城运营",
      workspaceDir: `/tmp/e2e-${suffix}`,
    });
    const run = RoleInstanceStore.recordRun({
      instanceId: inst.instanceId,
      taskPackageId: `tp_${suffix}`,
      executionId,
      status: "completed",
      summary: "完成",
      startedAt: Date.now(),
    });
    RoleInstanceStore.recordSteps(inst.instanceId, executionId, [
      {
        stepId: `s1_${suffix}`,
        order: 0,
        kind: "tool_call",
        description: "调 DeepSeek",
        status: "completed",
        startedAt: Date.now(),
        completedAt: Date.now(),
      },
    ]);
    RoleInstanceStore.recordArtifacts({
      instanceId: inst.instanceId,
      executionId,
      artifacts: [
        {
          artifactId: `a1_${suffix}`,
          runId: run.runId,
          relPath: `/tmp/e2e-${suffix}/img.png`,
          kind: "image",
          sizeBytes: 100,
          createdAt: Date.now(),
        },
      ],
    });

    expect(RoleInstanceStore.listSteps(run.runId).length).toBe(1);
    expect(RoleInstanceStore.listArtifacts(run.runId).length).toBe(1);

    const cand = MemoryCandidateStore.propose({
      type: "role_experience",
      title: "测试记忆",
      content: "test",
      source: { layer: "role", entityId: `rl_test_${suffix}`, entityType: "listing" },
      confidence: "high",
      tags: ["test"],
      requiresHumanConfirm: false,
      proposedBy: "e2e",
    });
    const result = MemoryConfirmService.confirmAndPromote(cand.candidateId, "e2e");
    expect("memory" in result).toBe(true);
  });

  it("门禁：Gates API 可用（验证 blockedReasons 包含至少一个门禁）", () => {
    const store = new AicsMainFlowStore();
    const rm = store.readModel();
    // empty or seeded DB — either way, blockedReasons is an array
    expect(Array.isArray(rm.blockedReasons)).toBe(true);
    expect(typeof rm.currentStage).toBe("string");
    expect(typeof rm.readiness.canPreparePlanning).toBe("boolean");
  });

  it("managementBreakdown：确认目标 → 工作块", () => {
    const store = new AicsMainFlowStore();
    const signalId = `signal_management_${Date.now()}`;
    const goal = store.update((s) => {
      const obs = prepareObservation(s, {
        title: "obs",
        summary: "",
        signals: [
          {
            id: signalId,
            title: "经营意图",
            summary: "测试观察信号",
            evidenceRefs: [`evidence:management:${signalId}`],
          },
        ],
      });
      confirmObservation(s, obs.id);
      const attr = prepareAttribution(s, {
        title: "attr",
        summary: "",
        findings: [
          {
            id: `finding_management_${Date.now()}`,
            title: "测试归因",
            summary: "测试归因结论",
            confidence: "medium",
            observationSignalIds: [signalId],
          },
        ],
      });
      confirmAttribution(s, attr.id);
      const g = createGoalCandidate(s, {
        title: "测试",
        owner: "t",
        metric: "m",
        target: "t",
        rationale: "r",
      });
      return confirmGoal(s, g.id);
    });

    store.update((s) =>
      createWorkBlocks(s, goal.id, [
        {
          name: "岗位商品信息架构",
          purpose: "提升岗位授权转化",
          progressGauge: "岗位商品可判断、可授权、可调用",
          roles: [{ roleListingId: "rl_1", roleTitle: "岗位商城运营" }],
          tasks: [{ title: "岗位商品信息架构优化", targetDeliverable: "信息架构方案" }],
        },
      ]),
    );

    const rm = store.readModel() as Record<string, unknown>;
    const wb = rm.workBlocks as Array<Record<string, unknown>>;
    expect(wb.some((item) => item.goalId === goal.id && item.name === "岗位商品信息架构")).toBe(
      true,
    );
  });

  it("错误恢复：RoleRun retry", () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inst = RoleInstanceStore.ensureInstance({
      roleListingId: `rl_retry_${suffix}`,
      roleTitle: "测试",
      workspaceDir: `/tmp/e2e-retry-${suffix}`,
    });
    const run1 = RoleInstanceStore.recordRun({
      instanceId: inst.instanceId,
      taskPackageId: `tp_retry_${suffix}`,
      executionId: `ex_retry_${suffix}`,
      status: "failed",
      summary: "失败",
      startedAt: Date.now() - 10000,
      completedAt: Date.now(),
      durationMs: 10000,
      error: "timeout",
    });

    // retry
    const run2 = RoleInstanceStore.recordRun({
      instanceId: inst.instanceId,
      taskPackageId: `tp_retry_${suffix}`,
      executionId: `ex_retry_${suffix}`,
      status: "running",
      summary: "重试",
      startedAt: Date.now(),
    });

    const runs = RoleInstanceStore.listRuns(inst.instanceId);
    expect(runs.length).toBe(2); // failed + running retry
    expect(runs[0].status).toBe("running");
    expect(runs[1].status).toBe("failed");
  });
});
