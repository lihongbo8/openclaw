import { describe, it, expect } from "vitest";
import {
  generateGoalCandidate,
  generatePlanningPackage,
  generateDispatchProposal,
  materializeTaskPackage,
} from "./pipeline-generators.js";
import type {
  CompanyGoal,
  AttributionReport,
  ObservationPackage,
  PlanningPackage,
  RolePlanItem,
  DispatchProposalReview,
} from "./types.js";

const now = Date.now();

function makeGoal(): CompanyGoal {
  return {
    id: "g1",
    kind: "CompanyGoal",
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
    auditRefs: [],
    attributionReportId: "a1",
    title: "提升岗位产出",
    owner: "test",
    metric: "执行次数",
    target: "10 次",
    rationale: "需要更多执行",
  };
}

function makeAttr(): AttributionReport {
  return {
    id: "a1",
    kind: "AttributionReport",
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
    auditRefs: [],
    observationPackageId: "o1",
    title: "归因",
    summary: "执行不足",
    findings: [
      {
        id: "f1",
        title: "执行太少",
        summary: "只有3次",
        confidence: "high",
        observationSignalIds: [],
      },
      {
        id: "f2",
        title: "数据不足",
        summary: "缺基线",
        confidence: "low",
        observationSignalIds: [],
      },
    ],
  };
}

function makeObs(): ObservationPackage {
  return {
    id: "o1",
    kind: "ObservationPackage",
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
    auditRefs: [],
    title: "观察",
    summary: "3次执行",
    signals: [{ id: "s1", title: "执行次数", summary: "3 次", evidenceRefs: [] }],
  };
}

describe("generateGoalCandidate", () => {
  it("marks data insufficient when no data", () => {
    const result = generateGoalCandidate({
      attributionResult: {
        completionStatus: "unknown",
        gapSummary: "",
        rankedCauses: [],
        dataInsufficient: true,
        dataInsufficientReason: "缺数据",
      },
      attributionReportId: "a1",
      owner: "test",
    });
    expect(result.title).toBe("提升岗位商城首批岗位授权转化与执行成功率");
    expect(result.metric).toBe("首批岗位授权转化与执行成功率");
    expect(result.rationale).toContain("数据基线");
  });

  it("generates fix goal when off track", () => {
    const result = generateGoalCandidate({
      attributionResult: {
        completionStatus: "off_track",
        gapSummary: "差距40%",
        rankedCauses: [
          {
            rank: 1,
            title: "执行太少",
            summary: "只3次",
            confidence: "high",
            impactLevel: "critical",
            evidenceRefs: [],
          },
        ],
        dataInsufficient: false,
      },
      attributionReportId: "a1",
      owner: "test",
    });
    expect(result.title).toBe("提升岗位商城首批岗位授权转化与执行成功率");
    expect(result.rationale).toContain("岗位商城运营问题");
  });
});

describe("generatePlanningPackage", () => {
  it("creates role marketplace operation work blocks for the default marketplace goal", () => {
    const goal: CompanyGoal = {
      ...makeGoal(),
      title: "提升岗位商城首批岗位授权转化与执行成功率",
      metric: "首批岗位授权转化与执行成功率",
      target: "首批岗位可授权、可执行、可回写",
      rationale: "岗位商城经营主闭环",
    };
    const { planning, rolePlanItems } = generatePlanningPackage({ goal });
    expect(rolePlanItems.map((item) => item.title)).toEqual([
      "岗位供给优化",
      "岗位详情页转化优化",
      "执行质量提升",
      "授权费用治理",
      "审核阻塞处理",
    ]);
    expect(rolePlanItems.every((item) => item.category === "岗位商城")).toBe(true);
    expect(rolePlanItems.some((item) => item.roleCapabilityRef === "ecommerce-visual")).toBe(true);
    expect(planning.rolePlanItems.length).toBe(5);
  });

  it("creates data baseline plan item when attribution has low confidence findings", () => {
    const goal = makeGoal();
    const attr = makeAttr();
    const obs = makeObs();
    const { planning, rolePlanItems } = generatePlanningPackage({
      goal,
      attributionReport: attr,
      observationPackage: obs,
    });
    expect(rolePlanItems.length).toBeGreaterThan(0);
    expect(rolePlanItems.some((rpi) => rpi.roleCapabilityRef === "data-collection")).toBe(true);
    expect(planning.rolePlanItems.length).toBe(rolePlanItems.length);
  });

  it("creates default execution item when no findings", () => {
    const { planning, rolePlanItems } = generatePlanningPackage({ goal: makeGoal() });
    expect(rolePlanItems.length).toBe(1);
    expect(rolePlanItems[0].roleCapabilityRef).toBe("general-execution");
  });
});

