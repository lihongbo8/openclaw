import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AicsMainFlowStore,
  confirmDispatch,
  confirmGoal,
  confirmPlanning,
  createAicsMainFlowReadModel,
  createDispatchProposal,
  createEmptyAicsMainFlowState,
  createGoalCandidate,
  createInteraction,
  materializeTaskPackage,
  prepareAttribution,
  prepareObservation,
  preparePlanning,
  runApprovedTask,
} from "./store.js";
import { AicsMainFlowGateError } from "./types.js";

const observationSignals = [
  { id: "signal-1", title: "经营意图", summary: "人工经营意图", evidenceRefs: ["interaction-1"] },
];

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
  const attribution = prepareAttribution(
    state,
    {
      id: "attr-1",
      observationPackageId: observation.id,
      title: "归因",
      summary: "增长卡在渠道质量",
    },
    3,
  );
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
    4,
  );
  confirmGoal(state, goal.id, 5);
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
    6,
  );
  return { state, planning };
}

describe("AICS main flow store", () => {
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
    const attribution = prepareAttribution(
      state,
      { id: "attr-1", observationPackageId: observation.id, title: "归因", summary: "原因" },
      6,
    );
    createGoalCandidate(
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
      7,
    );

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
        8,
      ),
    ).toThrowError(AicsMainFlowGateError);
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
        request: { id: "dispatch-request-1", roleListingId: "role-lead-review" },
      },
      13,
    );
    const run = runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        entitlementId: "entitlement-role-lead-review",
        confirmExecution: true,
        costConfirmed: true,
      },
      14,
    );

    expect(run.dispatchToRoleRequest.status).toBe("running");
    expect(createAicsMainFlowReadModel(state).readiness.canRunApprovedTask).toBe(true);
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
        title: "任务包：岗位商城详情页优化",
        taskText: "优化岗位商城首批岗位商品详情页",
        request: {
          id: "dispatch-request-auth",
          roleListingId: "role_marketplace_ecommerce_visual",
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
      expectGate(error, "cost_not_confirmed");
      expect((error as Error).message).toContain("费用");
    }

    const run = runApprovedTask(
      state,
      {
        taskPackageId: materialized.taskPackage.id,
        dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
        entitlementId: "entitlement-role-marketplace-visual",
        confirmExecution: true,
        costConfirmed: true,
        ledgerRef: "ledger:role-usage-1",
        memoryCandidateRef: "memory_candidate:role-marketplace-learning-1",
        result: {
          outcome: "succeeded",
          summary: "岗位商城详情页优化建议已完成。",
          artifactRefs: ["artifact:role-marketplace-visual-brief"],
        },
      },
      14,
    );

    expect(run.dispatchToRoleRequest.status).toBe("completed");
    expect(run.roleResult?.artifactRefs).toEqual([
      "artifact:role-marketplace-visual-brief",
      "ledger:role-usage-1",
      "memory_candidate:role-marketplace-learning-1",
    ]);
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
      expectGate(error, "missing_dispatch_to_role_request");
      expect((error as Error).message).toContain("missing category capability");
    }
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
});
