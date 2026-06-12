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
  materializeTaskPackage,
  prepareAttribution,
  prepareObservation,
  preparePlanning,
  runApprovedTask,
} from "./store.js";
import { AicsMainFlowGateError } from "./types.js";

function expectGate(error: unknown, code: AicsMainFlowGateError["code"]) {
  expect(error).toBeInstanceOf(AicsMainFlowGateError);
  expect((error as AicsMainFlowGateError).code).toBe(code);
}

function prepareConfirmedPlanningState() {
  const state = createEmptyAicsMainFlowState(1);
  const observation = prepareObservation(
    state,
    { id: "obs-1", title: "观察", summary: "收入和交付事实" },
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

    const observation = prepareObservation(
      state,
      { id: "obs-1", title: "观察", summary: "事实" },
      3,
    );
    const attribution = prepareAttribution(
      state,
      { id: "attr-1", observationPackageId: observation.id, title: "归因", summary: "原因" },
      4,
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
      5,
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
        6,
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
      },
      14,
    );

    expect(run.dispatchToRoleRequest.status).toBe("running");
    expect(createAicsMainFlowReadModel(state).readiness.canRunApprovedTask).toBe(true);
  });

  it("persists state and exposes a read model", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aics-main-flow-store-"));
    try {
      const store = new AicsMainFlowStore(path.join(dir, "state.json"));
      const observation = store.update((state) =>
        prepareObservation(state, { id: "obs-1", title: "观察", summary: "事实" }, 2),
      );

      expect(observation.id).toBe("obs-1");
      const readModel = store.readModel();
      expect(readModel.latest.observationPackage?.id).toBe("obs-1");
      expect(readModel.blockedReasons.map((reason) => reason.code)).toContain(
        "missing_attribution_report",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