describe("generateDispatchProposal", () => {
  it("creates proposal for each role plan item", () => {
    const pp: PlanningPackage = {
      id: "pp1",
      kind: "PlanningPackage",
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
      auditRefs: [],
      goalId: "g1",
      title: "方案",
      summary: "",
      rolePlanItemIds: ["rpi1", "rpi2"],
    };
    const items: RolePlanItem[] = [
      {
        id: "rpi1",
        kind: "RolePlanItem",
        status: "confirmed",
        createdAt: now,
        updatedAt: now,
        auditRefs: [],
        planningPackageId: "pp1",
        title: "数据收集",
        roleCapabilityRef: "data",
        taskIntent: "收集",
        expectedOutput: "数据",
        humanConfirmationRequired: false,
      },
      {
        id: "rpi2",
        kind: "RolePlanItem",
        status: "confirmed",
        createdAt: now,
        updatedAt: now,
        auditRefs: [],
        planningPackageId: "pp1",
        title: "高危操作",
        roleCapabilityRef: "danger",
        taskIntent: "危险",
        expectedOutput: "结果",
        humanConfirmationRequired: true,
      },
    ];
    const results = generateDispatchProposal({ planningPackage: pp, rolePlanItems: items });
    expect(results.length).toBe(2);
    expect(results[0].proposal.riskSummary).toContain("LOW");
    expect(results[1].proposal.riskSummary).toContain("HIGH");
  });
});

describe("materializeTaskPackage", () => {
  it("materializes a task from dispatch proposal", () => {
    const dp: DispatchProposalReview = {
      id: "dp1",
      kind: "DispatchProposalReview",
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
      auditRefs: [],
      planningPackageId: "pp1",
      rolePlanItemId: "rpi1",
      title: "调度",
      riskSummary: "LOW",
      confirmationSummary: "安全",
    };
    const rpi: RolePlanItem = {
      id: "rpi1",
      kind: "RolePlanItem",
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
      auditRefs: [],
      planningPackageId: "pp1",
      title: "任务",
      roleCapabilityRef: "data",
      taskIntent: "收集",
      expectedOutput: "数据",
      humanConfirmationRequired: false,
    };
    const result = materializeTaskPackage({ dispatchProposal: dp, rolePlanItem: rpi });
    expect(result.taskText).toContain("收集");
    expect(result.taskText).toContain("LOW");
  });

  it("binds the first ecommerce visual task to the platform marketplace role", () => {
    const dp: DispatchProposalReview = {
      id: "dp1",
      kind: "DispatchProposalReview",
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
      auditRefs: [],
      planningPackageId: "pp1",
      rolePlanItemId: "rpi1",
      title: "调度",
      riskSummary: "HIGH",
      confirmationSummary: "费用与授权确认",
    };
    const rpi: RolePlanItem = {
      id: "rpi1",
      kind: "RolePlanItem",
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
      auditRefs: [],
      planningPackageId: "pp1",
      title: "岗位详情页转化优化",
      category: "岗位商城",
      roleCapabilityRef: "ecommerce-visual",
      taskIntent: "优化岗位商品展示",
      expectedOutput: "展示优化方案",
      humanConfirmationRequired: true,
    };
    const result = materializeTaskPackage({ dispatchProposal: dp, rolePlanItem: rpi });
    expect(result.request?.roleListingId).toBe("role_marketplace_ecommerce_visual");
    expect(result.taskText).toContain("费用与授权确认");
  });
});
