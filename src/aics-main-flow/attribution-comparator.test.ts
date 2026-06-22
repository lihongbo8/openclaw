import { describe, it, expect } from "vitest";
import {
  AICS_ATTRIBUTION_DIMENSIONS,
  compareObservationsToGoal,
  toAttributionInput,
} from "./attribution-comparator.js";
import type { ObservationPackage, CompanyGoal } from "./types.js";

const now = Date.now();

function makeObs(
  signals: Array<{
    id: string;
    title: string;
    summary: string;
    evidenceRefs?: string[];
    usableForAttribution?: boolean;
  }>,
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
    signals: signals.map((s) => ({
      ...s,
      evidenceRefs: s.evidenceRefs ?? [`evidence:${s.id}`],
    })),
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
  it("generates evidence-based attribution candidates when no previous goal exists", () => {
    const obs = makeObs([
      { id: "s1", title: "API 状态", summary: "DeepSeek Provider 不可用，模型连接 blocked" },
    ]);
    const result = compareObservationsToGoal({ observation: obs });
    expect(result.dataInsufficient).toBe(false);
    expect(result.completionStatus).toBe("unknown");
    expect(result.gapSummary).toContain("不计算目标完成率");
    expect(result.rankedCauses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "API / 模型 / 工具 / Skill 问题",
          evidenceRefs: ["s1"],
        }),
      ]),
    );
  });

  it("blocks attribution when observation signals have no evidence refs", () => {
    const obs = makeObs([
      { id: "s1", title: "API 状态", summary: "DeepSeek Provider 不可用", evidenceRefs: [] },
    ]);
    const result = compareObservationsToGoal({ observation: obs });
    expect(result.dataInsufficient).toBe(true);
    expect(result.dataInsufficientReason).toContain("evidenceRefs");
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
    expect(result.rankedCauses.some((c) => c.title === "API / 模型 / 工具 / Skill 问题")).toBe(
      true,
    );
    expect(
      result.rankedCauses.every((cause) =>
        cause.evidenceRefs.every((ref) => ref === "s1" || ref === "s2"),
      ),
    ).toBe(true);
  });

  it("classifies marketplace production blockers by fixed production dimensions", () => {
    const obs = makeObs([
      { id: "s1", title: "授权转化", summary: "授权转化 5 次" },
      { id: "s2", title: "DeepSeek Provider", summary: "模型 provider unhealthy，不可用" },
      { id: "s3", title: "独特能力申请", summary: "独特能力 pending，岗位不可调用" },
      { id: "s4", title: "外部工具观察", summary: "外部模型工具出现可吸收能力" },
      { id: "s5", title: "商城审核", summary: "岗位商品上架 review rejected，商城发布 blocked" },
      { id: "s6", title: "本地服务", summary: "本地 OpenClaw gateway 端口异常，runtime 不可用" },
      { id: "s7", title: "岗位供给", summary: "运营岗位数量缺失，品类能力标签样例不足" },
      { id: "s8", title: "API 管理页面", summary: "API 管理保存后不回显，按钮点击无反应" },
      { id: "s9", title: "派发队列", summary: "调度 dispatch 执行队列 blocked" },
      { id: "s10", title: "岗位执行结果", summary: "RoleResult readback 失败，产物审计账本缺失" },
      { id: "s11", title: "竞品观察", summary: "竞品推出替代品，形成外部产品价格压力" },
      { id: "s12", title: "数据质量", summary: "观察证据过期，样本低可信" },
      { id: "s13", title: "目标口径", summary: "目标指标口径不一致，target 无法量化，阻塞归因" },
    ]);
    const goal = makeGoal("授权转化", "10 次");
    const result = compareObservationsToGoal({ observation: obs, previousGoal: goal });
    const titles = result.rankedCauses.map((c) => c.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "API / 模型 / 工具 / Skill 问题",
        "能力路由问题",
        "外部能力未吸收",
        "商城问题",
        "本地服务问题",
        "岗位供给问题",
        "页面体验问题",
        "调度链路问题",
        "岗位执行质量问题",
        "外部产品压力",
        "风险与数据质量问题",
        "目标设定问题",
      ]),
    );
    expect(
      titles.every(
        (title) =>
          title === "目标与实际差距" ||
          (AICS_ATTRIBUTION_DIMENSIONS as readonly string[]).includes(title),
      ),
    ).toBe(true);
    expect(result.rankedCauses.some((c) => c.evidenceRefs.includes("obs_1"))).toBe(false);
    expect(result.rankedCauses.some((c) => c.evidenceRefs.includes("goal_1"))).toBe(false);
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
          title: "目标与实际差距",
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
