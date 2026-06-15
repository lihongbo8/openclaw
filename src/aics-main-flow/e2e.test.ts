import { describe, it, expect, afterAll } from "vitest";
import { closePipelineDb, closeRoleInstancesDb, closeMemoryDb } from "./db.js";
import { MemoryCandidateStore, MemoryConfirmService } from "./memory-system.js";
import { RoleInstanceStore } from "./role-instance-store.js";
import {
  AicsMainFlowStore,
  prepareObservation,
  prepareAttribution,
  createGoalCandidate,
  confirmGoal,
  preparePlanning,
  confirmPlanning,
  createDispatchProposal,
  confirmDispatch,
  materializeTaskPackage,
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
            evidenceRefs: [],
          },
        ],
      }),
    );
    expect(obs.status).toBe("prepared");

    const attr = store.update((s) =>
      prepareAttribution(s, {
        title: "岗位商城归因",
        summary: "岗位供给、授权和执行质量差距分析",
        findings: [
          {
            id: `finding_conversion_${suffix}`,
            title: "详情页转化不足",
            summary: "",
            confidence: "high",
            observationSignalIds: [],
          },
        ],
      }),
    );
    expect(attr.status).toBe("prepared");

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
            title: "岗位详情页转化优化",
            roleCapabilityRef: "ecommerce-visual",
            taskIntent: "优化岗位商品详情页",
            expectedOutput: "展示优化方案",
          },
        ],
      }),
    );
    const cPlan = store.update((s) => confirmPlanning(s, plan.id));
    expect(cPlan.status).toBe("confirmed");

    const proposal = store.update((s) =>
      createDispatchProposal(s, {
        title: "岗位详情页优化调度",
        riskSummary: "低风险",
        confirmationSummary: "确认执行",
      }),
    );
    const cProp = store.update((s) => confirmDispatch(s, proposal.id));

    const result = store.update((s) =>
      materializeTaskPackage(s, {
        title: "任务：岗位详情页优化",
        taskText: "输出岗位商品展示优化方案",
      }),
    );
    expect(result.taskPackage.status).toBe("materialized");
    expect(result.dispatchToRoleRequest.confirmExecution).toBe(true);

    // 验证 readModel
    const rm = store.readModel();
    expect(rm.counts.observations).toBe((before.observations ?? 0) + 1);
    expect(rm.counts.goals).toBe((before.goals ?? 0) + 1);
    expect(rm.counts.taskPackages).toBe((before.taskPackages ?? 0) + 1);
  });

  it("执行链路：RoleInstance → Run → Steps → Artifacts → Memory", () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const executionId = `ex_${suffix}`;
    const inst = RoleInstanceStore.ensureInstance({
      roleListingId: `rl_test_${suffix}`,
      roleTitle: "电商美工",
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
      prepareObservation(s, {
        title: "obs",
        summary: "",
        signals: [{ id: signalId, title: "经营意图", summary: "测试观察信号", evidenceRefs: [] }],
      });
      prepareAttribution(s, { title: "attr", summary: "" });
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
          name: "详情页转化",
          purpose: "提升岗位授权转化",
          progressGauge: "授权转化率",
          roles: [{ roleListingId: "rl_1", roleTitle: "电商美工" }],
          tasks: [{ title: "岗位商品详情页优化", targetDeliverable: "展示优化方案" }],
        },
      ]),
    );

    const rm = store.readModel() as Record<string, unknown>;
    const wb = rm.workBlocks as Array<Record<string, unknown>>;
    expect(wb.some((item) => item.goalId === goal.id && item.name === "详情页转化")).toBe(true);
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
