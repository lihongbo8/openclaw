import { describe, it, expect } from "vitest";
import { compareObservationsToGoal, toAttributionInput } from "./attribution-comparator.js";
import type { ObservationPackage, CompanyGoal } from "./types.js";

const now = Date.now();

function makeObs(
  signals: Array<{ id: string; title: string; summary: string }>,
): ObservationPackage {
  return {
    id: "obs_1",
    kind: "ObservationPackage",
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
    auditRefs: [],
    title: "测试观察",
    summary: "测试观察包",
    signals: signals.map((s) => ({ ...s, evidenceRefs: [] })),
  };
}

function makeGoal(metric: string, target: string): CompanyGoal {
  return {
    id: "goal_1",
    kind: "CompanyGoal",
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
    auditRefs: [],
    attributionReportId: "attr_1",
    title: "测试目标",
    owner: "tester",
    metric,
    target,
    rationale: "test",
  };
}

describe("compareObservationsToGoal", () => {
  it("marks data insufficient when no previous goal", () => {
    const obs = makeObs([{ id: "s1", title: "信号", summary: "3 个岗位已发布" }]);
    const result = compareObservationsToGoal({ observation: obs });
    expect(result.dataInsufficient).toBe(true);
    expect(result.completionStatus).toBe("unknown");
  });

  it("marks data insufficient when observation has no signals", () => {
    const obs = makeObs([]);
    const goal = makeGoal("岗位数量", "5 个");
    const result = compareObservationsToGoal({ observation: obs, previousGoal: goal });
    expect(result.dataInsufficient).toBe(true);
  });

  it("detects missing metric signals", () => {
    const obs = makeObs([{ id: "s1", title: "其他数据", summary: "无关数据 10 项" }]);
    const goal = makeGoal("岗位数量", "5 个");
    const result = compareObservationsToGoal({ observation: obs, previousGoal: goal });
    expect(result.dataInsufficient).toBe(true);
    expect(result.dataInsufficientReason).toContain("岗位数量");
  });

  it("calculates gap when target and actual both numeric", () => {
    const obs = makeObs([{ id: "s1", title: "岗位数量", summary: "已发布 3 个岗位" }]);
    const goal = makeGoal("岗位数量", "5 个");
    const result = compareObservationsToGoal({ observation: obs, previousGoal: goal });
    expect(result.dataInsufficient).toBe(false);
    expect(result.completionStatus).toBe("off_track"); // 3 vs 5 = 40% gap
    expect(result.rankedCauses.length).toBeGreaterThan(0);
  });

  it("detects on_track when gap is small", () => {
    const obs = makeObs([{ id: "s1", title: "岗位数量", summary: "已发布 5 个岗位" }]);
    const goal = makeGoal("岗位数量", "5 个");
    const result = compareObservationsToGoal({ observation: obs, previousGoal: goal });
    expect(result.completionStatus).toBe("on_track");
  });

  it("flags failure signals as causes", () => {
    const obs = makeObs([
      { id: "s1", title: "岗位数量", summary: "已发布 5 个岗位" },
      { id: "s2", title: "服务故障", summary: "API 不可用" },
    ]);
    const goal = makeGoal("岗位数量", "5 个");
    const result = compareObservationsToGoal({ observation: obs, previousGoal: goal });
    expect(result.rankedCauses.length).toBeGreaterThanOrEqual(2);
    expect(result.rankedCauses.some((c) => c.title === "服务故障")).toBe(true);
  });
});

describe("toAttributionInput", () => {
  it("converts compare result to attribution input", () => {
    const result = {
      completionStatus: "off_track" as const,
      gapSummary: "差距 40%",
      rankedCauses: [
        {
          rank: 1,
          title: "Gap",
          summary: "40% behind",
          confidence: "high" as const,
          impactLevel: "critical" as const,
          evidenceRefs: [],
        },
      ],
      dataInsufficient: false,
    };
    const input = toAttributionInput(result, "obs_1");
    expect(input.findings.length).toBe(1);
    expect(input.title).toContain("归因报告");
  });
});
